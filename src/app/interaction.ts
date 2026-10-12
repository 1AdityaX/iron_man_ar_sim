import * as THREE from 'three';
import { CONFIG } from '../config';
import { clamp, wrapAngle, type Vec2 } from '../core/math';
import type { Viewport } from '../core/viewport';
import type { GestureEvent } from '../gestures/gestureEngine';
import { CATALOG, specByKind } from '../objects/catalog';
import type { HoloObject, ObjectSpec } from '../objects/holoObject';
import type { ObjectManager, PartHit } from '../objects/objectManager';
import type { Fx } from '../render/fx';
import type { HandVisualState } from '../render/handRig';
import { PALETTE } from '../render/holoMaterials';
import type { Settings } from '../settings';
import type { HandSet } from '../tracking/handSet';
import type { TrackedHand } from '../tracking/trackedHand';
import type { LabelLayer } from '../ui/labels';
import type { MenuOption, RadialMenu } from '../ui/radialMenu';

type Mode = 'idle' | 'hold' | 'menu' | 'part' | 'grab';

interface PartDrag {
  hit: PartHit;
  start: number;
  offset: Vec2;
  depth0: number;
  handDepth0: number;
}

interface Grab {
  obj: HoloObject;
  offset: Vec2;
  depth0: number;
  handDepth0: number;
}

interface HandCtl {
  readonly key: string;
  readonly hand: TrackedHand;
  mode: Mode;
  holdStart: number;
  holdFrom: Vec2;
  holdTarget: HoloObject | null;
  /** True once the pinch has slid away from where it opened the menu (see menuArmMove). */
  menuArmed: boolean;
  /** The option this hand's pinch points at; releasing the pinch selects it. */
  menuPick: string | null;
  drag: PartDrag | null;
  grab: Grab | null;
  fistAngle0: number;
}

interface TwoHandGrab {
  obj: HoloObject;
  sep0: number;
  scale0: number;
  offset: Vec2;
  depth0: number;
  handDepth0: number;
  angle0: number;
  quat0: THREE.Quaternion;
  scaleLog: { t: number; s: number }[];
}

interface MouseCtl {
  mode: 'idle' | 'part' | 'grab' | 'rotate';
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  lastT: number;
  vx: number;
  vy: number;
  inside: boolean;
  drag: PartDrag | null;
  grab: Grab | null;
  rotating: HoloObject | null;
}

export interface ControllerDeps {
  hands: HandSet;
  objects: ObjectManager;
  vp: Viewport;
  menu: RadialMenu;
  fx: Fx;
  settings: () => Settings;
  toast: (text: string) => void;
}

const OBJECT_MENU: MenuOption[] = [
  { id: 'explode', label: 'EXPLODE' },
  { id: 'assemble', label: 'ASSEMBLE' },
  { id: 'resetParts', label: 'RESET PARTS' },
  { id: 'reset', label: 'RESET' },
  { id: 'remove', label: 'DISMISS' },
  { id: 'close', label: 'CLOSE' },
];

const SPAWN_MENU: MenuOption[] = [
  ...CATALOG.map((s) => ({ id: `spawn:${s.kind}`, label: s.shortName })),
  { id: 'close', label: 'CLOSE' },
];

const VIEW_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Turns gestures (and mouse input) into actions on holograms: the pinch-hold menus, fist
 * grabs, two-handed move/scale/roll, flick spins, explode/assemble gestures and part dragging.
 */
export class InteractionController {
  private readonly ctls: HandCtl[];
  private twoHand: TwoHandGrab | null = null;
  private focus: HoloObject | null = null;
  private menuTarget: HoloObject | null = null;
  private lastClapAssemble = -Infinity;
  private now = 0;
  private readonly mouse: MouseCtl = {
    mode: 'idle',
    x: 0,
    y: 0,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    vx: 0,
    vy: 0,
    inside: false,
    drag: null,
    grab: null,
    rotating: null,
  };
  private readonly v = new THREE.Vector3();
  private readonly s: Vec2 = { x: 0, y: 0 };
  private readonly q = new THREE.Quaternion();

