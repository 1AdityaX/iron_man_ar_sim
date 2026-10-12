import { CONFIG } from '../config';
import type { Viewport } from '../core/viewport';
import { LM } from './landmarks';
import { TrackedHand, type RawHand, type Side } from './trackedHand';

/** Wrist and the four knuckles: an anchor that stays put while the fingers move. */
const ANCHOR_POINTS = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];

/** Where a detection sits on screen. */
export interface Anchor {
  x: number;
  y: number;
  /** Wrist to middle knuckle in screen pixels, the unit for how far a hand moved. */
  size: number;
  t: number;
}

interface Detection {
  raw: RawHand;
  anchor: Anchor;
}

const otherSide = (s: Side): Side => (s === 'Left' ? 'Right' : 'Left');

/** How strongly a detection's label votes for `side`: +1 confidently yes, -1 confidently no. */
const labelVote = (raw: RawHand, side: Side): number =>
  (raw.side === side ? 1 : -1) * Math.max(0, 2 * raw.score - 1);

/**
 * The user's two hands. Assigns each tracker detection to the right persistent hand.
 *
 * MediaPipe labels each detection left or right frame by frame, and gets it wrong on a few
 * percent of frames, which used to swap the hands mid-gesture. So a hand that is being tracked
 * keeps the detection nearest to where it just was, whatever that detection's label says. Labels
 * decide only for hands that are just appearing, and a hand the classifier keeps calling the
 * other side for several frames is handed over to that side.
 */
export class HandSet {
  readonly left = new TrackedHand('Left');
  readonly right = new TrackedHand('Right');
  readonly all: readonly TrackedHand[] = [this.left, this.right];
  /** Where each hand was last detected (raw, before smoothing). */
  private readonly anchors = new Map<Side, Anchor>();
  /** Running agreement between each hand's labels and its side, from -1 to +1. */
  private readonly trust = new Map<Side, number>();

  get(side: Side): TrackedHand {
    return side === 'Left' ? this.left : this.right;
  }

  other(hand: TrackedHand): TrackedHand {
    return hand === this.left ? this.right : this.left;
  }

  /**
   * Feeds one processed video frame. Returns the hands that were dropped this frame.
   */
  ingest(raws: RawHand[], tMs: number, vp: Viewport): TrackedHand[] {
    const dets = raws.slice(0, 2).map((raw) => ({ raw, anchor: anchorOf(raw, tMs, vp) }));
    const assigned = this.assign(dets, tMs, vp);
    const dropped: TrackedHand[] = [];
    // A hand handed over to the other side starts afresh there.
    for (const side of this.handovers(assigned)) {
      const hand = this.get(side);
      if (hand.present && hand.markMissing(Infinity)) dropped.push(hand);
    }
    for (const hand of this.all) {
      const det = assigned.get(hand.side);
      if (det) {
        const vote = labelVote(det.raw, hand.side);
        const prev = hand.present ? (this.trust.get(hand.side) ?? vote) : vote;
        this.trust.set(hand.side, prev + CONFIG.tracking.labelTrustRate * (vote - prev));
        this.anchors.set(hand.side, det.anchor);
        hand.update(det.raw, tMs, vp);
      } else if (hand.markMissing(tMs)) dropped.push(hand);
    }
    return dropped;
  }

  /** Drops both hands immediately (e.g. when the camera changes). */
  clear(): TrackedHand[] {
    const dropped = this.all.filter((h) => h.present);
    for (const h of dropped) h.markMissing(Infinity);
    return dropped;
  }

  /** Picks the cheapest way to give each detection its own side. */
  private assign(dets: Detection[], tMs: number, vp: Viewport): Map<Side, Detection> {
    const out = new Map<Side, Detection>();
    if (dets.length === 0) return out;
    const options: Side[][] = dets.length === 1 ? [['Left'], ['Right']] : [['Left', 'Right'], ['Right', 'Left']];
    const costs = options.map((sides) => sides.reduce((sum, side, j) => sum + this.cost(dets[j], side, tMs), 0));
    // A tie (new hands whose labels don't settle it) goes by screen position.
    const best = Math.abs(costs[0] - costs[1]) < 1e-9 ? this.byPosition(dets, vp) : options[costs[0] < costs[1] ? 0 : 1];
    best.forEach((side, j) => out.set(side, dets[j]));
    return out;
  }

