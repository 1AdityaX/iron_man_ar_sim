import * as THREE from 'three';
import { TAU } from '../core/math';
import { PALETTE } from '../render/holoMaterials';
import { arc, band, circle, edges, glassBox, polyline, radialArray, segments, shell, ticks } from './builders';
import type { ObjectSpec, PartSpec } from './holoObject';

/**
 * Arc Reactor MK-III: a palladium core inside containment rings and a toroidal coil array,
 * wrapped in a clamped casing with a focus plate in front. Local units are metres at 1x scale;
 * the reactor's axis is local +Z (front faces the viewer).
 */

const R = 0.24;
/** Explode axis (object-local): back parts fan up-left and away, front parts down-right. */
const AXIS = new THREE.Vector3(-0.72, 0.44, -0.54).normalize();
const along = (d: number): THREE.Vector3Tuple => AXIS.clone().multiplyScalar(d).toArray();

const conduits: PartSpec = {
  id: 'conduits',
  name: 'POWER CONDUITS',
  info: [
    ['GAUGE', '4 AWG'],
    ['CURRENT', '1.2 kA'],
  ],
  radius: 0.26,
  assembled: [0, 0, 0],
  exploded: along(0.6),
  spin: -0.05,
  build(look) {
    const g = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const a0 = ((i + 0.5) / 8) * TAU;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const r = R * 0.78 + t * 0.1;
        const a = a0 + Math.sin(t * Math.PI * 2 + i) * 0.16;
        pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, -0.03 - t * 0.075 + Math.sin(t * 9 + i) * 0.008));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      g.add(shell(look, new THREE.TubeGeometry(curve, 40, 0.0055, 6, false), { base: 0.3, rim: 1.3, opacity: 0.9 }));
      const end = pts[pts.length - 1];
      const spark = look.glow(0.03, PALETTE.cyan, 1.8, 0.9);
      spark.position.copy(end);
      g.add(spark);
    }
    return g;
  },
};

const casing: PartSpec = {
  id: 'casing',
  name: 'OUTER CASING',
  info: [
    ['DIAMETER', '76 mm'],
    ['SEAL', 'IP68'],
  ],
  radius: 0.27,
  assembled: [0, 0, 0],
  exploded: along(0.41),
  build(look) {
    const depth = 0.07;
    const g = new THREE.Group();
    g.add(band(look, R, depth, 0, { base: 0.05, rim: 0.95, opacity: 0.7 }));
    const lip = new THREE.RingGeometry(R * 0.86, R, 72, 1);
    lip.translate(0, 0, depth / 2);
    g.add(shell(look, lip, { base: 0.14, rim: 0.3, opacity: 0.5 }));
    g.add(circle(look, R * 0.86, depth / 2, { opacity: 0.65 }));
    const back = new THREE.CircleGeometry(R * 0.99, 72);
    back.translate(0, 0, -depth / 2);
    g.add(shell(look, back, { base: 0.03, rim: 0, opacity: 0.6 }));
    g.add(circle(look, R * 0.42, -depth / 2, { opacity: 0.45 }));
    g.add(ticks(look, R * 0.45, R * 0.82, 20, { z: -depth / 2, opacity: 0.35, intensity: 1.2 }));
    // Ten clamp blocks around the rim give the casing its crown silhouette.
    g.add(
      radialArray(10, (a) => {
        const clamp = glassBox(look, 0.07, 0.03, depth * 1.3, { base: 0.08 });
        clamp.position.set(Math.cos(a) * (R + 0.013), Math.sin(a) * (R + 0.013), 0.006);
        clamp.rotation.z = a + Math.PI / 2;
        return clamp;
      }),
    );
    return g;
  },
};

const rings: PartSpec = {
  id: 'rings',
  name: 'CONTAINMENT RINGS',
  info: [
    ['FIELD', '4.2 T'],
    ['ALLOY', 'Nb3Sn'],
  ],
  radius: 0.2,
  assembled: [0, 0, -0.012],
  exploded: along(0.21),
  spin: 0.35,
  build(look) {
    const g = new THREE.Group();
    [0.19, 0.155, 0.12].forEach((r, i) => {
      g.add(band(look, r, 0.012, -i * 0.017, { base: 0.1, rim: 1.0, opacity: 0.8 }));
    });
    // Struts tying the rings together.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      pts.push(new THREE.Vector3(Math.cos(a) * 0.19, Math.sin(a) * 0.19, 0), new THREE.Vector3(Math.cos(a) * 0.12, Math.sin(a) * 0.12, -0.034));
    }
    g.add(segments(look, pts, { opacity: 0.6 }));
    return g;
  },
};

