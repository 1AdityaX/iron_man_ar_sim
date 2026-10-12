/** The boot overlay: a boot log of model loading, camera start, and a mouse-only mode. */
export class StartScreen {
  private readonly root = document.getElementById('start-screen')!;
  private readonly status = document.getElementById('start-status')!;
  private readonly log = document.getElementById('start-log')!;
  private readonly startBtn = document.getElementById('btn-start') as HTMLButtonElement;
  private readonly demoBtn = document.getElementById('btn-demo') as HTMLButtonElement;
  private current: HTMLLIElement | null = null;
  private currentKey = '';

  constructor(onStart: () => void, onDemo: () => void) {
    this.startBtn.addEventListener('click', () => onStart());
    this.demoBtn.addEventListener('click', () => onDemo());
  }

  /**
   * Appends a boot-log line, or updates the current one when only a trailing percentage changed
   * ("LOADING HAND MODEL 40%" -> "... 41%"). The previous line is marked done.
   */
  setStatus(text: string, isError = false): void {
    const key = text.replace(/\s*\d+%$/, '');
    if (!this.current || key !== this.currentKey) {
      if (this.current?.classList.contains('current')) this.current.className = 'done';
      this.current = document.createElement('li');
      this.log.appendChild(this.current);
      this.currentKey = key;
      while (this.log.children.length > 6) this.log.firstElementChild?.remove();
    }
    this.current.textContent = text;
    this.current.className = isError ? 'error' : /ONLINE$/.test(text) ? 'done' : 'current';
    this.status.textContent = isError ? text : '';
  }

  setBusy(busy: boolean): void {
    this.startBtn.disabled = busy;
    this.demoBtn.disabled = busy;
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  show(): void {
    this.root.classList.remove('hidden');
  }
}
