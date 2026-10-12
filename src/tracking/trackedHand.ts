import * as THREE from 'three';
import { CONFIG } from '../config';
import { clamp, wrapAngle, type Vec2 } from '../core/math';
import { OneEuroFilter, OneEuroPoints } from '../core/oneEuro';
import type { Viewport } from '../core/viewport';
import {
  estimateDepth,
  fingerCurls,
  gripStrength,
  handTiltDeg,
  knuckleAngle,
  palmLength,
  pinchRatio,
  tipExtensions,
} from './handFeatures';
import { LM, NUM_LANDMARKS } from './landmarks';

export type Side = 'Left' | 'Right';

/** One hand as reported by the tracker for a single video frame. */
export interface RawHand {
  side: Side;
  score: number;
  /** 21 × (x, y, z) normalized image coordinates. */
  image: ArrayLike<number>;
  /** 21 × (x, y, z) world coordinates in metres. */
  world: ArrayLike<number>;
}

/** A boolean that only flips after its new value has held for `ms`. */
export class Debounced {
  value = false;
  private pendingSince = -1;

  constructor(private readonly ms: number) {}

  update(cond: boolean, t: number): void {
    if (cond === this.value) {
      this.pendingSince = -1;
      return;
    }
    if (this.pendingSince < 0) this.pendingSince = t;
    if (t - this.pendingSince >= this.ms) {
      this.value = cond;
      this.pendingSince = -1;
    }
  }

  reset(): void {
    this.value = false;
    this.pendingSince = -1;
  }
}

export interface HandSample {
  t: number;
  palm: Vec2;
  tip: Vec2;
  pinch: Vec2;
}

const HISTORY_MS = 1200;

/**
 * Persistent state for one physical hand: smoothed landmarks, a metric 3D reconstruction in
 * camera space, derived pose features and debounced gesture states.
 */
export class TrackedHand {
  present = false;
  lastSeen = -Infinity;
  score = 0;

  /** Smoothed landmark positions in screen pixels (21 × xy). */
  readonly screen = new Float32Array(NUM_LANDMARKS * 2);
  /** Smoothed world landmarks (metres, hand-centred). */
  world: Float32Array = new Float32Array(NUM_LANDMARKS * 3);
  /** Landmarks reconstructed in camera space (metres). */
  readonly points = Array.from({ length: NUM_LANDMARKS }, () => new THREE.Vector3());

  /** Estimated distance from the camera (metres). */
  depth = 0.7;
  palmLengthM = 0.09;

  readonly palm = new THREE.Vector3();
  readonly palmScreen: Vec2 = { x: 0, y: 0 };
  readonly knuckles = new THREE.Vector3();
  readonly palmNormal = new THREE.Vector3(0, 0, 1);
  readonly handDir = new THREE.Vector3(0, 1, 0);
  readonly sideDir = new THREE.Vector3(1, 0, 0);
  readonly pinchPoint = new THREE.Vector3();
  readonly pinchScreen: Vec2 = { x: 0, y: 0 };

  readonly curls = [0, 0, 0, 0, 0];
  /** Fingertip distance from the wrist over palm length, per finger. */
  readonly tipExt = [0, 0, 0, 0, 0];
  grip = 0;
  pinchRatio = 1;
  /** Screen-space knuckle-line angle, unwrapped so it can exceed ±π while twisting. */
  knuckleAngle = 0;
  tiltDeg = 0;

  readonly pinching = new Debounced(CONFIG.hand.debounceMs);
  readonly fist = new Debounced(CONFIG.hand.debounceMs);
  readonly pointing = new Debounced(CONFIG.hand.debounceMs * 1.5);
  readonly open = new Debounced(CONFIG.hand.debounceMs);

  readonly history: HandSample[] = [];

  private readonly imageFilter = new OneEuroPoints(NUM_LANDMARKS, 3, CONFIG.tracking.imageFilter);
  private readonly worldFilter = new OneEuroPoints(NUM_LANDMARKS, 3, CONFIG.tracking.worldFilter);
  private readonly depthFilter = new OneEuroFilter(CONFIG.tracking.depthFilter);
  private lastRawKnuckle = 0;
  private readonly tmp: Vec2 = { x: 0, y: 0 };
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();

