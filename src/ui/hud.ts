import type { Settings } from '../settings';

export type HudAction = 'mirror' | 'depth' | 'bw' | 'camera' | 'labels' | 'occlusion' | 'debug' | 'help' | 'explode';

const onOff = (v: boolean) => (v ? 'ON' : 'OFF');

/** The top-right control stack, the help footer and the toast line. */
export class Hud {
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly controls = document.getElementById('hud-controls')!;
  private readonly extra = this.controls.querySelector<HTMLElement>('.hud-extra')!;
  private readonly dimInput = this.controls.querySelector<HTMLInputElement>('input[data-action="dim"]')!;
  private readonly dimValue = this.controls.querySelector<HTMLElement>('.hud-slider-value')!;
  private readonly help = document.getElementById('help')!;
  private readonly toastEl = document.getElementById('toast')!;
  private toastTimer = 0;

  constructor(onAction: (action: HudAction) => void, onDim: (value: number) => void) {
    this.controls.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
      const action = btn.dataset.action!;
      this.buttons.set(action, btn);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.blur();
        if (action === 'more') {
          this.extra.hidden = !this.extra.hidden;
          btn.setAttribute('aria-expanded', String(!this.extra.hidden));
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
    this.set('mirror', `MIRROR ${onOff(s.mirror)}`, s.mirror);
    this.set('depth', `DEPTH INVERT ${onOff(s.depthInvert)}`, s.depthInvert);
    this.set('bw', `B&W ${onOff(s.grayscale)}`, s.grayscale);
    this.set('camera', `CAMERA ${cameraLabel}`, true);
    this.set('labels', `LABELS ${onOff(s.labels)}`, s.labels);
    this.set('occlusion', `OCCLUSION ${onOff(s.occlusion)}`, s.occlusion);
    this.set('debug', `DEBUG ${onOff(s.debug)}`, s.debug);
    this.set('help', `HELP ${onOff(s.help)}`, s.help);
    this.dimInput.value = String(Math.round(s.dim * 100));
    this.showDim(s.dim);
    this.help.classList.toggle('hidden', !s.help);
  }

  private showDim(v: number): void {
    this.dimValue.textContent = `${Math.round(v * 100)}%`;
    const max = Number(this.dimInput.max) / 100;
    this.dimInput.style.setProperty('--fill', `${(v / max) * 100}%`);
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1400);
  }

  get controlsRect(): DOMRect {
    return this.controls.getBoundingClientRect();
  }

  /** Screen y below which right-docked labels may go without covering the controls. */
  get controlsBottom(): number {
    return this.controls.getBoundingClientRect().bottom;
  }

  /** Screen y above which labels must stay to keep the help text readable. */
  get helpTop(): number {
    return this.help.classList.contains('hidden') ? window.innerHeight : this.help.getBoundingClientRect().top;
  }

  private set(action: string, text: string, on: boolean): void {
    const btn = this.buttons.get(action);
    if (!btn) return;
    if (btn.textContent !== text) btn.textContent = text;
    btn.classList.toggle('is-off', !on);
  }
}
