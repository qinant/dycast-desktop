import { isTauriProd } from './runtime';

export interface DySocket {
  binaryType: BinaryType;
  readonly OPEN: number;
  readyState: number;
  addEventListener(type: 'open', listener: (ev: Event) => void): void;
  addEventListener(type: 'close', listener: (ev: CloseEvent) => void): void;
  addEventListener(type: 'error', listener: (ev: Event) => void): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void;
  /** Rust 端发送通道溢出丢弃帧时触发（仅 Tauri 环境会发射） */
  addEventListener(type: 'backpressure', listener: (ev: CustomEvent<{ dropped: number }>) => void): void;
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

const DOUYIN_WS_BASE = 'wss://webcast100-ws-web-lq.douyin.com';

export const getWsBase = (): string => {
  if (isTauriProd()) {
    return `${DOUYIN_WS_BASE}/webcast/im/push/v2/`;
  }
  return `${location.origin.replace(/^http/, 'ws')}/socket/webcast/im/push/v2/`;
};

export const createSocket = async (url: string): Promise<DySocket> => {
  if (isTauriProd()) {
    const { createTauriWebSocket } = await import('./tauri/websocket');
    return createTauriWebSocket(url);
  }
  return new WebSocket(url);
};
