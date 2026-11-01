/** Native and browser I/O doubles. The production scene renderers and media adapters remain real. */
export class EventTargetFixture {
  listeners = new Map<string, Set<(event?: unknown) => void>>();
  addEventListener(name: string, callback: (event?: unknown) => void) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name)!.add(callback); }
  removeEventListener(name: string, callback: (event?: unknown) => void) { this.listeners.get(name)?.delete(callback); }
  emit(name: string, event?: unknown) { for (const callback of this.listeners.get(name) ?? []) callback.call(this, event); }
  on(name: string, callback: (event?: unknown) => void) { this.addEventListener(name, callback); }
  off(name: string, callback: (event?: unknown) => void) { this.removeEventListener(name, callback); }
}

export class CanvasFixture {
  width = 1; height = 1;
  draws: unknown[][] = [];
  context = {
    font: '', textBaseline: '', textAlign: '', fillStyle: '',
    measureText: (text: string) => ({ width: [...text].reduce((size, char) => size + (char.charCodeAt(0) > 255 ? 96 : 48), 0) }),
    scale: (x: number, y: number) => this.draws.push(['scale', x, y]),
    fillRect: (x: number, y: number, width: number, height: number) => this.draws.push(['fillRect', this.context.fillStyle, x, y, width, height]),
    fillText: (text: string, x: number, y: number) => this.draws.push(['fillText', this.context.fillStyle, this.context.textAlign, text, x, y]),
    clearRect() {},
    getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
  };
  getContext(type: string) { if (type !== '2d') throw new Error(`Unexpected canvas context ${type}`); return this.context; }
  createImage() { return new ImageFixture(); }
}

export class ImageFixture extends EventTargetFixture {
  width = 8; height = 4; complete = false;
  onload: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  source = '';
  set src(value: string) { this.source = value; if (!value) return; queueMicrotask(() => { this.complete = true; this.onload?.(); this.emit('load'); }); }
  get src() { return this.source; }
}

