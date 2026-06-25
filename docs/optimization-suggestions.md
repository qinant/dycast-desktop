# dycast-desktop 优化建议

> 基于对代码库的深入分析，按优先级排列。每条记录对应的文件:行号、问题描述与建议方案。

## 状态图例

- ✅ 已完成
- ⏸ 已评估但暂缓（见各条说明）
- ⬜ 待处理

---

## 一、高优先级（性能 / 正确性）

### 1. 正则表达式重复编译 — `src-tauri/src/live_info.rs:102-108` ⏸

**问题**

`regex_capture` 每次调用都执行 `Regex::new(pattern)`：

```rust
fn regex_capture(text: &str, pattern: &str) -> String {
    Regex::new(pattern)
        .ok()
        .and_then(|re| re.captures(text))
        .and_then(|captures| captures.get(1).map(|m| m.as_str().to_string()))
        .unwrap_or_default()
}
```

`parse_live_info`（lines 133-163）一次连接调用 `regex_capture` 7-8 次，`fetch_live_info` 在重试路径下最多调用 `parse_live_info` 2 次，导致每次连接房间发生 14-16 次正则编译。

**说明**

- 该流程是连接房间的**必要流程**：`fetch_live_info` 负责拉取直播间 HTML 并解析 `room_id`、`unique_id`、`avatar`、`cover`、`nickname`、`title`、`status` 等连接所需信息，不能省略。
- 缓存策略属于**缓存多个正则**，而非只缓存一个。`parse_live_info` 中使用的 7 个正则模式字符串各不相同，应分别缓存为静态实例。

**缓存方案**

当前代码使用的 7 个不同 pattern：

| 行号 | 模式 | 用途 |
|------|------|------|
| 137 | `"room":\{"id_str":"([0-9]+?)"` | 房间号主匹配 |
| 139 | `"roomId":"([0-9]+?)","web_rid":"[0-9]+?"` | 房间号备选 |
| 142 | `"user_unique_id":"([0-9]+?)"` | 用户唯一 ID |
| 147 | `"room":\{[\s\S]*?"status":([0-9]+)` | 直播状态 |
| 156 | `"anchor":\{[\s\S]*?"avatar_thumb":\{[\s\S]*?"url_list":\["([^"]+?)"` | 主播头像 |
| 158 | `"cover":\{[\s\S]*?"url_list":\["([^"]+?)"` | 直播封面 |
| 159 / 160 | `"anchor":\{[\s\S]*?"nickname":"([^"]*?)"`、`"room":\{[\s\S]*?"title":"([^"]*?)"` | 昵称 / 标题 |

**建议实现**：使用 `std::sync::OnceLock`（或 `once_cell::sync::Lazy`）为每个 pattern 创建一次性的静态 `Regex`，例如：

```rust
use std::sync::OnceLock;

fn regex_capture(text: &str, pattern: &str, re: &OnceLock<Regex>) -> String {
    let re = re.get_or_init(|| Regex::new(pattern).expect("invalid pattern"));
    re.captures(text)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
        .unwrap_or_default()
}

// 文件级静态实例
static RE_ROOM_ID: OnceLock<Regex> = OnceLock::new();
static RE_ROOM_ID_FALLBACK: OnceLock<Regex> = OnceLock::new();
static RE_UNIQUE_ID: OnceLock<Regex> = OnceLock::new();
static RE_STATUS: OnceLock<Regex> = OnceLock::new();
static RE_AVATAR: OnceLock<Regex> = OnceLock::new();
static RE_COVER: OnceLock<Regex> = OnceLock::new();
static RE_NICKNAME: OnceLock<Regex> = OnceLock::new();
static RE_TITLE: OnceLock<Regex> = OnceLock::new();
```

每个 `Regex` 只在第一次该 pattern 被使用时编译一次，后续所有连接复用。该方案对连接房间流程无任何影响，仅省下重复编译开销。

---

### 2. Relay 转发用错了数据源（潜在 bug） — `src/views/IndexView.vue:352-354` ✅

