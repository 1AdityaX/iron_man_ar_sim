import * as THREE from 'three';
import { TAU, clamp, damp } from '../core/math';
import { LM } from '../tracking/landmarks';
import type { TrackedHand } from '../tracking/trackedHand';
import { PALETTE, makeGlow, makeRing, type RingMaterial } from './holoMaterials';

export interface HandVisualState {
  /** Pinch-and-hold progress, 0..1. */
  holdProgress: number;
  /** Fist currently holding an object. */
  grabbing: boolean;
  /** Pinch currently dragging a part or steering a menu. */
  dragging: boolean;
}

type Ring = THREE.Mesh<THREE.PlaneGeometry, RingMaterial>;

const Z = new THREE.Vector3(0, 0, 1);

/**
 * The holographic HUD that rides on each tracked hand: a palm ring with a rotating inner arc and
 * orbiting node, a bracelet ring around the wrist, fingertip glows, a pinch reticle with a gold
 * hold-progress arc, a red glow on a grabbing fist and a reticle on a pointing finger.
 */
export class HandRig {
  readonly group = new THREE.Group();

  private readonly palm = new THREE.Group();
  private readonly palmRing: Ring;
  private readonly palmArc: Ring;
  private readonly palmTicks: Ring;
  private readonly palmNode: THREE.Sprite;

  private readonly wrist = new THREE.Group();
  private readonly wristRing: Ring;
  private readonly wristArc: Ring;
  private readonly wristDot: THREE.Sprite;

  private readonly indexDot: THREE.Sprite;
  private readonly thumbDot: THREE.Sprite;

  private readonly pinch = new THREE.Group();
  private readonly pinchRing: Ring;
  private readonly pinchProgress: Ring;

  private readonly fistGlow: THREE.Sprite;
  private readonly pointer = new THREE.Group();
  private readonly reticle: Ring;

  private presence = 0;
  private pinchFade = 0;
  private fistFade = 0;
  private pointFade = 0;
  private holdFade = 0;
  private initialized = false;

  private readonly basis = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly x = new THREE.Vector3();
  private readonly y = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(readonly hand: TrackedHand) {
    this.palmRing = makeRing({ radius: 1, width: 0.045, intensity: 1.9, glow: 1.2 });
    this.palmArc = makeRing({ radius: 0.74, width: 0.035, intensity: 1.6, arcLength: TAU * 0.68 });
    this.palmTicks = makeRing({ radius: 1.12, width: 0.03, intensity: 1.1, dashes: 36, duty: 0.35, opacity: 0.45, glow: 0 });
    this.palmNode = makeGlow(0.24, PALETTE.ice, 2.2);
    this.palm.add(this.palmRing, this.palmArc, this.palmTicks, this.palmNode);

    this.wristRing = makeRing({ radius: 1, width: 0.06, intensity: 1.8, glow: 1.1 });
    this.wristArc = makeRing({ radius: 1.3, width: 0.05, intensity: 1.4, arcLength: TAU * 0.55, opacity: 0.8 });
    this.wristDot = makeGlow(0.5, PALETTE.ice, 2);
    this.wrist.add(this.wristRing, this.wristArc, this.wristDot);

    this.indexDot = makeGlow(0.022, PALETTE.ice, 2.2);
    this.thumbDot = makeGlow(0.016, PALETTE.ice, 1.8);

    this.pinchRing = makeRing({ radius: 1, width: 0.12, intensity: 1.9 });
    this.pinchProgress = makeRing({
      radius: 1.45,
      width: 0.22,
      color: PALETTE.gold,
      intensity: 2.4,
      arcStart: Math.PI / 2,
      arcLength: 0,
    });
    this.pinch.add(this.pinchRing, this.pinchProgress);

    this.fistGlow = makeGlow(0.12, PALETTE.red, 1.8, 0);
    this.reticle = makeRing({ radius: 1, width: 0.12, intensity: 1.8, dashes: 8, duty: 0.55 });
    this.pointer.add(this.reticle);

    this.group.add(this.palm, this.wrist, this.indexDot, this.thumbDot, this.pinch, this.fistGlow, this.pointer);
    this.group.visible = false;
  }

