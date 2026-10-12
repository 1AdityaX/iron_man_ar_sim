import { describe, expect, it } from 'vitest';
import { wrapAngle } from '../src/core/math';
import { OneEuroFilter, OneEuroPoints } from '../src/core/oneEuro';
import { Viewport } from '../src/core/viewport';

describe('OneEuroFilter', () => {
  it('smooths jitter on a still signal', () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 0, dCutoff: 1 });
    let maxDev = 0;
    for (let i = 0; i < 120; i++) {
      const noisy = 5 + (i % 2 ? 0.1 : -0.1);
      const y = f.filter(noisy, i / 60);
      if (i > 30) maxDev = Math.max(maxDev, Math.abs(y - 5));
    }
    expect(maxDev).toBeLessThan(0.05);
  });

  it('tracks fast motion with little lag when beta is high', () => {
    const slow = new OneEuroFilter({ minCutoff: 1, beta: 0, dCutoff: 1 });
    const fast = new OneEuroFilter({ minCutoff: 1, beta: 5, dCutoff: 1 });
    let ys = 0;
    let yf = 0;
    for (let i = 0; i < 30; i++) {
      ys = slow.filter(i * 0.1, i / 60);
      yf = fast.filter(i * 0.1, i / 60);
    }
    const target = 29 * 0.1;
    expect(target - yf).toBeLessThan(target - ys);
  });

  it('point filter matches the scalar filter for 1D data', () => {
    const params = { minCutoff: 1.5, beta: 2, dCutoff: 1 };
    const scalar = new OneEuroFilter(params);
    const points = new OneEuroPoints(1, 1, params);
    for (let i = 0; i < 50; i++) {
      const v = Math.sin(i / 5);
      expect(points.filter([v], i / 30)[0]).toBeCloseTo(scalar.filter(v, i / 30), 5);
    }
  });
});

describe('Viewport', () => {
  const vp = new Viewport(60);
  vp.setVideo(1280, 720);
  vp.setScreen(1000, 1000);

  it('cover-fits the video', () => {
    // Square screen, 16:9 video: height fills, width is cropped.
    expect(vp.displayHeight).toBeCloseTo(1000);
    expect(vp.displayWidth).toBeCloseTo(1777.78, 1);
    expect(vp.offsetX).toBeCloseTo(-388.89, 1);
  });

  it('mirrors image coordinates', () => {
    const p = { x: 0, y: 0 };
    vp.mirror = true;
    vp.imageToScreen(0.25, 0.5, p);
    const mirrored = p.x;
    vp.mirror = false;
    vp.imageToScreen(0.25, 0.5, p);
    expect(mirrored + p.x).toBeCloseTo(1000); // symmetric about the screen centre
    vp.mirror = true;
  });

  it('round-trips screen -> world -> screen', () => {
    const w = { x: 0, y: 0, z: 0 };
    const s = { x: 0, y: 0 };
    vp.screenToWorld(123, 456, 0.8, w);
    const depth = vp.worldToScreen(w, s);
    expect(depth).toBeCloseTo(0.8);
    expect(s.x).toBeCloseTo(123);
    expect(s.y).toBeCloseTo(456);
  });

  it('matches the camera fov to the visible region', () => {
    // Height spans the full video, so vertical fov equals the video's vertical fov.
    const videoVFov = (2 * Math.atan(Math.tan((60 * Math.PI) / 360) * (720 / 1280)) * 180) / Math.PI;
    expect(vp.vFovDeg).toBeCloseTo(videoVFov, 3);
  });
});

describe('wrapAngle', () => {
  it('wraps into (-pi, pi]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI);
    expect(wrapAngle(0.25)).toBeCloseTo(0.25);
  });
});
