import { describe, expect, it } from 'vitest';
import { FlickDetector, TwistDetector, TwoHandDetector, type TwoHandGesture } from '../src/gestures/detectors';

const H = 1000; // screen height px

describe('FlickDetector', () => {
  it('fires once with the peak velocity after a fast pointing flick', () => {
    const d = new FlickDetector();
    let t = 0;
    const results = [];
    const speeds = [0, 0, 400, 1600, 2400, 900, 200, 0, 0];
    for (const vx of speeds) {
      const r = d.update(t, true, 500, 500, vx, 0, H);
      if (r) results.push(r);
      t += 33;
    }
    expect(results).toHaveLength(1);
    expect(results[0].vx).toBe(2400);
    expect(results[0].speed).toBeCloseTo(2.4);
  });

  it('ignores fast motion when the hand was not pointing', () => {
    const d = new FlickDetector();
    let fired = 0;
    for (let i = 0; i < 10; i++) if (d.update(i * 33, false, 0, 0, 3000, 0, H)) fired++;
    expect(fired).toBe(0);
  });

  it('ignores slow pointing motion', () => {
    const d = new FlickDetector();
    let fired = 0;
    for (let i = 0; i < 20; i++) if (d.update(i * 33, true, 0, 0, 500, 300, H)) fired++;
    expect(fired).toBe(0);
  });
});

describe('TwistDetector', () => {
  const run = (degPerStep: number, fist = true) => {
    const d = new TwistDetector();
    const out = [];
    for (let i = 0; i <= 12; i++) {
      const r = d.update(i * 33, fist, (i * degPerStep * Math.PI) / 180, 400, 400, H);
      if (r) out.push(r);
    }
    return out;
  };

  it('recognizes a counter-clockwise fist twist', () => {
    expect(run(8)).toEqual(['ccw']);
  });

  it('recognizes a clockwise fist twist', () => {
    expect(run(-8)).toEqual(['cw']);
  });

  it('needs a closed fist', () => {
    expect(run(8, false)).toEqual([]);
  });

  it('ignores small wobbles', () => {
    const d = new TwistDetector();
    let fired = 0;
    for (let i = 0; i < 60; i++) {
      if (d.update(i * 33, true, Math.sin(i / 3) * 0.4, 400, 400, H)) fired++;
    }
    expect(fired).toBe(0);
  });
});

describe('TwoHandDetector', () => {
  const play = (frames: { sep: number | null; fists?: boolean }[], dt = 33) => {
    const d = new TwoHandDetector();
    const events: TwoHandGesture[] = [];
    frames.forEach((f, i) => {
      events.push(
        ...d.update({
          t: 1000 + i * dt,
          both: f.sep !== null,
          sep: f.sep ?? Infinity,
          bothFists: !!f.fists && f.sep !== null,
          anyFist: !!f.fists,
        }),
      );
    });
    return events;
  };

  it('detects a clap', () => {
    const frames = [0.4, 0.4, 0.35, 0.25, 0.15, 0.08, 0.08, 0.1].map((sep) => ({ sep }));
    expect(play(frames)).toEqual(['clap']);
  });

  it('detects a clap that ends in a tracking dropout', () => {
    const frames = [0.4, 0.36, 0.3, 0.22, 0.14, null, null].map((sep) => ({ sep }));
    expect(play(frames)).toEqual(['clap']);
  });

  it('does not treat a slow approach as a clap', () => {
    const frames = Array.from({ length: 40 }, (_, i) => ({ sep: 0.4 - i * 0.008 }));
    expect(play(frames)).not.toContain('clap');
  });

  it('detects palms held together then spread apart', () => {
    const frames = [
      ...Array.from({ length: 12 }, () => ({ sep: 0.1 })),
      { sep: 0.18 },
      { sep: 0.26 },
      { sep: 0.36 },
    ];
    expect(play(frames)).toEqual(['palmsApart']);
  });

  it('keeps the together phase through a dropout while palms overlap', () => {
    const frames = [
      { sep: 0.12 },
      { sep: 0.12 },
      ...Array.from({ length: 8 }, () => ({ sep: null })),
      { sep: 0.4 },
    ];
    expect(play(frames)).toEqual(['palmsApart']);
  });

  it('detects two fists pulled apart', () => {
    const frames = [0.14, 0.14, 0.16, 0.22, 0.3, 0.38].map((sep) => ({ sep, fists: true }));
    expect(play(frames)).toEqual(['pullApart']);
  });

  it('ignores fists drifting apart slowly', () => {
    const frames = Array.from({ length: 60 }, (_, i) => ({ sep: 0.14 + i * 0.004, fists: true }));
    expect(play(frames)).toEqual([]);
  });
});
