import type { Settings } from '../settings';

export type HudAction = 'mirror' | 'depth' | 'bw' | 'camera' | 'labels' | 'occlusion' | 'debug' | 'help' | 'explode';

const onOff = (v: boolean) => (v ? 'ON' : 'OFF');

/** The SYSTEMS panel, the brand/status block, the gesture guide and the toast line. */
export class Hud {
  private readonly rows = new Map<string, HTMLButtonElement>();
  private readonly controls = document.getElementById('hud-controls')!;
  private readonly extra = this.controls.querySelector<HTMLElement>('.hud-extra')!;
  private readonly dimInput = this.controls.querySelector<HTMLInputElement>('input[data-action="dim"]')!;
  private readonly dimValue = this.controls.querySelector<HTMLElement>('.hud-slider-value')!;
  private readonly help = document.getElementById('help')!;
  private readonly toastEl = document.getElementById('toast')!;
  private readonly statusEl = document.getElementById('sys-status')!;
  private readonly clockEl = document.getElementById('sys-clock')!;
  private toastTimer = 0;
  private clockSeconds = -1;

  /** Called after the panel changes size (ADVANCED section toggled). */
  onLayout: () => void = () => undefined;

  constructor(onAction: (action: HudAction) => void, onDim: (value: number) => void) {
    this.controls.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
      const action = btn.dataset.action!;
      this.rows.set(action, btn);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.blur();
        if (action === 'more') {
          this.extra.hidden = !this.extra.hidden;
          btn.setAttribute('aria-expanded', String(!this.extra.hidden));
          this.onLayout();
        } else {
          onAction(action as HudAction);
        }
      });
    });
    this.dimInput.addEventListener('input', () => {
      const v = Number(this.dimInput.value) / 100;
      this.showDim(v);
      onDim(v);
    });
    // Keep keyboard shortcuts working after using the slider.
    this.dimInput.addEventListener('change', () => this.dimInput.blur());
  }

  sync(s: Settings, cameraLabel: string): void {
    this.set('mirror', onOff(s.mirror), s.mirror);
    this.set('depth', onOff(s.depthInvert), s.depthInvert);
    this.set('bw', onOff(s.grayscale), s.grayscale);
    this.set('camera', cameraLabel, cameraLabel !== 'OFF');
    this.set('labels', onOff(s.labels), s.labels);
    this.set('occlusion', onOff(s.occlusion), s.occlusion);
    this.set('debug', onOff(s.debug), s.debug);
    this.set('help', onOff(s.help), s.help);
    this.dimInput.value = String(Math.round(s.dim * 100));
    this.showDim(s.dim);
    this.help.classList.toggle('hidden', !s.help);
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1600);
  }

  /** The brand block's status line; `live` lights the LED green. */
  setStatus(text: string, live: boolean): void {
    if (this.statusEl.textContent !== text) this.statusEl.textContent = text;
    document.body.classList.toggle('live', live);
  }

  /** Mission clock since the session started. */
  setClock(seconds: number): void {
    const s = Math.floor(seconds);
    if (s === this.clockSeconds) return;
    this.clockSeconds = s;
    const pad = (n: number) => String(n).padStart(2, '0');
    this.clockEl.textContent = `T+${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  }

  get controlsRect(): DOMRect {
    return this.controls.getBoundingClientRect();
  }

  /** Screen y above which callouts must stay to keep the gesture guide readable. */
  get helpTop(): number {
    return this.help.classList.contains('hidden') ? window.innerHeight : this.help.getBoundingClientRect().top;
  }

  private showDim(v: number): void {
    this.dimValue.textContent = `${Math.round(v * 100)}%`;
    const max = Number(this.dimInput.max) / 100;
    this.dimInput.style.setProperty('--fill', `${(v / max) * 100}%`);
  }

  private set(action: string, value: string, on: boolean): void {
    const row = this.rows.get(action);
    const cell = row?.querySelector('.v');
    if (!row || !cell) return;
    if (cell.textContent !== value) cell.textContent = value;
    row.classList.toggle('is-off', !on);
  }
}
