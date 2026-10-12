import * as THREE from 'three';
import type { Vec2 } from '../core/math';
import type { HandSet } from '../tracking/handSet';
import { LM } from '../tracking/landmarks';
import type { TrackedHand } from '../tracking/trackedHand';
import { FlickDetector, TwistDetector, TwoHandDetector, type TwistDirection } from './detectors';

export type HandEdgeType = 'handFound' | 'handLost' | 'pinchStart' | 'pinchEnd' | 'fistStart' | 'fistEnd';
export type TwoHandType = 'clap' | 'palmsApart' | 'pullApart';

export type GestureEvent =
  | { type: HandEdgeType; hand: TrackedHand }
  | { type: 'flick'; hand: TrackedHand; vx: number; vy: number; speed: number; x: number; y: number }
  | { type: 'twist'; hand: TrackedHand; dir: TwistDirection }
  | { type: TwoHandType; x: number; y: number; world: THREE.Vector3 };

interface PrevState {
  present: boolean;
  pinching: boolean;
  fist: boolean;
}

/**
 * Turns per-frame hand state into discrete events: state edges (pinch/fist start & end, hand
 * found/lost) and recognized motion gestures (flick, twist, clap, palms apart, fists pulled apart).
 */
export class GestureEngine {
  private readonly prev = new Map<TrackedHand, PrevState>();
  private readonly flicks = new Map<TrackedHand, FlickDetector>();
  private readonly twists = new Map<TrackedHand, TwistDetector>();
  private readonly twoHand = new TwoHandDetector();
  private readonly vel: Vec2 = { x: 0, y: 0 };
  private readonly tip: Vec2 = { x: 0, y: 0 };
  private readonly mid = { x: 0, y: 0, world: new THREE.Vector3() };

  constructor(private readonly hands: HandSet) {
    for (const h of hands.all) {
      this.prev.set(h, { present: false, pinching: false, fist: false });
      this.flicks.set(h, new FlickDetector());
      this.twists.set(h, new TwistDetector());
    }
  }

  /** Call once per processed tracker frame. */
  update(tMs: number, screenH: number): GestureEvent[] {
    const events: GestureEvent[] = [];

    for (const hand of this.hands.all) {
      const prev = this.prev.get(hand)!;
      if (hand.present && !prev.present) events.push({ type: 'handFound', hand });

      const pinching = hand.present && hand.pinching.value;
      const fist = hand.present && hand.fist.value;
      if (pinching !== prev.pinching) events.push({ type: pinching ? 'pinchStart' : 'pinchEnd', hand });
      if (fist !== prev.fist) events.push({ type: fist ? 'fistStart' : 'fistEnd', hand });

      if (!hand.present && prev.present) {
        const pending = this.flicks.get(hand)!.flush(tMs);
        if (pending) events.push({ type: 'flick', hand, ...pending });
        events.push({ type: 'handLost', hand });
      }
      prev.present = hand.present;
      prev.pinching = pinching;
      prev.fist = fist;

      if (!hand.isFresh(tMs)) continue;

      hand.velocity('tip', 70, this.vel);
      hand.screenPoint(LM.INDEX_TIP, this.tip);
      const flick = this.flicks
        .get(hand)!
        .update(tMs, hand.pointing.value, this.tip.x, this.tip.y, this.vel.x, this.vel.y, screenH);
      if (flick) events.push({ type: 'flick', hand, ...flick });

      const twist = this.twists
        .get(hand)!
        .update(tMs, hand.fist.value, hand.knuckleAngle, hand.palmScreen.x, hand.palmScreen.y, screenH);
      if (twist) events.push({ type: 'twist', hand, dir: twist });
    }

    const L = this.hands.left;
    const R = this.hands.right;
    const both = L.isFresh(tMs) && R.isFresh(tMs);
    let sep = Infinity;
    if (both) {
      const dx = L.palm.x - R.palm.x;
      const dy = L.palm.y - R.palm.y;
      // Monocular depth is the noisiest axis, so it counts for less.
      const dz = (L.palm.z - R.palm.z) * 0.5;
      sep = Math.hypot(dx, dy, dz);
      this.mid.x = (L.palmScreen.x + R.palmScreen.x) / 2;
      this.mid.y = (L.palmScreen.y + R.palmScreen.y) / 2;
      this.mid.world.addVectors(L.palm, R.palm).multiplyScalar(0.5);
    }
    const lFist = L.present && L.fist.value;
    const rFist = R.present && R.fist.value;
    const twoHand = this.twoHand.update({
      t: tMs,
      both,
      sep,
      bothFists: both && lFist && rFist,
      anyFist: lFist || rFist,
    });
    for (const type of twoHand) {
      events.push({ type, x: this.mid.x, y: this.mid.y, world: this.mid.world.clone() });
    }
    return events;
  }
}
