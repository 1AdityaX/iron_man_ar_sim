import { describe, expect, it } from 'vitest';
import {
  estimateDepth,
  fingerCurls,
  gripStrength,
  handTiltDeg,
  knuckleAngle,
  pinchRatio,
} from '../src/tracking/handFeatures';
import { FIST, POINT, straightIndexTip, syntheticHand } from './syntheticHand';

describe('fingerCurls', () => {
  it('reads an open hand as straight', () => {
    const curls = fingerCurls(syntheticHand());
    for (const c of curls.slice(1)) expect(c).toBeLessThan(0.1);
    expect(gripStrength(curls)).toBeLessThan(0.1);
  });

  it('reads a fist as fully curled', () => {
    const curls = fingerCurls(syntheticHand({ curl: FIST }));
    for (const c of curls.slice(1)) expect(c).toBeGreaterThan(0.9);
    expect(gripStrength(curls)).toBeGreaterThan(0.9);
  });

  it('separates the index finger when pointing', () => {
    const curls = fingerCurls(syntheticHand({ curl: POINT }));
    expect(curls[1]).toBeLessThan(0.15);
    expect(Math.min(curls[2], curls[3], curls[4])).toBeGreaterThan(0.9);
  });

  it('is monotonic in bend angle', () => {
    let last = -1;
    for (const a of [0, 20, 40, 60, 80]) {
      const curl = fingerCurls(syntheticHand({ curl: [[0, 0, 0], [a, a, a / 2], [0, 0, 0], [0, 0, 0], [0, 0, 0]] }))[1];
      expect(curl).toBeGreaterThanOrEqual(last);
      last = curl;
    }
  });
});

describe('pinchRatio', () => {
  it('is large for an open hand and small when thumb meets index', () => {
    expect(pinchRatio(syntheticHand())).toBeGreaterThan(0.5);
    const [x, y, z] = straightIndexTip();
    const pinched = syntheticHand({ thumbTip: [x - 0.008, y - 0.006, z] });
    expect(pinchRatio(pinched)).toBeLessThan(0.15);
  });
});

describe('estimateDepth', () => {
  it('recovers the distance of a projected hand', () => {
    const world = syntheticHand();
    const focal = 900;
    for (const depth of [0.4, 0.75, 1.3]) {
      const screen = new Float32Array(42);
      for (let i = 0; i < 21; i++) {
        const d = depth + world[i * 3 + 2];
        screen[i * 2] = 640 + (world[i * 3] / d) * focal;
        screen[i * 2 + 1] = 360 + (world[i * 3 + 1] / d) * focal;
      }
      expect(estimateDepth(world, screen, focal)).toBeCloseTo(depth, 1);
    }
  });

  it('returns NaN for a degenerate projection', () => {
    expect(estimateDepth(syntheticHand(), new Float32Array(42), 900)).toBeNaN();
  });
});

describe('screen-space angles', () => {
  const screenOf = (rotDeg: number) => {
    const world = syntheticHand();
    const r = (rotDeg * Math.PI) / 180;
    const s = new Float32Array(42);
    for (let i = 0; i < 21; i++) {
      // Screen y points down, so flip world y; then rotate counter-clockwise on screen.
      const x = world[i * 3] * 1000;
      const y = -world[i * 3 + 1] * 1000;
      s[i * 2] = x * Math.cos(r) + y * Math.sin(r);
      s[i * 2 + 1] = -x * Math.sin(r) + y * Math.cos(r);
    }
    return s;
  };

  it('reports an upright hand as zero tilt', () => {
    expect(Math.abs(handTiltDeg(screenOf(0)))).toBeLessThan(15);
  });

  it('knuckle angle increases when the hand turns counter-clockwise on screen', () => {
    const a0 = knuckleAngle(screenOf(0));
    const a1 = knuckleAngle(screenOf(30));
    expect(a1 - a0).toBeCloseTo((30 * Math.PI) / 180, 2);
  });
});
