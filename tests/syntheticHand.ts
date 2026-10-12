/**
 * Builds plausible MediaPipe-style world landmarks (metres, hand-centred) for tests.
 * The hand lies in the XY plane with fingers pointing +Y; curling bends fingers toward -Z.
 */
export interface HandPose {
  /** Per-finger bend angles in degrees for [mcp, pip, dip] (thumb uses [mcp, ip] + ignored). */
  curl?: [number, number, number][];
  /** Override thumb tip position (e.g. to pinch). */
  thumbTip?: [number, number, number];
  /** Place the thumb tip this far (metres) from the index tip, as in a pinch. */
  thumbToIndex?: number;
}

const BASES: [number, number][] = [
  [0.024, 0.08], // index
  [0.004, 0.086], // middle
  [-0.015, 0.082], // ring
  [-0.032, 0.072], // pinky
];
const LENGTHS: [number, number, number][] = [
  [0.04, 0.024, 0.02],
  [0.044, 0.027, 0.021],
  [0.041, 0.026, 0.02],
  [0.032, 0.02, 0.018],
];

export function syntheticHand(pose: HandPose = {}): Float32Array {
  const out = new Float32Array(63);
  const set = (i: number, x: number, y: number, z: number) => {
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  };
  set(0, 0, 0, 0);
  // Thumb: a straight chain angled outward.
  const thumb: [number, number, number][] = [
    [0.022, 0.022, 0],
    [0.042, 0.04, 0],
    [0.058, 0.056, 0],
    [0.07, 0.07, 0],
  ];
  thumb.forEach((p, k) => set(1 + k, p[0], p[1], p[2]));

  for (let f = 0; f < 4; f++) {
    const [bx, by] = BASES[f];
    const len = Math.hypot(bx, by);
    // Finger direction follows the metacarpal (wrist -> knuckle) direction.
    const dx = bx / len;
    const dy = by / len;
    const bends = pose.curl?.[f + 1] ?? [0, 0, 0];
    let x = bx;
    let y = by;
    let z = 0;
    const mcp = 5 + f * 4;
    set(mcp, x, y, z);
    let angle = 0;
    for (let s = 0; s < 3; s++) {
      angle += (bends[s] * Math.PI) / 180;
      const l = LENGTHS[f][s];
      // Rotate the finger direction about the in-plane axis perpendicular to it, bending toward -Z.
      x += dx * Math.cos(angle) * l;
      y += dy * Math.cos(angle) * l;
      z += -Math.sin(angle) * l;
      set(mcp + 1 + s, x, y, z);
    }
  }
  if (pose.thumbTip) set(4, ...pose.thumbTip);
  if (pose.thumbToIndex !== undefined) set(4, out[24] + pose.thumbToIndex, out[25], out[26]);
  // Re-centre on the approximate geometric centre like MediaPipe world landmarks.
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < 21; i++) {
    cx += out[i * 3] / 21;
    cy += out[i * 3 + 1] / 21;
    cz += out[i * 3 + 2] / 21;
  }
  for (let i = 0; i < 21; i++) {
    out[i * 3] -= cx;
    out[i * 3 + 1] -= cy;
    out[i * 3 + 2] -= cz;
  }
  return out;
}

export const FIST: [number, number, number][] = [
  [30, 30, 0],
  [80, 100, 60],
  [85, 100, 60],
  [85, 100, 60],
  [85, 95, 55],
];

export const POINT: [number, number, number][] = [
  [30, 30, 0],
  [0, 5, 0],
  [85, 100, 60],
  [85, 100, 60],
  [85, 95, 55],
];

/** Index tip position of a straight hand, before re-centring (for building pinches). */
export function straightIndexTip(): [number, number, number] {
  const [bx, by] = BASES[0];
  const len = Math.hypot(bx, by);
  const total = LENGTHS[0][0] + LENGTHS[0][1] + LENGTHS[0][2];
  return [bx + (bx / len) * total, by + (by / len) * total, 0];
}