  constructor(private readonly d: ControllerDeps) {
    this.ctls = d.hands.all.map((hand) => ({
      key: hand.side,
      hand,
      mode: 'idle' as Mode,
      holdStart: 0,
      holdFrom: { x: 0, y: 0 },
      holdTarget: null,
      menuArmed: false,
      menuPick: null,
      drag: null,
      grab: null,
      fistAngle0: 0,
    }));
  }

  // ---------------------------------------------------------------- events

  handleEvents(events: GestureEvent[], now: number): void {
    this.now = now;
    for (const e of events) {
      switch (e.type) {
        case 'pinchStart':
          this.pinchStart(this.ctlOf(e.hand), now);
          break;
        case 'pinchEnd':
          this.pinchEnd(this.ctlOf(e.hand));
          break;
        case 'fistStart':
          this.fistStart(this.ctlOf(e.hand));
          break;
        case 'fistEnd':
          this.fistEnd(this.ctlOf(e.hand));
          break;
        case 'handLost':
          this.releaseHand(this.ctlOf(e.hand));
          break;
        case 'flick':
          this.flick(e.x, e.y, e.vx, e.vy, e.speed);
          break;
        case 'twist':
          if (e.dir === 'ccw') this.twist(this.ctlOf(e.hand));
          break;
        case 'pullApart':
          this.pullApart(e.x, e.y, now);
          break;
        case 'palmsApart':
          // Ignore the hands springing apart right after a clap.
          if (now - this.lastClapAssemble > 1500) this.explodeNear(e.x, e.y);
          break;
        case 'clap':
          this.clap(e.world, now);
          break;
        case 'handFound':
          break;
      }
    }
  }

  private pinchStart(c: HandCtl, now: number): void {
    if (c.mode === 'grab') return;
    const p = c.hand.pinchScreen;
    const menu = this.d.menu;
    if (menu.open) {
      const option = menu.hitTest(p.x, p.y);
      if (option) {
        menu.select(option);
        c.mode = 'idle';
        return;
      }
      if (menu.contains(p.x, p.y)) return;
      menu.hide();
    }
    const hit = this.d.objects.pickPart(p.x, p.y);
    if (hit) {
      c.drag = this.beginPartDrag(hit, p, c.hand.depth, now);
      c.mode = 'part';
      return;
    }
    c.mode = 'hold';
    c.holdStart = now;
    c.holdFrom = { x: p.x, y: p.y };
    c.holdTarget = this.d.objects.pick(p.x, p.y, 1.05, 30);
  }

  private pinchEnd(c: HandCtl): void {
    const menu = this.d.menu;
    if (c.mode === 'menu' && menu.open && menu.owner === c.key && c.menuPick) {
      menu.select(c.menuPick);
    } else if (c.mode === 'part' && c.drag) {
      this.endPartDrag(c.drag);
      c.drag = null;
    }
    if (c.mode !== 'grab') c.mode = 'idle';
  }

  private fistStart(c: HandCtl): void {
    if (c.drag) {
      this.endPartDrag(c.drag);
      c.drag = null;
    }
    c.mode = 'idle';
    c.fistAngle0 = c.hand.knuckleAngle;
    const p = c.hand.palmScreen;
    const obj = this.d.objects.pick(p.x, p.y, 1.3, 60);
    if (!obj) return;
    c.grab = this.beginGrab(obj, p, c.hand.depth);
    c.mode = 'grab';
    const other = this.ctlOf(this.d.hands.other(c.hand));
    if (other.mode === 'grab' && other.grab?.obj === obj) this.beginTwoHand(obj);
  }

  private fistEnd(c: HandCtl): void {
    if (c.mode === 'grab') this.endGrab(c);
  }

