import * as THREE from 'three';
import type { Vec2 } from '../core/math';
import type { Viewport } from '../core/viewport';
import { HoloObject, type HoloPart, type ObjectSpec } from './holoObject';

export interface ScreenCircle {
  x: number;
  y: number;
  r: number;
  depth: number;
}

export interface PartHit {
  obj: HoloObject;
  part: HoloPart;
}

/** Owns the live holograms and answers "what is under this screen point?". */
export class ObjectManager {
  readonly objects: HoloObject[] = [];
  private readonly v = new THREE.Vector3();
  private readonly s: Vec2 = { x: 0, y: 0 };

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly vp: Viewport,
  ) {}

  spawn(spec: ObjectSpec, position: THREE.Vector3): HoloObject {
    const obj = new HoloObject(spec, position);
    this.parent.add(obj.root);
    this.objects.push(obj);
    return obj;
  }

  get live(): HoloObject[] {
    return this.objects.filter((o) => !o.isRemoving);
  }

  update(dt: number, time: number): void {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      o.update(dt, time);
      if (o.dead) {
        o.dispose();
        this.objects.splice(i, 1);
      }
    }
  }

  screenCircle(obj: HoloObject, out: ScreenCircle): ScreenCircle {
    obj.root.getWorldPosition(this.v);
    const depth = this.vp.worldToScreen(this.v, this.s);
    out.x = this.s.x;
    out.y = this.s.y;
    out.depth = depth;
    out.r = this.vp.projectRadius(obj.spec.radius * obj.root.scale.x, depth);
    return out;
  }

  partCircle(obj: HoloObject, part: HoloPart, out: ScreenCircle): ScreenCircle {
    obj.partWorldCenter(part, this.v);
    const depth = this.vp.worldToScreen(this.v, this.s);
    out.x = this.s.x;
    out.y = this.s.y;
    out.depth = depth;
    out.r = this.vp.projectRadius(obj.partWorldRadius(part), depth);
    return out;
  }

  /**
   * The object whose on-screen footprint contains (x, y), with hit radii scaled by `pad` and at
   * least `minPx`. Exploded objects count every part's footprint. Closest (relative) hit wins.
   */
  pick(x: number, y: number, pad = 1, minPx = 0): HoloObject | null {
    let best: HoloObject | null = null;
    let bestScore = Infinity;
    const c: ScreenCircle = { x: 0, y: 0, r: 0, depth: 0 };
    for (const obj of this.live) {
      this.screenCircle(obj, c);
      let score = Math.hypot(x - c.x, y - c.y) / Math.max(minPx, c.r * pad);
      if (obj.explodeProgress > 0.3 || obj.parts.some((p) => p.detached)) {
        for (const part of obj.parts) {
          this.partCircle(obj, part, c);
          score = Math.min(score, Math.hypot(x - c.x, y - c.y) / Math.max(minPx * 0.6, c.r * pad));
        }
      }
      if (score <= 1 && score < bestScore) {
        bestScore = score;
        best = obj;
      }
    }
    return best;
  }

  /** A part under (x, y) on an exploded object (or a part that was pulled out). */
  pickPart(x: number, y: number, pad = 1): PartHit | null {
    let best: PartHit | null = null;
    let bestScore = Infinity;
    const c: ScreenCircle = { x: 0, y: 0, r: 0, depth: 0 };
    for (const obj of this.live) {
      for (const part of obj.parts) {
        if (!(obj.explodeProgress > 0.6 || part.detached)) continue;
        this.partCircle(obj, part, c);
        const rel = Math.hypot(x - c.x, y - c.y) / Math.max(18, c.r * pad);
        if (rel > 1) continue;
        // Prefer the part whose centre is closest relative to its size; nearer parts win ties.
        const score = rel + c.depth * 0.05;
        if (score < bestScore) {
          bestScore = score;
          best = { obj, part };
        }
      }
    }
    return best;
  }

  /** Closest live object to a screen point, within `maxPx` of its footprint edge. */
  nearest(x: number, y: number, maxPx = Infinity): HoloObject | null {
    let best: HoloObject | null = null;
    let bestD = Infinity;
    const c: ScreenCircle = { x: 0, y: 0, r: 0, depth: 0 };
    for (const obj of this.live) {
      this.screenCircle(obj, c);
      const d = Math.max(0, Math.hypot(x - c.x, y - c.y) - c.r);
      if (d < bestD && d <= maxPx) {
        bestD = d;
        best = obj;
      }
    }
    return best;
  }
}
