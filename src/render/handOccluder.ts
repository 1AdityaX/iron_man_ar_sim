import * as THREE from 'three';
import { HAND_BONES, LANDMARK_RADIUS, NUM_LANDMARKS } from '../tracking/landmarks';
import type { TrackedHand } from '../tracking/trackedHand';

const PALM_RING = [0, 1, 5, 9, 13, 17];
const UP = new THREE.Vector3(0, 1, 0);

/**
 * An invisible, depth-only proxy of a tracked hand (capsules along the bones plus the palm
 * polygon), drawn before the holograms so anything behind your real hand is hidden by it.
 */
export class HandOccluder {
  readonly group = new THREE.Group();
  private readonly joints: THREE.InstancedMesh;
  private readonly bones: THREE.InstancedMesh;
  private readonly palm: THREE.Mesh;
  private readonly palmPositions: Float32Array;
  private readonly depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  private readonly debug = new THREE.MeshBasicMaterial({
    color: 0xff40c0,
    wireframe: true,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(private readonly hand: TrackedHand) {
    this.joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), this.depthOnly, NUM_LANDMARKS);
    this.bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), this.depthOnly, HAND_BONES.length);
    this.palmPositions = new Float32Array((PALM_RING.length + 1) * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.palmPositions, 3));
    const index: number[] = [];
    for (let i = 0; i < PALM_RING.length; i++) index.push(PALM_RING.length, i, (i + 1) % PALM_RING.length);
    geo.setIndex(index);
    this.palm = new THREE.Mesh(geo, this.depthOnly);
    for (const mesh of [this.joints, this.bones, this.palm]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = -10;
    }
    this.group.add(this.joints, this.bones, this.palm);
    this.group.visible = false;
  }

  setDebug(on: boolean): void {
    const mat = on ? this.debug : this.depthOnly;
    this.joints.material = mat;
    this.bones.material = mat;
    this.palm.material = mat;
  }

  update(enabled: boolean): void {
    const h = this.hand;
    this.group.visible = enabled && h.present;
    if (!this.group.visible) return;
    const pts = h.points;
    const scale = h.palmLengthM > 0 ? Math.min(1.4, Math.max(0.7, h.palmLengthM / 0.09)) : 1;

    for (let i = 0; i < NUM_LANDMARKS; i++) {
      this.s.setScalar(LANDMARK_RADIUS[i] * scale);
      this.m.compose(pts[i], this.q.identity(), this.s);
      this.joints.setMatrixAt(i, this.m);
    }
    this.joints.instanceMatrix.needsUpdate = true;

    HAND_BONES.forEach(([a, b], i) => {
      this.mid.addVectors(pts[a], pts[b]).multiplyScalar(0.5);
      this.dir.subVectors(pts[b], pts[a]);
      const len = this.dir.length();
      if (len > 1e-6) this.q.setFromUnitVectors(UP, this.dir.divideScalar(len));
      const r = ((LANDMARK_RADIUS[a] + LANDMARK_RADIUS[b]) / 2) * scale;
      this.s.set(r, len, r);
      this.m.compose(this.mid, this.q, this.s);
      this.bones.setMatrixAt(i, this.m);
    });
    this.bones.instanceMatrix.needsUpdate = true;

    let cx = 0;
    let cy = 0;
    let cz = 0;
    PALM_RING.forEach((idx, i) => {
      const p = pts[idx];
      this.palmPositions.set([p.x, p.y, p.z], i * 3);
      cx += p.x / PALM_RING.length;
      cy += p.y / PALM_RING.length;
      cz += p.z / PALM_RING.length;
    });
    this.palmPositions.set([cx, cy, cz], PALM_RING.length * 3);
    this.palm.geometry.attributes.position.needsUpdate = true;
  }
}
