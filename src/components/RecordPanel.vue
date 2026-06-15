<template>
  <Teleport to="body">
    <Transition name="settings-panel">
      <div v-if="visible" class="record-overlay" @click.self="$emit('close')">
        <div class="record-dialog">
          <div class="dialog-header">
            <span class="dialog-icon">💾</span>
            <div class="dialog-title">
              <h3>弹幕记录</h3>
              <p>选择保存位置，将接收到的弹幕消息记录为 .jsonl 文件。</p>
            </div>
            <button class="btn-close" @click="$emit('close')">✕</button>
          </div>

          <div class="dialog-body">
            <div v-if="state !== 'idle'" class="record-section">
              <div class="file-info">
                <div class="info-row">
                  <span class="info-label">状态</span>
                  <span class="info-value">{{ stateText }}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">已记录</span>
                  <span class="info-value">{{ count.toLocaleString() }} 条</span>
                </div>
              </div>
            </div>

            <div v-if="state === 'idle'" class="record-section">
              <div class="record-row">
                <button class="btn-file" @click="$emit('select')">选择保存位置</button>
              </div>
            </div>

            <div v-else class="record-section record-controls">
              <button v-if="state === 'recording'" class="btn-pause" @click="$emit('pause')">⏸ 暂停</button>
              <button v-if="state === 'paused'" class="btn-play" @click="$emit('resume')">▶ 继续</button>
              <button class="btn-stop" @click="$emit('stop')">■ 终止</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';

type RecordState = 'idle' | 'recording' | 'paused';

const props = defineProps<{
  visible: boolean;
  state: RecordState;
  count: number;
}>();

defineEmits<{
  close: [];
  select: [];
  pause: [];
  resume: [];
  stop: [];
}>();

const stateText = computed(() => {
  switch (props.state) {
    case 'recording':
      return '记录中';
    case 'paused':
      return '已暂停';
    default:
      return '未开始';
  }
});
</script>

<style scoped lang="scss">
.record-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.record-dialog {
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

.record-section {
  margin-bottom: 16px;

  &:last-child {
    margin-bottom: 0;
  }
}

.record-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.file-info {
  background: var(--app-surface-soft);
  border-radius: 6px;
  padding: 12px;

  .info-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;

    &:last-child {
      margin-bottom: 0;
    }
  }

  .info-label {
    color: var(--app-text-muted);
    font-size: 13px;
  }

  .info-value {
    color: var(--app-text);
    font-size: 13px;
    font-weight: 500;
  }
}

.record-controls {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.btn-file {
  padding: 8px 16px;
  background: var(--app-surface);
  border: 1px solid var(--app-border-strong);
  border-radius: 6px;
  color: var(--app-text);
  cursor: pointer;
  font-size: 14px;

  &:hover {
    border-color: var(--app-accent);
    background: var(--app-surface-soft);
  }
}

.btn-play,
.btn-pause,
.btn-stop {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
}

.btn-play {
  background: var(--app-accent);
}

.btn-pause {
  background: var(--app-warning);
}

.btn-stop {
  background: var(--app-danger);
}
</style>
