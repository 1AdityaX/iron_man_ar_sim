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
const ringMat = (r: Ring) => r.material as RingMaterial;

/**
 * The targeting reticle that rides on each tracked hand, in the style of the films' workshop
 * HUD: a tick ring, a rotating three-segment arc, inner rings and a crosshair on the palm; a
 * segmented band on the wrist; fingertip glows; a pinch reticle with an amber hold-progress arc;
 * an orange glow on a grabbing fist; and a dashed reticle on a pointing finger.
 */
export class HandRig {
  readonly group = new THREE.Group();

  private readonly palm = new THREE.Group();
  private readonly palmTicks: Ring;
  private readonly palmSegments: Ring;
  private readonly palmInner: Ring;
  private readonly palmArc: Ring;
  private readonly palmCross: Ring;
  private readonly palmNode: THREE.Sprite;

  private readonly wrist = new THREE.Group();
  private readonly wristBand: Ring;
  private readonly wristInner: Ring;
  private readonly wristDot: THREE.Sprite;

  private readonly indexDot: THREE.Sprite;
  private readonly thumbDot: THREE.Sprite;

  private readonly pinch = new THREE.Group();
  private readonly pinchRing: Ring;
  private readonly pinchTicks: Ring;
  private readonly pinchProgress: Ring;

  private readonly fistGlow: THREE.Sprite;
  private readonly pointer = new THREE.Group();
  private readonly reticle: Ring;

  private presence = 0;
  private pinchFade = 0;
  private fistFade = 0;
  private pointFade = 0;
  private holdFade = 0;
  private heat = 0;
  private initialized = false;

