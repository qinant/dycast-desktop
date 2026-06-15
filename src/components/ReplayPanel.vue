<template>
  <Teleport to="body">
    <Transition name="settings-panel">
      <div v-if="visible" class="replay-overlay" @click.self="handleClose">
        <div class="replay-dialog">
          <div class="dialog-header">
            <span class="dialog-icon">▶</span>
            <div class="dialog-title">
              <h3>弹幕重放</h3>
              <p>选择 .jsonl 记录文件，将其中保存的弹幕消息重放到 WebSocket 后端。</p>
            </div>
            <button class="btn-close" @click="handleClose">✕</button>
          </div>

          <div class="dialog-body">
            <!-- 文件选择 -->
            <div class="replay-section">
              <div class="replay-row">
                <button class="btn-file" :disabled="replaying" @click="selectFile">
                  {{ fileInfo ? '重新选择文件' : '选择记录文件' }}
                </button>
              </div>
            </div>

            <!-- 文件信息 -->
            <div v-if="fileInfo" class="replay-section">
              <div class="file-info">
                <div class="info-row">
                  <span class="info-label">文件名</span>
                  <span class="info-value">{{ fileInfo.filename }}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">消息数</span>
                  <span class="info-value">{{ fileInfo.totalMessages.toLocaleString() }} 条</span>
                </div>
                <div class="info-row">
                  <span class="info-label">预计时长</span>
                  <span class="info-value">{{ formatDuration(fileInfo.estimatedDurationMs) }}</span>
                </div>
              </div>
            </div>

            <!-- 加载失败 -->
            <div v-if="loadError" class="replay-section">
              <div class="error-msg">{{ loadError }}</div>
            </div>

            <!-- 进度 -->
            <div v-if="fileInfo && state !== 'idle'" class="replay-section">
              <div class="progress-bar">
                <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
              </div>
              <div class="progress-text">{{ progressCurrent }} / {{ fileInfo.totalMessages.toLocaleString() }}</div>
            </div>

            <!-- 控制按钮 -->
            <div v-if="fileInfo" class="replay-section replay-controls">
              <button
                v-if="state === 'idle'"
                class="btn-play"
                :disabled="!relayUrl"
                @click="startReplay">
                ▶ 开始重放
              </button>
              <button
                v-if="state === 'playing'"
                class="btn-pause"
                @click="pauseReplay">
                ⏸ 暂停
              </button>
              <button
                v-if="state === 'paused'"
                class="btn-play"
                @click="resumeReplay">
                ▶ 继续
              </button>
              <button
                v-if="state !== 'idle'"
                class="btn-stop"
                @click="stopReplay">
                ■ 停止
              </button>
            </div>

            <!-- 未填 WS 地址提示 -->
            <div v-if="fileInfo && !relayUrl" class="replay-section">
              <div class="hint-msg">请先在 WS 地址输入框中填写转发地址</div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { Replayer, type ReplayFileInfo, type ReplayState } from '@/core/replayer';
import { isTauri } from '@/platform/runtime';
import { invoke } from '@tauri-apps/api/core';
import SkMessage from '@/components/Message';

type TauriReplayFileInfo = ReplayFileInfo & { id: number };

const props = defineProps<{
  visible: boolean;
  relayUrl: string;
}>();

const emit = defineEmits<{
  close: [];
  replayStart: [];
  replayStop: [];
  stateChange: [state: ReplayState];
}>();

const replayer = new Replayer();
const fileInfo = ref<ReplayFileInfo | null>(null);
const loadError = ref('');
const state = ref<ReplayState>('idle');
const progressCurrent = ref(0);
const progressTotal = ref(0);
const replaying = computed(() => state.value !== 'idle');
const progressPct = computed(() =>
  progressTotal.value > 0 ? Math.round((progressCurrent.value / progressTotal.value) * 100) : 0
);

replayer.on('progress', (current, total) => {
  progressCurrent.value = current;
  progressTotal.value = total;
});

replayer.on('done', () => {
  SkMessage.success('重放完成');
});

replayer.on('error', (msg) => {
  SkMessage.error(msg);
});

