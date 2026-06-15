<template>
  <div :class="['index-view', `theme-${appTheme}`]">
    <div class="view-left">
      <LiveInfo
        :cover="cover"
        :title="title"
        :avatar="avatar"
        :nickname="nickname"
        :follow-count="followCount"
        :member-count="memberCount"
        :user-count="userCount"
        :like-count="likeCount" />
      <div class="view-left-bottom">
        <SidTool />
        <div class="view-left-tools">
          <span class="version-text">v{{ version }}</span>
          <div
            :class="['view-left-tool', 'cm-btn', `record-${recordState}`]"
            :title="recordToolTitle"
            @click.stop="handleRecordToolClick">
            <i class="ice-save icon"></i>
          </div>
          <div
            :class="['view-left-tool', 'cm-btn', `replay-${replayState}`]"
            :title="replayToolTitle"
            @click.stop="showReplay = true">
            <svg class="icon" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          </div>
          <div
            class="view-left-tool cm-btn"
            title="设置"
            @click.stop="showSettings = true">
            <svg class="icon" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </div>
        </div>
        <hr class="hr" />
        <LiveStatusPanel ref="panel" :status="connectStatus" />
      </div>
    </div>
    <div class="view-center">
      <!-- 主要弹幕：聊天、礼物 -->
      <CastList :types="['chat', 'gift']" ref="castEl" :theme="appTheme" />
    </div>
    <div class="view-right">
      <div class="view-input">
        <ConnectInput
          ref="roomInput"
          label="房间号"
          placeholder="请输入房间号"
          v-model:value="roomNum"
          :test="verifyRoomNumber"
          @confirm="connectLive"
          @cancel="disconnectLive" />
        <ConnectInput
          ref="relayInput"
          label="WS地址"
          placeholder="请输入转发地址"
          confirm-text="转发"
          cancel-text="停止"
          v-model:value="relayUrl"
          :test="verifyWssUrl"
          @confirm="relayCast"
          @cancel="stopRelayCast" />
      </div>
      <div class="view-other">
        <!-- 其它弹幕：关注、点赞、进入、控制台等 -->
        <CastList ref="otherEl" :types="['social', 'like', 'member']" pos="left" no-prefix :theme="appTheme" />
      </div>
    </div>
    <SettingsPanel :visible="showSettings" @close="showSettings = false" />
    <RecordPanel :visible="showRecord" :state="recordState" :count="recordingCount" @close="showRecord = false" @select="startCastRecording" @pause="pauseCastRecording" @resume="resumeCastRecording" @stop="stopCastRecording" />
    <ReplayPanel :visible="showReplay" :relay-url="relayUrl" @close="showReplay = false" @replay-start="onReplayStart" @replay-stop="onReplayStop" @state-change="onReplayStateChange" />
  </div>
</template>

<script setup lang="ts">
import ConnectInput from '@/components/ConnectInput.vue';
import LiveInfo from '@/components/LiveInfo.vue';
import LiveStatusPanel from '@/components/LiveStatusPanel.vue';
import CastList from '@/components/CastList.vue';
import SidTool from '@/components/SidTool/SidTool.vue';
import SettingsPanel from '@/components/SettingsPanel.vue';
import RecordPanel from '@/components/RecordPanel.vue';
import ReplayPanel from '@/components/ReplayPanel.vue';
import type { ReplayState } from '@/core/replayer';
import {
  CastMethod,
  DyCast,
  DyCastCloseCode,
  RoomStatus,
  type ConnectStatus,
  type DyLiveInfo,
  type DyMessage,
  type LiveRoom
} from '@/core/dycast';
import { verifyRoomNum, verifyWsUrl } from '@/utils/verifyUtil';
import { computed, ref, useTemplateRef, onMounted } from 'vue';
import { CLog } from '@/utils/logUtil';
import { getId } from '@/utils/idUtil';
import { RelayCast } from '@/core/relay';
import SkMessage from '@/components/Message';
import { formatDate } from '@/utils/commonUtil';
import { JsonlRecorder } from '@/utils/jsonlRecorder';
import { settings } from '@/hooks/useSettings';
import { version } from '../../package.json';

const MAX_DEDUPE_IDS = 10000;
type RecordState = 'idle' | 'recording' | 'paused';

// 连接状态
const connectStatus = ref<ConnectStatus>(0);
// 转发状态
const relayStatus = ref<ConnectStatus>(0);
// 房间号
const roomNum = ref<string>('');
// 房间号输入框状态
const roomInputRef = useTemplateRef('roomInput');
// 转发地址
const relayUrl = ref<string>('');
const relayInputRef = useTemplateRef('relayInput');
// 状态面板
const statusPanelRef = useTemplateRef('panel');

