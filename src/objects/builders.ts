import * as THREE from 'three';
import { TAU } from '../core/math';
import type { HoloLook, SurfaceOptions } from '../render/holoMaterials';

/** Small helpers for building line-and-glass holograms out of three.js primitives. */

export interface LineStyle {
  color?: THREE.Color;
  intensity?: number;
  opacity?: number;
}

export function circlePoints(radius: number, segments = 72, z = 0, start = 0, length = TAU): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const closed = length >= TAU - 1e-6;
  const n = closed ? segments : segments + 1;
  for (let i = 0; i < n; i++) {
    const a = start + (i / segments) * length;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, z));
  }
  return pts;
}

export function circle(look: HoloLook, radius: number, z = 0, style: LineStyle = {}, segments = 72): THREE.LineLoop {
  const geo = new THREE.BufferGeometry().setFromPoints(circlePoints(radius, segments, z));
  return new THREE.LineLoop(geo, look.line(style.color, style.intensity, style.opacity));
}

export function arc(look: HoloLook, radius: number, start: number, length: number, z = 0, style: LineStyle = {}): THREE.Line {
  const segs = Math.max(8, Math.round((length / TAU) * 72));
  const geo = new THREE.BufferGeometry().setFromPoints(circlePoints(radius, segs, z, start, length));
  return new THREE.Line(geo, look.line(style.color, style.intensity, style.opacity));
}

export function polyline(look: HoloLook, points: THREE.Vector3[], style: LineStyle = {}): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geo, look.line(style.color, style.intensity, style.opacity));
}

/** Pairs of points drawn as independent segments. */
export function segments(look: HoloLook, points: THREE.Vector3[], style: LineStyle = {}): THREE.LineSegments {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.LineSegments(geo, look.line(style.color, style.intensity, style.opacity));
}

export function edges(look: HoloLook, geometry: THREE.BufferGeometry, style: LineStyle = {}, thresholdDeg = 25): THREE.LineSegments {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, thresholdDeg),
    look.line(style.color, style.intensity ?? 1.8, style.opacity),
  );
}

export function shell(look: HoloLook, geometry: THREE.BufferGeometry, opts: SurfaceOptions = {}): THREE.Mesh {
  return new THREE.Mesh(geometry, look.surface(opts));
}

/** Radial tick marks between two radii; every `longEvery`-th tick starts at `longInner`. */
export function ticks(
  look: HoloLook,
  inner: number,
  outer: number,
  count: number,
  opts: { longEvery?: number; longInner?: number; z?: number } & LineStyle = {},
): THREE.LineSegments {
  const pts: THREE.Vector3[] = [];
  const z = opts.z ?? 0;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    const r0 = opts.longEvery && i % opts.longEvery === 0 ? (opts.longInner ?? inner) : inner;
    pts.push(
      new THREE.Vector3(Math.cos(a) * r0, Math.sin(a) * r0, z),
      new THREE.Vector3(Math.cos(a) * outer, Math.sin(a) * outer, z),
    );
  }
  return segments(look, pts, opts);
}

/** A box rendered as faint glass plus bright edges. */
export function glassBox(look: HoloLook, w: number, h: number, d: number, opts: SurfaceOptions & LineStyle = {}): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  g.add(shell(look, geo, { base: opts.base ?? 0.1, rim: opts.rim ?? 0.9, opacity: 0.7, color: opts.color }));
  g.add(edges(look, geo, { color: opts.color, intensity: opts.intensity ?? 1.9, opacity: 0.95 }));
  return g;
}

/** Open cylinder band around the Z axis with bright rims. */
export function band(
  look: HoloLook,
  radius: number,
  height: number,
  z = 0,
  opts: SurfaceOptions & LineStyle & { segments?: number } = {},
): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(radius, radius, height, opts.segments ?? 72, 1, true);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, z);
  g.add(shell(look, geo, { base: opts.base ?? 0.06, rim: opts.rim ?? 1.0, opacity: opts.opacity ?? 0.75, color: opts.color }));
  const style = { color: opts.color, intensity: opts.intensity ?? 1.7 };
  g.add(circle(look, radius, z + height / 2, style));
  g.add(circle(look, radius, z - height / 2, { ...style, opacity: 0.55 }));
  return g;
}

/** Builds `count` copies around the Z axis; `make` receives each copy's angle and index. */
export function radialArray(count: number, make: (angle: number, i: number) => THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) g.add(make((i / count) * TAU, i));
  return g;
}


/**
 * A holotable projector pad: concentric rings and ticks lying flat, with faint light columns
 * rising toward the hologram. Built in the XY plane; the caller tips it horizontal.
 */
export function pedestal(look: HoloLook, radius: number): { group: THREE.Group; spinner: THREE.Group } {
  const group = new THREE.Group();
  const spinner = new THREE.Group();
  group.add(circle(look, radius, 0, { intensity: 1.4, opacity: 0.85 }, 96));
  group.add(ticks(look, radius * 1.04, radius * 1.12, 72, { longEvery: 6, longInner: radius * 0.98, intensity: 1.1, opacity: 0.6 }));
  group.add(circle(look, radius * 1.18, 0, { intensity: 0.9, opacity: 0.35 }, 96));
  spinner.add(arc(look, radius * 0.72, 0, 1.4, 0, { intensity: 1.3, opacity: 0.8 }));
  spinner.add(arc(look, radius * 0.72, Math.PI, 1.4, 0, { intensity: 1.3, opacity: 0.8 }));
  spinner.add(circle(look, radius * 0.45, 0, { intensity: 1, opacity: 0.45 }, 48));
  group.add(spinner);

  // Light columns: bright at the pad, fading out as they rise (+Z here, up once tipped).
  const positions: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    positions.push(x, y, 0, x * 0.9, y * 0.9, radius * 0.9);
    colors.push(1, 1, 1, 0, 0, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const beams = look.line(undefined, 1.2, 0.35);
  beams.vertexColors = true;
  group.add(new THREE.LineSegments(geo, beams));
  return { group, spinner };
}