  private readonly basis = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly x = new THREE.Vector3();
  private readonly y = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor(readonly hand: TrackedHand) {
    // Palm reticle, in units of the palm radius.
    this.palmTicks = makeRing({ radius: 1.2, width: 0.06, intensity: 1.0, dashes: 60, duty: 0.3, opacity: 0.5, glow: 0 });
    this.palmSegments = makeRing({ radius: 1, width: 0.075, intensity: 1.35, dashes: 3, duty: 0.7, glow: 0.55 });
    this.palmInner = makeRing({ radius: 0.76, width: 0.03, intensity: 1.0, glow: 0.3, opacity: 0.7 });
    this.palmArc = makeRing({ radius: 0.62, width: 0.055, intensity: 1.2, glow: 0.4, arcLength: TAU * 0.28 });
    this.palmCross = makeRing({ radius: 0.2, width: 0.07, intensity: 1.3, dashes: 4, duty: 0.45, glow: 0.3 });
    this.palmNode = makeGlow(0.24, PALETTE.ice, 1.6);
    this.palm.add(this.palmTicks, this.palmSegments, this.palmInner, this.palmArc, this.palmCross, this.palmNode);

    this.wristBand = makeRing({ radius: 1, width: 0.075, intensity: 1.2, dashes: 12, duty: 0.6, glow: 0.45 });
    this.wristInner = makeRing({ radius: 0.78, width: 0.035, intensity: 0.9, opacity: 0.7, glow: 0.2 });
    this.wristDot = makeGlow(0.45, PALETTE.ice, 1.5);
    this.wrist.add(this.wristBand, this.wristInner, this.wristDot);

    this.indexDot = makeGlow(0.02, PALETTE.ice, 1.6);
    this.thumbDot = makeGlow(0.015, PALETTE.ice, 1.4);

    this.pinchRing = makeRing({ radius: 1, width: 0.1, intensity: 1.4, glow: 0.6 });
    this.pinchTicks = makeRing({ radius: 1.35, width: 0.09, intensity: 1.1, dashes: 8, duty: 0.35, opacity: 0.8, glow: 0 });
    this.pinchProgress = makeRing({
      radius: 1.7,
      width: 0.18,
      color: PALETTE.amber,
      intensity: 1.7,
      glow: 0.7,
      arcStart: Math.PI / 2,
      arcLength: 0,
    });
    this.pinch.add(this.pinchRing, this.pinchTicks, this.pinchProgress);

    this.fistGlow = makeGlow(0.12, PALETTE.red, 1.8, 0);
    this.reticle = makeRing({ radius: 1, width: 0.12, intensity: 1.4, dashes: 8, duty: 0.55 });
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

    // Palm reticle lies in the palm plane.
    this.palm.position.lerp(h.palm, k);
    this.x.copy(h.sideDir).addScaledVector(h.palmNormal, -h.sideDir.dot(h.palmNormal)).normalize();
    this.y.crossVectors(h.palmNormal, this.x);
    this.basis.makeBasis(this.x, this.y, h.palmNormal);
    this.q.setFromRotationMatrix(this.basis);
    this.palm.quaternion.slerp(this.q, k);
    this.palm.scale.setScalar(0.05 * scale);
    ringMat(this.palmTicks).arcStart = -time * 0.25;
    ringMat(this.palmSegments).arcStart = time * 0.9;
    ringMat(this.palmArc).arcStart = -time * 1.7;
    ringMat(this.palmCross).arcStart = Math.PI / 4 - 0.2 + Math.sin(time * 1.3) * 0.12;
    const nodeAngle = time * 0.7 + (h.side === 'Left' ? 0 : Math.PI);
    this.palmNode.position.set(Math.cos(nodeAngle) * 1.2, Math.sin(nodeAngle) * 1.2, 0);

    // Grabbing or pinching heats the reticle from workshop blue to amber.
    const hot = state.grabbing || state.dragging || state.holdProgress > 0;
    this.heat += ((hot ? 1 : 0) - this.heat) * damp(10, dt);
    this.color.copy(PALETTE.cyan).lerp(PALETTE.amber, this.heat);
    ringMat(this.palmSegments).setColor(this.color);
    ringMat(this.palmCross).setColor(this.color);
    this.palmNode.material.color.copy(this.color).lerp(PALETTE.white, 0.4).multiplyScalar(1.6);

    // Wrist band: perpendicular to the forearm (approximated by the hand direction).
    this.wrist.position.lerp(h.points[LM.WRIST], k);
    this.q.setFromUnitVectors(Z, h.handDir);
    this.wrist.quaternion.slerp(this.q, k);
    this.wrist.scale.setScalar(0.036 * scale);
    ringMat(this.wristBand).arcStart = -time * 0.8;

    this.indexDot.position.lerp(h.points[LM.INDEX_TIP], k);
    this.thumbDot.position.lerp(h.points[LM.THUMB_TIP], k);

    // Pinch reticle faces the camera.
    this.pinch.position.lerp(h.pinchPoint, k);
    this.pinch.scale.setScalar(0.014 * scale);
    this.pinchFade += ((h.pinching.value || state.holdProgress > 0 ? 1 : 0) - this.pinchFade) * damp(16, dt);
    this.holdFade += ((state.holdProgress > 0 || state.dragging ? 1 : 0) - this.holdFade) * damp(14, dt);
    ringMat(this.pinchProgress).arcLength = (state.dragging ? 1 : state.holdProgress) * TAU;
    ringMat(this.pinchRing).setColor(state.dragging ? PALETTE.amber : PALETTE.cyan);
    ringMat(this.pinchTicks).arcStart = time * 2.2;

    this.tmp.copy(h.knuckles).lerp(h.palm, 0.3);
    this.fistGlow.position.lerp(this.tmp, k);
    const fistTarget = h.fist.value ? (state.grabbing ? 1 : 0.35) : 0;
    this.fistFade += (fistTarget - this.fistFade) * damp(12, dt);
    this.fistGlow.scale.setScalar(0.11 * scale * (0.9 + 0.1 * Math.sin(time * 10)));

    this.pointer.position.copy(this.indexDot.position);
    this.pointer.scale.setScalar(0.014 * scale);
    ringMat(this.reticle).arcStart = time * 3;
    this.pointFade += ((h.pointing.value ? 1 : 0) - this.pointFade) * damp(14, dt);

    this.applyFades();
  }

  private applyFades(): void {
    const p = this.presence;
    const pinchBoost = this.hand.pinching.value ? 1.6 : 1;
    ringMat(this.palmTicks).setOpacity(p * 0.5);
    ringMat(this.palmSegments).setOpacity(p * 0.95);
    ringMat(this.palmInner).setOpacity(p * 0.6);
    ringMat(this.palmArc).setOpacity(p * 0.8);
    ringMat(this.palmCross).setOpacity(p * 0.85);
    this.palmNode.material.opacity = p;
    ringMat(this.wristBand).setOpacity(p * 0.85);
    ringMat(this.wristInner).setOpacity(p * 0.55);
    this.wristDot.material.opacity = p;
    this.indexDot.material.opacity = p * Math.min(1, 0.7 * pinchBoost);
    this.thumbDot.material.opacity = p * Math.min(1, 0.6 * pinchBoost);
    ringMat(this.pinchRing).setOpacity(p * this.pinchFade);
    ringMat(this.pinchTicks).setOpacity(p * this.pinchFade * 0.8);
    ringMat(this.pinchProgress).setOpacity(p * this.holdFade);
    this.fistGlow.material.opacity = p * this.fistFade;
    ringMat(this.reticle).setOpacity(p * this.pointFade * 0.9);
  }
}
