import { reactive, watch } from 'vue';
import { CastMethod } from '@/core/dycast';

const STORAGE_KEY = 'dycast-settings';

export type AppTheme = 'light' | 'dark';

/** 适合转发的消息类型 */
export const FORWARDABLE_TYPES: CastMethod[] = [
  CastMethod.CHAT,
  CastMethod.GIFT,
  CastMethod.LIKE,
  CastMethod.MEMBER,
  CastMethod.SOCIAL,
  CastMethod.EMOJI_CHAT,
  CastMethod.CONTROL,
  CastMethod.FANSCLUB,
  CastMethod.ROOM_RANK,
];

export interface AppSettings {
  /** 自动检查更新 */
  autoUpdate: boolean;
  /** 记住上次连接的房间号 */
  rememberRoom: boolean;
  /** 记住上次转发地址 */
  rememberRelay: boolean;
  /** 主题 */
  theme: AppTheme;
  /** 上次房间号 */
  lastRoomId: string;
  /** 上次转发地址 */
  lastRelayUrl: string;
  /** 转发消息类型过滤 */
  relayFilter: CastMethod[];
  /** 录制消息类型过滤 */
  recordFilter: CastMethod[];
  /** 最大重连次数（连接断开时的重连上限） */
  maxReconnectCount: number;
}

const defaults: AppSettings = {
  autoUpdate: true,
  rememberRoom: true,
  rememberRelay: false,
  theme: 'light',
  lastRoomId: '',
  lastRelayUrl: '',
  relayFilter: [...FORWARDABLE_TYPES],
  recordFilter: [...FORWARDABLE_TYPES],
  maxReconnectCount: 3,
};
export { defaults };

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...defaults, ...JSON.parse(raw) };
    }
  } catch {
    // corrupted data — fall through to defaults
  }
  return { ...defaults };
}

function save(settings: AppSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // quota exceeded or disabled — silently ignore
  }
}

function normalizeTheme(value: unknown): AppTheme {
  return value === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

const settings = reactive<AppSettings>(load());
settings.theme = normalizeTheme(settings.theme);
applyTheme(settings.theme);

watch(
  () => ({ ...settings }),
  (val) => save(val as AppSettings),
  { deep: true },
);

watch(
  () => settings.theme,
  (theme) => applyTheme(normalizeTheme(theme)),
);

/** Reset all settings to defaults */
export function resetSettings() {
  Object.assign(settings, defaults);
}

/** Get a setting value */
export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return settings[key];
}

/** Set a setting value */
export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  settings[key] = value;
}

export function setTheme(theme: AppTheme) {
  settings.theme = theme;
}

export { settings };
export default settings;