replayer.on('stateChange', (newState) => {
  state.value = newState;
  emit('stateChange', newState);
  if (newState === 'idle') {
    emit('replayStop');
  }
});

const formatDuration = (ms: number) => {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const selectFile = async () => {
  loadError.value = '';
  try {
    if (isTauri()) {
      const result = await invoke<TauriReplayFileInfo | null>('cast_replay_read');
      if (!result) return;
      fileInfo.value = replayer.loadStream(
        result,
        () => invoke<string | null>('cast_replay_next', { id: result.id }),
        () => invoke('cast_replay_reset', { id: result.id }),
        () => invoke('cast_replay_close', { id: result.id })
      );
    } else {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON Lines', accept: { 'application/x-ndjson': ['.jsonl'] } }],
      });
      const file = await handle.getFile();
      const text = await file.text();
      fileInfo.value = replayer.load(text.split('\n'), file.name);
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    loadError.value = '文件读取失败: ' + ((err as Error).message || '未知错误');
  }
};

const startReplay = async () => {
  const ok = await replayer.start(props.relayUrl);
  if (ok) {
    emit('replayStart');
  }
};

const pauseReplay = () => replayer.pause();
const resumeReplay = () => replayer.resume();

const stopReplay = () => {
  replayer.stop();
  progressCurrent.value = 0;
  progressTotal.value = 0;
};

const handleClose = () => {
  emit('close');
};

onUnmounted(() => {
  replayer.dispose();
});
</script>

<style scoped lang="scss">
.replay-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.replay-dialog {
  background: var(--app-bg);
  border: 1px solid var(--app-border);
  border-radius: 12px;
  width: 420px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);

  .dialog-header {
    display: flex;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--app-border);

    .dialog-icon {
      font-size: 18px;
      margin-right: 8px;
    }

    .dialog-title {
      flex: 1;
      min-width: 0;

      h3 {
        margin: 0;
        font-size: 16px;
        color: var(--app-text);
      }

      p {
        margin: 4px 0 0;
        font-size: 12px;
        line-height: 1.4;
        color: var(--app-text-muted);
      }
    }

    .btn-close {
      background: none;
      border: none;
      color: var(--app-text-subtle);
      font-size: 18px;
      cursor: pointer;
      padding: 4px;
      line-height: 1;

      &:hover {
        color: var(--app-text);
      }
    }
  }

  .dialog-body {
    padding: 16px 20px;
  }
}

.replay-section {
  margin-bottom: 16px;

  &:last-child {
    margin-bottom: 0;
  }
}

.replay-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.btn-file {
  padding: 8px 16px;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background: var(--app-surface);
  color: var(--app-text);
  cursor: pointer;
  font-size: 13px;

  &:hover:not(:disabled) {
    background: var(--app-hover);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.file-info {
  background: var(--app-surface);
  border-radius: 8px;
  padding: 12px;

  .info-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    font-size: 13px;

    .info-label {
      color: var(--app-text-subtle);
    }

    .info-value {
      color: var(--app-text);
    }
  }
}

.progress-bar {
  height: 6px;
  background: var(--app-border);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 6px;

  .progress-fill {
    height: 100%;
    background: var(--app-accent, #4caf50);
    border-radius: 3px;
    transition: width 0.3s ease;
  }
}

.progress-text {
  font-size: 12px;
  color: var(--app-text-subtle);
  text-align: center;
}

.replay-controls {
  display: flex;
  gap: 8px;
}

.btn-play,
.btn-pause,
.btn-stop {
  flex: 1;
  padding: 10px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  text-align: center;
}

.btn-play {
  background: #4caf50;
  color: #fff;

  &:hover {
    background: #43a047;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn-pause {
  background: #ff9800;
  color: #fff;

  &:hover {
    background: #f57c00;
  }
}

.btn-stop {
  background: #f44336;
  color: #fff;

  &:hover {
    background: #e53935;
  }
}

.error-msg {
  color: #f44336;
  font-size: 13px;
  padding: 8px 12px;
  background: rgba(244, 67, 54, 0.1);
  border-radius: 6px;
}

.hint-msg {
  color: var(--app-text-subtle);
  font-size: 13px;
  text-align: center;
  padding: 8px;
}
</style>
