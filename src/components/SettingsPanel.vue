<template>
  <Teleport to="body">
    <Transition name="settings-panel">
      <div v-if="visible" class="settings-overlay" @click.self="$emit('close')">
        <div class="settings-dialog">
          <div class="dialog-header">
            <span class="dialog-icon">⚙️</span>
            <h3>设置</h3>
            <button class="btn-close" @click="$emit('close')">✕</button>
          </div>

          <div class="dialog-body">
            <!-- 自动更新 -->
            <div class="setting-item">
              <div class="setting-info">
                <div class="setting-label">自动检查更新</div>
                <div class="setting-desc">启动时自动检查是否有新版本</div>
              </div>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="localSettings.autoUpdate"
                  @change="toggle('autoUpdate')"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <hr class="setting-divider" />

            <!-- 记住房间号 -->
            <div class="setting-item">
              <div class="setting-info">
                <div class="setting-label">记住房间号</div>
                <div class="setting-desc">下次启动时自动填入上次连接的房间号</div>
              </div>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="localSettings.rememberRoom"
                  @change="toggle('rememberRoom')"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <!-- 记住转发地址 -->
            <div class="setting-item">
              <div class="setting-info">
                <div class="setting-label">记住转发地址</div>
                <div class="setting-desc">下次启动时自动填入上次转发地址</div>
              </div>
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="localSettings.rememberRelay"
                  @change="toggle('rememberRelay')"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <hr class="setting-divider" />

            <div class="setting-item">
              <div class="setting-info">
                <div class="setting-label">主题外观</div>
                <div class="setting-desc">选择应用界面的亮色或暗色主题</div>
              </div>
              <div class="theme-selector">
                <button
                  :class="['theme-btn', { active: localSettings.theme === 'dark' }]"
                  @click="selectTheme('dark')"
                >
                  🌙 暗色
                </button>
                <button
                  :class="['theme-btn', { active: localSettings.theme === 'light' }]"
                  @click="selectTheme('light')"
                >
                  ☀️ 亮色
                </button>
              </div>
            </div>

            <hr class="setting-divider" />

            <!-- 转发消息类型过滤 -->
            <div class="setting-item section-header">
              <div class="setting-info">
                <div class="setting-label">转发消息类型</div>
                <div class="setting-desc">选择要转发到 WebSocket 服务的消息类型</div>
              </div>
            </div>
            <div class="relay-filter-grid">
              <label
                v-for="item in relayTypeList"
                :key="item.method"
                class="relay-filter-item"
              >
                <input
                  type="checkbox"
                  :checked="localSettings.relayFilter.includes(item.method)"
                  @change="toggleRelayType(item.method)"
                />
                <span class="relay-filter-label">{{ item.label }}</span>
              </label>
            </div>

            <hr class="setting-divider" />

            <!-- 录制消息类型过滤 -->
            <div class="setting-item section-header">
              <div class="setting-info">
                <div class="setting-label">录制消息类型</div>
                <div class="setting-desc">选择要录制到 .jsonl 文件的消息类型</div>
              </div>
            </div>
            <div class="relay-filter-grid">
              <label
                v-for="item in recordTypeList"
                :key="item.method"
                class="relay-filter-item"
              >
                <input
                  type="checkbox"
                  :checked="localSettings.recordFilter.includes(item.method)"
                  @change="toggleRecordType(item.method)"
                />
                <span class="relay-filter-label">{{ item.label }}</span>
              </label>
            </div>

            <hr class="setting-divider" />

            <!-- 最大重连次数 -->
            <div class="setting-item">
              <div class="setting-info">
                <div class="setting-label">最大重连次数</div>
                <div class="setting-desc">连接断开时的重连上限（0-20，需重连生效）</div>
              </div>
              <input
                type="number"
                class="reconnect-input"
                min="0"
                max="20"
                :value="localSettings.maxReconnectCount"
                @change="changeMaxReconnect"
              />
            </div>

            <hr class="setting-divider" />

            <!-- 手动检查更新 -->
            <div class="setting-item">
              <div class="setting-info">
                <div class="setting-label">检查更新</div>
                <div class="setting-desc">手动检查是否有新版本可用</div>
              </div>
              <button class="btn-check" :disabled="checking" @click="handleCheckUpdate">
                {{ checking ? '检查中...' : '立即检查' }}
              </button>
            </div>

            <!-- 检查结果 -->
            <div v-if="checkResult" class="check-result" :class="checkResult.type">
              {{ checkResult.message }}
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { settings, FORWARDABLE_TYPES, defaults, type AppTheme } from '@/hooks/useSettings';
import { CastMethod } from '@/core/dycast';
import { useUpdater } from '@/hooks/useUpdater';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

