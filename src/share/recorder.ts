/**
 * Video recording of the game view (highlight clips, the trailer): the WebGL canvas is copied every frame
 * into a 2D canvas at the output size, the overlay (letterbox, fades, title cards, watermark) is drawn on top,
 * and MediaRecorder encodes that canvas's captureStream plus the game's final audio mix (AudioSystem
 * captureStream: the speakers keep playing). Everything stays in the page: the result is a Blob the player
 * downloads or shares. Real time, at the quality the game already renders.
 */

export interface RecordFormat {
  mime: string;
  ext: 'webm' | 'mp4';
}

/** The best container / codecs this browser records (WebM first; Safari records MP4). */
export function pickFormat(): RecordFormat | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const tries: RecordFormat[] = [
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
    { mime: 'video/mp4;codecs=avc1,mp4a', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
  ];
  for (const f of tries) {
    try { if (MediaRecorder.isTypeSupported(f.mime)) return f; } catch { /* keep trying */ }
  }
  return null;
}

/** Can this browser record the game (MediaRecorder + canvas captureStream)? */
export function canRecordVideo(): boolean {
  return typeof document !== 'undefined' && !!pickFormat() && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

export interface RecorderOptions {
  /** The game's WebGL canvas. */
  source: HTMLCanvasElement;
  /** The game's audio (AudioSystem.captureStream()), or null for a silent video. */
  audio?: MediaStream | null;
  /** Output cap; the source aspect ratio is kept (default 1920×1080). */
  maxWidth?: number;
  maxHeight?: number;
  fps?: number;
  /** Video bits per second (default: ~0.12 bits per pixel per frame). */
  videoBitsPerSecond?: number;
  /** Draw on top of each frame (title cards, fades, watermark). */
  overlay?(ctx: CanvasRenderingContext2D, w: number, h: number): void;
}

/** Records the canvas (plus audio) until stop(). */
export class CanvasRecorder {
  readonly format: RecordFormat;
  readonly width: number;
  readonly height: number;
  private comp: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  private raf = 0;
  private stopped: Promise<Blob>;
  private resolveStop!: (b: Blob) => void;
  private rejectStop!: (e: unknown) => void;
  private t0 = 0;
  private running = false;
  frames = 0;

  constructor(private o: RecorderOptions) {
    const fmt = pickFormat();
    if (!fmt) throw new Error('This browser cannot record video.');
    this.format = fmt;
    const sw = Math.max(2, o.source.width), sh = Math.max(2, o.source.height);
    const k = Math.min(1, (o.maxWidth ?? 1920) / sw, (o.maxHeight ?? 1080) / sh);
    // encoders want even sizes
    this.width = Math.max(2, Math.round((sw * k) / 2) * 2);
    this.height = Math.max(2, Math.round((sh * k) / 2) * 2);
    this.comp = document.createElement('canvas');
    this.comp.width = this.width;
    this.comp.height = this.height;
    const ctx = this.comp.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('No 2D canvas for recording.');
    this.ctx = ctx;
    ctx.imageSmoothingQuality = 'high';
    const fps = o.fps ?? 30;
    const video = this.comp.captureStream(fps);
    const tracks = [...video.getVideoTracks(), ...(o.audio?.getAudioTracks() ?? [])];
    const stream = new MediaStream(tracks);
    const bits = o.videoBitsPerSecond ?? Math.round(Math.min(16e6, Math.max(2.5e6, this.width * this.height * fps * 0.12)));
    this.rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: bits, audioBitsPerSecond: 160_000 });
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.stopped = new Promise<Blob>((res, rej) => { this.resolveStop = res; this.rejectStop = rej; });
    this.rec.onstop = () => {
      for (const t of video.getVideoTracks()) t.stop();
      this.resolveStop(new Blob(this.chunks, { type: fmt.mime.split(';')[0] }));
    };
    this.rec.onerror = (e) => this.rejectStop((e as unknown as { error?: unknown }).error ?? new Error('Recording failed.'));
  }

  /** Seconds recorded so far. */
  get elapsed(): number {
    return this.running ? (performance.now() - this.t0) / 1000 : 0;
  }

  /** Start copying frames (call after the game's own frame loop is running: frames are copied right after it renders). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.t0 = performance.now();
    this.draw();
    this.rec.start(1000);
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private draw(): void {
    const { ctx, width: w, height: h } = this;
    try {
      ctx.drawImage(this.o.source, 0, 0, w, h);
    } catch {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
    this.o.overlay?.(ctx, w, h);
    this.frames++;
  }

  /** Stop and get the video. */
  stop(): Promise<Blob> {
    if (this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
      try { this.rec.requestData(); } catch { /* not recording */ }
      try { this.rec.stop(); } catch (e) { this.rejectStop(e); }
    }
    return this.stopped;
  }

  /** Abandon the recording (no Blob). */
  cancel(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    try { if (this.rec.state !== 'inactive') this.rec.stop(); } catch { /* ignore */ }
    this.chunks = [];
  }
}

