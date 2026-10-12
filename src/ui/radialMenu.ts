import { clamp } from '../core/math';

export interface MenuOption {
  id: string;
  label: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The circular HUD menu ("SPAWN OBJECT", "REACTOR CONTROL"...). Options sit on a ring around
 * the point where it opened. Hands select by hovering the pinch point over an option and
 * releasing (or pinching again); the mouse can simply click.
 */
export class RadialMenu {
  open = false;
  /** Who opened the menu (a hand side or 'mouse'); a held pinch steers the menu it opened. */
  owner: string | null = null;
  x = 0;
  y = 0;
  /** Depth (metres) of the hand that opened it; spawned objects appear there. */
  depth = 0.7;
  hovered: string | null = null;
  /** Screen rectangle the menu must not cover (the HUD control stack). */
  avoid: (() => DOMRect | null) | null = null;

  private readonly el: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly ringSvg: SVGSVGElement;
  private options: { opt: MenuOption; el: HTMLButtonElement; dx: number; dy: number }[] = [];
  private radius = 104;
  private optionRadius = 38;
  private idleTime = 0;
  private closeTimer = 0;

  constructor(
    layer: HTMLElement,
    private readonly onSelect: (id: string) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'radial-menu';
    this.title = document.createElement('div');
    this.title.className = 'rm-title';
    this.ringSvg = document.createElementNS(SVG_NS, 'svg');
    this.ringSvg.classList.add('rm-ring');
    this.el.append(this.ringSvg, this.title);
    layer.appendChild(this.el);
  }

  show(title: string, options: MenuOption[], x: number, y: number, owner: string, depth: number): void {
    window.clearTimeout(this.closeTimer);
    const small = Math.min(window.innerWidth, window.innerHeight) < 560;
    this.radius = small ? 82 : 104;
    this.optionRadius = small ? 32 : 38;
    const reach = this.radius + this.optionRadius + 12;
    this.x = clamp(x, reach, window.innerWidth - reach);
    this.y = clamp(y, reach + 46, window.innerHeight - reach);
    const r = this.avoid?.();
    if (r && this.x + reach > r.left - 8 && this.y - reach - 46 < r.bottom + 8) {
      // Slide clear of the control stack, whichever way is the shorter move.
      const down = r.bottom + 8 - (this.y - reach - 46);
      const left = this.x + reach - (r.left - 8);
      if (down <= left && this.y + down <= window.innerHeight - reach) this.y += down;
      else this.x = Math.max(reach, this.x - left);
    }
    this.owner = owner;
    this.depth = depth;
    this.hovered = null;
    this.idleTime = 0;
    this.title.textContent = title;
    this.title.style.transform = `translate(-50%, ${-this.radius - this.optionRadius - 34}px)`;

    const size = (this.radius + 6) * 2;
    this.ringSvg.setAttribute('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`);
    this.ringSvg.style.width = this.ringSvg.style.height = `${size}px`;
    this.ringSvg.style.transform = `translate(${-size / 2}px, ${-size / 2}px)`;
    this.ringSvg.innerHTML =
      `<circle class="rm-track" r="${this.radius}"/>` +
      `<circle class="rm-track-dash" r="${this.radius - 9}"/>` +
      `<circle class="rm-core" r="${this.optionRadius * 0.55}"/>`;

    for (const o of this.options) o.el.remove();
    this.options = options.map((opt, i) => {
      const a = -Math.PI / 2 + (i / options.length) * Math.PI * 2;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'rm-option';
      for (const word of opt.label.split(' ')) {
        const span = document.createElement('span');
        span.textContent = word;
        el.appendChild(span);
      }
      const dx = Math.cos(a) * this.radius;
      const dy = Math.sin(a) * this.radius;
      el.style.left = `${dx}px`;
      el.style.top = `${dy}px`;
      el.style.width = el.style.height = `${this.optionRadius * 2}px`;
      el.style.transitionDelay = `${i * 30}ms`;
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select(opt.id);
      });
      el.addEventListener('pointerenter', () => this.setHover(opt.id));
      el.addEventListener('pointerleave', () => this.setHover(null));
      this.el.appendChild(el);
      return { opt, el, dx, dy };
    });

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
    this.closeTimer = window.setTimeout(() => this.el.classList.remove('visible', 'closing'), 260);
  }

  /** Option under a screen point, or null. */
  hitTest(x: number, y: number): string | null {
    if (!this.open) return null;
    let best: string | null = null;
    let bestD = this.optionRadius * 1.3;
    for (const o of this.options) {
      const d = Math.hypot(x - (this.x + o.dx), y - (this.y + o.dy));
      if (d < bestD) {
        bestD = d;
        best = o.opt.id;
      }
    }
    return best;
  }

  /** True if the point is within the menu's overall footprint. */
  contains(x: number, y: number): boolean {
    return this.open && Math.hypot(x - this.x, y - this.y) < this.radius + this.optionRadius * 1.6;
  }

  setHover(id: string | null): void {
    if (id) this.idleTime = 0;
    if (id === this.hovered) return;
    this.hovered = id;
    for (const o of this.options) o.el.classList.toggle('hover', o.opt.id === id);
  }

  select(id: string): void {
    if (!this.open) return;
    const chosen = this.options.find((o) => o.opt.id === id);
    chosen?.el.classList.add('chosen');
    this.hide();
    this.onSelect(id);
  }

  /** Closes the menu after a stretch of inactivity. */
  update(dt: number): void {
    if (!this.open) return;
    this.idleTime += dt;
    if (this.idleTime > 9) this.hide();
  }
}