  constructor(readonly side: Side) {}

  get label(): string {
    return this.side === 'Left' ? 'LEFT HAND' : 'RIGHT HAND';
  }

  update(raw: RawHand, tMs: number, vp: Viewport): void {
    const tSec = tMs / 1000;
    if (!this.present) {
      this.imageFilter.reset();
      this.worldFilter.reset();
      this.depthFilter.reset();
      this.history.length = 0;
    }
    const wasPresent = this.present;
    this.present = true;
    this.lastSeen = tMs;
    this.score = raw.score;

    const image = this.imageFilter.filter(raw.image, tSec);
    this.world = this.worldFilter.filter(raw.world, tSec);
    const world = this.world;

    for (let i = 0; i < NUM_LANDMARKS; i++) {
      vp.imageToScreen(image[i * 3], image[i * 3 + 1], this.tmp);
      this.screen[i * 2] = this.tmp.x;
      this.screen[i * 2 + 1] = this.tmp.y;
    }

    const est = estimateDepth(world, this.screen, vp.focalPx);
    if (Number.isFinite(est)) {
      this.depth = this.depthFilter.filter(
        clamp(est, CONFIG.tracking.minDepth, CONFIG.tracking.maxDepth),
        tSec,
      );
    }

    // Metric 3D reconstruction: each landmark sits on its own pixel's view ray, at the hand's
    // distance offset by its relative depth from the world landmarks (+z = away from camera).
    for (let i = 0; i < NUM_LANDMARKS; i++) {
      const d = Math.max(0.05, this.depth + world[i * 3 + 2]);
      vp.screenToWorld(this.screen[i * 2], this.screen[i * 2 + 1], d, this.points[i]);
    }
    this.computeFrame();

    this.palmLengthM = palmLength(world);
    fingerCurls(world, this.curls);
    tipExtensions(world, this.tipExt);
    this.grip = gripStrength(this.curls);
    this.pinchRatio = pinchRatio(world);

    const rawKnuckle = knuckleAngle(this.screen);
    if (!wasPresent) {
      this.knuckleAngle = rawKnuckle;
    } else {
      this.knuckleAngle += wrapAngle(rawKnuckle - this.lastRawKnuckle);
    }
    this.lastRawKnuckle = rawKnuckle;
    this.tiltDeg = handTiltDeg(this.screen);

    this.updateStates(tMs);

    this.history.push({
      t: tMs,
      palm: { x: this.palmScreen.x, y: this.palmScreen.y },
      tip: { x: this.screen[LM.INDEX_TIP * 2], y: this.screen[LM.INDEX_TIP * 2 + 1] },
      pinch: { x: this.pinchScreen.x, y: this.pinchScreen.y },
    });
    while (this.history.length > 2 && tMs - this.history[0].t > HISTORY_MS) this.history.shift();
  }

  /** Called when a frame was processed without this hand. Returns true if the hand just got dropped. */
  markMissing(tMs: number): boolean {
    if (this.present && tMs - this.lastSeen > CONFIG.tracking.lostGraceMs) {
      this.present = false;
      this.pinching.reset();
      this.fist.reset();
      this.pointing.reset();
      this.open.reset();
      this.history.length = 0;
      return true;
    }
    return false;
  }

  /** True when the hand was seen in the most recent processed frame (not just within the grace period). */
  isFresh(tMs: number): boolean {
    return this.present && tMs - this.lastSeen < 1;
  }

  screenPoint(index: number, out: Vec2): Vec2 {
    out.x = this.screen[index * 2];
    out.y = this.screen[index * 2 + 1];
    return out;
  }

  /** Screen-space velocity (px/s) of a tracked point, measured over roughly `windowMs`. */
  velocity(key: 'palm' | 'tip' | 'pinch', windowMs: number, out: Vec2): Vec2 {
    out.x = 0;
    out.y = 0;
    const h = this.history;
    if (h.length < 2) return out;
    const last = h[h.length - 1];
    let j = h.length - 2;
    while (j > 0 && last.t - h[j].t < windowMs) j--;
    const first = h[j];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return out;
    out.x = (last[key].x - first[key].x) / dt;
    out.y = (last[key].y - first[key].y) / dt;
    return out;
  }