/** 直播间信息 */
const cover = ref<string>('');
const title = ref<string>('*****');
const avatar = ref<string>('');
const nickname = ref<string>('***');
const followCount = ref<string | number>('*****');
const memberCount = ref<string | number>('*****');
const userCount = ref<string | number>('*****');
const likeCount = ref<string | number>('*****');

// 主要弹幕
const castRef = useTemplateRef('castEl');
// 其它弹幕
const otherRef = useTemplateRef('otherEl');
// 记录弹幕
const castSet = new Set<string>();
const castIdQueue: string[] = [];
const recordState = ref<RecordState>('idle');
const recordingCount = ref(0);
const castRecorder = new JsonlRecorder<DyMessage>();
// 弹幕客户端
let castWs: DyCast | undefined;
// 转发客户端
let relayWs: RelayCast | undefined;
// 设置面板
const showSettings = ref(false);
// 记录面板
const showRecord = ref(false);
// 重放面板
const showReplay = ref(false);
const isReplaying = ref(false);
const replayState = ref<ReplayState>('idle');
const appTheme = computed(() => settings.theme);
const isRecording = computed(() => recordState.value !== 'idle');
const recordToolTitle = computed(() => {
  switch (recordState.value) {
    case 'recording':
      return `记录弹幕中(${recordingCount.value})`;
    case 'paused':
      return `弹幕记录已暂停(${recordingCount.value})`;
    default:
      return '记录弹幕';
  }
});
const replayToolTitle = computed(() => {
  switch (replayState.value) {
    case 'playing':
      return '弹幕重放中';
    case 'paused':
      return '弹幕重放已暂停';
    default:
      return '弹幕重放';
  }
});

onMounted(() => {
  // Restore remembered values
  if (settings.rememberRoom && settings.lastRoomId) {
    roomNum.value = settings.lastRoomId;
  }
  if (settings.rememberRelay && settings.lastRelayUrl) {
    relayUrl.value = settings.lastRelayUrl;
  }
});

/**
 * 验证房间号
 * @param value
 * @returns
 */
function verifyRoomNumber(value: string) {
  const flag = verifyRoomNum(value);
  if (flag) return { flag, message: '' };
  else {
    return { flag, message: '房间号错误' };
  }
}

/**
 * 验证转发地址 WsUrl
 * @param value
 * @returns
 */
function verifyWssUrl(value: string) {
  const flag = verifyWsUrl(value);
  if (flag) return { flag, message: '' };
  else {
    return { flag, message: '转发地址错误' };
  }
}

/** 设置房间号输入框状态 */
const setRoomInputStatus = function (flag?: boolean) {
  if (roomInputRef.value) roomInputRef.value.setStatus(flag);
};

/** 设置转发地址输入框状态 */
const setRelayInputStatus = function (flag?: boolean) {
  if (relayInputRef.value) relayInputRef.value.setStatus(flag);
};

/**
 * 设置房间统计信息
 * @param room
 * @returns
 */
const setRoomCount = function (room?: LiveRoom) {
  if (!room) return;
  if (room.audienceCount) memberCount.value = `${room.audienceCount}`;
  if (room.followCount) followCount.value = `${room.followCount}`;
  if (room.likeCount) likeCount.value = `${room.likeCount}`;
  if (room.totalUserCount) userCount.value = `${room.totalUserCount}`;
};
/**
 * 设置直播间信息
 * @param info
 */
const setRoomInfo = function (info?: DyLiveInfo) {
  if (!info) return;
  if (info.cover) cover.value = info.cover;
  if (info.title) title.value = info.title;
  if (info.avatar) avatar.value = info.avatar;
  if (info.nickname) nickname.value = info.nickname;
};

const addCastId = function (id: string) {
  if (castSet.has(id)) return false;
  castSet.add(id);
  castIdQueue.push(id);

  const overflow = castIdQueue.length - MAX_DEDUPE_IDS;
  if (overflow > 0) {
    const removed = castIdQueue.splice(0, overflow);
    for (const item of removed) castSet.delete(item);
  }

  return true;
};