// 深拷贝数组字段，避免 splice/push 直接修改全局 settings（relayFilter/recordFilter 是引用类型）
const localSettings = reactive({
  ...settings,
  relayFilter: [...settings.relayFilter],
  recordFilter: [...settings.recordFilter]
});
const checking = ref(false);
const checkResult = ref<{ type: string; message: string } | null>(null);

// Sync local changes back to persistent store
watch(
  () => ({ ...localSettings }),
  (val) => {
    Object.assign(settings, val);
  },
  { deep: true },
);

const typeLabels: Record<string, string> = {
  [CastMethod.CHAT]: '聊天',
  [CastMethod.GIFT]: '礼物',
  [CastMethod.LIKE]: '点赞',
  [CastMethod.MEMBER]: '进场',
  [CastMethod.SOCIAL]: '关注',
  [CastMethod.EMOJI_CHAT]: '表情',
  [CastMethod.CONTROL]: '直播状态',
  [CastMethod.FANSCLUB]: '粉丝团',
  [CastMethod.ROOM_RANK]: '排行',
};

const relayTypeList = FORWARDABLE_TYPES.map(m => ({ method: m, label: typeLabels[m] || m }));
const recordTypeList = FORWARDABLE_TYPES.map(m => ({ method: m, label: typeLabels[m] || m }));

function toggle(key: 'autoUpdate' | 'rememberRoom' | 'rememberRelay') {
  localSettings[key] = !localSettings[key];
}

function changeMaxReconnect(ev: Event) {
  const val = parseInt((ev.target as HTMLInputElement).value, 10);
  if (Number.isFinite(val)) {
    localSettings.maxReconnectCount = Math.min(20, Math.max(0, val));
  } else {
    localSettings.maxReconnectCount = defaults.maxReconnectCount;
  }
}

function toggleRecordType(method: CastMethod) {
  const idx = localSettings.recordFilter.indexOf(method);
  if (idx >= 0) {
    localSettings.recordFilter.splice(idx, 1);
  } else {
    localSettings.recordFilter.push(method);
  }
}

function toggleRelayType(method: CastMethod) {
  const idx = localSettings.relayFilter.indexOf(method);
  if (idx >= 0) {
    localSettings.relayFilter.splice(idx, 1);
  } else {
    localSettings.relayFilter.push(method);
  }
}

function selectTheme(theme: AppTheme) {
  localSettings.theme = theme;
}

async function handleCheckUpdate() {
  checking.value = true;
  checkResult.value = null;

  const { status, checkUpdate } = useUpdater();
  await checkUpdate();

  if (status.value.available) {
    checkResult.value = {
      type: 'available',
      message: `发现新版本 v${status.value.version}，请关闭设置后点击弹出的更新对话框进行更新`,
    };
    // Keep the update dialog visible — it's managed by App.vue
  } else if (status.value.error) {
    checkResult.value = {
      type: 'error',
      message: `检查失败：${status.value.error}。可能原因：网络不通或尚未发布包含更新清单 (latest.json) 的新版本。推送新 tag 后 CI 将自动生成。`,
    };
  } else {
    checkResult.value = {
      type: 'none',
      message: '当前已是最新版本（或暂未发布新版本更新清单）',
    };
  }
  checking.value = false;

  // Auto-clear result after 5s
  setTimeout(() => {
    checkResult.value = null;
  }, 5000);
}
</script>

