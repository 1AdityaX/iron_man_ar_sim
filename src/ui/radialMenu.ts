import { clamp } from '../core/math';

export interface MenuOption {
  id: string;
  label: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** Multi-word labels stack one word per line, centred on (x, y). */
function stackedText(words: string[], x: number, y: number, className: string): SVGTextElement {
  const text = svg('text', { x, y, class: className, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  words.forEach((w, i) => {
    const span = svg('tspan', { x, dy: i === 0 ? `${-(words.length - 1) * 0.55}em` : '1.1em' });
    span.textContent = w;
    text.appendChild(span);
  });
  return text;
}

/**
 * A ring menu in the style of the films' workshop HUD: options are sectors of a ring around a
 * hub that carries the menu's name, inside a rotating tick bezel. Hands pick a sector by sliding
 * the pinch onto it and releasing (or pinching again); the mouse can simply click.
 */
export class RadialMenu {
  open = false;
  /** Who opened the menu (a hand side or 'mouse'); a held pinch steers the menu it opened. */
  owner: string | null = null;
  x = 0;
  y = 0;
  /** Depth (metres) of the hand that opened it; fabricated objects appear there. */
  depth = 0.7;
  hovered: string | null = null;
  /** Screen rectangle the menu must not cover (the control panel). */
  avoid: (() => DOMRect | null) | null = null;

  private readonly el: HTMLDivElement;
  private readonly svgEl: SVGSVGElement;
  private sectors: { opt: MenuOption; g: SVGGElement }[] = [];
  private inner = 64;
  private outer = 126;
  private idleTime = 0;
  private closeTimer = 0;

  constructor(
    layer: HTMLElement,
    private readonly onSelect: (id: string) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'radial-menu';
    this.svgEl = svg('svg', { class: 'rm-svg' });
    this.el.appendChild(this.svgEl);
    layer.appendChild(this.el);
  }

  show(title: string, options: MenuOption[], x: number, y: number, owner: string, depth: number): void {
    window.clearTimeout(this.closeTimer);
    const small = Math.min(window.innerWidth, window.innerHeight) < 560;
    this.inner = small ? 50 : 64;
    this.outer = small ? 100 : 126;
    const reach = this.outer + 26;
    this.x = clamp(x, reach, window.innerWidth - reach);
    this.y = clamp(y, reach, window.innerHeight - reach);
    const r = this.avoid?.();
    if (r && this.x + reach > r.left - 8 && this.y - reach < r.bottom + 8) {
      // Slide clear of the control panel, whichever way is the shorter move.
      const down = r.bottom + 8 - (this.y - reach);
      const left = this.x + reach - (r.left - 8);
      if (down <= left && this.y + down <= window.innerHeight - reach) this.y += down;
      else this.x = Math.max(reach, this.x - left);
    }
    this.owner = owner;
    this.depth = depth;
    this.hovered = null;
    this.idleTime = 0;
    this.build(title, options);
    this.el.style.transform = `translate(${this.x}px, ${this.y}px)`;
    this.el.classList.remove('closing');
    this.el.classList.add('visible');
    // Next frame, so the open transition plays.
    requestAnimationFrame(() => this.el.classList.add('open'));
    this.open = true;
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.owner = null;
    this.hovered = null;
    this.el.classList.remove('open');
    this.el.classList.add('closing');
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => this.el.classList.remove('visible', 'closing'), 300);
  }

  /** Option whose sector is under a screen point, or null. */
  hitTest(x: number, y: number): string | null {
    if (!this.open || this.sectors.length === 0) return null;
    const dx = x - this.x;
    const dy = y - this.y;
    const r = Math.hypot(dx, dy);
    if (r < this.inner * 0.8 || r > this.outer * 1.22) return null;
    const step = TAU / this.sectors.length;
    // Sector i is centred on -90° + i·step (clockwise from the top, as on screen).
    const rel = (((Math.atan2(dy, dx) + Math.PI / 2 + step / 2) % TAU) + TAU) % TAU;
    return this.sectors[Math.floor(rel / step) % this.sectors.length].opt.id;
  }

  /** True if the point is within the menu's overall footprint. */
  contains(x: number, y: number): boolean {
    return this.open && Math.hypot(x - this.x, y - this.y) < this.outer + 34;
  }

  setHover(id: string | null): void {
    if (id) this.idleTime = 0;
    if (id === this.hovered) return;
    this.hovered = id;
    for (const s of this.sectors) s.g.classList.toggle('hover', s.opt.id === id);
  }

  select(id: string): void {
    if (!this.open) return;
    this.sectors.find((s) => s.opt.id === id)?.g.classList.add('chosen');
    this.hide();
    this.onSelect(id);
  }

  /** Closes the menu after a stretch of inactivity. */
  update(dt: number): void {
    if (!this.open) return;
    this.idleTime += dt;
    if (this.idleTime > 9) this.hide();
  }

  private build(title: string, options: MenuOption[]): void {
    const { inner, outer } = this;
    const size = (outer + 30) * 2;
    const s = this.svgEl;
    s.replaceChildren();
    s.setAttribute('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`);
    s.style.width = s.style.height = `${size}px`;
    s.style.transform = `translate(${-size / 2}px, ${-size / 2}px)`;

    // Bezel: a thin ring and a rotating band of ticks.
    s.appendChild(svg('circle', { r: outer + 5, class: 'rm-bezel' }));
    const ticks = svg('g', { class: 'rm-ticks' });
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU;
      const r0 = outer + (i % 6 === 0 ? 9 : 11);
      const r1 = outer + 15;
      ticks.appendChild(
        svg('line', { x1: Math.cos(a) * r0, y1: Math.sin(a) * r0, x2: Math.cos(a) * r1, y2: Math.sin(a) * r1 }),
      );
    }
    s.appendChild(ticks);

    const step = TAU / options.length;
    const gap = 3 / outer;
    const mid = (inner + outer) / 2;
    const p = (r: number, a: number) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
    this.sectors = options.map((opt, i) => {
      const center = -Math.PI / 2 + i * step;
      const a0 = center - step / 2 + gap;
      const a1 = center + step / 2 - gap;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const g = svg('g', { class: 'rm-sector' });
      g.style.setProperty('--i', String(i));
      g.appendChild(
        svg('path', {
          d: `M ${p(outer, a0)} A ${outer} ${outer} 0 ${large} 1 ${p(outer, a1)} L ${p(inner, a1)} A ${inner} ${inner} 0 ${large} 0 ${p(inner, a0)} Z`,
        }),
      );
      const words = opt.label.split(' ');
      const cls = words.some((w) => w.length > 7) ? 'rm-label long' : 'rm-label';
      g.appendChild(stackedText(words, Math.cos(center) * mid, Math.sin(center) * mid, cls));
      g.addEventListener('pointerdown', (e) => e.stopPropagation());
      g.addEventListener('pointerenter', () => this.setHover(opt.id));
      g.addEventListener('pointerleave', () => this.setHover(null));
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select(opt.id);
      });
      s.appendChild(g);
      return { opt, g };
    });

    // Hub with the menu's name; clicking it closes the menu.
    const hub = svg('g', { class: 'rm-hub' });
    hub.appendChild(svg('circle', { r: inner - 10, class: 'rm-hub-disc' }));
    hub.appendChild(svg('circle', { r: inner - 4, class: 'rm-hub-dash' }));
    hub.appendChild(stackedText(title.split(' '), 0, 0, 'rm-title'));
    hub.addEventListener('pointerdown', (e) => e.stopPropagation());
    hub.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });
    s.appendChild(hub);
  }
}
