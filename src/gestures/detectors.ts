import { CONFIG } from '../config';
import { DEG } from '../core/math';

/**
 * Motion-gesture recognizers. They are deliberately free of DOM/three.js dependencies and are
 * fed plain numbers, which keeps them deterministic and unit-testable.
 */

export interface FlickResult {
  /** Peak velocity, px/s. */
  vx: number;
  vy: number;
  /** Peak speed in screen heights per second. */
  speed: number;
  /** Where the flick started (px). */
  x: number;
  y: number;
}

/** A quick fingertip flick performed while pointing. */
export class FlickDetector {
  private active = false;
  private startT = 0;
  private peak: FlickResult = { vx: 0, vy: 0, speed: 0, x: 0, y: 0 };
  private cooldownUntil = 0;
  private lastPointT = -Infinity;

  /**
   * @param vx,vy fingertip velocity in px/s
   * @param screenH screen height in px (speeds are normalized by it)
   */
  update(t: number, pointing: boolean, x: number, y: number, vx: number, vy: number, screenH: number): FlickResult | null {
    const G = CONFIG.gestures;
    if (pointing) this.lastPointT = t;
    const speed = Math.hypot(vx, vy) / screenH;
    if (!this.active) {
      if (t >= this.cooldownUntil && speed >= G.flickMinSpeed && t - this.lastPointT < 220) {
        this.active = true;
        this.startT = t;
        this.peak = { vx, vy, speed, x, y };
      }
      return null;
    }
    if (speed > this.peak.speed) {
      this.peak.vx = vx;
      this.peak.vy = vy;
      this.peak.speed = speed;
    }
    if (speed < G.flickEndSpeed || t - this.startT > G.flickMaxMs) return this.finish(t);
    return null;
  }

  /** Ends an in-progress flick (e.g. tracking lost mid-flick). */
  flush(t: number): FlickResult | null {
    return this.active ? this.finish(t) : null;
  }

  private finish(t: number): FlickResult {
    this.active = false;
    this.cooldownUntil = t + CONFIG.gestures.flickCooldownMs;
    return { ...this.peak };
  }
}

export type TwistDirection = 'ccw' | 'cw';

/** Rotating a closed fist in the screen plane (like turning a dial). */
export class TwistDetector {
  private samples: { t: number; a: number; x: number; y: number }[] = [];
  private cooldownUntil = 0;

  /**
   * @param angle unwrapped knuckle-line angle in radians (counter-clockwise positive on screen)
   */
  update(t: number, isFist: boolean, angle: number, x: number, y: number, screenH: number): TwistDirection | null {
    const G = CONFIG.gestures;
    if (!isFist) {
      this.samples.length = 0;
      return null;
    }
    this.samples.push({ t, a: angle, x, y });
    while (this.samples.length > 1 && t - this.samples[0].t > G.twistWindowMs) this.samples.shift();
    if (t < this.cooldownUntil || this.samples.length < 3) return null;

    let minA = Infinity;
    let maxA = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of this.samples) {
      minA = Math.min(minA, s.a);
      maxA = Math.max(maxA, s.a);
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y);
      maxY = Math.max(maxY, s.y);
    }
    if (Math.hypot(maxX - minX, maxY - minY) / screenH > G.twistMaxTravel) return null;

    const threshold = G.twistDeg * DEG;
    let dir: TwistDirection | null = null;
    if (angle - minA >= threshold) dir = 'ccw';
    else if (maxA - angle >= threshold) dir = 'cw';
    if (dir) {
      this.samples.length = 0;
      this.cooldownUntil = t + G.twistCooldownMs;
    }
    return dir;
  }
}

export type TwoHandGesture = 'clap' | 'palmsApart' | 'pullApart';

export interface TwoHandFrame {
  t: number;
  /** Both hands tracked this frame. */
  both: boolean;
  /** Distance between palm centres in metres (only meaningful when `both`). */
  sep: number;
  bothFists: boolean;
  anyFist: boolean;
}

/**
 * Gestures that need both hands: a fast clap, palms pressed together then spread apart, and two
 * fists pulled apart. Hands that overlap often drop out of tracking, so the "together" phase is
 * allowed to persist through short dropouts.
 */
