import { Viewport } from '../core/viewport';
import { GestureEngine, type GestureEvent } from '../gestures/gestureEngine';
import { CameraError, CameraFeed } from '../input/camera';
import { ARC_REACTOR } from '../objects/arcReactor';
import { ObjectManager } from '../objects/objectManager';
import { Fx } from '../render/fx';
import { HandOccluder } from '../render/handOccluder';
import { HandRig } from '../render/handRig';
import { sharedUniforms } from '../render/holoMaterials';
import { Stage } from '../render/stage';
import { loadSettings, saveSettings, type Settings } from '../settings';
import { HandSet } from '../tracking/handSet';
import type { RawHand } from '../tracking/trackedHand';
import { HandTracker, type Delegate } from '../tracking/handTracker';
import { DebugOverlay } from '../ui/debugOverlay';
import { Hud, type HudAction } from '../ui/hud';
import { LabelLayer, type Rect } from '../ui/labels';
import { RadialMenu } from '../ui/radialMenu';
import { StartScreen } from '../ui/startScreen';
import { InteractionController } from './interaction';

export interface AppOptions {
  /** Play this video file instead of opening the webcam (demos, testing). */
  videoUrl?: string | null;
  /** Skip the start screen. */
  autostart?: boolean;
  /** The source video is already mirrored (e.g. a screen recording of a selfie view). */
  premirrored?: boolean;
  /** Force the tracker onto the CPU (some GPU drivers misbehave with the WebGL delegate). */
  delegate?: Delegate;
  /**
   * Drive all timing from the video file's timeline instead of the wall clock, so a recorded
   * clip replays gestures identically however slowly frames are processed (testing aid).
   */
  videoClock?: boolean;
  /** Settings forced for this session (from URL parameters). */
  overrides?: Partial<Settings>;
}

const KEYMAP: Record<string, HudAction> = {
  e: 'explode',
  c: 'camera',
  b: 'bw',
  f: 'mirror',
  i: 'depth',
  l: 'labels',
  o: 'occlusion',
  d: 'debug',
  h: 'help',
};

const onOff = (v: boolean) => (v ? 'ON' : 'OFF');

export class App {
  readonly settings: Settings;
  readonly vp = new Viewport();
  readonly hands = new HandSet();
  readonly tracker = new HandTracker();
  readonly gestures = new GestureEngine(this.hands);
  readonly stage: Stage;
  readonly camera: CameraFeed;
  readonly objects: ObjectManager;
  readonly fx = new Fx();
  readonly ctl: InteractionController;

  private readonly rigs: HandRig[];
  private readonly occluders: HandOccluder[];
  private readonly hud: Hud;
  private readonly labels: LabelLayer;
  private readonly menu: RadialMenu;
  private readonly debug: DebugOverlay;
  private readonly start: StartScreen;

  private mode: 'camera' | 'demo' | null = null;
  private running = false;
  private trackerLoad: Promise<void> | null = null;
  private lastFrame = performance.now();
  private lastVideoTime = -1;
  private fps = 60;
  private trackerFps = 0;
  private trackCount = 0;
  private trackWindowStart = performance.now();
  private helpTop = 0;
  private keepOut: Rect[] = [];
  private sessionStart = performance.now();
  /** Number of video frames run through the tracker so far. */
  framesTracked = 0;
  /** A manually advanced clock in ms for scripted replays and tests; null means real time. */
  manualClock: number | null = null;
  /** Recent gesture events, newest last (shown in debug mode). */
  readonly eventLog: string[] = [];

