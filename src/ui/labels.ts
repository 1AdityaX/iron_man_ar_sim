import { damp, type Vec2 } from '../core/math';

export interface LabelSpec {
  key: string;
  /** Screen point the leader line points at. */
  anchor: Vec2;
  title: string;
  lines: string[];
  /** Dock edge; 'auto' picks the edge on the anchor's side of the screen. */
  side?: 'left' | 'right' | 'auto';
  variant?: 'hand' | 'object' | 'info';
}

interface Entry {
  el: HTMLDivElement;
  titleEl: HTMLDivElement;
  lineEls: HTMLDivElement[];
  path: SVGPolylineElement;
  dot: SVGCircleElement;
  text: string;
  w: number;
  h: number;
  x: number;
  y: number;
  side: 'left' | 'right';
  spec: LabelSpec | null;
  opacity: number;
  placed: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARGIN = 14;
const GAP = 8;

/**
 * HUD callouts docked to the screen edges with angled leader lines back to what they describe
 * (hands, holograms, parts). Call begin(), put() each visible label, then end() once per frame.
 */
export class LabelLayer {
  private readonly entries = new Map<string, Entry>();
  visible = true;

  constructor(
    private readonly container: HTMLElement,
    private readonly svg: SVGSVGElement,
  ) {}

  begin(): void {
    for (const e of this.entries.values()) e.spec = null;
  }

  put(spec: LabelSpec): void {
    let e = this.entries.get(spec.key);
    if (!e) e = this.create(spec.key);
    e.spec = spec;
    const text = `${spec.variant}|${spec.title}|${spec.lines.join('|')}`;
    if (text !== e.text) {
      e.text = text;
      e.el.className = `holo-label ${spec.variant ?? 'hand'}`;
      e.titleEl.textContent = spec.title;
      while (e.lineEls.length < spec.lines.length) {
        const div = document.createElement('div');
        e.el.appendChild(div);
        e.lineEls.push(div);
      }
      e.lineEls.forEach((div, i) => {
        div.textContent = spec.lines[i] ?? '';
        div.hidden = i >= spec.lines.length;
      });
      e.w = 0; // re-measure
    }
  }

  /**
   * Lays out and draws the frame's labels.
   * @param topRight y below which right-docked labels may start (clears the control stack)
   * @param bottom y above which labels must end (clears the help text)
   */
  end(dt: number, width: number, height: number, topRight: number, bottom: number): void {
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const bySide: Record<'left' | 'right', Entry[]> = { left: [], right: [] };
    for (const e of this.entries.values()) {
      const target = e.spec && this.visible ? 1 : 0;
      e.opacity += (target - e.opacity) * damp(target ? 12 : 8, dt);
      if (!e.spec) continue;
      if (!e.w) {
        e.w = e.el.offsetWidth;
        e.h = e.el.offsetHeight;
      }
      const side = e.spec.side ?? 'auto';
      e.side = side === 'auto' ? (e.spec.anchor.x < width / 2 ? 'left' : 'right') : side;
      bySide[e.side].push(e);
    }

    for (const side of ['left', 'right'] as const) {
      const list = bySide[side];
      const top = side === 'right' ? topRight + GAP : MARGIN;
      const maxY = bottom - GAP;
      // Prefer sitting a little above the anchor, then resolve overlaps top-down.
      const desired = list.map((e) => ({ e, y: e.spec!.anchor.y - e.h - 36 }));
      desired.sort((a, b) => a.y - b.y);
      let cursor = top;
      for (const d of desired) {
        d.y = Math.max(d.y, cursor);
        cursor = d.y + d.e.h + GAP;
      }
      // Then bottom-up, so nothing runs past the help text.
      let floor = maxY;
      for (let i = desired.length - 1; i >= 0; i--) {
        desired[i].y = Math.max(top, Math.min(desired[i].y, floor - desired[i].e.h));
        floor = desired[i].y - GAP;
      }
      for (const d of desired) {
        const x = side === 'left' ? MARGIN : width - MARGIN - d.e.w;
        const k = d.e.placed ? damp(14, dt) : 1;
        d.e.x += (x - d.e.x) * k;
        d.e.y += (d.y - d.e.y) * k;
        d.e.placed = true;
      }
    }

    for (const e of this.entries.values()) {
      const show = e.opacity > 0.02;
      e.el.style.display = show ? '' : 'none';
      e.path.style.display = show && e.spec ? '' : 'none';
      e.dot.style.display = show && e.spec ? '' : 'none';
      if (!show) {
        e.placed = false;
        continue;
      }
      e.el.classList.toggle('dock-left', e.side === 'left');
      e.el.style.opacity = e.opacity.toFixed(3);
      e.el.style.transform = `translate3d(${e.x.toFixed(1)}px, ${e.y.toFixed(1)}px, 0)`;
      if (!e.spec) continue;
      const a = e.spec.anchor;
      const innerX = e.side === 'left' ? e.x + e.w : e.x;
      const ly = e.y + e.h / 2;
      // 45° elbow from the anchor, then a horizontal run into the label.
      const run = Math.abs(ly - a.y);
      const dir = Math.sign(innerX - a.x) || 1;
      let ex = a.x + dir * run;
      if ((dir > 0 && ex > innerX) || (dir < 0 && ex < innerX)) ex = innerX;
      e.path.setAttribute('points', `${a.x.toFixed(1)},${a.y.toFixed(1)} ${ex.toFixed(1)},${ly.toFixed(1)} ${innerX.toFixed(1)},${ly.toFixed(1)}`);
      e.path.style.opacity = (e.opacity * 0.85).toFixed(3);
      e.path.setAttribute('class', `leader ${e.spec.variant ?? 'hand'}`);
      e.dot.setAttribute('cx', a.x.toFixed(1));
      e.dot.setAttribute('cy', a.y.toFixed(1));
      e.dot.setAttribute('class', `leader-dot ${e.spec.variant ?? 'hand'}`);
      e.dot.style.opacity = e.opacity.toFixed(3);
    }
  }

  private create(key: string): Entry {
    const el = document.createElement('div');
    el.className = 'holo-label';
    const titleEl = document.createElement('div');
    titleEl.className = 't';
    el.appendChild(titleEl);
    this.container.appendChild(el);
    const path = document.createElementNS(SVG_NS, 'polyline');
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('r', '2.6');
    this.svg.append(path, dot);
    const entry: Entry = {
      el,
      titleEl,
      lineEls: [],
      path,
      dot,
      text: '',
      w: 0,
      h: 0,
      x: 0,
      y: 0,
      side: 'left',
      spec: null,
      opacity: 0,
      placed: false,
    };
    this.entries.set(key, entry);
    return entry;
  }
}
