import { CONFIG } from '../config';
import type { Vec2 } from './math';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Maps between the three coordinate spaces the app juggles:
 *  - image:  normalized webcam frame coordinates from MediaPipe (0..1, unmirrored)
 *  - screen: CSS pixels of the full-window stage (the video is "cover"-fitted and optionally mirrored)
 *  - world:  metres in camera space. The 3D camera sits at the origin looking down -Z, with
 *            intrinsics matched to the visible part of the webcam image, so a point at depth d
 *            lands exactly on top of the pixel where the webcam saw it.
 */
export class Viewport {
  width = 1;
  height = 1;
  videoWidth = 16;
  videoHeight = 9;
  mirror = true;

  /** Video-to-screen scale for object-fit: cover. */
  coverScale = 1;
  displayWidth = 1;
  displayHeight = 1;
  offsetX = 0;
  offsetY = 0;
  /** Focal length in screen pixels. */
  focalPx = 1;

  constructor(private readonly hfovDeg: number = CONFIG.camera.assumedHFovDeg) {
    this.recompute();
  }

  setScreen(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.recompute();
  }

  setVideo(width: number, height: number): void {
    if (width > 0 && height > 0) {
      this.videoWidth = width;
      this.videoHeight = height;
      this.recompute();
    }
  }

  private recompute(): void {
    const s = Math.max(this.width / this.videoWidth, this.height / this.videoHeight);
    this.coverScale = s;
    this.displayWidth = this.videoWidth * s;
    this.displayHeight = this.videoHeight * s;
    this.offsetX = (this.width - this.displayWidth) / 2;
    this.offsetY = (this.height - this.displayHeight) / 2;
    const videoFocal = this.videoWidth / 2 / Math.tan((this.hfovDeg * Math.PI) / 360);
    this.focalPx = videoFocal * s;
  }

  /** Vertical field of view of the visible stage, for THREE.PerspectiveCamera. */
  get vFovDeg(): number {
    return (2 * Math.atan(this.height / 2 / this.focalPx) * 180) / Math.PI;
  }

  get aspect(): number {
    return this.width / this.height;
  }

  /** UV transform from screen UV (0..1) to the cover-cropped region of the video texture. */
  get videoUvScale(): [number, number] {
    return [this.width / this.displayWidth, this.height / this.displayHeight];
  }

  imageToScreen(u: number, v: number, out: Vec2): Vec2 {
    out.x = this.offsetX + (this.mirror ? 1 - u : u) * this.displayWidth;
    out.y = this.offsetY + v * this.displayHeight;
    return out;
  }

  screenToWorld(x: number, y: number, depth: number, out: Vec3Like): Vec3Like {
    const f = this.focalPx;
    out.x = ((x - this.width / 2) / f) * depth;
    out.y = (-(y - this.height / 2) / f) * depth;
    out.z = -depth;
    return out;
  }

  /** Projects a world point; returns its depth (distance along the view axis). */
  worldToScreen(p: Vec3Like, out: Vec2): number {
    const depth = Math.max(1e-4, -p.z);
    out.x = this.width / 2 + (p.x / depth) * this.focalPx;
    out.y = this.height / 2 - (p.y / depth) * this.focalPx;
    return depth;
  }

  /** Screen-space radius in pixels of a sphere with world radius `r` at `depth`. */
  projectRadius(r: number, depth: number): number {
    return (r * this.focalPx) / Math.max(1e-4, depth);
  }

  /** World length spanned by `px` screen pixels at `depth`. */
  pxToWorld(px: number, depth: number): number {
    return (px * depth) / this.focalPx;
  }
}