const core: PartSpec = {
  id: 'core',
  name: 'PALLADIUM CORE',
  info: [
    ['OUTPUT', '3 GJ/s'],
    ['TEMP', '2100 K'],
  ],
  radius: 0.09,
  assembled: [0, 0, 0],
  exploded: along(0.0),
  spin: 0.9,
  build(look) {
    const g = new THREE.Group();
    g.add(shell(look, new THREE.SphereGeometry(0.05, 32, 16), { color: PALETTE.ice, base: 0.9, rim: 1.2, opacity: 1 }));
    g.add(edges(look, new THREE.IcosahedronGeometry(0.075, 1), { color: PALETTE.ice, intensity: 1.2, opacity: 0.45 }, 1));
    const orbit = circle(look, 0.09, 0, { intensity: 1.5, opacity: 0.7 });
    orbit.rotation.x = 1.1;
    g.add(orbit);
    const orbit2 = circle(look, 0.1, 0, { intensity: 1.2, opacity: 0.5 });
    orbit2.rotation.y = 1.2;
    g.add(orbit2);
    g.add(look.glow(0.34, PALETTE.cyan, 0.9, 0.55));
    g.add(look.glow(0.13, PALETTE.white, 1.8, 1));
    return g;
  },
};

const coils: PartSpec = {
  id: 'coils',
  name: 'TOROIDAL COIL ARRAY',
  info: [
    ['WINDINGS', '10 × 42'],
    ['LOSS', '0.02 mΩ'],
  ],
  radius: 0.2,
  assembled: [0, 0, 0.018],
  exploded: along(-0.21),
  spin: 0.25,
  build(look) {
    const rc = 0.165;
    const g = new THREE.Group();
    g.add(circle(look, rc, 0, { intensity: 1.3, opacity: 0.8 }));
    g.add(shell(look, new THREE.TorusGeometry(rc, 0.0035, 6, 96), { base: 0.25, rim: 1, opacity: 0.8 }));
    g.add(
      radialArray(10, (a) => {
        const block = new THREE.Group();
        block.add(glassBox(look, 0.056, 0.036, 0.036, { base: 0.16, intensity: 2.1 }));
        // Copper windings: loops around the block's long axis.
        for (let k = -1.5; k <= 1.5; k++) {
          const x = k * 0.011;
          const h = 0.021;
          block.add(
            polyline(
              look,
              [
                new THREE.Vector3(x, -h, -h),
                new THREE.Vector3(x, h, -h),
                new THREE.Vector3(x, h, h),
                new THREE.Vector3(x, -h, h),
                new THREE.Vector3(x, -h, -h),
              ],
              { intensity: 1.4, opacity: 0.7 },
            ),
          );
        }
        block.position.set(Math.cos(a) * rc, Math.sin(a) * rc, 0);
        block.rotation.z = a + Math.PI / 2;
        return block;
      }),
    );
    return g;
  },
};

const plate: PartSpec = {
  id: 'plate',
  name: 'FOCUS PLATE',
  info: [
    ['TICKS', '60'],
    ['ALLOY', 'Ti-6Al-4V'],
  ],
  radius: 0.22,
  assembled: [0, 0, 0.042],
  exploded: along(-0.41),
  spin: -0.12,
  build(look) {
    const g = new THREE.Group();
    g.add(shell(look, new THREE.RingGeometry(0.08, 0.205, 96, 1), { base: 0.07, rim: 0.25, opacity: 0.55 }));
    g.add(circle(look, 0.205, 0, { intensity: 1.9 }));
    g.add(circle(look, 0.185, 0, { opacity: 0.6 }));
    g.add(circle(look, 0.08, 0, { intensity: 1.6 }));
    g.add(circle(look, 0.035, 0, { opacity: 0.6 }));
    g.add(ticks(look, 0.188, 0.2, 60, { longEvery: 5, longInner: 0.17, intensity: 1.7 }));
    g.add(arc(look, 0.13, 0.2, 1.6, 0, { opacity: 0.6 }));
    g.add(arc(look, 0.13, 2.3, 1.6, 0, { opacity: 0.6 }));
    g.add(arc(look, 0.13, 4.4, 1.4, 0, { opacity: 0.6 }));
    // Dial "hands".
    const hands: THREE.Vector3[] = [];
    for (const [a, r1] of [
      [1.7, 0.165],
      [3.9, 0.15],
      [5.9, 0.16],
    ] as const) {
      hands.push(new THREE.Vector3(Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0), new THREE.Vector3(Math.cos(a) * r1, Math.sin(a) * r1, 0));
    }
    g.add(segments(look, hands, { intensity: 2 }));
    return g;
  },
};

export const ARC_REACTOR: ObjectSpec = {
  kind: 'arc-reactor',
  title: 'ARC REACTOR MK-III',
  shortName: 'ARC REACTOR',
  menuTitle: 'REACTOR CONTROL',
  radius: 0.28,
  parts: [conduits, casing, rings, core, coils, plate],
  restRotation: new THREE.Euler(0.28, -0.38, 0),
  explodedTilt: new THREE.Euler(-0.55, 0.45, 0.1),
};