const writeRecordedCasts = function (casts: DyMessage[]) {
  if (recordState.value !== 'recording' || !castRecorder.isRecording || !casts.length) return;
  const now = Date.now();
  const stamped = casts.map(c => ({ ...c, timestamp: now }));
  castRecorder
    .write(stamped)
    .then(count => {
      recordingCount.value = count;
    })
    .catch(err => {
      CLog.error('弹幕记录写入失败 =>', err);
      SkMessage.error('弹幕记录写入失败，已停止记录');
      recordState.value = 'idle';
      castRecorder.stop().catch(closeErr => {
        CLog.error('关闭弹幕记录文件失败 =>', closeErr);
      });
    });
};

/**
 * 处理消息列表
 */
const handleMessages = function (msgs: DyMessage[]) {
  const newCasts: DyMessage[] = [];
  const mainCasts: DyMessage[] = [];
  const otherCasts: DyMessage[] = [];
  try {
    for (const msg of msgs) {
      if (!msg.id) continue;
      const msgId = `${msg.method}-${msg.id}`;
      if (!addCastId(msgId)) continue;
      switch (msg.method) {
        case CastMethod.CHAT:
          newCasts.push(msg);
          mainCasts.push(msg);
          break;
        case CastMethod.GIFT:
          if (!msg?.gift?.repeatEnd) {
            newCasts.push(msg);
            mainCasts.push(msg);
          }
          break;
        case CastMethod.LIKE:
          newCasts.push(msg);
          otherCasts.push(msg);
          setRoomCount(msg.room);
          break;
        case CastMethod.MEMBER:
          newCasts.push(msg);
          otherCasts.push(msg);
          setRoomCount(msg.room);
          break;
        case CastMethod.SOCIAL:
          newCasts.push(msg);
          otherCasts.push(msg);
          setRoomCount(msg.room);
          break;
        case CastMethod.EMOJI_CHAT:
          newCasts.push(msg);
          mainCasts.push(msg);
          break;
        case CastMethod.ROOM_USER_SEQ:
          setRoomCount(msg.room);
          break;
        case CastMethod.ROOM_STATS:
          setRoomCount(msg.room);
          break;
        case CastMethod.CONTROL:
          if (msg?.room?.status !== RoomStatus.LIVING) {
            // 已经下播
            newCasts.push(msg);
            otherCasts.push(msg);
            disconnectLive();
          }
          break;
      }
    }
  } catch (err) {
    CLog.error('IndexView Handle Messages Error =>', err);
  }
  const recordCasts = newCasts.filter(m => !!m.method && settings.recordFilter.includes(m.method));
  writeRecordedCasts(recordCasts);
  if (castRef.value) castRef.value.appendCasts(mainCasts);
  if (otherRef.value) otherRef.value.appendCasts(otherCasts);
  if (relayWs && relayWs.isConnected()) {
    const filtered = msgs.filter((m): m is DyMessage & { method: CastMethod } => !!m.method && settings.relayFilter.includes(m.method));
    if (filtered.length) relayWs.send(JSON.stringify(filtered));
  }
};

/**
 * 添加控制台消息
 * @param msg
 */
const addConsoleMessage = function (content: string) {
  if (otherRef.value)
    otherRef.value.appendCasts([
      {
        id: getId(),
        method: CastMethod.CUSTOM,
        content,
        user: { name: '控制台' }
      }
    ]);
};

/**
 * 清理列表
 */
function clearMessageList() {
  castSet.clear();
  castIdQueue.length = 0;
  if (castRef.value) castRef.value.clearCasts();
  if (otherRef.value) otherRef.value.clearCasts();
}

/**
 * 连接房间
 */