  /**
   * Cost of giving `det` to `side`: how far that hand would have moved, in hand sizes per frame,
   * plus a penalty when the detection's label says otherwise. Starting a new hand costs a fixed
   * amount, so a detection near a tracked hand stays with it even if its label flips.
   */
  private cost(det: Detection, side: Side, tMs: number): number {
    const T = CONFIG.tracking;
    const mismatch = Math.max(0, -labelVote(det.raw, side));
    const hand = this.get(side);
    const last = this.anchors.get(side);
    if (!hand.present || !last) return T.spawnCost + T.labelWeight * mismatch;
    const frames = Math.max(1, (tMs - last.t) / T.nominalFrameMs);
    const moved = Math.hypot(det.anchor.x - last.x, det.anchor.y - last.y) / Math.max(last.size, det.anchor.size, 1);
    // Too far to be the same hand: no better than a new one, so the label decides.
    return Math.min(moved / frames, T.spawnCost) + T.labelWeight * mismatch;
  }

  /** In a mirrored view your left hand is on the left of the screen; unmirrored, on the right. */
  private byPosition(dets: Detection[], vp: Viewport): Side[] {
    const [a, b] = dets;
    const aLeftOfB = b ? a.anchor.x <= b.anchor.x : a.anchor.x <= vp.width / 2;
    const aIsLeft = vp.mirror ? aLeftOfB : !aLeftOfB;
    const first: Side = aIsLeft ? 'Left' : 'Right';
    return b ? [first, otherSide(first)] : [first];
  }

  /**
   * Sides whose hand the classifier has kept calling the other side. Moves their detections over
   * (or swaps both hands when both are wrong) and returns the sides to reset.
   */
  private handovers(assigned: Map<Side, Detection>): Side[] {
    const T = CONFIG.tracking;
    const wrong = (side: Side): boolean => {
      const det = assigned.get(side);
      if (!det || !this.get(side).present) return false;
      const prev = this.trust.get(side) ?? 0;
      return prev + T.labelTrustRate * (labelVote(det.raw, side) - prev) < T.labelHandover;
    };
    const l = wrong('Left');
    const r = wrong('Right');
    if (l && r) {
      const left = assigned.get('Left')!;
      assigned.set('Left', assigned.get('Right')!);
      assigned.set('Right', left);
      return ['Left', 'Right'];
    }
    for (const side of [l ? 'Left' : null, r ? 'Right' : null] as const) {
      if (!side) continue;
      const to = otherSide(side);
      if (this.get(to).present || assigned.has(to)) continue;
      assigned.set(to, assigned.get(side)!);
      assigned.delete(side);
      return [side];
    }
    return [];
  }
}

/** Mean of the wrist and knuckles in screen pixels, with the wrist-to-middle-knuckle size. */
export function anchorOf(raw: RawHand, tMs: number, vp: Viewport): Anchor {
  const p = { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const i of ANCHOR_POINTS) {
    vp.imageToScreen(raw.image[i * 3], raw.image[i * 3 + 1], p);
    x += p.x / ANCHOR_POINTS.length;
    y += p.y / ANCHOR_POINTS.length;
  }
  vp.imageToScreen(raw.image[LM.WRIST * 3], raw.image[LM.WRIST * 3 + 1], p);
  const wx = p.x;
  const wy = p.y;
  vp.imageToScreen(raw.image[LM.MIDDLE_MCP * 3], raw.image[LM.MIDDLE_MCP * 3 + 1], p);
  return { x, y, size: Math.hypot(p.x - wx, p.y - wy), t: tMs };
}
