import * as THREE from 'three';

/** Linear-space palette. Intensities above 1 are fine: the pipeline is HDR and feeds bloom. */
export const PALETTE = {
  cyan: new THREE.Color('#58d3ff'),
  ice: new THREE.Color('#c9f4ff'),
  blue: new THREE.Color('#2b86ff'),
  gold: new THREE.Color('#ffbf3c'),
  red: new THREE.Color('#ff2f55'),
  white: new THREE.Color('#ffffff'),
};

/** Uniforms shared by every hologram material so one write animates them all. */
export const sharedUniforms = {
  uTime: { value: 0 },
};

const surfaceVertex = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const surfaceFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uTint;
  uniform float uTintAmt;
  uniform float uOpacity;
  uniform float uBase;
  uniform float uRim;
  uniform float uRimPow;
  uniform float uBoost;
  uniform float uTime;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    vec3 n = normalize(vNormalV);
    vec3 v = normalize(vViewDir);
    float rim = pow(1.0 - abs(dot(n, v)), uRimPow);
    float scan = 0.86 + 0.14 * sin(gl_FragCoord.y * 1.35 - uTime * 9.0);
    float flicker = 0.97 + 0.03 * sin(uTime * 41.0 + gl_FragCoord.x * 0.013);
    vec3 col = mix(uColor, uTint, uTintAmt);
    float intensity = (uBase + rim * uRim) * scan * flicker * uBoost;
    gl_FragColor = vec4(col * intensity, uOpacity);
  }
`;

export interface SurfaceOptions {
  color?: THREE.Color;
  opacity?: number;
  /** Flat emission independent of view angle. */
  base?: number;
  /** Fresnel edge glow strength. */
  rim?: number;
  rimPower?: number;
}

/** Additive fresnel "hologram glass" with scanlines and a subtle flicker. */
export class HoloSurfaceMaterial extends THREE.ShaderMaterial {
  readonly baseOpacity: number;

  constructor(opts: SurfaceOptions = {}) {
    const opacity = opts.opacity ?? 0.85;
    super({
      uniforms: {
        uColor: { value: (opts.color ?? PALETTE.cyan).clone() },
        uTint: { value: PALETTE.gold.clone() },
        uTintAmt: { value: 0 },
        uOpacity: { value: opacity },
        uBase: { value: opts.base ?? 0.08 },
        uRim: { value: opts.rim ?? 1.1 },
        uRimPow: { value: opts.rimPower ?? 2.2 },
        uBoost: { value: 1 },
        uTime: sharedUniforms.uTime,
      },
      vertexShader: surfaceVertex,
      fragmentShader: surfaceFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.baseOpacity = opacity;
  }
}

const ringVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ringFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uIntensity;
  uniform float uInner;
  uniform float uOuter;
  uniform float uArcStart;
  uniform float uArcLen;
  uniform float uDashes;
  uniform float uDuty;
  uniform float uGlow;
  varying vec2 vP;
  const float TAU = 6.28318530718;
  void main() {
    float r = length(vP);
    float aa = max(fwidth(r), 1e-4) * 1.2;
    float band = smoothstep(uInner - aa, uInner + aa, r) * (1.0 - smoothstep(uOuter - aa, uOuter + aa, r));
    float halfW = 0.5 * (uOuter - uInner);
    float d = max(abs(r - 0.5 * (uInner + uOuter)) - halfW, 0.0);
    float glow = uGlow * exp(-d * 22.0) * 0.55 * smoothstep(1.0, 0.92, r);
    float rel = mod(atan(vP.y, vP.x) - uArcStart, TAU);
    float arc = 1.0;
    if (uArcLen < TAU - 0.001) {
      arc = smoothstep(0.0, 0.025, rel) * (1.0 - smoothstep(uArcLen - 0.025, uArcLen, rel));
    }
    if (uDashes > 0.5) arc *= step(fract(rel / TAU * uDashes), uDuty);
    float alpha = (band + glow) * arc * uOpacity;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(uColor * uIntensity, alpha);
  }
`;

export interface RingOptions {
  radius: number;
  /** Band width in world units. */
  width: number;
  color?: THREE.Color;
  opacity?: number;
  intensity?: number;
  arcStart?: number;
  arcLength?: number;
  dashes?: number;
  duty?: number;
  glow?: number;
}

/**
 * An anti-aliased ring/arc/dashed ring drawn procedurally on a quad, with a soft glow halo.
 * The quad is sized to the ring; scale the mesh to resize it.
 */