  private computeFrame(): void {
    const p = this.points;
    // Palm centre: two thirds of the way from the wrist to the knuckle line.
    this.knuckles
      .copy(p[LM.INDEX_MCP])
      .add(p[LM.MIDDLE_MCP])
      .add(p[LM.RING_MCP])
      .add(p[LM.PINKY_MCP])
      .multiplyScalar(0.25);
    this.palm.copy(p[LM.WRIST]).lerp(this.knuckles, 0.66);

    this.v1.subVectors(p[LM.INDEX_MCP], p[LM.WRIST]);
    this.v2.subVectors(p[LM.PINKY_MCP], p[LM.WRIST]);
    this.palmNormal.crossVectors(this.v1, this.v2);
    if (this.palmNormal.lengthSq() < 1e-12) this.palmNormal.set(0, 0, 1);
    this.palmNormal.normalize();
    // Rings are drawn double-sided; keep the normal facing the camera so their spin is stable.
    if (this.palmNormal.z < 0) this.palmNormal.negate();

    this.handDir.subVectors(this.knuckles, p[LM.WRIST]);
    if (this.handDir.lengthSq() < 1e-12) this.handDir.set(0, 1, 0);
    this.handDir.normalize();
    this.sideDir.subVectors(p[LM.INDEX_MCP], p[LM.PINKY_MCP]).normalize();

    this.pinchPoint.copy(p[LM.THUMB_TIP]).add(p[LM.INDEX_TIP]).multiplyScalar(0.5);
    this.pinchScreen.x = (this.screen[LM.THUMB_TIP * 2] + this.screen[LM.INDEX_TIP * 2]) / 2;
    this.pinchScreen.y = (this.screen[LM.THUMB_TIP * 2 + 1] + this.screen[LM.INDEX_TIP * 2 + 1]) / 2;

    // Same wrist-to-knuckles weighting as the 3D palm centre.
    let kx = 0;
    let ky = 0;
    for (const i of [LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP]) {
      kx += this.screen[i * 2] / 4;
      ky += this.screen[i * 2 + 1] / 4;
    }
    const wx = this.screen[LM.WRIST * 2];
    const wy = this.screen[LM.WRIST * 2 + 1];
    this.palmScreen.x = wx + (kx - wx) * 0.66;
    this.palmScreen.y = wy + (ky - wy) * 0.66;
  }

  private updateStates(tMs: number): void {
    const H = CONFIG.hand;
    const c = this.curls;
    const indexExt = this.tipExt[1];

    // Each state uses looser thresholds to stay on than to turn on (hysteresis).
    const pinching = this.pinching.value;
    const pinchCond =
      this.pinchRatio < (pinching ? H.pinchExit : H.pinchEnter) &&
      indexExt > (pinching ? H.pinchHoldIndexExt : H.pinchMinIndexExt);
    this.pinching.update(pinchCond, tMs);

    const fisting = this.fist.value;
    const fistCond =
      !pinchCond &&
      (fisting
        ? this.grip > H.fistExit && indexExt < H.fistHoldIndexExt
        : this.grip > H.fistEnter && indexExt < H.fistMaxIndexExt);
    this.fist.update(fistCond, tMs);
    // A pinch with the other fingers curled must never also read as a fist.
    if (this.pinching.value && this.fist.value) this.fist.reset();

    const pointing = this.pointing.value;
    const slack = pointing ? 0.1 : 0;
    const indexOut = c[1] < H.pointIndexMaxCurl + slack || indexExt > H.pointIndexMinExt - slack;
    const othersIn = (c[2] + c[3] + c[4]) / 3 > H.pointOthersMinCurl - slack && Math.min(c[2], c[3], c[4]) > 0.3;
    this.pointing.update(indexOut && othersIn && !pinchCond, tMs);

    this.open.update(this.grip < H.openMax + (this.open.value ? 0.08 : 0), tMs);
  }
}
