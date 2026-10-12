import { CONFIG } from '../config';

/** "MacBook Pro Camera" -> "MACBOOK PRO", "FaceTime HD Camera (Built-in)" -> "FACETIME HD". */
export function shortCameraLabel(label: string): string {
  const s = label
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(camera|webcam|video|built-in|integrated)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return s || 'WEBCAM';
}

export type CameraErrorKind = 'insecure' | 'denied' | 'missing' | 'busy' | 'unknown';

export class CameraError extends Error {
  constructor(
    readonly kind: CameraErrorKind,
    message: string,
  ) {
    super(message);
  }
}

function classify(err: unknown): CameraError {
  const name = (err as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return new CameraError('denied', 'Camera permission was denied.');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new CameraError('missing', 'No camera was found.');
  if (name === 'NotReadableError' || name === 'AbortError') return new CameraError('busy', 'The camera is in use by another app.');
  return new CameraError('unknown', (err as Error)?.message ?? 'Could not start the camera.');
}

/** The webcam (or, for testing, a looping video file) feeding the tracker and the backdrop. */
export class CameraFeed {
  devices: MediaDeviceInfo[] = [];
  deviceId: string | null = null;
  label = 'OFF';
  source: 'none' | 'camera' | 'file' = 'none';
  private stream: MediaStream | null = null;

  constructor(readonly video: HTMLVideoElement) {
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
  }

  static get supported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  get ready(): boolean {
    return this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  async start(deviceId: string | null = null): Promise<void> {
    if (!window.isSecureContext || !CameraFeed.supported) {
      throw new CameraError('insecure', 'Camera access needs HTTPS (or localhost).');
    }
    this.stop();
    const video: MediaTrackConstraints = {
      width: { ideal: CONFIG.camera.idealWidth },
      height: { ideal: CONFIG.camera.idealHeight },
      frameRate: { ideal: 30 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
    };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (err) {
      if (!deviceId) throw classify(err);
      // A remembered camera may be gone; fall back to the default one.
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { ...video, deviceId: undefined, facingMode: 'user' }, audio: false });
      } catch (err2) {
        throw classify(err2);
      }
    }
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play().catch(() => undefined);
    const track = stream.getVideoTracks()[0];
    this.deviceId = track?.getSettings().deviceId ?? deviceId;
    this.label = shortCameraLabel(track?.label ?? '');
    this.source = 'camera';
    await this.refreshDevices();
    await this.waitForFrames();
  }

  /** Plays a video file as if it were the camera (handy for demos and testing). */
  async startFile(url: string): Promise<void> {
    this.stop();
    this.video.srcObject = null;
    this.video.src = url;
    this.video.loop = true;
    this.source = 'file';
    this.label = 'VIDEO FILE';
    await this.video.play();
    await this.waitForFrames();
  }

  async refreshDevices(): Promise<void> {
    try {
      this.devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    } catch {
      this.devices = [];
    }
  }

  /** Switches to the next camera. Returns false if there is only one. */
  async next(): Promise<boolean> {
    await this.refreshDevices();
    if (this.source !== 'camera' || this.devices.length < 2) return false;
    const i = this.devices.findIndex((d) => d.deviceId === this.deviceId);
    const nextDevice = this.devices[(i + 1) % this.devices.length];
    await this.start(nextDevice.deviceId);
    return true;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private waitForFrames(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.video.removeEventListener('loadeddata', done);
        resolve();
      };
      this.video.addEventListener('loadeddata', done);
      setTimeout(done, 4000);
    });
  }
}
