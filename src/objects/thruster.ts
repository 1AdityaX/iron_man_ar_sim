import * as THREE from 'three';
import { TAU } from '../core/math';
import { PALETTE } from '../render/holoMaterials';
import { band, circle, edges, glassBox, radialArray, segments, shell } from './builders';
import type { ObjectSpec, PartSpec } from './holoObject';

/**
 * Repulsor boot thruster: a miniature turbofan. The engine axis is local +Z (intake at the
 * front); it explodes along that axis like a classic engine teardown drawing.
 */

/** A disc of blades: `count` thin pitched blades between two radii. */
function bladeDisc(look: Parameters<PartSpec['build']>[0], inner: number, outer: number, count: number, pitch: number) {
  const g = new THREE.Group();
  g.add(circle(look, outer, 0, { intensity: 1.5, opacity: 0.7 }));
  g.add(circle(look, inner, 0, { intensity: 1.5 }));
  g.add(
    radialArray(count, (a) => {
      const blade = new THREE.Group();
      const len = outer - inner;
      const geo = new THREE.BoxGeometry(0.004, len, 0.018);
      blade.add(shell(look, geo, { base: 0.07, rim: 0.6, opacity: 0.5 }));
      blade.add(edges(look, geo, { intensity: 1.3, opacity: 0.6 }));
      blade.rotation.y = pitch;
      const holder = new THREE.Group();
      blade.position.y = inner + len / 2;
      holder.add(blade);
      holder.rotation.z = a;
      return holder;
    }),
  );
  return g;
}

const nose: PartSpec = {
  id: 'nose',
  name: 'NOSE CONE',
  info: [
    ['MATERIAL', 'CFRP'],
    ['MASS', '0.4 kg'],
  ],
  radius: 0.06,
  assembled: [0, 0, 0.205],
  exploded: [0, 0, 0.62],
  spin: 5,
  build(look) {
    const g = new THREE.Group();
    const geo = new THREE.ConeGeometry(0.045, 0.075, 24, 1, true);
    geo.rotateX(Math.PI / 2);
    g.add(shell(look, geo, { base: 0.12, rim: 1.2 }));
    g.add(edges(look, new THREE.ConeGeometry(0.045, 0.075, 8, 1, true).rotateX(Math.PI / 2), { opacity: 0.6 }));
    return g;
  },
};

const fan: PartSpec = {
  id: 'fan',
  name: 'INTAKE FAN',
  info: [
    ['BLADES', '16'],
    ['RPM', '42,000'],
  ],
  radius: 0.14,
  assembled: [0, 0, 0.16],
  exploded: [0, 0, 0.44],
  spin: 4,
  build(look) {
    const g = bladeDisc(look, 0.045, 0.128, 16, 0.55);
    g.add(shell(look, new THREE.CylinderGeometry(0.045, 0.045, 0.03, 24, 1, true).rotateX(Math.PI / 2), { base: 0.1 }));
    return g;
  },
};

const compressor: PartSpec = {
  id: 'compressor',
  name: 'COMPRESSOR',
  info: [
    ['STAGES', '3'],
    ['RATIO', '12:1'],
  ],
  radius: 0.11,
  assembled: [0, 0, 0.075],
  exploded: [0, 0, 0.24],
  spin: 3,
  build(look) {
    const g = new THREE.Group();
    [0.105, 0.095, 0.085].forEach((r, i) => {
      const disc = bladeDisc(look, 0.04, r, 22, 0.45);
      disc.position.z = 0.03 - i * 0.03;
      g.add(disc);
    });
    g.add(band(look, 0.04, 0.075, 0, { base: 0.08 }));
    return g;
  },
};

const combustor: PartSpec = {
  id: 'combustor',
  name: 'COMBUSTOR',
  info: [
    ['INJECTORS', '12'],
    ['TEMP', '1,850 K'],
  ],
  radius: 0.12,
  assembled: [0, 0, -0.02],
  exploded: [0, 0, 0.04],
  build(look) {
    const g = new THREE.Group();
    g.add(shell(look, new THREE.TorusGeometry(0.085, 0.026, 12, 48), { base: 0.06, rim: 1.1 }));
    g.add(circle(look, 0.111, 0, { opacity: 0.8 }));
    g.add(circle(look, 0.059, 0, { opacity: 0.8 }));
    g.add(
      radialArray(12, (a) => {
        const s = look.glow(0.03, PALETTE.gold, 1.8, 0.9);
        s.position.set(Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0.028);
        return s;
      }),
    );
    return g;
  },
};

