import * as THREE from 'three';
import { CONFIG } from '../config';
import { clamp, damp, easeOutBack } from '../core/math';
import { HoloLook, PALETTE } from '../render/holoMaterials';
import { pedestal } from './builders';

export interface PartSpec {
  id: string;
  name: string;
  /** Rows for the info card, e.g. ['DIAMETER', '76 mm']. */
  info: [string, string][];
  /** Builds the part's geometry around its own origin; register materials on `look`. */
  build: (look: HoloLook) => THREE.Object3D;
  /** Bounding radius (object-local units) used for picking. */
  radius: number;
  assembled: THREE.Vector3Tuple;
  exploded: THREE.Vector3Tuple;
  /** Idle spin about the part's local Z axis, rad/s. */
  spin?: number;
}

export interface ObjectSpec {
  kind: string;
  /** Label title, e.g. "ARC REACTOR MK-III". */
  title: string;
  /** Short name for the spawn menu. */
  shortName: string;
  /** Context menu title, e.g. "REACTOR OPS". */
  menuTitle: string;
  /** Assembled bounding radius (object-local units). */
  radius: number;
  parts: PartSpec[];
  /** Orientation the object spawns in and resets to. */
  restRotation: THREE.Euler;
  /** Extra rotation applied to each part while exploded, so flat parts read at an angle. */
  explodedTilt: THREE.Euler;
}

export type Highlight = 'none' | 'hover' | 'active';

const SPRING_W = 10;
const SPRING_Z = 0.72;
const tmpColor = new THREE.Color();

export class HoloPart {
  readonly group = new THREE.Group();
  readonly look = new HoloLook();
  readonly assembledPos: THREE.Vector3;
  readonly explodedPos: THREE.Vector3;
  readonly assembledQuat = new THREE.Quaternion();
  readonly explodedQuat = new THREE.Quaternion();
  /** Where the part was dropped after being pulled out (object-local), or null. */
  detached: THREE.Vector3 | null = null;
  dragging = false;
  /** Seconds to wait before following a new target (explode/assemble stagger). */
  delay = 0;
  highlight: Highlight = 'none';

  private readonly spinner = new THREE.Group();
  private readonly vel = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private hover = 0;
  private active = 0;

  constructor(
    readonly spec: PartSpec,
    tilt: THREE.Quaternion,
  ) {
    this.assembledPos = new THREE.Vector3(...spec.assembled);
    this.explodedPos = new THREE.Vector3(...spec.exploded);
    this.explodedQuat.copy(tilt);
    this.group.position.copy(this.assembledPos);
    this.group.add(this.spinner);
    this.spinner.add(spec.build(this.look));
    this.group.name = spec.id;
  }

  get name(): string {
    return this.spec.name;
  }

  get pos(): THREE.Vector3 {
    return this.group.position;
  }

  update(dt: number, exploded: boolean, fade: number): void {
    if (this.dragging && this.detached) {
      this.group.position.copy(this.detached);
      this.vel.set(0, 0, 0);
    } else if (this.delay > 0) {
      this.delay -= dt;
    } else {
      this.target.copy(this.detached ?? (exploded ? this.explodedPos : this.assembledPos));
      // Semi-implicit damped spring toward the target.
      const p = this.group.position;
      const w = SPRING_W;
      this.vel.x += (w * w * (this.target.x - p.x) - 2 * SPRING_Z * w * this.vel.x) * dt;
      this.vel.y += (w * w * (this.target.y - p.y) - 2 * SPRING_Z * w * this.vel.y) * dt;
      this.vel.z += (w * w * (this.target.z - p.z) - 2 * SPRING_Z * w * this.vel.z) * dt;
      p.addScaledVector(this.vel, dt);
    }
    const q = exploded || this.detached ? this.explodedQuat : this.assembledQuat;
    this.group.quaternion.slerp(q, damp(7, dt));
    this.spinner.rotation.z += (this.spec.spin ?? 0) * dt;

    this.hover += ((this.highlight === 'hover' ? 1 : 0) - this.hover) * damp(14, dt);
    this.active += ((this.highlight === 'active' ? 1 : 0) - this.active) * damp(14, dt);
    // Hover brightens toward ice-white; grabbing turns the part amber.
    tmpColor.copy(PALETTE.ice).lerp(PALETTE.amber, this.active);
    const amount = Math.max(this.hover * 0.45, this.active * 0.9);
    this.look.apply(tmpColor, amount, 1 + this.hover * 0.5 + this.active * 0.6, fade);
  }
}

