<template>
  <div class="live-info-item">
    <label class="title">{{ title }}：</label>
    <div class="live-info-item-main">
      <img v-if="cover" :src="cover" alt="avatar" class="avatar" />
      <span class="text" :title="String(text)">{{ text }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface LiveInfoItemProps {
  title?: string;
  text?: string | number;
  cover?: string;
}

const props = withDefaults(defineProps<LiveInfoItemProps>(), {
  text: '*****'
});
</script>

<style lang="scss" scoped>
.live-info-item {
  width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  .title {
    font-weight: 600;
    font-size: 1rem;
    font-weight: bold;
    color: var(--app-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
  }
}

.live-info-item-main {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  flex: 1 1 auto;
  justify-content: flex-end;
  .text {
    min-width: 0;
    user-select: none;
    font-size: 0.9rem;
    color: var(--app-text-muted);
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
  }
  .avatar {
    width: 2rem;
    height: 2rem;
    object-fit: cover;
    border-radius: 0.7rem;
  }
}
</style>
