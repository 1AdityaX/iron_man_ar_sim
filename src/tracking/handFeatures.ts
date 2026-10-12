import { clamp, clamp01 } from '../core/math';
import { FINGERS, LM, PALM_POINTS } from './landmarks';

/**
 * Pure feature extraction on flat landmark arrays. World arrays hold 21 xyz triplets in metres
 * (MediaPipe world landmarks: camera-aligned, origin at the hand centre). Screen arrays hold
 * 21 xy pairs in pixels.
 */
type Arr = ArrayLike<number>;

/** Summed joint bend (radians) of a straight finger and of a fully curled one. */
export const CURL_STRAIGHT = 0.5;
export const CURL_FULL = 3.4;
const THUMB_STRAIGHT = 0.3;
const THUMB_FULL = 1.7;

export function distance3(p: Arr, a: number, b: number): number {
  return Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
}

/** Angle in radians between the bone a->b and the bone b->c (0 = collinear). */
export function jointAngle(p: Arr, a: number, b: number, c: number): number {
  const ux = p[b * 3] - p[a * 3];
  const uy = p[b * 3 + 1] - p[a * 3 + 1];
  const uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[b * 3];
  const vy = p[c * 3 + 1] - p[b * 3 + 1];
  const vz = p[c * 3 + 2] - p[b * 3 + 2];
  const lu = Math.hypot(ux, uy, uz);
  const lv = Math.hypot(vx, vy, vz);
  if (lu < 1e-6 || lv < 1e-6) return 0;
  return Math.acos(clamp((ux * vx + uy * vy + uz * vz) / (lu * lv), -1, 1));
}

/** Curl per finger (thumb, index, middle, ring, pinky): 0 = straight, 1 = fully curled. */
export function fingerCurls(world: Arr, out: number[] = [0, 0, 0, 0, 0]): number[] {
  const [t1, t2, t3, t4] = FINGERS[0];
  const thumbBend = jointAngle(world, t1, t2, t3) + jointAngle(world, t2, t3, t4);
  out[0] = clamp01((thumbBend - THUMB_STRAIGHT) / (THUMB_FULL - THUMB_STRAIGHT));
  for (let f = 1; f < 5; f++) {
    const [m, p, d, t] = FINGERS[f];
    const bend =
      jointAngle(world, LM.WRIST, m, p) + jointAngle(world, m, p, d) + jointAngle(world, p, d, t);
    out[f] = clamp01((bend - CURL_STRAIGHT) / (CURL_FULL - CURL_STRAIGHT));
  }
  return out;
}

/** Wrist to middle-finger knuckle: a stable, pose-independent hand size (~9-10 cm). */
export function palmLength(world: Arr): number {
  return distance3(world, LM.WRIST, LM.MIDDLE_MCP);
}

/** Thumb-tip to index-tip distance, normalized by palm length. */
export function pinchRatio(world: Arr): number {
  const len = palmLength(world);
  return len > 1e-5 ? distance3(world, LM.THUMB_TIP, LM.INDEX_TIP) / len : 1;
}

/**
 * Fingertip distance from the wrist divided by palm length, per finger (thumb..pinky).
 * Open fingers read ~1.7-2.0; an index tucked into a fist reads below ~1.05, while an index
 * reaching for the thumb in a pinch stays above ~1.1 even when the other fingers curl.
 */
export function tipExtensions(world: Arr, out: number[] = [0, 0, 0, 0, 0]): number[] {
  const len = palmLength(world);
  for (let f = 0; f < 5; f++) out[f] = len > 1e-5 ? distance3(world, FINGERS[f][3], LM.WRIST) / len : 0;
  return out;
}

/** Mean curl of the four fingers (thumb excluded). */
export function gripStrength(curls: readonly number[]): number {
  return (curls[1] + curls[2] + curls[3] + curls[4]) / 4;
}

/**
 * Hand distance from the camera via weak perspective: the spread of the rigid palm points in
 * metres (world landmarks, camera-aligned) over their spread in screen pixels, times the focal
 * length. Orientation cancels out because both spreads are projections onto the image plane.
 */
export function estimateDepth(world: Arr, screen: Arr, focalPx: number): number {
  let wx = 0;
  let wy = 0;
  let sx = 0;
  let sy = 0;
  for (const i of PALM_POINTS) {
    wx += world[i * 3];
    wy += world[i * 3 + 1];
    sx += screen[i * 2];
    sy += screen[i * 2 + 1];
  }
  const n = PALM_POINTS.length;
  wx /= n;
  wy /= n;
  sx /= n;
  sy /= n;
  let spreadWorld = 0;
  let spreadScreen = 0;
  for (const i of PALM_POINTS) {
    spreadWorld += Math.hypot(world[i * 3] - wx, world[i * 3 + 1] - wy);
    spreadScreen += Math.hypot(screen[i * 2] - sx, screen[i * 2 + 1] - sy);
  }
  if (spreadScreen < 1e-3 || spreadWorld < 1e-6) return NaN;
  return (focalPx * spreadWorld) / spreadScreen;
}

/**
 * Screen-space angle (radians, counter-clockwise positive as seen on screen) of the knuckle line
 * from the index knuckle to the pinky knuckle. Rotating a fist rotates this line.
 */
export function knuckleAngle(screen: Arr): number {
  const dx = screen[LM.PINKY_MCP * 2] - screen[LM.INDEX_MCP * 2];
  const dy = screen[LM.PINKY_MCP * 2 + 1] - screen[LM.INDEX_MCP * 2 + 1];
  return Math.atan2(-dy, dx);
}

/** In-plane tilt of the hand (degrees) relative to screen-up; 0 = fingers pointing up. */
export function handTiltDeg(screen: Arr): number {
  const dx = screen[LM.MIDDLE_MCP * 2] - screen[LM.WRIST * 2];
  const dy = screen[LM.MIDDLE_MCP * 2 + 1] - screen[LM.WRIST * 2 + 1];
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}
