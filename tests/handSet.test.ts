import { describe, expect, it } from 'vitest';
import { Viewport } from '../src/core/viewport';
import { HandSet } from '../src/tracking/handSet';
import type { RawHand, Side } from '../src/tracking/trackedHand';
import { syntheticHand } from './syntheticHand';

const WORLD = syntheticHand();

function viewport(mirror: boolean): Viewport {
  const vp = new Viewport(63);
  vp.setVideo(1280, 720);
  vp.setScreen(1280, 720);
  vp.mirror = mirror;
  return vp;
}

/** A detection whose hand sits around screen point (x, y), labelled as the tracker would. */
function det(vp: Viewport, x: number, y: number, side: Side, score = 0.95): RawHand {
  const image = new Float32Array(63);
  const depth = 0.6;
  for (let i = 0; i < 21; i++) {
    const d = depth + WORLD[i * 3 + 2];
    const sx = x + (WORLD[i * 3] / d) * vp.focalPx;
    const sy = y + (WORLD[i * 3 + 1] / d) * vp.focalPx;
    image[i * 3] = vp.mirror ? 1 - sx / 1280 : sx / 1280;
    image[i * 3 + 1] = sy / 720;
  }
  return { side, score, image, world: WORLD };
}

/** Feeds frames 33 ms apart; returns the time of the last one. */
function run(hands: HandSet, vp: Viewport, frames: RawHand[][], t0 = 0): number {
  let t = t0;
  for (const raws of frames) {
    hands.ingest(raws, t, vp);
    t += 33;
  }
  return t - 33;
}

const repeat = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));

describe('HandSet', () => {
  it('keeps a tracked hand when its left/right label flips for a frame', () => {
    const vp = viewport(true);
    const hands = new HandSet();
    const t = run(hands, vp, [...repeat(10, () => [det(vp, 300, 400, 'Left')]), [det(vp, 300, 400, 'Right')]]);
    expect(hands.left.isFresh(t)).toBe(true);
    expect(hands.right.present).toBe(false);
  });

  it('does not swap two tracked hands when both labels flip', () => {
    const vp = viewport(true);
    const hands = new HandSet();
    const both = (l: Side, r: Side) => [det(vp, 300, 400, l), det(vp, 900, 400, r)];
    const t = run(hands, vp, [...repeat(10, () => both('Left', 'Right')), both('Right', 'Left'), both('Right', 'Left')]);
    expect(hands.left.isFresh(t) && hands.right.isFresh(t)).toBe(true);
    expect(hands.left.palmScreen.x).toBeLessThan(640);
    expect(hands.right.palmScreen.x).toBeGreaterThan(640);
  });

  it('follows a fast hand across frames even with a flipped label', () => {
    const vp = viewport(true);
    const hands = new HandSet();
    // ~100 px per frame is about two thirds of the hand's size at this distance.
    const frames = repeat(12, (i) => [det(vp, 200 + i * 100, 400, i === 8 ? 'Right' : 'Left')]);
    const t = run(hands, vp, frames);
    expect(hands.left.isFresh(t)).toBe(true);
    expect(hands.right.present).toBe(false);
  });

  it('gives a second hand appearing elsewhere its labelled side', () => {
    const vp = viewport(true);
    const hands = new HandSet();
    const t = run(hands, vp, [
      ...repeat(10, () => [det(vp, 300, 400, 'Left')]),
      [det(vp, 300, 400, 'Left'), det(vp, 950, 380, 'Right')],
    ]);
    expect(hands.right.isFresh(t)).toBe(true);
    expect(hands.right.palmScreen.x).toBeGreaterThan(640);
    expect(hands.left.palmScreen.x).toBeLessThan(640);
  });

  it('splits two new hands with the same label by screen position, mirror-aware', () => {
    for (const mirror of [true, false]) {
      const vp = viewport(mirror);
      const hands = new HandSet();
      run(hands, vp, [[det(vp, 300, 400, 'Right'), det(vp, 900, 400, 'Right')]]);
      const leftOnLeft = hands.left.palmScreen.x < hands.right.palmScreen.x;
      expect(leftOnLeft).toBe(mirror);
    }
  });

  it('hands a hand over to the side its labels keep naming', () => {
    const vp = viewport(true);
    const hands = new HandSet();
    // Picked up under an unsure "Left" label, then confidently called "Right" from then on.
    let t = run(hands, vp, [[det(vp, 300, 400, 'Left', 0.55)], ...repeat(2, () => [det(vp, 300, 400, 'Right')])]);
    expect(hands.left.isFresh(t)).toBe(true);
    t = run(hands, vp, repeat(8, () => [det(vp, 300, 400, 'Right')]), t + 33);
    expect(hands.right.isFresh(t)).toBe(true);
    expect(hands.left.present).toBe(false);
  });

  it('keeps both hands, unswapped, when they meet in a clap', () => {
    const vp = viewport(true);
    const hands = new HandSet();
    // The hands close in until their palms nearly overlap; one frame's labels come out swapped.
    const frames = repeat(12, (i) => {
      const gap = Math.max(15, 300 - i * 40);
      const flip = i === 9;
      return [det(vp, 640 - gap, 400, flip ? 'Right' : 'Left'), det(vp, 640 + gap, 400, flip ? 'Left' : 'Right')];
    });
    const t = run(hands, vp, frames);
    expect(hands.left.isFresh(t) && hands.right.isFresh(t)).toBe(true);
    expect(hands.left.palmScreen.x).toBeLessThan(hands.right.palmScreen.x);
  });
});