  private releaseHand(c: HandCtl): void {
    if (c.mode === 'part' && c.drag) this.endPartDrag(c.drag);
    if (c.mode === 'grab') this.endGrab(c);
    c.drag = null;
    c.mode = 'idle';
  }

  private flick(x: number, y: number, vx: number, vy: number, speed: number): void {
    const obj = this.d.objects.pick(x, y, 2.4, 150) ?? this.d.objects.nearest(x, y, 220);
    if (!obj) return;
    // Screen y points down: a rightward flick spins about +Y, a downward flick about +X,
    // so the side facing you moves the way your finger did.
    this.v.set(vy, vx, 0);
    if (this.v.lengthSq() < 1e-6) return;
    obj.addSpin(this.v.normalize(), CONFIG.objects.flickSpinGain * speed);
    this.focus = obj;
  }

  private twist(c: HandCtl): void {
    const p = c.hand.palmScreen;
    const target = c.grab?.obj ?? this.d.objects.nearest(p.x, p.y, 280) ?? this.soleObject();
    if (target && !target.exploded) this.explode(target);
  }

  private pullApart(x: number, y: number, now: number): void {
    const t = this.twoHand;
    const target = t?.obj ?? this.d.objects.nearest(x, y, 280) ?? this.soleObject();
    if (!target || target.exploded) return;
    if (t && t.obj === target) {
      // The rip also stretched the two-hand scale; undo that, and let go so the fists that keep
      // moving apart don't go on scaling the exploded hologram.
      const before = t.scaleLog.find((e) => now - e.t <= CONFIG.gestures.pullApartWindowMs + 100);
      target.scale = before?.s ?? t.scale0;
      this.twoHand = null;
      for (const c of this.ctls) {
        if (c.grab?.obj !== target) continue;
        c.grab = null;
        c.mode = 'idle';
        target.grabCount = Math.max(0, target.grabCount - 1);
      }
    }
    this.explode(target);
  }

  private explodeNear(x: number, y: number): void {
    const target = this.d.objects.nearest(x, y, 320) ?? this.soleObject();
    if (target && !target.exploded) this.explode(target);
  }

  private clap(world: THREE.Vector3, now: number): void {
    this.d.fx.clap(world);
    let any = false;
    for (const obj of this.d.objects.live) {
      if (this.assemble(obj)) any = true;
    }
    if (any) this.lastClapAssemble = now;
  }

  // ---------------------------------------------------------------- actions

  spawn(spec: ObjectSpec, x: number, y: number, depth: number): HoloObject {
    const pos = new THREE.Vector3();
    this.d.vp.screenToWorld(x, y, depth, pos);
    const obj = this.d.objects.spawn(spec, pos);
    this.focus = obj;
    this.d.fx.flash(pos, PALETTE.ice, 0.3);
    this.d.fx.shockwave(pos, PALETTE.cyan, 0.32, 0.7);
    this.d.fx.burst(pos, PALETTE.cyan, 56, 0.3, 0.8);
    return obj;
  }

  explode(obj: HoloObject): boolean {
    if (!obj.explode()) return false;
    obj.root.getWorldPosition(this.v);
    this.d.fx.shockwave(this.v, PALETTE.cyan, obj.worldRadius * 1.5, 0.6);
    this.d.fx.burst(this.v, PALETTE.cyan, 40, 0.35, 0.8);
    this.focus = obj;
    return true;
  }

  assemble(obj: HoloObject): boolean {
    for (const c of this.ctls) if (c.drag?.hit.obj === obj) this.releaseHand(c);
    if (this.mouse.drag?.hit.obj === obj) this.mouseUp();
    if (!obj.assemble()) return false;
    obj.root.getWorldPosition(this.v);
    this.d.fx.implode(this.v, PALETTE.amber, Math.min(0.5, obj.worldRadius * 1.4));
    this.focus = obj;
    return true;
  }

