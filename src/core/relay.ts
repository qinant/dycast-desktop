import { Emitter, type EventMap } from './emitter';
import { createSocket, type DySocket } from '@/platform/websocket';

interface RelayCastEvent extends EventMap {
  open: (ev: Event) => void;
  close: (code?: number, msg?: string) => void;
  error: (ev: Error) => void;
  message: (data: any) => void;
  /** Rust 端发送通道溢出丢弃帧时触发，参数为累计丢弃数 */
  backpressure: (dropped: number) => void;
}

/**
 * 弹幕转发器（复用平台 WebSocket 抽象，兼容 Tauri 和浏览器环境）
 */
export class RelayCast {
  private url: string;

  private ws: DySocket | undefined;

  private emitter: Emitter<RelayCastEvent>;

  constructor(url: string) {
    this.url = url;
    this.emitter = new Emitter();
  }

  public on<K extends keyof RelayCastEvent>(event: K, listener: RelayCastEvent[K]) {
    this.emitter.on(event, listener);
  }

  public off<K extends keyof RelayCastEvent>(event: K, listener: RelayCastEvent[K]) {
    this.emitter.off(event, listener);
  }

  public once<K extends keyof RelayCastEvent>(event: K, listener: RelayCastEvent[K]) {
    this.emitter.once(event, listener);
  }

  async connect() {
    try {
      this.ws = await createSocket(this.url);
      this.ws.addEventListener('open', ev => {
        this.emitter.emit('open', ev);
      });
      this.ws.addEventListener('close', ev => {
        this.emitter.emit('close', ev.code, ev.reason || ev.type);
      });
      this.ws.addEventListener('error', ev => {
        this.emitter.emit('error', Error(ev instanceof ErrorEvent ? ev.message : (ev.type || 'Unknown')));
      });
      this.ws.addEventListener('message', ev => {
        this.emitter.emit('message', ev.data);
      });
      this.ws.addEventListener('backpressure', ev => {
        this.emitter.emit('backpressure', ev.detail.dropped);
      });
      return true;
    } catch (err) {
      this.emitter.emit('error', Error('转发服务器连接出错'));
      this.emitter.emit('close', 4002);
      return false;
    }
  }

  isConnected() {
    return !!(this.ws && this.ws.readyState === this.ws.OPEN);
  }

  send(data: string | ArrayBuffer) {
    if (this.ws && this.ws.readyState === this.ws.OPEN) this.ws.send(data);
  }

  close(code: number = 1000, msg: string = 'close replay') {
    if (this.ws) {
      this.ws.close(code, msg);
      this.ws = void 0;
    }
  }
}
