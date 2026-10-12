import { damp, type Vec2 } from '../core/math';

export interface LabelSpec {
  key: string;
  /** Screen point the leader line points at. */
  anchor: Vec2;
  title: string;
  /** Key/value rows under the title. */
  rows: [string, string][];
  /** Which side of the anchor the callout sits on; 'auto' points outward from screen centre. */
  side?: 'left' | 'right' | 'auto';
  variant?: 'hand' | 'object' | 'info';
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Entry {
  el: HTMLDivElement;
  titleEl: HTMLDivElement;
  rowEls: { row: HTMLDivElement; k: HTMLSpanElement; v: HTMLSpanElement }[];
  path: SVGPolylineElement;
  dot: SVGCircleElement;
  ring: SVGCircleElement;
  text: string;
  w: number;
  h: number;
  /** Smoothed box position. */
  x: number;
  y: number;
  target: Rect & { side: 'left' | 'right'; below: boolean };
  spec: LabelSpec | null;
  opacity: number;
  placed: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARGIN = 14;
const GAP = 6;

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Floating callouts in the style of the films' workshop HUD: a short diagonal leader from the
 * thing being described, an underline with an end tick, and the text riding on that line.
 * Call begin(), put() each visible callout, then end() once per frame.
 */
export class LabelLayer {
  private readonly entries = new Map<string, Entry>();
  /** Screen areas callouts must stay out of (control panel, brand block). */
  keepOut: () => Rect[] = () => [];

  constructor(
    private readonly container: HTMLElement,
    private readonly svg: SVGSVGElement,
  ) {}

  begin(): void {
    for (const e of this.entries.values()) e.spec = null;
  }

  put(spec: LabelSpec): void {
    const e = this.entries.get(spec.key) ?? this.create(spec.key);
    e.spec = spec;
    const text = `${spec.variant}|${spec.title}|${spec.rows.map((r) => r.join(':')).join('|')}`;
    if (text === e.text) return;
    e.text = text;
    e.titleEl.textContent = spec.title;
    while (e.rowEls.length < spec.rows.length) {
      const row = document.createElement('div');
      row.className = 'c-row';
      const k = document.createElement('span');
      k.className = 'k';
      const v = document.createElement('span');
      v.className = 'v';
      row.append(k, v);
      e.el.appendChild(row);
      e.rowEls.push({ row, k, v });
    }
    e.rowEls.forEach((r, i) => {
      r.row.hidden = i >= spec.rows.length;
      if (i < spec.rows.length) {
        r.k.textContent = spec.rows[i][0];
        r.v.textContent = spec.rows[i][1];
      }
    });
    e.w = 0; // re-measure
  }

  /**
   * Lays out and draws the frame's callouts.
   * @param bottom y the callouts must stay above (the gesture guide)
   */
  end(dt: number, width: number, height: number, bottom: number): void {
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const keepOut = this.keepOut();
    const active: Entry[] = [];
    for (const e of this.entries.values()) {
      e.opacity += ((e.spec ? 1 : 0) - e.opacity) * damp(e.spec ? 12 : 8, dt);
      if (!e.spec) continue;
      if (!e.w) {
        e.w = e.el.offsetWidth;
        e.h = e.el.offsetHeight;
      }
      e.target = this.place(e, width, bottom, keepOut);
      active.push(e);
    }

    // Push overlapping callouts apart vertically (a few relaxation passes).
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
          const a = active[i].target;
          const b = active[j].target;
          if (!overlaps(a, b)) continue;
          const upper = a.y <= b.y ? a : b;
          const lower = upper === a ? b : a;
          const push = (upper.y + upper.h + GAP - lower.y) / 2;
          upper.y = Math.max(MARGIN, upper.y - push);
          lower.y = Math.min(bottom - lower.h - GAP, lower.y + push);
        }
      }
    }