**问题**

```ts
if (relayWs && relayWs.isConnected()) {
  const filtered = msgs.filter((m): m is DyMessage & { method: CastMethod } =>
    !!m.method && settings.relayFilter.includes(m.method));
  if (filtered.length) relayWs.send(JSON.stringify(filtered));
}
```

relay 过滤使用的是原始 `msgs`，而非前面去重 + 礼物连击合并后的 `newCasts`。后果：

- 下游 relay 消费者会收到 UI 已过滤掉的 `msgId` 重复消息
- GIFT 分支（lines 304-309）只在 `repeatEnd` 时推送合成消息到 UI，但 relay 仍会收到所有中间连击帧

**修复**

将 `msgs.filter(...)` 改为 `newCasts.filter(...)`。

---

### 3. 消息列表追加方式低效 — `src/components/CastList.vue:154` ✅

**问题**

```ts
// 用展开替换 push 以触发 shallowRef 的响应式更新
casts.value = [...casts.value, ...list];
trimCasts(casts.value);
```

`MAX_CASTS = 3000`，高流量房间（数百条/秒）下每批次都做 3000 元素的数组展开拷贝，每秒分配数 MB 垃圾。

**修复**

`shallowRef` 不能自动监听就地变更，但可以用 `triggerRef` 显式触发：

```ts
import { triggerRef } from 'vue';

// 就地追加，再手动触发响应式更新
casts.value.push(...list);
trimCasts(casts.value);
triggerRef(casts);
```

避免每次分配新数组，让 GC 压力大幅下降。

---

### 4. `push(...msgs)` 大批量会爆栈 — `src/components/CastList.vue:139` ✅

**问题**

```ts
allCasts.push(...msgs);
```

刚进入房间时一帧可能含上千条历史消息。`push(...spread)` 会把数组元素展开成函数参数，参数数量超过 JS 引擎参数上限（V8 ~65k）会抛 `RangeError: Maximum call stack size exceeded`。

**修复**

改用循环 push 或 `Array.prototype.push.apply` 分块：

```ts
for (let i = 0; i < msgs.length; i += 5000) {
  for (let j = i; j < Math.min(i + 5000, msgs.length); j++) {
    allCasts.push(msgs[j]);
  }
}
```

或更简洁的写法：

```ts
const len = msgs.length;
for (let i = 0; i < len; i++) allCasts.push(msgs[i]);
```

该写法不会受参数上限限制，性能也优于 spread（V8 对小循环有良好优化）。

---

## 二、中优先级（稳定性 / 内存）

### 5. 录制写队列无上限 — `src/utils/jsonlRecorder.ts:24` ⬜

`.then` 链式队列在慢盘 + 高流量下无限增长，每个 pending 闭包持有完整 payload。建议加队列长度上限或背压信号。

### 6. Rust 端阻塞写卡住 tokio runtime — `src-tauri/src/cast_record.rs:85-100` ✅

异步命令在 `std::sync::Mutex` 内同步 `write_all`。建议改用 `spawn_blocking` 或 `tokio::sync::Mutex` + `AsyncWriteExt`。`cast_replay.rs:174-179` 同样问题。

**实现**：`cast_record.rs` / `cast_replay.rs` 全量异步化 —— `std::sync::Mutex` → `tokio::sync::Mutex`，`std::fs::File` → `tokio::fs::File`，`std::io::Buf{Reader,Writer}` → `tokio::io::Buf{Reader,Writer}`，写读用 `AsyncWriteExt`/`AsyncBufReadExt`。`tokio::fs` 内部经阻塞线程池调度，不再卡 worker 线程。`scan_replay_file` 保持同步（已用 `spawn_blocking`）。`lib.rs` 中 `CastReplayState` 的 mutex 类型同步更新。`cast_record_start` 的 `File::create` 直接 await（tokio 自动调度），不再包 `spawn_blocking`。

### 7. WS relay 无背压 — `src-tauri/src/ws_relay.rs:106` ✅