  constructor(private readonly opts: AppOptions) {
    this.settings = { ...loadSettings(), ...opts.overrides };
    const canvas = document.getElementById('stage') as HTMLCanvasElement;
    this.stage = new Stage(canvas, this.vp);
    this.camera = new CameraFeed(document.getElementById('camera') as HTMLVideoElement);
    this.objects = new ObjectManager(this.stage.scene, this.vp);
    this.stage.scene.add(this.fx.group);
    this.rigs = this.hands.all.map((h) => new HandRig(h));
    this.occluders = this.hands.all.map((h) => new HandOccluder(h));
    for (const r of this.rigs) this.stage.scene.add(r.group);
    for (const o of this.occluders) this.stage.scene.add(o.group);

    this.hud = new Hud(
      (a) => this.action(a),
      (v) => {
        this.settings.dim = v;
        this.persist();
        this.applySettings();
      },
    );
    this.labels = new LabelLayer(
      document.getElementById('label-layer')!,
      document.getElementById('leader-layer') as unknown as SVGSVGElement,
    );
    this.labels.keepOut = () => this.keepOut;
    this.hud.onLayout = () => this.cacheLayout();
    this.menu = new RadialMenu(document.getElementById('menu-layer')!, (id) => this.ctl.onMenuSelect(id));
    this.menu.avoid = () => this.hud.controlsRect;
    this.debug = new DebugOverlay(document.getElementById('debug-layer') as HTMLCanvasElement);
    this.start = new StartScreen(
      () => void this.startCamera(),
      () => this.startDemo(),
    );
    this.ctl = new InteractionController({
      hands: this.hands,
      objects: this.objects,
      vp: this.vp,
      menu: this.menu,
      fx: this.fx,
      settings: () => this.settings,
      toast: (t) => this.hud.toast(t),
    });
    this.tracker.swapHandedness = !!opts.premirrored;

    this.bindInput(canvas);
    window.addEventListener('resize', () => this.resize());
    this.camera.video.addEventListener('loadedmetadata', () => this.resize());
    this.camera.video.addEventListener('resize', () => this.resize());
    this.resize();
    this.applySettings();
  }

  /** Starts loading the tracker in the background; the user picks camera or demo meanwhile. */
  boot(): void {
    this.trackerLoad = this.tracker.init((msg) => this.start.setStatus(msg), this.opts.delegate).catch((err: unknown) => {
      console.error('[tracker]', err);
      this.start.setStatus('HAND TRACKING FAILED TO LOAD. CHECK YOUR CONNECTION, OR USE MOUSE MODE.', true);
    });
    if (this.opts.autostart) void this.startCamera();
  }

  async startCamera(): Promise<void> {
    this.start.setBusy(true);
    this.start.setStatus('REQUESTING CAMERA');
    try {
      if (this.opts.videoUrl) await this.camera.startFile(this.opts.videoUrl);
      else await this.camera.start(this.settings.cameraId);
      if (this.camera.deviceId) this.settings.cameraId = this.camera.deviceId;
      this.persist();
    } catch (err) {
      const msg = err instanceof CameraError ? err.message : 'Could not start the camera.';
      this.start.setStatus(`${msg.toUpperCase()} YOU CAN STILL USE MOUSE MODE.`, true);
      this.start.setBusy(false);
      if (this.mode) this.hud.toast(msg.toUpperCase());
      return;
    }
    this.stage.attachVideo(this.camera.video);
    if (!this.tracker.ready) {
      this.start.setStatus('WAITING FOR HAND MODEL');
      await this.trackerLoad;
    }
    this.mode = 'camera';
    this.lastVideoTime = -1;
    this.start.hide();
    this.resize();
    this.applySettings();
    this.hud.toast(this.tracker.ready ? 'RAISE A HAND · PINCH + HOLD TO FABRICATE' : 'TRACKING OFFLINE · MOUSE ONLY');
    this.run();
  }

  startDemo(): void {
    this.mode = 'demo';
    this.stage.attachVideo(null);
    this.start.hide();
    this.applySettings();
    this.ctl.spawn(ARC_REACTOR, this.vp.width / 2, this.vp.height * 0.45, 0.8);
    this.hud.toast('MOUSE MODE · DOUBLE-CLICK FOR MENUS');
    this.run();
  }