    for (const e of this.entries.values()) {
      const show = e.opacity > 0.02;
      e.el.style.display = show ? '' : 'none';
      const lineShown = show && !!e.spec;
      e.path.style.display = e.dot.style.display = e.ring.style.display = lineShown ? '' : 'none';
      if (!show) {
        e.placed = false;
        continue;
      }
      if (e.spec) {
        const k = e.placed ? damp(14, dt) : 1;
        e.x += (e.target.x - e.x) * k;
        e.y += (e.target.y - e.y) * k;
        e.placed = true;
        e.el.className = `callout ${e.spec.variant ?? 'hand'} side-${e.target.side}${e.target.below ? ' below' : ''}`;
      }
      e.el.style.opacity = e.opacity.toFixed(3);
      e.el.style.transform = `translate3d(${e.x.toFixed(1)}px, ${e.y.toFixed(1)}px, 0)`;
      if (!e.spec) continue;

      // Leader: anchor -> elbow at the near end of the underline -> far end -> end tick.
      const a = e.spec.anchor;
      const right = e.target.side === 'right';
      const lineY = e.target.below ? e.y - 3 : e.y + e.h + 3;
      const nearX = right ? e.x - 2 : e.x + e.w + 2;
      const farX = right ? e.x + e.w : e.x;
      const tick = e.target.below ? 6 : -6;
      e.path.setAttribute(
        'points',
        `${a.x.toFixed(1)},${a.y.toFixed(1)} ${nearX.toFixed(1)},${lineY.toFixed(1)} ${farX.toFixed(1)},${lineY.toFixed(1)} ${farX.toFixed(1)},${(lineY + tick).toFixed(1)}`,
      );
      const variant = e.spec.variant ?? 'hand';
      e.path.setAttribute('class', `leader ${variant}`);
      e.dot.setAttribute('class', `leader-dot ${variant}`);
      e.ring.setAttribute('class', `leader-ring ${variant}`);
      for (const c of [e.dot, e.ring]) {
        c.setAttribute('cx', a.x.toFixed(1));
        c.setAttribute('cy', a.y.toFixed(1));
      }
      const o = e.opacity.toFixed(3);
      e.path.style.opacity = e.dot.style.opacity = e.ring.style.opacity = o;
    }
  }

  /** Target box for a callout: diagonally out from its anchor, clear of the edges and keep-out areas. */
  private place(e: Entry, width: number, bottom: number, keepOut: Rect[]): Entry['target'] {
    const spec = e.spec!;
    const reach = spec.variant === 'info' ? 64 : 48;
    let side: 'left' | 'right' = spec.side && spec.side !== 'auto' ? spec.side : spec.anchor.x < width / 2 ? 'left' : 'right';
    const boxFor = (s: 'left' | 'right', below: boolean): Rect => {
      const elbowX = spec.anchor.x + (s === 'right' ? reach : -reach);
      const elbowY = spec.anchor.y + (below ? reach : -reach);
      return {
        x: s === 'right' ? elbowX + 2 : elbowX - 2 - e.w,
        y: below ? elbowY + 3 : elbowY - 3 - e.h,
        w: e.w,
        h: e.h,
      };
    };
    const fits = (r: Rect) =>
      r.x >= MARGIN && r.x + r.w <= width - MARGIN && r.y >= MARGIN && r.y + r.h <= bottom - GAP && !keepOut.some((k) => overlaps(r, k));
    // Preference order: outward and above, outward and below, then the inner side.
    const other = side === 'left' ? 'right' : 'left';
    for (const [s, below] of [
      [side, false],
      [side, true],
      [other, false],
      [other, true],
    ] as const) {
      const r = boxFor(s, below);
      if (fits(r)) return { ...r, side: s, below };
    }
    // Nothing fits cleanly: stay outward and clamp onto the screen.
    const r = boxFor(side, false);
    r.x = Math.min(Math.max(MARGIN, r.x), width - MARGIN - r.w);
    r.y = Math.min(Math.max(MARGIN, r.y), bottom - GAP - r.h);
    side = r.x + r.w / 2 >= spec.anchor.x ? 'right' : 'left';
    return { ...r, side, below: false };
  }

  private create(key: string): Entry {
    const el = document.createElement('div');
    el.className = 'callout';
    const titleEl = document.createElement('div');
    titleEl.className = 'c-title';
    el.appendChild(titleEl);
    this.container.appendChild(el);
    const path = document.createElementNS(SVG_NS, 'polyline');
    const ring = document.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('r', '6.5');
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('r', '2.4');
    this.svg.append(path, ring, dot);
    const entry: Entry = {
      el,
      titleEl,
      rowEls: [],
      path,
      dot,
      ring,
      text: '',
      w: 0,
      h: 0,
      x: 0,
      y: 0,
      target: { x: 0, y: 0, w: 0, h: 0, side: 'right', below: false },
      spec: null,
      opacity: 0,
      placed: false,
    };
    this.entries.set(key, entry);
    return entry;
  }
}