export class HoloObject {
  private static seq = 0;
  readonly id = ++HoloObject.seq;
  /** Positioned in camera space. */
  readonly root = new THREE.Group();
  /** User rotation and scale. */
  readonly pivot = new THREE.Group();
  /** Gentle idle bob; parts live in this space ("object-local"). */
  readonly local = new THREE.Group();
  readonly parts: HoloPart[];
  readonly angularVelocity = new THREE.Vector3();
  /** Where the object is heading while grabbed (smoothed follow). */
  readonly targetPosition = new THREE.Vector3();
  exploded = false;
  scale: number = CONFIG.objects.spawnScale;
  grabCount = 0;
  /** True once removal has finished and the object can be disposed. */
  dead = false;

  private age = 0;
  private removing = false;
  private removeAge = 0;
  private explodeAmount = 0;
  /** Easing back to the rest orientation after a reset. */
  private resetting = false;
  private readonly restQuat: THREE.Quaternion;
  private readonly guide: THREE.Line;
  private readonly guideMat: THREE.LineDashedMaterial;
  private readonly guideLook = new HoloLook();
  /** Holotable projector pad under the hologram; stays level however the object turns. */
  private readonly pad: THREE.Group;
  private readonly padSpinner: THREE.Group;
  private readonly padLook = new HoloLook();
  private readonly dq = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();