  removeObject(obj: HoloObject): void {
    for (const c of this.ctls) {
      if (c.grab?.obj === obj || c.drag?.hit.obj === obj) this.releaseHand(c);
    }
    if (this.mouse.grab?.obj === obj || this.mouse.drag?.hit.obj === obj || this.mouse.rotating === obj) this.mouseUp();
    if (this.twoHand?.obj === obj) this.twoHand = null;
    obj.root.getWorldPosition(this.v);
    this.d.fx.implode(this.v, PALETTE.cyan, obj.worldRadius * 1.4, 0.4);
    obj.remove();
    if (this.focus === obj) this.focus = null;
  }

  /** E key / EXPLODE button: toggle the focused hologram. */
  toggleExplode(): void {
    const target = this.focusObject();
    if (!target) {
      this.d.toast('NO HOLOGRAM · PINCH + HOLD TO FABRICATE');
      return;
    }
    if (target.exploded || target.parts.some((p) => p.detached)) this.assemble(target);
    else this.explode(target);
  }

  openMenu(owner: string, x: number, y: number, target: HoloObject | null, depth: number): void {
    this.menuTarget = target;
    if (target) this.d.menu.show(target.spec.menuTitle, OBJECT_MENU, x, y, owner, depth);
    else this.d.menu.show('FABRICATE', SPAWN_MENU, x, y, owner, depth);
  }

  /** Wired to RadialMenu's onSelect. */
  onMenuSelect(id: string): void {
    const target = this.menuTarget;
    this.menuTarget = null;
    if (id.startsWith('spawn:')) {
      const spec = specByKind(id.slice('spawn:'.length));
      if (spec) this.spawn(spec, this.d.menu.x, this.d.menu.y, this.d.menu.depth);
      return;
    }
    if (!target || target.isRemoving) return;
    switch (id) {
      case 'explode':
        this.explode(target);
        break;
      case 'assemble':
        this.assemble(target);
        break;
      case 'resetParts':
        target.resetParts();
        break;
      case 'reset':
        target.resetPose();
        break;
      case 'remove':
        this.removeObject(target);
        break;
    }
  }

  // ---------------------------------------------------------------- per frame

  update(now: number): void {
    this.now = now;
    for (const obj of this.d.objects.objects) for (const p of obj.parts) p.highlight = 'none';
    const menu = this.d.menu;
    let menuHover: string | null = null;
    let handsSteerMenu = false;

    for (const c of this.ctls) {
      const h = c.hand;
      if (!h.present) continue;
      const p = h.pinchScreen;
      switch (c.mode) {
        case 'hold': {
          const moved = Math.hypot(p.x - c.holdFrom.x, p.y - c.holdFrom.y);
          if (moved > CONFIG.gestures.pinchHoldMoveTolerance * this.d.vp.height) {
            c.mode = 'idle';
          } else if (now - c.holdStart >= CONFIG.gestures.pinchHoldMs) {
            const target = c.holdTarget && !c.holdTarget.isRemoving ? c.holdTarget : null;
            this.openMenu(c.key, p.x, p.y, target, this.spawnDepth(h.depth));
            c.mode = 'menu';
            c.menuArmed = false;
            c.menuPick = null;
            c.holdFrom = { x: p.x, y: p.y };
          }
          break;
        }
        case 'menu':
          if (!menu.open || menu.owner !== c.key) c.mode = 'idle';
          else {
            handsSteerMenu = true;
            // Steer only while the pinch is firmly closed: opening the fingers moves the pinch
            // point, and that must not change (or make) the choice the release confirms.
            if (h.pinchRatio < CONFIG.hand.pinchEnter) {
              const moved = Math.hypot(p.x - c.holdFrom.x, p.y - c.holdFrom.y);
              if (moved > CONFIG.gestures.menuArmMove * this.d.vp.height) c.menuArmed = true;
              if (c.menuArmed) c.menuPick = menu.hitTest(p.x, p.y);
            }
            menuHover = c.menuPick ?? menuHover;
          }
          break;
        case 'part':
          if (c.drag && this.updatePartDrag(c.drag, p, h.depth)) c.drag.hit.part.highlight = 'active';
          else {
            c.drag = null;
            c.mode = 'idle';
          }
          break;
        case 'grab':
          if (c.grab && this.twoHand?.obj !== c.grab.obj) this.updateGrab(c.grab, h.palmScreen, h.depth);
          break;
        case 'idle':
          if (h.fist.value) break;
          if (menu.open) {
            handsSteerMenu = true;
            menuHover = menuHover ?? menu.hitTest(p.x, p.y);
          } else if (h.pinchRatio < 0.9) {
            const hit = this.d.objects.pickPart(p.x, p.y);
            if (hit && hit.part.highlight === 'none') hit.part.highlight = 'hover';
          }
          break;
      }
    }
    if (menu.open && handsSteerMenu && menu.owner !== 'mouse') menu.setHover(menuHover);

    if (this.twoHand) this.updateTwoHand(now);
    this.updateMouse(now);
    if (this.focus?.isRemoving) this.focus = null;
  }