export class RingMaterial extends THREE.ShaderMaterial {
  constructor(opts: RingOptions, half: number) {
    super({
      uniforms: {
        uColor: { value: (opts.color ?? PALETTE.cyan).clone() },
        uOpacity: { value: opts.opacity ?? 1 },
        uIntensity: { value: opts.intensity ?? 1.6 },
        uInner: { value: (opts.radius - opts.width / 2) / half },
        uOuter: { value: (opts.radius + opts.width / 2) / half },
        uArcStart: { value: opts.arcStart ?? 0 },
        uArcLen: { value: opts.arcLength ?? Math.PI * 2 },
        uDashes: { value: opts.dashes ?? 0 },
        uDuty: { value: opts.duty ?? 0.5 },
        uGlow: { value: opts.glow ?? 1 },
      },
      vertexShader: ringVertex,
      fragmentShader: ringFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  }

  set arcLength(v: number) {
    this.uniforms.uArcLen.value = v;
  }

  set arcStart(v: number) {
    this.uniforms.uArcStart.value = v;
  }

  setOpacity(v: number): void {
    this.uniforms.uOpacity.value = v;
  }

  setColor(c: THREE.Color): void {
    (this.uniforms.uColor.value as THREE.Color).copy(c);
  }

  setIntensity(v: number): void {
    this.uniforms.uIntensity.value = v;
  }
}

const quadGeometry = new THREE.PlaneGeometry(2, 2);

export function makeRing(opts: RingOptions): THREE.Mesh<THREE.PlaneGeometry, RingMaterial> {
  const half = opts.radius + opts.width / 2 + Math.max(opts.width * 2, opts.radius * 0.12);
  const mesh = new THREE.Mesh(quadGeometry, new RingMaterial(opts, half));
  mesh.scale.setScalar(half);
  mesh.frustumCulled = false;
  return mesh;
}

let glowTexture: THREE.Texture | null = null;

/** Soft radial glow sprite texture (generated once). */
export function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.32)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

export function makeGlow(size: number, color: THREE.Color, intensity = 1.5, opacity = 1): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color: color.clone().multiplyScalar(intensity),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(size);
  return sprite;
}

export function makeLineMaterial(color: THREE.Color, intensity = 1.6, opacity = 0.9): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: color.clone().multiplyScalar(intensity),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

interface TintedLine {
  mat: THREE.LineBasicMaterial | THREE.SpriteMaterial | THREE.LineDashedMaterial;
  base: THREE.Color;
  intensity: number;
  opacity: number;
}

/**
 * Tracks every material belonging to one selectable piece of a hologram so it can be faded,
 * brightened or tinted (hover = brighter, grabbed = gold) as a unit.
 */
export class HoloLook {
  readonly surfaces: HoloSurfaceMaterial[] = [];
  private readonly tinted: TintedLine[] = [];
  private readonly scratch = new THREE.Color();

  surface(opts: SurfaceOptions): HoloSurfaceMaterial {
    const m = new HoloSurfaceMaterial(opts);
    this.surfaces.push(m);
    return m;
  }

  line(color: THREE.Color = PALETTE.cyan, intensity = 1.6, opacity = 0.9): THREE.LineBasicMaterial {
    const mat = makeLineMaterial(color, intensity, opacity);
    this.tinted.push({ mat, base: color.clone(), intensity, opacity });
    return mat;
  }

  dashed(color: THREE.Color, intensity: number, opacity: number, dash: number, gap: number): THREE.LineDashedMaterial {
    const mat = new THREE.LineDashedMaterial({
      color: color.clone().multiplyScalar(intensity),
      transparent: true,
      opacity,
      dashSize: dash,
      gapSize: gap,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.tinted.push({ mat, base: color.clone(), intensity, opacity });
    return mat;
  }

  glow(size: number, color: THREE.Color = PALETTE.cyan, intensity = 1.5, opacity = 1): THREE.Sprite {
    const sprite = makeGlow(size, color, intensity, opacity);
    this.tinted.push({ mat: sprite.material, base: color.clone(), intensity, opacity });
    return sprite;
  }

  /**
   * @param tint colour mixed in by `amount` (0..1)
   * @param boost overall brightness multiplier
   * @param fade opacity multiplier (spawn/despawn)
   */
  apply(tint: THREE.Color, amount: number, boost: number, fade: number): void {
    for (const s of this.surfaces) {
      (s.uniforms.uTint.value as THREE.Color).copy(tint);
      s.uniforms.uTintAmt.value = amount;
      s.uniforms.uBoost.value = boost;
      s.uniforms.uOpacity.value = s.baseOpacity * fade;
    }
    for (const t of this.tinted) {
      this.scratch.copy(t.base).lerp(tint, amount).multiplyScalar(t.intensity * boost);
      t.mat.color.copy(this.scratch);
      t.mat.opacity = t.opacity * fade;
    }
  }

  dispose(): void {
    for (const s of this.surfaces) s.dispose();
    for (const t of this.tinted) t.mat.dispose();
  }
}
