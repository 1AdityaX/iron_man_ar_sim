/** The boot overlay: model loading status, camera start, and a mouse-only demo mode. */
export class StartScreen {
  private readonly root = document.getElementById('start-screen')!;
  private readonly status = document.getElementById('start-status')!;
  private readonly startBtn = document.getElementById('btn-start') as HTMLButtonElement;
  private readonly demoBtn = document.getElementById('btn-demo') as HTMLButtonElement;

  constructor(onStart: () => void, onDemo: () => void) {
    this.startBtn.addEventListener('click', () => onStart());
    this.demoBtn.addEventListener('click', () => onDemo());
  }

  setStatus(text: string, isError = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('error', isError);
  }

  setBusy(busy: boolean): void {
    this.startBtn.disabled = busy;
    this.demoBtn.disabled = busy;
  }

  setStartLabel(text: string): void {
    this.startBtn.textContent = text;
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  show(): void {
    this.root.classList.remove('hidden');
  }
}
