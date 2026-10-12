import { CONFIG } from '../config';
import { clamp } from '../core/math';
import type { Viewport } from '../core/viewport';
import { anchorOf, type Anchor } from './handSet';
import type { RawHand } from './trackedHand';

/** A square crop of the video frame, in video pixels. */
export interface CropRegion {
  x: number;
  y: number;
  size: number;
  frameWidth: number;
  frameHeight: number;
}

/**
 * Where to look for a hand the full-frame pass lost: a square around where it was last seen,
 * a few hand lengths wide and growing with each frame it stays missing.
 */
export function refindRegion(last: Anchor, tMs: number, vp: Viewport): CropRegion {
  const R = CONFIG.tracking.refind;
  const centre = vp.screenToImage(last.x, last.y, { x: 0, y: 0 });
  const handPx = last.size / vp.coverScale;
  const missed = Math.max(0, (tMs - last.t) / CONFIG.tracking.nominalFrameMs - 1);
  const W = vp.videoWidth;
  const H = vp.videoHeight;
  const size = Math.min(W, H, Math.max(R.minCropPx, R.cropHands * handPx * (1 + R.growPerFrame * missed)));
  return {
    x: clamp(centre.x * W - size / 2, 0, W - size),
    y: clamp(centre.y * H - size / 2, 0, H - size),
    size,
    frameWidth: W,
    frameHeight: H,
  };
}

/** Maps landmarks normalized to a crop back to normalized full-frame image coordinates. */
export function fromCrop(image: ArrayLike<number>, r: CropRegion): Float32Array {
  const out = new Float32Array(image.length);
  for (let i = 0; i < image.length; i += 3) {
    out[i] = (r.x + image[i] * r.size) / r.frameWidth;
    out[i + 1] = (r.y + image[i + 1] * r.size) / r.frameHeight;
    // MediaPipe scales z like x.
    out[i + 2] = (image[i + 2] * r.size) / r.frameWidth;
  }
  return out;
}

/**
 * Of the hands found in a lost hand's crop, the one that is that hand: the nearest to where it
 * was, within reach, and not a hand the full-frame pass already found (a crop around one hand
 * often contains the other).
 */
export function pickRefound(candidates: RawHand[], last: Anchor, found: RawHand[], tMs: number, vp: Viewport): RawHand | null {
  const R = CONFIG.tracking.refind;
  const missed = Math.max(0, (tMs - last.t) / CONFIG.tracking.nominalFrameMs - 1);
  const known = found.map((raw) => anchorOf(raw, tMs, vp));
  let best: RawHand | null = null;
  let bestDist = Infinity;
  for (const raw of candidates) {
    const a = anchorOf(raw, tMs, vp);
    const size = Math.max(a.size, last.size, 1);
    const dist = Math.hypot(a.x - last.x, a.y - last.y) / size;
    if (dist > R.reach * (1 + 0.15 * missed) || dist >= bestDist) continue;
    if (known.some((k) => Math.hypot(a.x - k.x, a.y - k.y) < R.duplicateDist * Math.max(size, k.size))) continue;
    best = raw;
    bestDist = dist;
  }
  return best;
}