const connectLive = function () {
  try {
    // Save room number for next session
    if (settings.rememberRoom) {
      settings.lastRoomId = roomNum.value;
    }
    // 清空上一次连接的消息
    clearMessageList();
    CLog.debug('正在连接:', roomNum.value);
    SkMessage.info(`正在连接：${roomNum.value}`);
    const cast = new DyCast(roomNum.value);
    cast.on('open', (ev, info) => {
      CLog.info('DyCast 房间连接成功');
      SkMessage.success(`房间连接成功[${roomNum.value}]`);
      setRoomInputStatus(true);
      connectStatus.value = 1;
      setRoomInfo(info);
      addConsoleMessage('直播间已连接');
    });
    cast.on('error', err => {
      CLog.error('DyCast 连接出错 =>', err);
      SkMessage.error(`连接出错: ${err}`);
      connectStatus.value = 2;
      setRoomInputStatus(false);
    });
    cast.on('close', (code, reason) => {
      CLog.info(`DyCast 房间已关闭[${code}] => ${reason}`);
      connectStatus.value = 3;
      setRoomInputStatus(false);
      switch (code) {
        case DyCastCloseCode.NORMAL:
          SkMessage.success('断开成功');
          break;
        case DyCastCloseCode.LIVE_END:
          SkMessage.info('主播已下播');
          break;
        case DyCastCloseCode.CANNOT_RECEIVE:
          SkMessage.error('无法正常接收信息，已关闭');
          break;
        default:
          SkMessage.info('房间已关闭');
      }
      if (code === DyCastCloseCode.LIVE_END) {
        addConsoleMessage(reason || '主播尚未开播或已下播');
      } else {
        if (statusPanelRef.value) addConsoleMessage(`连接已关闭，共持续: ${statusPanelRef.value.getDuration()}`);
        else addConsoleMessage('连接已关闭');
      }
    });
    cast.on('message', msgs => {
      handleMessages(msgs);
    });
    cast.on('reconnecting', (count, code, reason) => {
      switch (code) {
        case DyCastCloseCode.CANNOT_RECEIVE:
          // 无法正常接收信息
          SkMessage.warning('无法正常接收弹幕，准备重连中');
          break;
        default:
          CLog.warn('DyCast 重连中 =>', count);
          SkMessage.warning(`正在重连中: ${count}`);
      }
    });
    cast.on('reconnect', ev => {
      CLog.info('DyCast 重连成功');
      SkMessage.success('房间重连完成');
    });
    cast.connect();
    castWs = cast;
  } catch (err) {
    CLog.error('房间连接过程出错:', err);
    SkMessage.error('房间连接过程出错');
    setRoomInputStatus(false);
    castWs = void 0;
  }
};
/** 断开连接 */
const disconnectLive = function () {
  if (castWs) castWs.close(1000, '断开连接');
  stopRelayCast();
};

/** 连接转发房间 */
const relayCast = async function () {
  try {
    // Save relay URL for next session
    if (settings.rememberRelay) {
      settings.lastRelayUrl = relayUrl.value;
    }
    CLog.info('正在连接转发中 =>', relayUrl.value);
    SkMessage.info(`转发连接中: ${relayUrl.value}`);
    const cast = new RelayCast(relayUrl.value);
    let relayErrorReported = false;
    cast.on('open', () => {
      relayErrorReported = false;
      CLog.info(`DyCast 转发连接成功`);
      SkMessage.success(`已开始转发`);
      setRelayInputStatus(true);
      relayStatus.value = 1;
      addConsoleMessage('转发客户端已连接');
      if (castWs) {
        // 发送直播间信息给转发地址
        cast.send(JSON.stringify(castWs.getLiveInfo()));
      }
    });
    cast.on('close', (code, msg) => {
      CLog.info(`(${code})dycast 转发已关闭: ${msg || '未知原因'}`);
      if (code === 1000) SkMessage.info(`已停止转发`);
      else if (!relayErrorReported) SkMessage.warning(`转发已停止: ${msg || '未知原因'}`);
      setRelayInputStatus(false);
      relayStatus.value = code === 1000 ? 0 : 2;
      relayWs = void 0;
      addConsoleMessage('转发已关闭');
    });
    cast.on('error', ev => {
      relayErrorReported = true;
      CLog.warn(`dycast 转发出错: ${ev.message}`);
      SkMessage.error(`转发出错了: ${ev.message}`);
      setRelayInputStatus(false);
      relayStatus.value = 2;
    });
    const connected = await cast.connect();
    if (!connected) return;
    relayWs = cast;
  } catch (err) {
    CLog.error('弹幕转发出错:', err);
    SkMessage.error(`转发出错: ${err instanceof Error ? err.message : err}`);
    setRelayInputStatus(false);
    relayStatus.value = 2;
    relayWs = void 0;
  }
};
/** 暂停转发 */
const stopRelayCast = function () {
  if (relayWs) relayWs.close(1000);
};

const startCastRecording = async function () {
  if (recordState.value !== 'idle') return;
  if (!JsonlRecorder.isSupported()) {
    SkMessage.error('当前环境不支持流式记录文件');
    return;
  }

  const date = formatDate(new Date(), 'yyyy-MM-dd_HHmmss');
  const room = roomNum.value || 'unknown';
  const fileName = `[${room}]${date}`;

  try {
    await castRecorder.start({
      name: fileName,
      ext: '.jsonl',
      mimeType: 'application/x-ndjson',
      description: '弹幕记录'
    });
    recordingCount.value = 0;
    recordState.value = 'recording';
    showRecord.value = false;
    SkMessage.success('已开始记录弹幕');
    addConsoleMessage(`已开始记录弹幕: ${castRecorder.fileName}`);
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      CLog.error('开始记录弹幕失败 =>', err);
      SkMessage.error('开始记录弹幕失败');
    }
  }
};

