import * as THREE from 'three';
import { easeOutCubic } from '../core/math';
import { PALETTE, getGlowTexture, makeGlow, makeRing, type RingMaterial } from './holoMaterials';

interface Effect {
  object: THREE.Object3D;
  age: number;
  life: number;
  delay: number;
  tick: (t: number, dt: number) => void;
  dispose: () => void;
}

/** Short-lived one-shot effects: shockwave rings, particle bursts and flashes. */
export class Fx {
  readonly group = new THREE.Group();
  private readonly effects: Effect[] = [];

  /** Expanding ring that faces the camera. */
  shockwave(pos: THREE.Vector3, color: THREE.Color, maxRadius: number, life = 0.8, delay = 0, width = 0.035): void {
    const ring = makeRing({ radius: 1, width, color, intensity: 1.8, glow: 0.8 });
    const mat = ring.material as RingMaterial;
    const base = ring.scale.x;
    ring.position.copy(pos);
    this.add(ring, life, delay, (t) => {
      const e = easeOutCubic(t);
      ring.scale.setScalar(base * (0.03 + e * maxRadius));
      mat.setOpacity((1 - t) * (1 - t));
    }, () => mat.dispose());
  }

  /** Ring that collapses inward (used when parts snap back together). */
  implode(pos: THREE.Vector3, color: THREE.Color, radius: number, life = 0.55): void {
    const ring = makeRing({ radius: 1, width: 0.025, color, intensity: 1.3, glow: 0.6 });
    const mat = ring.material as RingMaterial;
    const base = ring.scale.x;
    ring.position.copy(pos);
    this.add(ring, life, 0, (t) => {
      ring.scale.setScalar(base * radius * (1 - easeOutCubic(t)) + 0.001);
      mat.setOpacity(Math.sin(t * Math.PI));
    }, () => mat.dispose());
  }

  /** A burst of glowing sparks flying outward and slowing down. */
  burst(pos: THREE.Vector3, color: THREE.Color, count = 48, speed = 0.45, life = 0.9, size = 0.018): void {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3().randomDirection();
      const v = speed * (0.35 + Math.random() * 0.65);
      velocities.set([dir.x * v, dir.y * v, dir.z * v], i * 3);
      positions.set([pos.x, pos.y, pos.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size,
      map: getGlowTexture(),
      color: color.clone().multiplyScalar(2.2),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.add(points, life, 0, (t, dt) => {
      const drag = Math.exp(-3 * dt);
      for (let i = 0; i < count * 3; i++) {
        positions[i] += velocities[i] * dt;
        velocities[i] *= drag;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 1 - t;
    }, () => {
      geo.dispose();
      mat.dispose();
    });
  }

  flash(pos: THREE.Vector3, color: THREE.Color, size: number, life = 0.35, intensity = 1.6): void {
    const sprite = makeGlow(size, color, intensity);
    sprite.position.copy(pos);
    this.add(sprite, life, 0, (t) => {
      sprite.scale.setScalar(size * (0.6 + t * 0.8));
      sprite.material.opacity = 1 - t;
    }, () => sprite.material.dispose());
  }

  /** The big gold clap shockwave. */
  clap(pos: THREE.Vector3): void {
    this.flash(pos, PALETTE.gold, 0.16, 0.35, 1.2);
    this.shockwave(pos, PALETTE.gold, 0.8, 0.85, 0, 0.022);
    this.shockwave(pos, PALETTE.gold, 0.5, 0.75, 0.08, 0.016);
  }

  update(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      if (e.delay > 0) {
        e.delay -= dt;
        e.object.visible = false;
        continue;
      }
      e.object.visible = true;
      e.age += dt;
      const t = Math.min(1, e.age / e.life);
      e.tick(t, dt);
      if (t >= 1) {
        e.object.removeFromParent();
        e.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  private add(object: THREE.Object3D, life: number, delay: number, tick: Effect['tick'], dispose: () => void): void {
    object.visible = delay <= 0;
    this.group.add(object);
    this.effects.push({ object, age: 0, life, delay, tick, dispose });
    tick(0, 0);
  }
}