<style lang="scss" scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: var(--app-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(4px);
}

.settings-dialog {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  width: 440px;
  max-width: 90vw;
  max-height: 80vh;
  overflow: hidden;
  box-shadow: var(--app-shadow);
  display: flex;
  flex-direction: column;
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--app-border);

  .dialog-icon {
    font-size: 20px;
  }

  h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    color: var(--app-text);
    flex: 1;
  }

  .btn-close {
    background: none;
    border: none;
    color: var(--app-text-muted);
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: all 0.15s;

    &:hover {
      color: var(--app-text);
      background: var(--app-surface-soft);
    }
  }
}

.dialog-body {
  padding: 12px 24px 24px;
  flex: 1;
  overflow-y: auto;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  gap: 16px;
}

.setting-info {
  flex: 1;
  min-width: 0;

  .setting-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--app-text);
  }

  .setting-desc {
    font-size: 12px;
    color: var(--app-text-muted);
    margin-top: 2px;
  }
}

.setting-divider {
  border: 0;
  border-top: 1px solid var(--app-border);
  margin: 0;
}

// Toggle switch
.toggle {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
  cursor: pointer;

  input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-slider {
    position: absolute;
    inset: 0;
    background: var(--app-border);
    border-radius: 12px;
    transition: background 0.2s;

    &::before {
      content: '';
      position: absolute;
      width: 18px;
      height: 18px;
      left: 3px;
      top: 3px;
      background: var(--app-surface);
      border-radius: 50%;
      transition: transform 0.2s;
    }
  }

  input:checked + .toggle-slider {
    background: var(--app-accent);

    &::before {
      transform: translateX(20px);
      background: #fff;
    }
  }
}

// Theme selector
.theme-selector {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.theme-btn {
  padding: 6px 12px;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background: transparent;
  color: var(--app-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: var(--app-accent);
    color: var(--app-text);
  }

  &.active {
    background: var(--app-accent);
    border-color: var(--app-accent);
    color: #fff;
  }
}

// Reconnect count input
.reconnect-input {
  width: 60px;
  padding: 6px 8px;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background: transparent;
  color: var(--app-text);
  font-size: 13px;
  text-align: center;
  flex-shrink: 0;

  &:focus {
    outline: none;
    border-color: var(--app-accent);
  }
}

// Check update button
.btn-check {
  padding: 6px 14px;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background: transparent;
  color: var(--app-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    border-color: var(--app-accent);
    color: var(--app-accent);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

// Check result
.check-result {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;

  &.available {
    background: rgba(104, 190, 141, 0.12);
    border: 1px solid var(--app-accent);
    color: var(--app-accent-strong);
  }

  &.none {
    background: var(--app-surface-soft);
    border: 1px solid var(--app-border);
    color: var(--app-text-muted);
  }

  &.error {
    background: rgba(233, 84, 100, 0.12);
    border: 1px solid var(--app-danger);
    color: var(--app-danger);
  }
}

// Relay filter grid
.section-header {
  padding-bottom: 4px;
}

.relay-filter-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  padding: 4px 0 8px;
}

.relay-filter-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--app-text);
  background: var(--app-surface-soft);
  transition: background 0.15s;
  user-select: none;

  input {
    accent-color: var(--app-accent);
  }

  &:hover {
    background: var(--app-surface-hover);
  }
}

.relay-filter-label {
  line-height: 1;
}

// Transitions
.settings-panel-enter-active,
.settings-panel-leave-active {
  transition: opacity 0.2s;
}

.settings-panel-enter-from,
.settings-panel-leave-to {
  opacity: 0;
}
</style>