export class BrowserMediaFixture extends EventTargetFixture {
  duration = 20; currentTime = 0; volume = 1; muted = false; playbackRate = 1; loop = false; readyState = 4; paused = true;
  videoWidth = 8; videoHeight = 4; crossOrigin = ''; preload = ''; playsInline = false;
  source = ''; lastSource = ''; plays = 0; loads = 0; released = false;
  set src(value: string) { this.source = value; if (value) this.lastSource = value; }
  get src() { return this.source; }
  constructor(readonly kind: 'audio' | 'video') { super(); }
  load() { this.loads++; queueMicrotask(() => { this.emit('loadedmetadata'); this.emit('canplay'); }); }
  play() { this.plays++; this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute(name: string) { if (name === 'src') { this.src = ''; this.released = true; } }
  tick(seconds: number) { if (!this.paused) this.currentTime = Math.min(this.duration, this.currentTime + seconds * this.playbackRate); }
}

export class InnerAudioFixture extends EventTargetFixture {
  source = ''; currentTime = 0; duration = 20; paused = true; destroyed = false;
  autoplay = false; loop = false; volume = 0; startTime = 0; playbackRate = 1;
  set src(value: string) { this.source = value; this.currentTime = this.startTime; queueMicrotask(() => this.emit('canplay')); }
  play() { this.paused = false; }
  pause() { this.paused = true; }
  destroy() { this.destroyed = true; this.paused = true; }
  seek(time: number) { this.currentTime = time; queueMicrotask(() => this.emit('seeked')); }
  onCanplay(callback: () => void) { this.on('canplay', callback); }
  offCanplay(callback: () => void) { this.off('canplay', callback); }
  onSeeked(callback: () => void) { this.on('seeked', callback); }
  offSeeked(callback: () => void) { this.off('seeked', callback); }
  onEnded(callback: () => void) { this.on('ended', callback); }
  offEnded(callback: () => void) { this.off('ended', callback); }
  onError(callback: () => void) { this.on('error', callback); }
  offError(callback: () => void) { this.off('error', callback); }
  tick(seconds: number) { if (!this.paused && !this.destroyed) this.currentTime = Math.min(this.duration, this.currentTime + seconds * this.playbackRate); }
}
function mp4Fixture() {
  function box(type: string, ...children: Buffer[]) { const payload = Buffer.concat(children), bytes = Buffer.alloc(8 + payload.length); bytes.writeUInt32BE(bytes.length); bytes.write(type, 4); payload.copy(bytes, 8); return bytes; }
  const mvhd = Buffer.alloc(20); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(20000, 16);
  const hdlr = Buffer.alloc(12); hdlr.write('soun', 8);
  return Buffer.concat([box('ftyp', Buffer.alloc(8)), box('moov', box('mvhd', mvhd), box('trak', box('mdia', box('hdlr', hdlr))))]);
}

export class GainFixture {
  gain = { value: 1 }; disconnected = false;
  connect() {}
  disconnect() { this.disconnected = true; }
}
export class AudioSourceFixture {
  buffer: AudioBufferFixture | null = null;
  playbackRate = { value: 1 }; loop = false; loopStart = 0; loopEnd = 0;
  onended: (() => void) | null = null;
  started = false; stopped = false; disconnected = false; offset = 0; startTime = 0; stoppedAt = 0; scheduledStop = Infinity;
  gain?: GainFixture;
  constructor(readonly context: AudioContextFixture) {}
  connect(destination: unknown) { if (destination instanceof GainFixture) this.gain = destination; }
  disconnect() { this.disconnected = true; }
  start(_when = 0, offset = 0) { this.started = true; this.offset = offset; this.startTime = this.context.currentTime; }
  stop(when = this.context.currentTime) { this.scheduledStop = when; this.tick(); }
  tick() { if (!this.stopped && this.context.currentTime >= this.scheduledStop) { this.stoppedAt = this.scheduledStop; this.stopped = true; this.onended?.(); } }
  get position() {
    const time = this.offset + Math.max(0, (this.stopped ? this.stoppedAt : this.context.currentTime) - this.startTime) * this.playbackRate.value;
    return this.loop && this.loopEnd > this.loopStart && time >= this.loopEnd ? this.loopStart + (time - this.loopStart) % (this.loopEnd - this.loopStart) : time;
  }
}
export class AudioBufferFixture {
  readonly data: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number, readonly source = '') { this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length)); }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(channel: number) { return this.data[channel]; }
}
export class AudioContextFixture {
  currentTime = 0; destination = {}; state = 'running'; closed = false;
  sources: AudioSourceFixture[] = []; gains: GainFixture[] = [];
  decodeAudioData(bytes: ArrayBuffer, success?: (value: AudioBufferFixture) => void) {
    const buffer = new AudioBufferFixture(2, 2000, 100, new TextDecoder().decode(bytes)); success?.(buffer); return Promise.resolve(buffer);
  }
  createBuffer(channels: number, length: number, sampleRate: number) { return new AudioBufferFixture(channels, length, sampleRate); }
  createBufferSource() { const source = new AudioSourceFixture(this); this.sources.push(source); return source; }
  createGain() { const gain = new GainFixture(); this.gains.push(gain); return gain; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
}
export class VideoDecoderFixture extends EventTargetFixture {
  source = ''; currentTime = 0; removed = false; started = false; seekCalls: number[] = []; pendingFrame = true;
  failNextSeek = false; abortVideo = false;
  start(options: { source: string; mode: number; abortVideo?: boolean }) { this.abortVideo = !!options.abortVideo; this.source = options.source; this.started = true; this.pendingFrame = true; queueMicrotask(() => this.emit('start')); return Promise.resolve({ width: 8, height: 4, duration: 20000 }); }
  seek(milliseconds: number) { if (this.failNextSeek) { this.failNextSeek = false; return Promise.reject(new Error('Injected decoder seek failure')); } this.currentTime = milliseconds / 1000; this.seekCalls.push(milliseconds); this.pendingFrame = true; queueMicrotask(() => this.emit('seek')); return Promise.resolve(); }
  getFrameData() { if (this.removed || !this.started || !this.pendingFrame) return null; this.pendingFrame = false; return { data: new Uint8Array(8 * 4 * 4).fill(255).buffer, width: 8, height: 4, pkPts: this.currentTime * 1000, pkDts: this.currentTime * 1000 }; }
  stop() { this.started = false; return Promise.resolve(); }
  remove() { this.removed = true; this.started = false; return Promise.resolve(); }
}

export class MediaAudioPlayerFixture {
  decoder?: VideoDecoderFixture;
  volume = 0; started = false; destroyed = false;
  addAudioSource(decoder: VideoDecoderFixture) { this.decoder = decoder; return Promise.resolve(); }
  removeAudioSource() { this.decoder = undefined; return Promise.resolve(); }
  start() { this.started = true; return Promise.resolve(); }
  stop() { this.started = false; return Promise.resolve(); }
  destroy() { this.destroyed = true; this.started = false; return Promise.resolve(); }
  tick(seconds: number) { if (this.started && !this.destroyed && this.decoder) this.decoder.currentTime += seconds; }
}

export function performanceHosts() {
  const browserMedia: BrowserMediaFixture[] = [], browserCanvases: CanvasFixture[] = [], miniCanvases: CanvasFixture[] = [];
  const audioContexts: AudioContextFixture[] = [], decoders: VideoDecoderFixture[] = [], innerAudio: InnerAudioFixture[] = [];
  const mediaAudio: MediaAudioPlayerFixture[] = [];
  const realNow = Date.now; let now = realNow(); Date.now = () => now;
  const files = new Set<string>();
  const document = {
    createElement(name: string) {
      if (name === 'canvas') { const canvas = new CanvasFixture(); browserCanvases.push(canvas); return canvas; }
      if (name === 'audio' || name === 'video') { const media = new BrowserMediaFixture(name); browserMedia.push(media); return media; }
      throw new Error(`Unexpected DOM creation: ${name}`);
    },
    createElementNS(_namespace: string, name: string) { if (name === 'img') return new ImageFixture(); throw new Error(`Unexpected namespaced element ${name}`); },
  };
  const wx = {
    env: { USER_DATA_PATH: '/performance-fixture' },
    createOffscreenCanvas() { const canvas = new CanvasFixture(); miniCanvases.push(canvas); return canvas; },
    createInnerAudioContext() { const audio = new InnerAudioFixture(); innerAudio.push(audio); return audio; },
    request({ header, success }: { header: { Range: string }; success(value: unknown): void }) {
      const match = /bytes=(\d+)-(\d+)/.exec(header.Range)!; const bytes = mp4Fixture().subarray(Number(match[1]), Number(match[2]) + 1);
      queueMicrotask(() => success({ statusCode: 206, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) })); return { abort() {} };
    },
    createWebAudioContext() { const context = new AudioContextFixture(); audioContexts.push(context); return context; },
    createMediaAudioPlayer() { const player = new MediaAudioPlayerFixture(); mediaAudio.push(player); return player; },
    createVideoDecoder() { const decoder = new VideoDecoderFixture(); decoders.push(decoder); return decoder; },
    getVideoInfo({ src, success }: { src: string; success(value: unknown): void }) { queueMicrotask(() => success({ duration: 20, width: 8, height: 4, type: 'mp4', size: 1, source: src })); },
    downloadFile({ url, success }: { url: string; success(value: unknown): void }) { const path = `/performance-fixture/${url.split('/').at(-1)}`; files.add(path); queueMicrotask(() => success({ statusCode: 200, tempFilePath: path })); return { abort() {} }; },
    getFileSystemManager() { return {
      readFile({ filePath, success }: { filePath: string; success(value: unknown): void }) { queueMicrotask(() => success({ data: new TextEncoder().encode(filePath).buffer })); },
      unlink({ filePath, success }: { filePath: string; success?: () => void }) { files.delete(filePath); success?.(); },
    }; },
  };
  const descriptors = { document: Object.getOwnPropertyDescriptor(globalThis, 'document'), wx: Object.getOwnPropertyDescriptor(globalThis, 'wx') };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'wx', { configurable: true, value: wx });
  return { browserMedia, browserCanvases, miniCanvases, audioContexts, innerAudio, mediaAudio, decoders, files, canvas: new CanvasFixture(),
    tick(seconds: number) { now += seconds * 1000; mediaAudio.forEach(player => player.tick(seconds)); browserMedia.forEach(media => media.tick(seconds)); innerAudio.forEach(media => media.tick(seconds)); audioContexts.forEach(context => { context.currentTime += seconds; context.sources.forEach(source => source.tick()); }); },
    restore() { Date.now = realNow; for (const [key, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } },
  };
}
export async function settleMedia() { for (let i = 0; i < 100; i++) await Promise.resolve(); }