export class TwoHandDetector {
  private samples: { t: number; sep: number; fists: boolean }[] = [];
  private lastBothT = -Infinity;
  private lastSep = Infinity;
  private approachSpeed = 0;
  private dropoutHandled = true;
  private togetherSince = -1;
  private togetherLastT = -Infinity;
  private armed = false;
  private clapCooldownUntil = 0;
  private cooldownUntil = 0;

  update(f: TwoHandFrame): TwoHandGesture[] {
    const G = CONFIG.gestures;
    const events: TwoHandGesture[] = [];
    const t = f.t;

    if (!f.both) {
      // A clap often merges both hands into one blob that the tracker drops.
      if (!this.dropoutHandled && t - this.lastBothT < 200) {
        this.dropoutHandled = true;
        if (this.lastSep <= G.clapToDist + 0.05 && this.approachSpeed > 0.8 && t >= this.clapCooldownUntil) {
          events.push('clap');
          this.clapCooldownUntil = t + G.clapCooldownMs;
        }
      }
      // Palms pressed together hide each other; keep the "together" phase alive meanwhile.
      if (this.togetherSince >= 0 && this.lastSep <= G.palmsTogetherDist) {
        if (t - this.lastBothT < 1500) {
          this.togetherLastT = t;
          if (t - this.togetherSince >= G.palmsTogetherMinMs) this.armed = true;
        } else {
          this.togetherSince = -1;
          this.armed = false;
        }
      }
      this.samples.length = 0;
      return events;
    }

    this.samples.push({ t, sep: f.sep, fists: f.bothFists });
    while (this.samples.length > 1 && t - this.samples[0].t > 1200) this.samples.shift();
    const ref = this.sampleBefore(t - 100);
    this.approachSpeed = ref ? (ref.sep - f.sep) / Math.max(0.03, (t - ref.t) / 1000) : 0;

    // Clap: hands slam together from apart within a short window.
    if (!f.anyFist && t >= this.clapCooldownUntil && f.sep <= G.clapToDist) {
      let recentMax = 0;
      for (const s of this.samples) if (t - s.t <= G.clapWindowMs && s.t < t) recentMax = Math.max(recentMax, s.sep);
      if (recentMax >= G.clapFromDist) {
        events.push('clap');
        this.clapCooldownUntil = t + G.clapCooldownMs;
      }
    }

    // Palms together (held briefly), then spread apart.
    if (f.anyFist) {
      this.armed = false;
      this.togetherSince = -1;
    } else if (f.sep <= G.palmsTogetherDist) {
      if (this.togetherSince < 0) this.togetherSince = t;
      this.togetherLastT = t;
      if (t - this.togetherSince >= G.palmsTogetherMinMs) this.armed = true;
    } else {
      this.togetherSince = -1;
      if (this.armed) {
        if (t - this.togetherLastT > G.palmsApartWindowMs) {
          this.armed = false;
        } else if (f.sep >= G.palmsApartDist) {
          this.armed = false;
          if (t >= this.cooldownUntil) {
            events.push('palmsApart');
            this.cooldownUntil = t + G.twoHandCooldownMs;
          }
        }
      }
    }

    // Two fists pulled apart quickly.
    if (f.bothFists && t >= this.cooldownUntil) {
      let minSep = Infinity;
      for (const s of this.samples) {
        if (s.fists && t - s.t <= G.pullApartWindowMs) minSep = Math.min(minSep, s.sep);
      }
      if (f.sep - minSep >= G.pullApartGain && f.sep / minSep >= G.pullApartRatio) {
        events.push('pullApart');
        this.cooldownUntil = t + G.twoHandCooldownMs;
      }
    }

    this.lastBothT = t;
    this.lastSep = f.sep;
    this.dropoutHandled = false;
    return events;
  }

  private sampleBefore(t: number): { t: number; sep: number } | null {
    for (let i = this.samples.length - 1; i >= 0; i--) if (this.samples[i].t <= t) return this.samples[i];
    return this.samples.length > 1 ? this.samples[0] : null;
  }
}