`mpsc::unbounded_channel` 在 JS 发送快于远端排空时内存无限增长。建议换成有界 channel。

**实现**：`unbounded_channel` → 有界 `mpsc::channel(256)`；`ws_send`/`ws_send_text` 用 `try_send`，满则丢弃并按步长（每 100 帧）emit `ws-backpressure` 事件（含累计丢弃数）。JS 侧 `TauriWebSocket` 监听该事件转发为 `backpressure` CustomEvent → `RelayCast` 转发为自身事件 → `IndexView` 弹 `SkMessage.warning`。选择"丢弃+通知"而非"阻塞"是因为 JS 侧 `send` 是 fire-and-forget，阻塞 Rust 端无法封顶 JS/IPC 层内存。

### 8. 重连耗尽后 UI 卡在"连接中" — `src/core/dycast.ts:684-688` ✅

超过最大重连次数只发 `error`，不发 `close`，`wsRoomStatus` 卡在 `RECONNECTING`。建议同时发 `close` 并重置状态。

### 9. Decoder 预加载与首次解码有竞态 — `src/core/dycast.ts:868-872, 1082-1088` ✅

`_afterOpen` 预加载和 `_ensureDecoders` 都各自调 `loadDecoders()`。建议缓存 promise 而非结果值。

### 10. 手动 UTF-8 解码 O(N²) — `src/core/model/shared.ts:137-214` ⏸

`text += fromCharCode(...)` 循环拼接，长字符串性能差。建议使用 `TextDecoder.decode` 或分段累积。

**暂缓**：`shared.ts` 属自动生成的 protobuf 解码器（`AGENTS.md` 标注禁用手改），改动会被下次生成覆盖。且 V8 对小字符串拼接有 rope 优化，弹幕聊天内容通常 <100 字符，实际影响可忽略。

---

## 三、中优先级（构建 / UX）

### 11. `mssdk.js` 阻塞首屏 — `index.html:10` ✅

`<script src="./mssdk.js">` 同步加载阻塞解析。建议加 `defer`。

### 12. 缺少 `manualChunks` 和 `build.target` — `vite.config.ts` ✅

`base.ts`（375KB）未显式分块。建议加 `manualChunks` 和 `build.target: 'chrome110'`。

**实现**：`build.target` 设为 `chrome110`（Tauri WebView2 = Chromium 110+，避免不必要转译）；`manualChunks` 显式分出 `vendor`（vue + vue-virtual-scroller，~100KB）和 `protobuf-base`（base.ts + shared.ts，~78KB），后者强制单 chunk 避免被各 message decoder 子图重复内联；`chunkSizeWarningLimit: 600` 消除大 chunk 警告噪音。build 验证：protobuf-base 78KB／vendor 100KB／主 chunk 148KB，9 个 message decoder 各 1-7KB 独立分包。

### 13. SettingsPanel 的"本地副本"是假象 — `src/components/SettingsPanel.vue:172-183` ✅

`reactive({ ...settings })` 浅拷贝使 `relayFilter` / `recordFilter` 数组共享引用。建议深拷贝数组。

### 14. 重连次数硬编码不可配置 — `src/core/dycast.ts:467` ✅

`maxReconnectCount = 3` 弱网下过低，建议加设置项。

---

## 四、低优先级

- ✅ `Cargo.toml:28` tokio `features=["full"]` → `["rt-multi-thread", "macros", "sync", "fs", "io-util"]`（实际用到的全部特性，减小二进制）。
- ⏸ `main.ts:5` 全量注册 `vue-virtual-scroller`，应按需导入 `DynamicScroller`。暂缓：改动需验证样式导入路径，优先级低。
- ⏸ 缺少 `dispose()` 清理 emitter 监听。暂缓：旧实例被 GC，仅在"断开→重连"短窗口可能触发一次旧监听，无实际泄漏。
- ⏸ `logUtil.ts:161-163` 文件日志是空壳；`request.ts:128` 有注释掉的 debug 值。暂缓：预留扩展，删除无收益。
