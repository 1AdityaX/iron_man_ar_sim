import type { Vec2 } from '../core/math';
import type { Viewport } from '../core/viewport';
import { LM } from './landmarks';
import { TrackedHand, type RawHand, type Side } from './trackedHand';

/** The user's two hands. Assigns each tracker detection to the right persistent hand. */
export class HandSet {
  readonly left = new TrackedHand('Left');
  readonly right = new TrackedHand('Right');
  readonly all: readonly TrackedHand[] = [this.left, this.right];
  private readonly tmp: Vec2 = { x: 0, y: 0 };

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
    const assigned = this.assign(raws, vp);
    const dropped: TrackedHand[] = [];
    for (const hand of this.all) {
      const raw = assigned.get(hand.side);
      if (raw) hand.update(raw, tMs, vp);
      else if (hand.markMissing(tMs)) dropped.push(hand);
    }
    return dropped;
  }

  /** Drops both hands immediately (e.g. when the camera changes). */
  clear(): TrackedHand[] {
    const dropped = this.all.filter((h) => h.present);
    for (const h of dropped) h.markMissing(Infinity);
    return dropped;
  }

  private assign(raws: RawHand[], vp: Viewport): Map<Side, RawHand> {
    const out = new Map<Side, RawHand>();
    if (raws.length === 0) return out;
    if (raws.length === 1 || raws[0].side !== raws[1].side) {
      for (const r of raws.slice(0, 2)) if (!out.has(r.side)) out.set(r.side, r);
      return out;
    }
    // Both detections claim the same side (the classifier occasionally does this):
    // keep whichever assignment best matches where the hands were last frame,
    // or fall back to screen position (in a mirror, your left hand is on the left).
    const [a, b] = raws;
    const pa = this.wristScreen(a, vp, { x: 0, y: 0 });
    const pb = this.wristScreen(b, vp, { x: 0, y: 0 });
    let aIsLeft: boolean;
    if (this.left.present && this.right.present) {
      const lw = this.left.screenPoint(LM.WRIST, this.tmp);
      const lx = lw.x;
      const ly = lw.y;
      const rw = this.right.screenPoint(LM.WRIST, this.tmp);
      const keep =
        Math.hypot(pa.x - lx, pa.y - ly) + Math.hypot(pb.x - rw.x, pb.y - rw.y);
      const swap =
        Math.hypot(pb.x - lx, pb.y - ly) + Math.hypot(pa.x - rw.x, pa.y - rw.y);
      aIsLeft = keep <= swap;
    } else {
      aIsLeft = vp.mirror ? pa.x < pb.x : pa.x > pb.x;
    }
    out.set('Left', aIsLeft ? a : b);
    out.set('Right', aIsLeft ? b : a);
    return out;
  }

  private wristScreen(raw: RawHand, vp: Viewport, out: Vec2): Vec2 {
    return vp.imageToScreen(raw.image[0], raw.image[1], out);
  }
}
