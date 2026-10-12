import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CONFIG } from '../config';
import type { Viewport } from '../core/viewport';
import { sharedUniforms } from './holoMaterials';

/**
 * Final composite: the (cover-fitted, optionally mirrored / greyscale / dimmed) webcam feed with
 * the bloomed hologram layer added on top. Holograms slightly darken what is behind them so they
 * stay readable against bright rooms.
 */
const CompositeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tVideo: { value: null as THREE.Texture | null },
    uHasVideo: { value: 0 },
    uMirror: { value: 1 },
    uGray: { value: 0 },
    uDim: { value: 0.4 },
    uDarken: { value: 0.35 },
    uUvScale: { value: new THREE.Vector2(1, 1) },
    uAspect: { value: 1 },
    uTime: sharedUniforms.uTime,
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tVideo;
    uniform float uHasVideo;
    uniform float uMirror;
    uniform float uGray;
    uniform float uDim;
    uniform float uDarken;
    uniform vec2 uUvScale;
    uniform float uAspect;
    uniform float uTime;
    varying vec2 vUv;

    vec3 backdrop(vec2 uv) {
      vec3 c = mix(vec3(0.0, 0.004, 0.009), vec3(0.008, 0.026, 0.045), uv.y);
      vec2 g = uv * vec2(uAspect, 1.0) * 12.0;
      vec2 cell = abs(fract(g) - 0.5);
      float line = 1.0 - smoothstep(0.47, 0.5, max(cell.x, cell.y));
      float fade = smoothstep(1.1, 0.1, length((uv - 0.5) * vec2(uAspect, 1.0)));
      c += vec3(0.01, 0.045, 0.07) * (1.0 - line) * fade;
      return c;
    }

    void main() {
      vec4 holo = texture2D(tDiffuse, vUv);
      vec3 cam;
      if (uHasVideo > 0.5) {
        vec2 uv = vUv;
        if (uMirror > 0.5) uv.x = 1.0 - uv.x;
        uv = 0.5 + (uv - 0.5) * uUvScale;
        cam = texture2D(tVideo, uv).rgb;
        float l = dot(cam, vec3(0.2126, 0.7152, 0.0722));
        cam = mix(cam, vec3(l), uGray);
        cam *= 1.0 - uDim;
      } else {
        cam = backdrop(vUv);
      }
      float glowAmount = clamp(dot(holo.rgb, vec3(0.3, 0.55, 0.15)) * 1.3, 0.0, 1.0);
      cam *= 1.0 - uDarken * glowAmount;
      vec2 q = vUv - 0.5;
      cam *= 1.0 - dot(q, q) * 0.45;
      gl_FragColor = vec4(cam + holo.rgb, 1.0);
    }
  `,
};

export interface FeedParams {
  hasVideo: boolean;
  mirror: boolean;
  grayscale: boolean;
  dim: number;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.02, 60);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly composite: ShaderPass;
  private videoTexture: THREE.VideoTexture | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly viewport: Viewport,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.render.maxPixelRatio));

    const target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(256, 256),
      CONFIG.render.bloomStrength,
      CONFIG.render.bloomRadius,
      CONFIG.render.bloomThreshold,
    );
    this.composer.addPass(this.bloom);
    this.composite = new ShaderPass(CompositeShader);
    this.composer.addPass(this.composite);
    this.composer.addPass(new OutputPass());
    this.scene.add(this.camera);
  }

  attachVideo(video: HTMLVideoElement | null): void {
    this.videoTexture?.dispose();
    this.videoTexture = null;
    if (video) {
      this.videoTexture = new THREE.VideoTexture(video);
      this.videoTexture.colorSpace = THREE.SRGBColorSpace;
      this.videoTexture.minFilter = THREE.LinearFilter;
      this.videoTexture.magFilter = THREE.LinearFilter;
      this.videoTexture.generateMipmaps = false;
    }
    this.composite.uniforms.tVideo.value = this.videoTexture;
  }

  setFeed(p: FeedParams): void {
    const u = this.composite.uniforms;
    u.uHasVideo.value = p.hasVideo && this.videoTexture ? 1 : 0;
    u.uMirror.value = p.mirror ? 1 : 0;
    u.uGray.value = p.grayscale ? 1 : 0;
    u.uDim.value = p.dim;
  }

  /** Call after the window or the video resolution changes. */
  resize(width: number, height: number): void {
    const pr = Math.min(window.devicePixelRatio || 1, CONFIG.render.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(width, height);
    this.camera.fov = this.viewport.vFovDeg;
    this.camera.aspect = this.viewport.aspect;
    this.camera.updateProjectionMatrix();
    const [sx, sy] = this.viewport.videoUvScale;
    (this.composite.uniforms.uUvScale.value as THREE.Vector2).set(sx, sy);
    this.composite.uniforms.uAspect.value = width / height;
  }

  render(): void {
    this.composer.render();
  }
}