  visualState(hand: TrackedHand): HandVisualState {
    const c = this.ctlOf(hand);
    const elapsed = this.now - c.holdStart - 120;
    return {
      holdProgress: c.mode === 'hold' ? clamp(elapsed / (CONFIG.gestures.pinchHoldMs - 120), 0, 1) : 0,
      grabbing: c.mode === 'grab',
      dragging: c.mode === 'part' || c.mode === 'menu',
    };
  }

  /** Hand, hologram and part-info callouts for this frame. */
  buildLabels(layer: LabelLayer): void {
    const { labels } = this.d.settings();
    const W = this.d.vp.width;
    // An open menu covers whatever is under it; those callouts wait until it closes.
    const underMenu = (p: Vec2) => this.d.menu.contains(p.x, p.y);
    if (labels) {
      for (const c of this.ctls) {
        if (!c.hand.present || underMenu(c.hand.palmScreen)) continue;
        const { title, rows } = this.handLabel(c);
        layer.put({ key: `hand-${c.key}`, anchor: c.hand.palmScreen, title, rows, variant: 'hand' });
      }
      const circle = { x: 0, y: 0, r: 0, depth: 0 };
      for (const obj of this.d.objects.live) {
        this.d.objects.screenCircle(obj, circle);
        const dir = circle.x < W / 2 ? -1 : 1;
        const anchor = { x: circle.x + dir * circle.r * 0.62, y: circle.y - circle.r * 0.62 };
        if (underMenu(anchor)) continue;
        // Keep the callout off the hologram itself (its inner 80% at least).
        const inset = circle.r * 0.8;
        layer.put({
          key: `obj-${obj.id}`,
          anchor,
          avoid: { x: circle.x - inset, y: circle.y - inset, w: inset * 2, h: inset * 2 },
          title: obj.title,
          rows: [
            ['STATUS', obj.state],
            ['SCALE', `${obj.scale.toFixed(2)}×`],
            ['LINKS', String(this.contacts(obj))],
          ],
          variant: 'object',
        });
      }
    }
    // Part info cards show whenever a part is held still long enough, even with labels off.
    const drags = [...this.ctls.map((c) => c.drag), this.mouse.drag];
    drags.forEach((drag, i) => {
      if (!drag || this.now - drag.start < CONFIG.gestures.partInfoHoldMs) return;
      const pc = this.d.objects.partCircle(drag.hit.obj, drag.hit.part, { x: 0, y: 0, r: 0, depth: 0 });
      layer.put({
        key: `info-${i}`,
        anchor: { x: pc.x, y: pc.y },
        title: drag.hit.part.name,
        rows: drag.hit.part.spec.info,
        variant: 'info',
      });
    });
  }

  focusObject(): HoloObject | null {
    if (this.focus && !this.focus.isRemoving) return this.focus;
    const live = this.d.objects.live;
    return live.length ? live[live.length - 1] : null;
  }

  // ---------------------------------------------------------------- mouse

