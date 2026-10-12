import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { Viewport } from '../src/core/viewport';
import { HandSet, anchorOf } from '../src/tracking/handSet';
import { fromCrop, pickRefound, refindRegion } from '../src/tracking/refind';
import type { RawHand, Side } from '../src/tracking/trackedHand';
import { syntheticHand } from './syntheticHand';

const WORLD = syntheticHand();

/** 1280x720 video shown mirrored and cover-fitted into a 1000x800 window. */
function viewport(): Viewport {
  const vp = new Viewport(63);
  vp.setVideo(1280, 720);
  vp.setScreen(1000, 800);
  return vp;
}

/** A detection whose hand sits around screen point (x, y), `scale` times the usual size. */
function det(vp: Viewport, x: number, y: number, side: Side = 'Right', scale = 1): RawHand {
  const image = new Float32Array(63);
  const p = { x: 0, y: 0 };
  for (let i = 0; i < 21; i++) {
    const d = 0.6 + WORLD[i * 3 + 2];
    const sx = x + scale * (WORLD[i * 3] / d) * vp.focalPx;
    const sy = y + scale * (WORLD[i * 3 + 1] / d) * vp.focalPx;
    vp.screenToImage(sx, sy, p);
    image[i * 3] = p.x;
    image[i * 3 + 1] = p.y;
  }
  return { side, score: 0.95, image, world: WORLD };
}

describe('Viewport.screenToImage', () => {
  it('inverts imageToScreen, mirrored or not', () => {
    for (const mirror of [true, false]) {
      const vp = viewport();
      vp.mirror = mirror;
      const s = vp.imageToScreen(0.3, 0.7, { x: 0, y: 0 });
      const back = vp.screenToImage(s.x, s.y, { x: 0, y: 0 });
      expect(back.x).toBeCloseTo(0.3, 6);
      expect(back.y).toBeCloseTo(0.7, 6);
    }
  });
});

describe('refindRegion', () => {
  it('centres a square crop of a few hand lengths on where the hand was', () => {
    const vp = viewport();
    const last = anchorOf(det(vp, 400, 300, 'Right', 0.5), 0, vp);
    const r = refindRegion(last, 33, vp);
    const handPx = last.size / vp.coverScale;
    expect(r.size).toBeCloseTo(Math.max(CONFIG.tracking.refind.minCropPx, CONFIG.tracking.refind.cropHands * handPx), 3);
    const centre = vp.screenToImage(last.x, last.y, { x: 0, y: 0 });
    expect(r.x + r.size / 2).toBeCloseTo(centre.x * 1280, 3);
    expect(r.y + r.size / 2).toBeCloseTo(centre.y * 720, 3);
  });

  it('grows while the hand stays missing, and stays inside the frame', () => {
    const vp = viewport();
    const last = anchorOf(det(vp, 60, 60, 'Right', 0.4), 0, vp);
    const soon = refindRegion(last, 33, vp);
    const later = refindRegion(last, 200, vp);
    expect(later.size).toBeGreaterThan(soon.size);
    for (const r of [soon, later]) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.size).toBeLessThanOrEqual(1280 + 1e-9);
      expect(r.y + r.size).toBeLessThanOrEqual(720 + 1e-9);
    }
  });
});

describe('fromCrop', () => {
  it('maps crop coordinates back to the full frame', () => {
    const r = { x: 200, y: 100, size: 400, frameWidth: 1280, frameHeight: 720 };
    const out = fromCrop([0.5, 0.5, 0.1, 0, 1, 0], r);
    expect(out[0]).toBeCloseTo(400 / 1280, 6);
    expect(out[1]).toBeCloseTo(300 / 720, 6);
    expect(out[2]).toBeCloseTo((0.1 * 400) / 1280, 6);
    expect(out[3]).toBeCloseTo(200 / 1280, 6);
    expect(out[4]).toBeCloseTo(500 / 720, 6);
  });
});

describe('pickRefound', () => {
  const vp = viewport();
  const last = anchorOf(det(vp, 400, 400), 0, vp);

  it('takes the candidate nearest to where the hand was', () => {
    const near = det(vp, 420, 410);
    const pick = pickRefound([det(vp, 560, 400), near], last, [], 33, vp);
    expect(pick).toBe(near);
  });

  it('ignores candidates out of reach', () => {
    expect(pickRefound([det(vp, 900, 400)], last, [], 33, vp)).toBeNull();
  });

  it('ignores the other hand when the full-frame pass already has it', () => {
    const other = det(vp, 470, 400, 'Left');
    expect(pickRefound([det(vp, 470, 402, 'Left')], last, [other], 33, vp)).toBeNull();
  });
});

describe('HandSet.missing', () => {
  it('reports a tracked hand that no detection covers', () => {
    const vp = viewport();
    const hands = new HandSet();
    for (let t = 0; t <= 165; t += 33) hands.ingest([det(vp, 300, 400, 'Left'), det(vp, 700, 400, 'Right')], t, vp);
    // Next frame only the left hand is detected: the right one is missing.
    const lost = hands.missing([det(vp, 305, 400, 'Left')], 198, vp);
    expect(lost.length).toBe(1);
    expect(lost[0].x).toBeGreaterThan(600);
    expect(hands.missing([det(vp, 305, 400, 'Left'), det(vp, 705, 400, 'Right')], 198, vp)).toEqual([]);
  });
});