  constructor(
    readonly spec: ObjectSpec,
    position: THREE.Vector3,
  ) {
    const tilt = new THREE.Quaternion().setFromEuler(spec.explodedTilt);
    this.parts = spec.parts.map((p) => new HoloPart(p, tilt));
    this.root.position.copy(position);
    this.targetPosition.copy(position);
    this.restQuat = new THREE.Quaternion().setFromEuler(spec.restRotation);
    this.pivot.quaternion.copy(this.restQuat);
    this.root.add(this.pivot);
    this.pivot.add(this.local);
    for (const p of this.parts) this.local.add(p.group);

    // Dashed assembly axis shown while exploded, like a technical exploded-view drawing.
    const ends = this.parts.map((p) => p.explodedPos);
    const sorted = [...ends].sort((a, b) => a.y - b.y);
    const a = sorted[0].clone();
    const b = sorted[sorted.length - 1].clone();
    const dir = b.clone().sub(a).normalize();
    a.addScaledVector(dir, -0.12);
    b.addScaledVector(dir, 0.12);
    this.guideMat = this.guideLook.dashed(PALETTE.cyan, 1.2, 0.5, 0.025, 0.018);
    this.guide = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), this.guideMat);
    this.guide.computeLineDistances();
    this.local.add(this.guide);

    const pad = pedestal(this.padLook, spec.radius * 0.85);
    this.pad = pad.group;
    this.padSpinner = pad.spinner;
    this.pad.rotation.x = -Math.PI / 2;
    this.pad.position.y = -spec.radius * 1.35;
    this.root.add(this.pad);
    this.root.scale.setScalar(0.0001);
  }

  get title(): string {
    return this.spec.title;
  }

  get isRemoving(): boolean {
    return this.removing;
  }

  /** 0 = assembled, 1 = fully exploded (smoothed). */
  get explodeProgress(): number {
    return this.explodeAmount;
  }

  get state(): string {
    if (this.removing) return 'OFFLINE';
    if (this.age < 0.9) return 'MATERIALIZING';
    if (this.grabCount > 1) return 'DUAL HOLD';
    if (this.grabCount === 1) return 'HELD';
    if (this.angularVelocity.length() > 0.8) return 'SPINNING';
    if (this.exploded) return 'EXPLODED';
    if (this.explodeAmount > 0.05) return 'ASSEMBLING';
    return 'STANDBY';
  }

  explode(): boolean {
    if (this.exploded || this.removing) return false;
    this.exploded = true;
    // Stagger outward from the core so the parts fan out in sequence.
    const order = [...this.parts].sort((p, q) => p.explodedPos.length() - q.explodedPos.length());
    order.forEach((p, i) => (p.delay = i * 0.05));
    return true;
  }

  assemble(): boolean {
    const hadDetached = this.parts.some((p) => p.detached && !p.dragging);
    if ((!this.exploded && !hadDetached) || this.removing) return false;
    this.exploded = false;
    const order = [...this.parts].sort((p, q) => q.explodedPos.length() - p.explodedPos.length());
    order.forEach((p, i) => {
      p.delay = i * 0.04;
      p.detached = null;
      p.dragging = false;
    });
    return true;
  }

  /** Sends pulled-out parts back to their exploded (or assembled) slots. */
  resetParts(): void {
    for (const p of this.parts) {
      p.detached = null;
      p.dragging = false;
    }
  }

  /** Back to the spawn pose: assembled, upright, default scale, not spinning. */
  resetPose(): void {
    this.assemble();
    this.resetParts();
    this.angularVelocity.set(0, 0, 0);
    this.scale = CONFIG.objects.spawnScale;
    this.resetting = true;
  }

  remove(): void {
    this.removing = true;
    this.grabCount = 0;
  }

  /** Adds spin about a world-space axis. */
  addSpin(axis: THREE.Vector3, radPerSec: number): void {
    this.angularVelocity.addScaledVector(axis, radPerSec);
    const max = CONFIG.objects.maxSpin;
    if (this.angularVelocity.length() > max) this.angularVelocity.setLength(max);
    this.resetting = false;
  }

  /** Rotates by a world-space quaternion (direct manipulation). */
  rotateBy(q: THREE.Quaternion): void {
    this.pivot.quaternion.premultiply(q);
    this.resetting = false;
  }

  setOrientation(q: THREE.Quaternion): void {
    this.pivot.quaternion.copy(q);
    this.resetting = false;
  }

  get orientation(): THREE.Quaternion {
    return this.pivot.quaternion;
  }

  update(dt: number, time: number): void {
    this.age += dt;
    let fade = 1;
    let displayScale = this.scale;
    if (this.age < 0.7) {
      const t = this.age / 0.7;
      displayScale *= Math.max(0.0001, easeOutBack(t));
      fade = clamp(t * 1.6, 0, 1);
    }
    if (this.removing) {
      this.removeAge += dt;
      const t = clamp(this.removeAge / 0.4, 0, 1);
      displayScale *= Math.max(0.0001, 1 - t * t);
      fade *= 1 - t;
      if (t >= 1) this.dead = true;
    }
    this.root.scale.setScalar(displayScale);

    // Smoothly follow the target position (grab), and coast otherwise.
    this.root.position.lerp(this.targetPosition, damp(this.grabCount > 0 ? 22 : 10, dt));

    const w = this.angularVelocity.length();
    if (w > 1e-4) {
      this.axis.copy(this.angularVelocity).divideScalar(w);
      this.dq.setFromAxisAngle(this.axis, w * dt);
      this.pivot.quaternion.premultiply(this.dq);
      this.angularVelocity.multiplyScalar(Math.exp(-CONFIG.objects.spinDamping * dt));
    }
    if (this.resetting) {
      this.pivot.quaternion.slerp(this.restQuat, damp(6, dt));
      if (this.pivot.quaternion.angleTo(this.restQuat) < 0.002) this.resetting = false;
    }

    // Idle hover bob.
    this.local.position.y = Math.sin(time * 1.3 + this.id) * 0.006;

    this.explodeAmount += ((this.exploded ? 1 : 0) - this.explodeAmount) * damp(5, dt);
    for (const p of this.parts) p.update(dt, this.exploded, fade);
    this.guideLook.apply(PALETTE.cyan, 0, 1, fade * this.explodeAmount);
    this.guide.visible = this.explodeAmount > 0.02;
    this.padSpinner.rotation.z = time * 0.6;
    this.padLook.apply(PALETTE.amber, this.grabCount > 0 ? 0.6 : 0, 1, fade * (1 - 0.6 * this.explodeAmount));
  }

  /** Bounding radius in world units for the current (assembled or exploded) layout. */
  get worldRadius(): number {
    let r = this.spec.radius;
    for (const p of this.parts) r = Math.max(r, p.pos.length() + p.spec.radius * 0.6);
    return r * this.root.scale.x;
  }

  partWorldCenter(part: HoloPart, out: THREE.Vector3): THREE.Vector3 {
    return part.group.getWorldPosition(out);
  }

  partWorldRadius(part: HoloPart): number {
    return part.spec.radius * this.root.scale.x;
  }

  /** Converts a world point into object-local (part) space. */
  worldToLocal(p: THREE.Vector3): THREE.Vector3 {
    this.local.updateWorldMatrix(true, false);
    return this.local.worldToLocal(p);
  }

  dispose(): void {
    this.root.traverse((o) => {
      // Sprites share one geometry across the whole app; leave it alone.
      if ((o as THREE.Sprite).isSprite) return;
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    for (const p of this.parts) p.look.dispose();
    this.guideLook.dispose();
    this.padLook.dispose();
    this.root.removeFromParent();
  }
}