  mouseDown(x: number, y: number, button: number, shift: boolean): void {
    const m = this.mouse;
    this.mouseMove(x, y);
    m.lastX = x;
    m.lastY = y;
    m.vx = m.vy = 0;
    const menu = this.d.menu;
    if (menu.open && !menu.contains(x, y)) menu.hide();
    if (button === 2 || shift) {
      const obj = this.d.objects.pick(x, y, 1.15, 40);
      if (obj) {
        m.mode = 'rotate';
        m.rotating = obj;
        obj.angularVelocity.set(0, 0, 0);
        this.focus = obj;
      }
      return;
    }
    if (button !== 0) return;
    const hit = this.d.objects.pickPart(x, y);
    if (hit) {
      m.drag = this.beginPartDrag(hit, { x, y }, 0, this.now);
      m.mode = 'part';
      return;
    }
    const obj = this.d.objects.pick(x, y, 1.05, 30);
    if (obj) {
      m.grab = this.beginGrab(obj, { x, y }, 0);
      m.mode = 'grab';
    }
  }

  mouseMove(x: number, y: number): void {
    const m = this.mouse;
    const t = performance.now();
    const dt = Math.max(1, t - m.lastT) / 1000;
    m.vx = m.vx * 0.6 + ((x - m.x) / dt) * 0.4;
    m.vy = m.vy * 0.6 + ((y - m.y) / dt) * 0.4;
    m.x = x;
    m.y = y;
    m.lastT = t;
    m.inside = true;
  }

  mouseLeave(): void {
    this.mouse.inside = false;
  }

  mouseUp(): void {
    const m = this.mouse;
    if (m.mode === 'part' && m.drag) this.endPartDrag(m.drag);
    if (m.mode === 'grab' && m.grab) m.grab.obj.grabCount = Math.max(0, m.grab.obj.grabCount - 1);
    if (m.mode === 'rotate' && m.rotating) {
      // Let go mid-drag to fling it spinning.
      const speed = Math.hypot(m.vx, m.vy) / this.d.vp.height;
      if (speed > 0.5 && performance.now() - m.lastT < 80) {
        this.v.set(m.vy, m.vx, 0).normalize();
        m.rotating.addSpin(this.v, CONFIG.objects.flickSpinGain * 0.6 * speed);
      }
    }
    m.mode = 'idle';
    m.drag = null;
    m.grab = null;
    m.rotating = null;
  }

  doubleClick(x: number, y: number): void {
    const obj = this.d.objects.pick(x, y, 1.05, 30);
    let depth = 0.75;
    if (obj) depth = this.d.vp.worldToScreen(obj.root.position, this.s);
    this.openMenu('mouse', x, y, obj, depth);
  }

  wheel(x: number, y: number, deltaY: number): void {
    const obj = this.d.objects.pick(x, y, 1.2, 40) ?? this.focusObject();
    if (!obj) return;
    obj.scale = clamp(obj.scale * Math.exp(-deltaY * 0.0012), CONFIG.objects.minScale, CONFIG.objects.maxScale);
    this.focus = obj;
  }

  private updateMouse(now: number): void {
    const m = this.mouse;
    switch (m.mode) {
      case 'part':
        if (m.drag && this.updatePartDrag(m.drag, m, 0)) m.drag.hit.part.highlight = 'active';
        break;
      case 'grab':
        if (m.grab) this.updateGrab(m.grab, m, 0);
        break;
      case 'rotate': {
        const dx = m.x - m.lastX;
        const dy = m.y - m.lastY;
        const len = Math.hypot(dx, dy);
        if (m.rotating && len > 0) {
          this.v.set(dy, dx, 0).normalize();
          this.q.setFromAxisAngle(this.v, len * 0.008);
          m.rotating.rotateBy(this.q);
        }
        m.lastX = m.x;
        m.lastY = m.y;
        break;
      }
      case 'idle':
        if (m.inside && !this.d.menu.open && now - m.lastT < 4000) {
          const hit = this.d.objects.pickPart(m.x, m.y);
          if (hit && hit.part.highlight === 'none') hit.part.highlight = 'hover';
        }
        break;
    }
  }

