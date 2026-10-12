import * as THREE from 'three';
import { TAU } from '../core/math';
import { PALETTE } from '../render/holoMaterials';
import { circle, edges, glassBox, polyline, radialArray, shell } from './builders';
import type { ObjectSpec, PartSpec } from './holoObject';

/**
 * Holo globe: a layered planet (core, mantle, crust grid, atmosphere) with an orbital ring and a
 * moon. The polar axis is local +Z; the rest pose tips it upright.
 */

const AXIS = new THREE.Vector3(-0.7, 0.45, -0.55).normalize();
const along = (d: number): THREE.Vector3Tuple => AXIS.clone().multiplyScalar(d).toArray();

const coreP: PartSpec = {
  id: 'core',
  name: 'INNER CORE',
  info: [
    ['TEMP', '5,400 K'],
    ['RADIUS', '1,220 km'],
  ],
  radius: 0.06,
  assembled: [0, 0, 0],
  exploded: along(-0.3),
  spin: 1,
  build(look) {
    const g = new THREE.Group();
    g.add(shell(look, new THREE.SphereGeometry(0.035, 24, 12), { color: PALETTE.ice, base: 0.9, rim: 1.2, opacity: 1 }));
    g.add(look.glow(0.2, PALETTE.cyan, 1.1, 0.7));
    return g;
  },
};

const mantle: PartSpec = {
  id: 'mantle',
  name: 'MANTLE',
  info: [
    ['DEPTH', '2,900 km'],
    ['STATE', 'SILICATE'],
  ],
  radius: 0.1,
  assembled: [0, 0, 0],
  exploded: along(-0.08),
  spin: -0.4,
  build(look) {
    const g = new THREE.Group();
    g.add(edges(look, new THREE.IcosahedronGeometry(0.095, 2), { intensity: 1.2, opacity: 0.55 }, 1));
    g.add(shell(look, new THREE.SphereGeometry(0.093, 24, 12), { base: 0.05, rim: 0.8, opacity: 0.6 }));
    return g;
  },
};

const crust: PartSpec = {
  id: 'crust',
  name: 'CRUST GRID',
  info: [
    ['PLATES', '15'],
    ['RES', '1 km'],
  ],
  radius: 0.17,
  assembled: [0, 0, 0],
  exploded: along(0.2),
  spin: 0.35,
  build(look) {
    const g = new THREE.Group();
    const r = 0.16;
    for (let i = 0; i < 12; i++) {
      // Meridians: great circles through the poles (local Z).
      const m = circle(look, r, 0, { opacity: 0.55, intensity: 1.3 }, 64);
      m.rotation.x = Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(m);
      holder.rotation.z = (i / 12) * Math.PI;
      g.add(holder);
    }
    for (let k = -3; k <= 3; k++) {
      const lat = (k / 4) * (Math.PI / 2);
      g.add(circle(look, r * Math.cos(lat), r * Math.sin(lat), { opacity: k === 0 ? 0.9 : 0.5, intensity: k === 0 ? 1.8 : 1.3 }));
    }
    g.add(shell(look, new THREE.SphereGeometry(r * 0.99, 32, 16), { base: 0.03, rim: 0.7, opacity: 0.5 }));
    // A few "city lights".
    for (let i = 0; i < 14; i++) {
      const p = new THREE.Vector3().randomDirection().multiplyScalar(r);
      const s = look.glow(0.012, PALETTE.amber, 1.6, 0.9);
      s.position.copy(p);
      g.add(s);
    }
    return g;
  },
};

const atmosphere: PartSpec = {
  id: 'atmosphere',
  name: 'ATMOSPHERE',
  info: [
    ['HEIGHT', '100 km'],
    ['O2', '21%'],
  ],
  radius: 0.19,
  assembled: [0, 0, 0],
  exploded: along(0.42),
  build(look) {
    const g = new THREE.Group();
    g.add(shell(look, new THREE.SphereGeometry(0.185, 40, 20), { color: PALETTE.blue, base: 0.0, rim: 1.6, rimPower: 3, opacity: 0.9 }));
    return g;
  },
};

const orbit: PartSpec = {
  id: 'orbit',
  name: 'ORBITAL RING',
  info: [
    ['SATELLITES', '3'],
    ['ALT', '35,786 km'],
  ],
  radius: 0.27,
  assembled: [0, 0, 0],
  exploded: along(-0.48),
  spin: 0.6,
  build(look) {
    const g = new THREE.Group();
    g.add(circle(look, 0.25, 0, { intensity: 1.5, opacity: 0.8 }, 96));
    g.add(circle(look, 0.262, 0, { opacity: 0.35 }, 96));
    g.add(
      radialArray(3, (a) => {
        const sat = new THREE.Group();
        sat.add(glassBox(look, 0.018, 0.018, 0.018, { base: 0.2 }));
        sat.add(glassBox(look, 0.05, 0.003, 0.014, { base: 0.25, intensity: 1.4 }));
        sat.position.set(Math.cos(a) * 0.25, Math.sin(a) * 0.25, 0);
        sat.rotation.z = a;
        return sat;
      }),
    );
    return g;
  },
};

const moon: PartSpec = {
  id: 'moon',
  name: 'MOON',
  info: [
    ['DIST', '384,400 km'],
    ['PERIOD', '27.3 d'],
  ],
  radius: 0.05,
  assembled: [0.3, 0.08, 0.05],
  exploded: along(0.66),
  spin: 0.2,
  build(look) {
    const g = new THREE.Group();
    g.add(edges(look, new THREE.IcosahedronGeometry(0.032, 1), { intensity: 1.3, opacity: 0.7 }, 1));
    g.add(shell(look, new THREE.SphereGeometry(0.03, 20, 10), { base: 0.12, rim: 1 }));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * TAU * 0.3 - 0.3;
      pts.push(new THREE.Vector3(Math.cos(a) * 0.05 - 0.05, Math.sin(a) * 0.05, 0));
    }
    g.add(polyline(look, pts, { opacity: 0.4 }));
    return g;
  },
};

export const GLOBE: ObjectSpec = {
  kind: 'globe',
  title: 'HOLO GLOBE',
  shortName: 'HOLO GLOBE',
  menuTitle: 'GLOBE OPS',
  radius: 0.3,
  parts: [orbit, coreP, mantle, crust, atmosphere, moon],
  restRotation: new THREE.Euler(-1.2, 0, 0.35),
  explodedTilt: new THREE.Euler(0.3, 0.3, 0),
};