const stopCastRecording = async function () {
  if (recordState.value === 'idle') return;

  try {
    const count = await castRecorder.stop();
    recordingCount.value = count;
    recordState.value = 'idle';
    showRecord.value = false;
    SkMessage.success(`已停止记录，共 ${count} 条`);
    addConsoleMessage(`弹幕记录已停止，共 ${count} 条`);
  } catch (err) {
    CLog.error('停止记录弹幕失败 =>', err);
    SkMessage.error('停止记录弹幕失败');
  }
};

const pauseCastRecording = function () {
  if (recordState.value !== 'recording') return;
  recordState.value = 'paused';
  SkMessage.info('弹幕记录已暂停');
};

const resumeCastRecording = function () {
  if (recordState.value !== 'paused') return;
  recordState.value = 'recording';
  SkMessage.info('弹幕记录已继续');
};

const toggleCastRecording = function () {
  showRecord.value = true;
};

const handleRecordToolClick = function () {
  toggleCastRecording();
};

const onReplayStart = function () {
  isReplaying.value = true;
  replayState.value = 'playing';
  SkMessage.info('弹幕重放已开始');
};

const onReplayStop = function () {
  isReplaying.value = false;
  replayState.value = 'idle';
  SkMessage.info('弹幕重放已停止');
};

const onReplayStateChange = function (state: ReplayState) {
  replayState.value = state;
  isReplaying.value = state !== 'idle';
};

</script>

<style lang="scss" scoped>
.index-view {
  position: relative;
  background-color: var(--app-bg);
  display: flex;
  width: 100%;
  height: 100%;
  transition: background-color 0.2s ease;
  .view-left,
  .view-center,
  .view-right {
    display: flex;
    flex-direction: column;
    height: 100%;
    box-sizing: border-box;
    width: 0;
    flex-shrink: 0;
  }
  .view-left {
    flex-grow: 2.5;
    border-right: 1px solid var(--app-border);
    justify-content: space-between;
  }
  .view-left-bottom {
    width: 100%;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    padding: 12px 0;
    .hr {
      height: 0;
      border: 0;
      border-top: 1px solid var(--app-border);
      margin: 5px 0;
    }
  }
  .view-left-tools {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    .version-text {
      margin-right: auto;
      font-size: 12px;
      color: var(--app-text-subtle);
      user-select: none;
    }
    box-sizing: border-box;
    padding: 0 12px;
  }
  .view-left-tool {
    font-size: 21px;
    width: 1.2em;
    height: 1.2em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--app-text-muted);
    &.cm-btn {
      transition:
        color 0.2s ease-in-out,
        background-color 0.3s ease-in-out,
        opacity 0.2s ease;
      background-color: transparent;
      border-radius: 0.4em;
      &.record-recording {
        color: #fff;
        background-color: var(--app-accent-strong);
      }
      &.record-paused {
        color: #fff;
        background-color: var(--app-warning);
      }
      &.replay-playing {
        color: #fff;
        background-color: var(--app-accent);
      }
      &.replay-paused {
        color: #fff;
        background-color: var(--app-warning);
      }
      &:hover {
        color: #fff;
        background-color: var(--app-accent);
      }
      &:active {
        opacity: 0.8;
      }
    }
    .icon {
      font-size: 1em;
    }
  }
  .view-center {
    flex-grow: 4.5;
    padding: 18px 12px;
  }
  .view-right {
    flex-grow: 3;
    border-left: 1px solid var(--app-border);
    padding: 18px 12px;
    gap: 12px;
  }
  .view-input {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .view-other {
    display: flex;
    width: 100%;
    height: 0;
    flex-grow: 1;
    box-sizing: border-box;
  }
}

@media (max-width: 768px) {
  .index-view {
    flex-direction: column;
    height: auto;
    .view-left,
    .view-center,
    .view-right {
      width: 100%;
      flex-grow: 0;
      border: none;
    }
    .view-left {
      margin-top: 250px;
      justify-content: flex-start;
    }
    .view-center {
      height: 100vh;
    }
    .view-right {
      height: 80vh;
    }
    .view-input {
      position: absolute;
      top: 0;
      left: 0;
      box-sizing: border-box;
      padding: 18px 12px;
    }
    .view-left-bottom {
      position: absolute;
      top: 150px;
      left: 0;
    }
  }
}

</style>