  // ---------------------------------------------------------------- helpers

  private ctlOf(hand: TrackedHand): HandCtl {
    return this.ctls.find((c) => c.hand === hand)!;
  }

  private soleObject(): HoloObject | null {
    const live = this.d.objects.live;
    return live.length === 1 ? live[0] : this.focusObject();
  }

  private contacts(obj: HoloObject): number {
    let n = obj.grabCount;
    for (const c of this.ctls) if (c.drag?.hit.obj === obj) n++;
    if (this.mouse.drag?.hit.obj === obj) n++;
    return n;
  }

  private spawnDepth(handDepth: number): number {
    return clamp(handDepth, CONFIG.objects.spawnDepthMin, CONFIG.objects.spawnDepthMax);
  }

  /** New object depth for a hand that moved `handDelta` metres in depth since it took hold. */
  private objectDepth(depth0: number, handDelta: number): number {
    const sign = this.d.settings().depthInvert ? -1 : 1;
    return clamp(depth0 + sign * CONFIG.objects.depthGain * handDelta, CONFIG.objects.minDepth, CONFIG.objects.maxDepth);
  }

  private beginPartDrag(hit: PartHit, p: Vec2, handDepth: number, now: number): PartDrag {
    const pc = this.d.objects.partCircle(hit.obj, hit.part, { x: 0, y: 0, r: 0, depth: 0 });
    hit.part.dragging = true;
    if (!hit.part.detached) hit.part.detached = hit.part.pos.clone();
    this.focus = hit.obj;
    return { hit, start: now, offset: { x: pc.x - p.x, y: pc.y - p.y }, depth0: pc.depth, handDepth0: handDepth };
  }

  private updatePartDrag(drag: PartDrag, p: Vec2, handDepth: number): boolean {
    const { obj, part } = drag.hit;
    if (obj.isRemoving || !part.detached) return false;
    const depth = this.objectDepth(drag.depth0, handDepth - drag.handDepth0);
    this.d.vp.screenToWorld(p.x + drag.offset.x, p.y + drag.offset.y, depth, this.v);
    part.detached.copy(obj.worldToLocal(this.v));
    return true;
  }

  private endPartDrag(drag: PartDrag): void {
    drag.hit.part.dragging = false;
  }

  private beginGrab(obj: HoloObject, p: Vec2, handDepth: number): Grab {
    obj.targetPosition.copy(obj.root.position);
    const depth = this.d.vp.worldToScreen(obj.targetPosition, this.s);
    obj.grabCount++;
    obj.angularVelocity.multiplyScalar(0.25);
    this.focus = obj;
    return { obj, offset: { x: this.s.x - p.x, y: this.s.y - p.y }, depth0: depth, handDepth0: handDepth };
  }

  private updateGrab(g: Grab, p: Vec2, handDepth: number): void {
    const depth = this.objectDepth(g.depth0, handDepth - g.handDepth0);
    this.d.vp.screenToWorld(p.x + g.offset.x, p.y + g.offset.y, depth, g.obj.targetPosition);
  }

  private endGrab(c: HandCtl): void {
    const obj = c.grab?.obj;
    c.grab = null;
    c.mode = 'idle';
    if (!obj) return;
    obj.grabCount = Math.max(0, obj.grabCount - 1);
    if (this.twoHand?.obj === obj) {
      this.twoHand = null;
      // The other hand keeps holding: re-anchor it so the object doesn't jump.
      const other = this.ctls.find((o) => o !== c && o.grab?.obj === obj);
      if (other?.grab) {
        obj.grabCount = Math.max(0, obj.grabCount - 1);
        other.grab = this.beginGrab(obj, other.hand.palmScreen, other.hand.depth);
      }
    }
  }

