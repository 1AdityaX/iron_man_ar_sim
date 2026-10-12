import { describe, expect, it } from 'vitest';
import { Viewport } from '../src/core/viewport';
import { TrackedHand, type RawHand } from '../src/tracking/trackedHand';
import { FIST, POINT, syntheticHand } from './syntheticHand';

const vp = new Viewport(63);
vp.setVideo(1280, 720);
vp.setScreen(1280, 720);

/** Projects synthetic world landmarks into normalized image coordinates at `depth`. */
function raw(world: Float32Array, depth = 0.6): RawHand {
  const image = new Float32Array(63);
  const f = vp.focalPx;
  for (let i = 0; i < 21; i++) {
    const d = depth + world[i * 3 + 2];
    image[i * 3] = (640 + (world[i * 3] / d) * f) / 1280;
    image[i * 3 + 1] = (360 + (world[i * 3 + 1] / d) * f) / 720;
  }
  return { side: 'Right', score: 1, image, world };
}

function settle(world: Float32Array, depth = 0.6): TrackedHand {
  const hand = new TrackedHand('Right');
  for (let t = 0; t <= 400; t += 33) hand.update(raw(world, depth), t, vp);
  return hand;
}

describe('TrackedHand states', () => {
  it('open hand', () => {
    const h = settle(syntheticHand());
    expect([h.pinching.value, h.fist.value, h.pointing.value, h.open.value]).toEqual([false, false, false, true]);
  });

  it('fist', () => {
    const h = settle(syntheticHand({ curl: FIST }));
    expect(h.fist.value).toBe(true);
    expect(h.pinching.value).toBe(false);
  });

  it('fist with the thumb resting on the curled index is still a fist', () => {
    const h = settle(syntheticHand({ curl: FIST, thumbToIndex: 0.006 }));
    expect(h.pinchRatio).toBeLessThan(0.3);
    expect(h.fist.value).toBe(true);
    expect(h.pinching.value).toBe(false);
  });

  it('pinch with the other fingers curled is a pinch, not a fist', () => {
    const curl: [number, number, number][] = [[0, 0, 0], [25, 35, 15], ...FIST.slice(2)];
    const h = settle(syntheticHand({ curl, thumbToIndex: 0.008 }));
    expect(h.pinching.value).toBe(true);
    expect(h.fist.value).toBe(false);
  });

  it('pointing', () => {
    const h = settle(syntheticHand({ curl: POINT }));
    expect(h.pointing.value).toBe(true);
    expect(h.fist.value).toBe(false);
  });

  it('estimates depth and reconstructs the hand in camera space', () => {
    const h = settle(syntheticHand(), 0.8);
    expect(h.depth).toBeCloseTo(0.8, 1);
    expect(h.palm.z).toBeLessThan(-0.6);
    // Palm length in reconstructed camera space matches the world model (~9 cm).
    expect(h.points[0].distanceTo(h.points[9])).toBeCloseTo(h.palmLengthM, 2);
  });
});