// ---------------------------------------------------------------------------------------------
// Overlay painting shared by clips and the trailer

export interface OverlayState {
  /** 0..1 black over the picture. */
  fade: number;
  /** 0..1 letterbox (fraction of 11 % of the height per bar). */
  letter: number;
  card: { kicker?: string; title: string; sub?: string; at?: 'center' | 'lower' } | null;
  cardAlpha: number;
}

/** Paint letterbox bars, a title card, a fade and the watermark into a recording frame. */
export function paintOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, s: OverlayState, watermark = 'RED HORIZON'): void {
  const bar = Math.round(h * 0.11 * Math.max(0, Math.min(1, s.letter)));
  if (bar > 0) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
  }
  const u = h / 1080;
  if (s.card && s.cardAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, s.cardAlpha);
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 24 * u;
    ctx.textBaseline = 'alphabetic';
    const lower = s.card.at === 'lower';
    const x = lower ? w * 0.07 : w / 2;
    ctx.textAlign = lower ? 'left' : 'center';
    const titleSize = (lower ? 64 : 104) * u;
    let y = lower ? h - Math.max(bar, h * 0.06) - h * 0.1 : h / 2 + titleSize * 0.35;
    if (s.card.kicker) {
      ctx.font = `600 ${Math.round(24 * u)}px Rajdhani, sans-serif`;
      ctx.fillStyle = '#ffb08a';
      spaced(ctx, s.card.kicker.toUpperCase(), x, y - titleSize * 1.05, 0.45, lower);
    }
    ctx.font = `700 ${Math.round(titleSize)}px Rajdhani, sans-serif`;
    ctx.fillStyle = '#f2f6fa';
    spaced(ctx, s.card.title.toUpperCase(), x, y, 0.16, lower);
    if (s.card.sub) {
      ctx.font = `500 ${Math.round(28 * u)}px Rajdhani, sans-serif`;
      ctx.fillStyle = 'rgba(242,246,250,0.85)';
      y += 52 * u;
      spaced(ctx, s.card.sub.toUpperCase(), x, y, 0.28, lower);
    }
    ctx.restore();
  }
  if (watermark) {
    ctx.save();
    ctx.globalAlpha = 0.72 * (1 - s.fade);
    ctx.font = `700 ${Math.round(22 * u)}px Rajdhani, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 8 * u;
    spaced(ctx, watermark, w - 28 * u, h - Math.max(bar, 0) - 24 * u, 0.3, false, true);
    ctx.restore();
  }
  if (s.fade > 0.003) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, s.fade).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }
}

/** fillText with letter spacing (canvas letterSpacing where supported). */
function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, em: number, left: boolean, right = false): void {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? '16');
  if ('letterSpacing' in c) {
    c.letterSpacing = `${(size * em).toFixed(1)}px`;
    // centred text drifts left by one trailing space: compensate
    ctx.fillText(text, left || right ? x : x + (size * em) / 2, y);
    c.letterSpacing = '0px';
    return;
  }
  ctx.fillText(text, x, y);
}

/** A file name for a recording: red-horizon-<slug>-<yyyymmdd-hhmm>.<ext>. */
export function videoFileName(label: string, ext: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'clip';
  return `red-horizon-${slug}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.${ext}`;
}

/** Trigger a download of a Blob (object URL revoked shortly after). */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Share a video file through the system share sheet where the browser can (mostly mobile). */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}
