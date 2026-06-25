import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

interface WsMessagePayload {
  id: number;
  data: string;
}

interface WsClosePayload {
  id: number;
  code: number;
  reason: string;
}

interface WsErrorPayload {
  id: number;
  error: string;
}

interface WsBackpressurePayload {
  id: number;
  dropped: number;
}

type OpenListener = (ev: Event) => void;
type CloseListener = (ev: CloseEvent) => void;
type ErrorListener = (ev: ErrorEvent) => void;
type MessageListener = (ev: MessageEvent) => void;

const toArrayBuffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

const createCloseEvent = (code: number, reason: string) =>
  new CloseEvent('close', {
    code,
    reason,
    wasClean: code === 1000
  });

export class TauriWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = TauriWebSocket.CONNECTING;
  readonly OPEN = TauriWebSocket.OPEN;
  readonly CLOSING = TauriWebSocket.CLOSING;
  readonly CLOSED = TauriWebSocket.CLOSED;

  binaryType: BinaryType = 'arraybuffer';
  readyState = TauriWebSocket.CONNECTING;

  private id: number | null = null;
  private target = new EventTarget();
  private unlistenFns: UnlistenFn[] = [];

  constructor(private url: string) {
    void this.connect();
  }

  addEventListener(type: 'open', listener: OpenListener): void;
  addEventListener(type: 'close', listener: CloseListener): void;
  addEventListener(type: 'error', listener: ErrorListener): void;
  addEventListener(type: 'message', listener: MessageListener): void;
  addEventListener(type: string, listener: any): void;
  addEventListener(type: string, listener: any) {
    this.target.addEventListener(type, listener as EventListener);
  }

  removeEventListener(type: 'open', listener: OpenListener): void;
  removeEventListener(type: 'close', listener: CloseListener): void;
  removeEventListener(type: 'error', listener: ErrorListener): void;
  removeEventListener(type: 'message', listener: MessageListener): void;
  removeEventListener(type: string, listener: any): void;
  removeEventListener(type: string, listener: any) {
    this.target.removeEventListener(type, listener as EventListener);
  }

  send(data: string | ArrayBuffer | Uint8Array) {
    if (this.readyState !== TauriWebSocket.OPEN || this.id === null) {
      throw new Error('WebSocket is not open');
    }
    if (typeof data === 'string') {
      void invoke('ws_send_text', { id: this.id, data }).catch(error => {
        this.dispatchError(String(error));
      });
      return;
    }
    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(data);
    void invoke('ws_send', { id: this.id, data: Array.from(bytes) }).catch(error => {
      this.dispatchError(String(error));
    });
  }

  close(code = 1000, reason = 'close') {
    if (this.readyState === TauriWebSocket.CLOSED || this.readyState === TauriWebSocket.CLOSING) return;
    this.readyState = TauriWebSocket.CLOSING;
    if (this.id === null) {
      this.finishClose(code, reason);
      return;
    }
    void invoke('ws_close', { id: this.id })
      .catch(error => this.dispatchError(String(error)))
      .finally(() => {
        if (this.readyState !== TauriWebSocket.CLOSED) this.finishClose(code, reason);
      });
  }

  private async connect() {
    try {
      this.unlistenFns = await Promise.all([
        listen<WsMessagePayload>('ws-message', event => {
          if (event.payload.id !== this.id || this.readyState !== TauriWebSocket.OPEN) return;
          const data = toArrayBuffer(event.payload.data);
          this.target.dispatchEvent(new MessageEvent('message', { data }));
        }),
        listen<WsClosePayload>('ws-close', event => {
          if (event.payload.id !== this.id) return;
          this.finishClose(event.payload.code, event.payload.reason);
        }),
        listen<WsErrorPayload>('ws-error', event => {
          if (event.payload.id !== this.id) return;
          this.dispatchError(event.payload.error);
        }),
        listen<WsBackpressurePayload>('ws-backpressure', event => {
          if (event.payload.id !== this.id) return;
          // Rust 端发送通道溢出丢弃帧：转发为 backpressure 事件给上层（如 RelayCast）
          this.target.dispatchEvent(
            new CustomEvent('backpressure', { detail: { dropped: event.payload.dropped } })
          );
        })
      ]);

      this.id = await invoke<number>('ws_connect', { url: this.url, cookies: document.cookie || '' });
      if (this.readyState === TauriWebSocket.CLOSING) {
        this.close();
        return;
      }
      this.readyState = TauriWebSocket.OPEN;
      this.target.dispatchEvent(new Event('open'));
    } catch (error) {
      this.dispatchError(String(error));
      this.finishClose(1006, String(error));
    }
  }

  private dispatchError(error: string) {
    this.target.dispatchEvent(new ErrorEvent('error', { message: error }));
  }

  private finishClose(code: number, reason: string) {
    if (this.readyState === TauriWebSocket.CLOSED) return;
    this.readyState = TauriWebSocket.CLOSED;
    for (const unlisten of this.unlistenFns) unlisten();
    this.unlistenFns = [];
    this.target.dispatchEvent(createCloseEvent(code, reason));
  }
}

export const createTauriWebSocket = (url: string) => new TauriWebSocket(url);
