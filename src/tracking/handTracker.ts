import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { CONFIG } from '../config';
import { fromCrop, type CropRegion } from './refind';
import type { RawHand, Side } from './trackedHand';

export type Delegate = 'GPU' | 'CPU';

/** Resolves a path relative to the page (works under any deploy base path). */
const local = (path: string): string => new URL(path, document.baseURI).href.replace(/\/$/, '');

/** True if `url` exists and isn't an SPA index.html fallback. */
async function isServed(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

async function fetchWithProgress(url: string, onProgress: (fraction: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} loading ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) onProgress(Math.min(1, received / total));
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  onProgress(1);
  return bytes;
}

/**
 * Thin wrapper around MediaPipe's HandLandmarker running in VIDEO mode. Prefers the wasm runtime
 * and model copied into public/ by `npm run setup-assets`, falling back to the official CDNs.
 */
export class HandTracker {
  delegate: Delegate = 'GPU';
  /** Duration of the last detect() call in ms. */
  lastDetectMs = 0;
  /**
   * MediaPipe's handedness label matches the chirality the hand *appears* to have in the frame.
   * (Verified against the landmarks' 3D chirality on real footage: the palm-normal cross product
   * agreed with the label in 99 of 106 detections.) Raw webcam frames therefore name the user's
   * real hands; only an already-mirrored source needs the labels swapped.
   */
  swapHandedness = false;

  private landmarker: HandLandmarker | null = null;
  /** Single-image detector for zoomed crops around hands the full-frame pass lost. */
  private zoomer: HandLandmarker | null = null;
  private crop: CanvasRenderingContext2D | null = null;
  private lastTimestamp = 0;

  get ready(): boolean {
    return this.landmarker !== null;
  }

  get canRefind(): boolean {
    return this.zoomer !== null && CONFIG.tracking.refind.enabled;
  }

  async init(onStatus: (message: string) => void, only?: Delegate): Promise<void> {
    onStatus('LOCATING TRACKING RUNTIME');
    const localWasm = local(CONFIG.assets.localWasm);
    const wasmBase = (await isServed(`${localWasm}/vision_wasm_internal.js`)) ? localWasm : CONFIG.assets.cdnWasm;
    const fileset = await FilesetResolver.forVisionTasks(wasmBase);

    const localModel = local(CONFIG.assets.localModel);
    const modelUrl = (await isServed(localModel)) ? localModel : CONFIG.assets.cdnModel;
    const model = await fetchWithProgress(modelUrl, (f) =>
      onStatus(`LOADING HAND MODEL ${Math.round(f * 100)}%`),
    );

    onStatus('COMPILING NEURAL NET');
    const delegates: Delegate[] = only ? [only] : ['GPU', 'CPU'];
    for (const delegate of delegates) {
      try {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: model, delegate },
          runningMode: 'VIDEO',
          numHands: CONFIG.tracking.numHands,
          minHandDetectionConfidence: CONFIG.tracking.minHandDetectionConfidence,
          minHandPresenceConfidence: CONFIG.tracking.minHandPresenceConfidence,
          minTrackingConfidence: CONFIG.tracking.minTrackingConfidence,
        });
        this.delegate = delegate;
        break;
      } catch (err) {
        if (delegate === delegates[delegates.length - 1]) throw err;
        console.warn('[tracker] GPU delegate unavailable, falling back to CPU', err);
      }
    }
    try {
      this.zoomer = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: model, delegate: this.delegate },
        runningMode: 'IMAGE',
        numHands: 2,
        minHandDetectionConfidence: CONFIG.tracking.refind.minDetectionConfidence,
        minHandPresenceConfidence: CONFIG.tracking.minHandPresenceConfidence,
      });
    } catch (err) {
      // Tracking still works; distant hands are just lost sooner.
      console.warn('[tracker] zoomed re-finding unavailable', err);
    }
    onStatus('TRACKING ONLINE');
  }

  detect(video: HTMLVideoElement, nowMs: number): RawHand[] {
    if (!this.landmarker) return [];
    let ts = Math.round(nowMs);
    if (ts <= this.lastTimestamp) ts = this.lastTimestamp + 1;
    this.lastTimestamp = ts;
    const t0 = performance.now();
    const result = this.landmarker.detectForVideo(video, ts);
    this.lastDetectMs = performance.now() - t0;
    return this.parse(result);
  }

  /**
   * Runs the single-image detector on each crop of the current frame and returns the hands found
   * in each, in full-frame image coordinates. Time spent is added to lastDetectMs.
   */
  refind(video: HTMLVideoElement, regions: CropRegion[]): RawHand[][] {
    const zoomer = this.zoomer;
    if (!zoomer) return regions.map(() => []);
    const px = CONFIG.tracking.refind.canvasPx;
    if (!this.crop) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = px;
      this.crop = canvas.getContext('2d');
      if (!this.crop) return regions.map(() => []);
    }
    const ctx = this.crop;
    const t0 = performance.now();
    const found = regions.map((r) => {
      ctx.drawImage(video, r.x, r.y, r.size, r.size, 0, 0, px, px);
      return this.parse(zoomer.detect(ctx.canvas)).map((hand) => ({ ...hand, image: fromCrop(hand.image, r) }));
    });
    this.lastDetectMs += performance.now() - t0;
    return found;
  }

  private parse(result: HandLandmarkerResult): RawHand[] {
    const hands: RawHand[] = [];
    const count = Math.min(result.landmarks.length, result.worldLandmarks.length);
    for (let i = 0; i < count; i++) {
      const category = result.handedness[i]?.[0];
      let side: Side = category?.categoryName === 'Left' ? 'Left' : 'Right';
      if (this.swapHandedness) side = side === 'Left' ? 'Right' : 'Left';
      const image = new Float32Array(63);
      const world = new Float32Array(63);
      result.landmarks[i].forEach((p, j) => {
        image[j * 3] = p.x;
        image[j * 3 + 1] = p.y;
        image[j * 3 + 2] = p.z;
      });
      result.worldLandmarks[i].forEach((p, j) => {
        world[j * 3] = p.x;
        world[j * 3 + 1] = p.y;
        world[j * 3 + 2] = p.z;
      });
      hands.push({ side, score: category?.score ?? 0, image, world });
    }
    return hands;
  }

  close(): void {
    this.landmarker?.close();
    this.zoomer?.close();
    this.landmarker = null;
    this.zoomer = null;
  }
}