  private handSeparation(): number {
    const L = this.d.hands.left.palm;
    const R = this.d.hands.right.palm;
    return Math.max(0.03, Math.hypot(L.x - R.x, L.y - R.y, (L.z - R.z) * 0.5));
  }

  private beginTwoHand(obj: HoloObject): void {
    const L = this.d.hands.left;
    const R = this.d.hands.right;
    const mx = (L.palmScreen.x + R.palmScreen.x) / 2;
    const my = (L.palmScreen.y + R.palmScreen.y) / 2;
    const depth = this.d.vp.worldToScreen(obj.targetPosition, this.s);
    obj.angularVelocity.set(0, 0, 0);
    this.twoHand = {
      obj,
      sep0: this.handSeparation(),
      scale0: obj.scale,
      offset: { x: this.s.x - mx, y: this.s.y - my },
      depth0: depth,
      handDepth0: (L.depth + R.depth) / 2,
      angle0: Math.atan2(R.palmScreen.y - L.palmScreen.y, R.palmScreen.x - L.palmScreen.x),
      quat0: obj.orientation.clone(),
      scaleLog: [],
    };
  }

  private updateTwoHand(now: number): void {
    const t = this.twoHand!;
    const L = this.d.hands.left;
    const R = this.d.hands.right;
    if (!L.present || !R.present) return;
    const ratio = this.handSeparation() / t.sep0;
    t.obj.scale = clamp(t.scale0 * ratio, CONFIG.objects.minScale, CONFIG.objects.maxScale);
    t.scaleLog.push({ t: now, s: t.obj.scale });
    while (t.scaleLog.length > 1 && now - t.scaleLog[0].t > 1500) t.scaleLog.shift();

    const mx = (L.palmScreen.x + R.palmScreen.x) / 2;
    const my = (L.palmScreen.y + R.palmScreen.y) / 2;
    const depth = this.objectDepth(t.depth0, (L.depth + R.depth) / 2 - t.handDepth0);
    this.d.vp.screenToWorld(mx + t.offset.x * ratio, my + t.offset.y * ratio, depth, t.obj.targetPosition);

    // Turning the pair of fists like a steering wheel rolls the hologram.
    const angle = Math.atan2(R.palmScreen.y - L.palmScreen.y, R.palmScreen.x - L.palmScreen.x);
    this.q.setFromAxisAngle(VIEW_AXIS, -wrapAngle(angle - t.angle0));
    t.obj.setOrientation(this.q.multiply(t.quat0));
  }

  private handLabel(c: HandCtl): { title: string; rows: [string, string][] } {
    const h = c.hand;
    const side = h.side === 'Left' ? 'L' : 'R';
    const range: [string, string] = ['RANGE', `${h.depth.toFixed(2)} M`];
    if (h.fist.value && c.mode !== 'grab') {
      // A free fist is a twist dial: show how far it has turned.
      const twist = ((h.knuckleAngle - c.fistAngle0) * 180) / Math.PI;
      return {
        title: `WRIST ${side}`,
        rows: [
          ['ROT', `${twist >= 0 ? 'CCW' : 'CW'} ${Math.abs(twist).toFixed(0)}°`],
          ['TILT', `${Math.round(Math.abs(h.tiltDeg))}°`],
        ],
      };
    }
    let mode: string;
    if (c.mode === 'grab') mode = 'LOCKED';
    else if (c.mode === 'part') mode = 'LINKED';
    else if (c.mode === 'hold') mode = `HOLD ${Math.round(this.visualState(h).holdProgress * 100)}%`;
    else if (c.mode === 'menu') mode = 'MENU';
    else if (h.pinching.value) mode = 'PINCH';
    else if (h.pointing.value) mode = 'POINT';
    else mode = h.grip > 0.5 ? 'CLOSED' : 'OPEN';
    return { title: `HAND ${side}`, rows: [['GRIP', `${Math.round(h.grip * 100)}% ${mode}`], range] };
  }
}