const turbine: PartSpec = {
  id: 'turbine',
  name: 'TURBINE',
  info: [
    ['STAGES', '2'],
    ['TIP SPEED', '480 m/s'],
  ],
  radius: 0.11,
  assembled: [0, 0, -0.085],
  exploded: [0, 0, -0.16],
  spin: -3.5,
  build(look) {
    const g = new THREE.Group();
    [0, -0.032].forEach((z) => {
      const disc = bladeDisc(look, 0.035, 0.095, 26, -0.5);
      disc.position.z = z;
      g.add(disc);
    });
    return g;
  },
};

const nozzle: PartSpec = {
  id: 'nozzle',
  name: 'EXHAUST NOZZLE',
  info: [
    ['THRUST', '3.2 kN'],
    ['TYPE', 'C-D'],
  ],
  radius: 0.12,
  assembled: [0, 0, -0.17],
  exploded: [0, 0, -0.36],
  build(look) {
    const g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.1, 0.075, 0.09, 40, 1, true);
    geo.rotateX(Math.PI / 2);
    g.add(shell(look, geo, { base: 0.07, rim: 1.1 }));
    g.add(circle(look, 0.1, 0.045, { intensity: 1.8 }));
    g.add(circle(look, 0.075, -0.045, { intensity: 1.8 }));
    const petals: THREE.Vector3[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      petals.push(new THREE.Vector3(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0.045), new THREE.Vector3(Math.cos(a) * 0.075, Math.sin(a) * 0.075, -0.045));
    }
    g.add(segments(look, petals, { opacity: 0.6 }));
    // Exhaust plume.
    const plume = new THREE.ConeGeometry(0.06, 0.16, 24, 1, true);
    plume.rotateX(Math.PI / 2);
    plume.translate(0, 0, -0.125);
    g.add(shell(look, plume, { color: PALETTE.blue, base: 0.25, rim: 0.6, opacity: 0.6 }));
    const flame = look.glow(0.14, PALETTE.ice, 1.4, 0.8);
    flame.position.z = -0.07;
    g.add(flame);
    return g;
  },
};

const nacelle: PartSpec = {
  id: 'nacelle',
  name: 'NACELLE',
  info: [
    ['LENGTH', '340 mm'],
    ['COATING', 'YSZ'],
  ],
  radius: 0.2,
  assembled: [0, 0, 0],
  exploded: [0, 0.3, 0.02],
  build(look) {
    const g = new THREE.Group();
    // Lathe profile: rounded intake lip, bulging mid-body, tapering tail.
    const profile = [
      [0.128, 0.215],
      [0.145, 0.2],
      [0.15, 0.12],
      [0.148, 0.02],
      [0.138, -0.07],
      [0.115, -0.14],
    ].map(([r, z]) => new THREE.Vector2(r, z));
    const geo = new THREE.LatheGeometry(profile, 56);
    geo.rotateX(Math.PI / 2);
    g.add(shell(look, geo, { base: 0.03, rim: 0.85, opacity: 0.6 }));
    for (const [r, z] of [
      [0.128, 0.215],
      [0.15, 0.08],
      [0.115, -0.14],
    ]) {
      g.add(circle(look, r, z, { intensity: 1.6, opacity: 0.8 }));
    }
    const ribs: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      for (let k = 0; k < profile.length - 1; k++) {
        const [p, q] = [profile[k], profile[k + 1]];
        ribs.push(new THREE.Vector3(Math.cos(a) * p.x, Math.sin(a) * p.x, p.y), new THREE.Vector3(Math.cos(a) * q.x, Math.sin(a) * q.x, q.y));
      }
    }
    g.add(segments(look, ribs, { opacity: 0.35, intensity: 1.2 }));
    const mount = glassBox(look, 0.05, 0.03, 0.12, { base: 0.08 });
    mount.position.set(0, 0.165, 0.02);
    g.add(mount);
    return g;
  },
};

export const THRUSTER: ObjectSpec = {
  kind: 'thruster',
  title: 'BOOT THRUSTER MK-II',
  shortName: 'THRUSTER',
  menuTitle: 'THRUSTER CONTROL',
  radius: 0.26,
  parts: [nacelle, nose, fan, compressor, combustor, turbine, nozzle],
  restRotation: new THREE.Euler(0.25, -1.15, 0),
  explodedTilt: new THREE.Euler(0, 0.5, 0),
};
