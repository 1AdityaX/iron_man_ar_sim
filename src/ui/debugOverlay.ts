import { HAND_BONES, LM } from '../tracking/landmarks';
import type { TrackedHand } from '../tracking/trackedHand';

export interface DebugStats {
  fps: number;
  trackerFps: number;
  detectMs: number;
  delegate: string;
  video: string;
  objects: number;
  /** Most recent gesture events. */
  events: string[];
}

/** Landmark skeletons and per-hand gesture readouts, toggled with D. */
export class DebugOverlay {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private wasOn = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(enabled: boolean, hands: readonly TrackedHand[], stats: DebugStats): void {
    const ctx = this.ctx;
    if (!enabled) {
      if (this.wasOn) ctx.clearRect(0, 0, this.width, this.height);
      this.wasOn = false;
      return;
    }
    this.wasOn = true;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'top';

    for (const h of hands) {
      if (!h.present) continue;
      const color = h.side === 'Left' ? '#ff5bd1' : '#7cff8a';
      const s = h.screen;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const [a, b] of HAND_BONES) {
        ctx.moveTo(s[a * 2], s[a * 2 + 1]);
        ctx.lineTo(s[b * 2], s[b * 2 + 1]);
      }
      ctx.stroke();
      ctx.fillStyle = color;
      for (let i = 0; i < 21; i++) {
        ctx.beginPath();
        ctx.arc(s[i * 2], s[i * 2 + 1], i % 4 === 0 ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const flags = [
        h.pinching.value && 'PINCH',
        h.fist.value && 'FIST',
        h.pointing.value && 'POINT',
        h.open.value && 'OPEN',
      ].filter(Boolean);
      const lines = [
        `${h.side.toUpperCase()} ${(h.score * 100).toFixed(0)}%  ${flags.join(' ') || '-'}`,
        `pinch ${h.pinchRatio.toFixed(2)}  grip ${h.grip.toFixed(2)}  ext ${h.tipExt[1].toFixed(2)}`,
        `curl ${h.curls.map((c) => c.toFixed(1)).join(' ')}`,
        `depth ${h.depth.toFixed(2)}m  twist ${((h.knuckleAngle * 180) / Math.PI).toFixed(0)}°`,
      ];
      const x = s[LM.WRIST * 2] + 16;
      const y = s[LM.WRIST * 2 + 1] + 10;
      this.panel(x, y, lines, color);
    }

    // Below the brand block in the top-left corner.
    this.panel(24, 100, [
      `FPS ${stats.fps.toFixed(0)}  TRACK ${stats.trackerFps.toFixed(0)} Hz  ${stats.detectMs.toFixed(1)} ms`,
      `DELEGATE ${stats.delegate}  VIDEO ${stats.video}`,
      `OBJECTS ${stats.objects}`,
      ...stats.events.map((e) => `› ${e}`),
    ], '#58d3ff');
  }

  private panel(x: number, y: number, lines: string[], color: string): void {
    const ctx = this.ctx;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14;
    const h = lines.length * 14 + 10;
    x = Math.min(x, this.width - w - 6);
    y = Math.min(y, this.height - h - 6);
    ctx.fillStyle = 'rgba(0, 8, 14, 0.72)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = '#e8fbff';
    lines.forEach((l, i) => ctx.fillText(l, x + 7, y + 6 + i * 14));
  }
}