  update(dt: number, time: number, state: HandVisualState): void {
    const h = this.hand;
    this.presence += ((h.present ? 1 : 0) - this.presence) * damp(h.present ? 14 : 8, dt);
    this.group.visible = this.presence > 0.01;
    if (!this.group.visible) {
      this.initialized = false;
      return;
    }
    if (!h.present) {
      this.applyFades();
      return;
    }

    // Positions interpolate toward the 30 Hz tracker so 60 Hz rendering stays smooth.
    const k = this.initialized ? damp(32, dt) : 1;
    this.initialized = true;
    const scale = clamp(h.palmLengthM / 0.09, 0.75, 1.35);

    // Palm ring lies in the palm plane.
    this.palm.position.lerp(h.palm, k);
    this.x.copy(h.sideDir).addScaledVector(h.palmNormal, -h.sideDir.dot(h.palmNormal)).normalize();
    this.y.crossVectors(h.palmNormal, this.x);
    this.basis.makeBasis(this.x, this.y, h.palmNormal);
    this.q.setFromRotationMatrix(this.basis);
    this.palm.quaternion.slerp(this.q, k);
    this.palm.scale.setScalar(0.072 * scale);
    (this.palmArc.material as RingMaterial).arcStart = time * 1.6;
    (this.palmTicks.material as RingMaterial).arcStart = -time * 0.4;
    const nodeAngle = time * 0.9 + (h.side === 'Left' ? 0 : Math.PI);
    this.palmNode.position.set(Math.cos(nodeAngle), Math.sin(nodeAngle), 0);

    // Wrist bracelet: perpendicular to the forearm (approximated by the hand direction).
    this.wrist.position.lerp(h.points[LM.WRIST], k);
    this.q.setFromUnitVectors(Z, h.handDir);
    this.wrist.quaternion.slerp(this.q, k);
    this.wrist.scale.setScalar(0.04 * scale);
    (this.wristArc.material as RingMaterial).arcStart = -time * 1.1;

    this.indexDot.position.lerp(h.points[LM.INDEX_TIP], k);
    this.thumbDot.position.lerp(h.points[LM.THUMB_TIP], k);

    // Pinch reticle faces the camera.
    this.pinch.position.lerp(h.pinchPoint, k);
    this.pinch.scale.setScalar(0.016 * scale);
    this.pinchFade += ((h.pinching.value || state.holdProgress > 0 ? 1 : 0) - this.pinchFade) * damp(16, dt);
    this.holdFade += ((state.holdProgress > 0 || state.dragging ? 1 : 0) - this.holdFade) * damp(14, dt);
    const progress = state.dragging ? 1 : state.holdProgress;
    (this.pinchProgress.material as RingMaterial).arcLength = progress * TAU;
    (this.pinchRing.material as RingMaterial).setColor(state.dragging ? PALETTE.gold : PALETTE.cyan);

    this.tmp.copy(h.knuckles).lerp(h.palm, 0.3);
    this.fistGlow.position.lerp(this.tmp, k);
    const fistTarget = h.fist.value ? (state.grabbing ? 1 : 0.35) : 0;
    this.fistFade += (fistTarget - this.fistFade) * damp(12, dt);
    this.fistGlow.scale.setScalar(0.11 * scale * (0.9 + 0.1 * Math.sin(time * 10)));

    this.pointer.position.copy(this.indexDot.position);
    this.pointer.scale.setScalar(0.014 * scale);
    (this.reticle.material as RingMaterial).arcStart = time * 3;
    this.pointFade += ((h.pointing.value ? 1 : 0) - this.pointFade) * damp(14, dt);

    this.applyFades();
  }

  private applyFades(): void {
    const p = this.presence;
    const h = this.hand;
    const pinchBoost = h.pinching.value ? 1.6 : 1;
    (this.palmRing.material as RingMaterial).setOpacity(p * 0.95);
    (this.palmArc.material as RingMaterial).setOpacity(p * 0.8);
    (this.palmTicks.material as RingMaterial).setOpacity(p * 0.4);
    this.palmNode.material.opacity = p;
    (this.wristRing.material as RingMaterial).setOpacity(p * 0.9);
    (this.wristArc.material as RingMaterial).setOpacity(p * 0.6);
    this.wristDot.material.opacity = p;
    this.indexDot.material.opacity = p * Math.min(1, 0.7 * pinchBoost);
    this.thumbDot.material.opacity = p * Math.min(1, 0.6 * pinchBoost);
    (this.pinchRing.material as RingMaterial).setOpacity(p * this.pinchFade);
    (this.pinchProgress.material as RingMaterial).setOpacity(p * this.holdFade);
    this.fistGlow.material.opacity = p * this.fistFade;
    (this.reticle.material as RingMaterial).setOpacity(p * this.pointFade * 0.9);
  }
}