  private run(): void {
    if (this.running) return;
    this.running = true;
    this.sessionStart = performance.now();
    this.lastFrame = this.clock();
    requestAnimationFrame(this.loop);
  }

  private clock(): number {
    if (this.manualClock !== null) return this.manualClock;
    if (this.opts.videoClock && this.camera.source === 'file') return 1000 + this.camera.video.currentTime * 1000;
    return performance.now();
  }

  /** Feeds one frame of hand landmarks as if the tracker had produced them (replays, tests). */
  feedHands(raws: RawHand[]): void {
    this.processHands(raws, this.clock());
  }

  private processHands(raws: RawHand[], now: number): void {
    this.hands.ingest(raws, now, this.vp);
    const events = this.gestures.update(now, this.vp.height);
    this.ctl.handleEvents(events, now);
    this.logEvents(events, now);
  }

  private readonly loop = (): void => {
    const now = this.clock();
    // Cap the step so a stalled tab doesn't teleport everything, while slow GPUs stay ~real-time.
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    if (dt > 0) this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    sharedUniforms.uTime.value = now / 1000;

    if (this.mode === 'camera' && this.tracker.ready && this.camera.ready) {
      const video = this.camera.video;
      if (video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = video.currentTime;
        this.processHands(this.tracker.detect(video, now), now);
        this.trackCount++;
        this.framesTracked++;
      }
    }
    if (now - this.trackWindowStart >= 1000) {
      this.trackerFps = (this.trackCount * 1000) / (now - this.trackWindowStart);
      this.trackCount = 0;
      this.trackWindowStart = now;
    }

    this.ctl.update(now);
    this.objects.update(dt, now / 1000);
    for (const r of this.rigs) r.update(dt, now / 1000, this.ctl.visualState(r.hand));
    for (const o of this.occluders) o.update(this.settings.occlusion);
    this.fx.update(dt);
    this.menu.update(dt);
    this.labels.begin();
    this.ctl.buildLabels(this.labels);
    this.labels.end(dt, this.vp.width, this.vp.height, this.helpTop);
    this.stage.render();
    this.hud.setClock((performance.now() - this.sessionStart) / 1000);
    this.hud.setStatus(this.statusText(), this.mode === 'camera' && this.tracker.ready);
    this.debug.draw(this.settings.debug, this.hands.all, {
      fps: this.fps,
      trackerFps: this.trackerFps,
      detectMs: this.tracker.lastDetectMs,
      delegate: this.tracker.ready ? this.tracker.delegate : '-',
      video: this.camera.ready ? `${this.camera.video.videoWidth}x${this.camera.video.videoHeight}` : '-',
      objects: this.objects.live.length,
      events: this.eventLog.slice(-6),
    });
    requestAnimationFrame(this.loop);
  };

  private statusText(): string {
    if (this.mode === 'demo') return 'MOUSE MODE';
    if (this.mode !== 'camera') return 'STANDBY';
    if (!this.tracker.ready) return 'TRACKING OFFLINE';
    const n = this.hands.all.filter((h) => h.present).length;
    return n ? `TRACKING ${n} HAND${n > 1 ? 'S' : ''}` : 'SEARCHING';
  }

  private logEvents(events: GestureEvent[], now: number): void {
    for (const e of events) {
      const who = 'hand' in e ? `(${e.hand.side[0]})` : '';
      this.eventLog.push(`${(now / 1000).toFixed(2)}s ${e.type}${who}${e.type === 'twist' ? ` ${e.dir}` : ''}`);
    }
    if (this.eventLog.length > 60) this.eventLog.splice(0, this.eventLog.length - 60);
  }

