import { Emitter, type EventMap } from './emitter';
import { RelayCast } from './relay';
import type { DyMessage } from './dycast';

export interface ReplayFileInfo {
  id?: number;
  filename: string;
  totalMessages: number;
  estimatedDurationMs: number;
}

interface ReplayerEvent extends EventMap {
  progress: (current: number, total: number) => void;
  done: () => void;
  error: (msg: string) => void;
  stateChange: (state: ReplayState) => void;
}

export type ReplayState = 'idle' | 'playing' | 'paused';

const FALLBACK_INTERVAL_MS = 200;

export class Replayer {
  private messages: DyMessage[] = [];
  private memoryIndex = 0;
  private currentIndex = 0;
  private pendingMessage: DyMessage | null = null;
  private prevTimestamp: number | undefined;
  private state: ReplayState = 'idle';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private relayCast: RelayCast | undefined;
  private fileInfo: ReplayFileInfo | null = null;
  private nextLine: (() => Promise<string | null>) | undefined;
  private resetSource: (() => Promise<void> | void) | undefined;
  private disposeSource: (() => Promise<void> | void) | undefined;
  private emitter: Emitter<ReplayerEvent>;

  constructor() {
    this.emitter = new Emitter();
  }

  on<K extends keyof ReplayerEvent>(event: K, listener: ReplayerEvent[K]) {
    this.emitter.on(event, listener);
  }

  off<K extends keyof ReplayerEvent>(event: K, listener: ReplayerEvent[K]) {
    this.emitter.off(event, listener);
  }

  get currentState() {
    return this.state;
  }

  get currentFileInfo() {
    return this.fileInfo;
  }

  load(lines: string[], filename: string): ReplayFileInfo {
    void this.disposeCurrentSource();
    this.messages = [];
    this.pendingMessage = null;
    this.nextLine = undefined;
    this.resetSource = undefined;
    this.disposeSource = undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as DyMessage;
        this.messages.push(msg);
      } catch {
        continue;
      }
    }

    if (this.messages.length === 0) {
      throw new Error('文件中没有有效的弹幕数据');
    }

    let totalDuration = 0;
    for (let i = 1; i < this.messages.length; i++) {
      const prev = this.messages[i - 1].timestamp;
      const curr = this.messages[i].timestamp;
      if (prev !== undefined && curr !== undefined && curr > prev) {
        const diff = curr - prev;
        totalDuration += diff;
      } else {
        totalDuration += FALLBACK_INTERVAL_MS;
      }
    }

    this.fileInfo = {
      filename,
      totalMessages: this.messages.length,
      estimatedDurationMs: totalDuration,
    };

    return this.fileInfo;
  }

  loadStream(
    info: ReplayFileInfo,
    nextLine: () => Promise<string | null>,
    resetSource: () => Promise<void> | void,
    disposeSource: () => Promise<void> | void
  ): ReplayFileInfo {
    void this.disposeCurrentSource();
    this.messages = [];
    this.pendingMessage = null;
    this.nextLine = nextLine;
    this.resetSource = resetSource;
    this.disposeSource = disposeSource;
    this.fileInfo = info;
    return this.fileInfo;
  }

  async start(relayUrl: string): Promise<boolean> {
    if (this.state !== 'idle' || !this.fileInfo) return false;

    const relay = new RelayCast(relayUrl);
    const connected = await relay.connect();
    if (!connected) {
      this.emitter.emit('error', '连接转发服务器失败');
      return false;
    }

    this.relayCast = relay;
    this.currentIndex = 0;
    this.memoryIndex = 0;
    this.pendingMessage = null;
    this.prevTimestamp = undefined;
    this.state = 'playing';
    this.emitter.emit('stateChange', 'playing');
    void this.scheduleNext();
    return true;
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.emitter.emit('stateChange', 'paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.emitter.emit('stateChange', 'playing');
    this.scheduleNext();
  }

  stop() {
    if (this.state === 'idle') return;
    this.state = 'idle';
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.relayCast) {
      this.relayCast.close();
      this.relayCast = undefined;
    }
    this.pendingMessage = null;
    void this.resetCurrentSource();
    this.currentIndex = 0;
    this.emitter.emit('stateChange', 'idle');
  }

  dispose() {
    this.stop();
    if (this.state === 'idle') {
      void this.disposeCurrentSource();
    }
  }

  private async scheduleNext() {
    if (this.state !== 'playing') return;

    let msg = this.pendingMessage;
    try {
      if (!msg) {
        msg = await this.readNextMessage();
        this.pendingMessage = msg;
      }
    } catch (err) {
      this.emitter.emit('error', (err as Error).message || '读取重放消息失败');
      this.stop();
      return;
    }

    if (!msg) {
      this.relayCast?.close();
      this.relayCast = undefined;
      this.state = 'idle';
      this.currentIndex = 0;
      this.pendingMessage = null;
      this.prevTimestamp = undefined;
      void this.resetCurrentSource();
      this.emitter.emit('done');
      this.emitter.emit('stateChange', 'idle');
      return;
    }

    const interval = this.currentIndex === 0
      ? 0
      : this.getInterval(this.prevTimestamp, msg.timestamp);

    this.timer = setTimeout(() => {
      if (this.state !== 'playing') return;
      this.relayCast?.send(JSON.stringify([msg]));
      this.emitter.emit('progress', this.currentIndex + 1, this.fileInfo?.totalMessages || 0);
      this.pendingMessage = null;
      this.prevTimestamp = msg.timestamp;
      this.currentIndex++;
      void this.scheduleNext();
    }, interval === 0 ? 0 : Math.max(interval, 10));
  }

  private async readNextMessage(): Promise<DyMessage | null> {
    if (this.nextLine) {
      const line = await this.nextLine();
      return line ? JSON.parse(line) as DyMessage : null;
    }
    return this.messages[this.memoryIndex++] || null;
  }

  private getInterval(prev?: number, curr?: number) {
    if (prev !== undefined && curr !== undefined && curr > prev) return curr - prev;
    return FALLBACK_INTERVAL_MS;
  }

  private async resetCurrentSource() {
    this.memoryIndex = 0;
    this.pendingMessage = null;
    this.prevTimestamp = undefined;
    if (!this.resetSource) return;
    await this.resetSource();
  }

  private async disposeCurrentSource() {
    if (!this.disposeSource) return;
    const disposeSource = this.disposeSource;
    this.disposeSource = undefined;
    this.resetSource = undefined;
    this.pendingMessage = null;
    this.nextLine = undefined;
    await disposeSource();
  }
}