  private action(a: HudAction): void {
    const s = this.settings;
    const toast = (t: string) => this.hud.toast(t);
    switch (a) {
      case 'mirror':
        s.mirror = !s.mirror;
        toast(`MIRROR ${onOff(s.mirror)}`);
        break;
      case 'depth':
        s.depthInvert = !s.depthInvert;
        toast(`DEPTH INVERT ${onOff(s.depthInvert)}`);
        break;
      case 'bw':
        s.grayscale = !s.grayscale;
        toast(`MONOCHROME ${onOff(s.grayscale)}`);
        break;
      case 'labels':
        s.labels = !s.labels;
        toast(`CALLOUTS ${onOff(s.labels)}`);
        break;
      case 'occlusion':
        s.occlusion = !s.occlusion;
        toast(`OCCLUSION ${onOff(s.occlusion)}`);
        break;
      case 'debug':
        s.debug = !s.debug;
        toast(`DIAGNOSTICS ${onOff(s.debug)}`);
        break;
      case 'help':
        s.help = !s.help;
        break;
      case 'camera':
        void this.nextCamera();
        return;
      case 'explode':
        this.ctl.toggleExplode();
        return;
    }
    this.persist();
    this.applySettings();
  }

  private async nextCamera(): Promise<void> {
    if (this.mode !== 'camera') {
      await this.startCamera();
      return;
    }
    if (this.camera.source === 'file') {
      this.hud.toast('PLAYING A VIDEO FILE');
      return;
    }
    try {
      if (!(await this.camera.next())) {
        this.hud.toast('NO OTHER CAMERA FOUND');
        return;
      }
    } catch (err) {
      this.hud.toast(err instanceof CameraError ? err.message.toUpperCase() : 'CAMERA SWITCH FAILED');
      return;
    }
    this.settings.cameraId = this.camera.deviceId;
    this.persist();
    this.hands.clear();
    this.lastVideoTime = -1;
    this.resize();
    this.applySettings();
    this.hud.toast(`CAMERA ${this.camera.label}`);
  }

  private applySettings(): void {
    const s = this.settings;
    this.vp.mirror = s.mirror;
    this.stage.setFeed({ hasVideo: this.mode === 'camera', mirror: s.mirror, grayscale: s.grayscale, dim: s.dim });
    for (const o of this.occluders) o.setDebug(s.debug);
    this.hud.sync(s, this.camera.label);
    this.cacheLayout();
  }

  private persist(): void {
    saveSettings(this.settings);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.vp.setScreen(w, h);
    if (this.camera.ready) this.vp.setVideo(this.camera.video.videoWidth, this.camera.video.videoHeight);
    this.stage.resize(w, h);
    this.debug.resize(w, h);
    this.cacheLayout();
  }

  /** Callout layout needs these every frame; reading them live would force synchronous layout. */
  private cacheLayout(): void {
    this.helpTop = this.hud.helpTop;
    const pad = (r: DOMRect): Rect => ({ x: r.x - 8, y: r.y - 8, w: r.width + 16, h: r.height + 16 });
    this.keepOut = [pad(this.hud.controlsRect), pad(document.getElementById('brand')!.getBoundingClientRect())];
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.ctl.mouseDown(e.clientX, e.clientY, e.button, e.shiftKey);
    });
    canvas.addEventListener('pointermove', (e) => this.ctl.mouseMove(e.clientX, e.clientY));
    canvas.addEventListener('pointerup', () => this.ctl.mouseUp());
    canvas.addEventListener('pointercancel', () => this.ctl.mouseUp());
    canvas.addEventListener('pointerleave', () => this.ctl.mouseLeave());
    canvas.addEventListener('dblclick', (e) => this.ctl.doubleClick(e.clientX, e.clientY));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.ctl.wheel(e.clientX, e.clientY, e.deltaY);
      },
      { passive: false },
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (!this.mode || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') {
        this.menu.hide();
        return;
      }
      const action = KEYMAP[e.key.toLowerCase()];
      if (action) {
        e.preventDefault();
        this.action(action);
      }
    });
  }
}
