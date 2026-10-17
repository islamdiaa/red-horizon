/**
 * [CTRL] Touch controls (tablets): hooked from InputController for pointers of type 'touch' on the canvas.
 *
 * One finger
 * - tap an own unit / structure: select it (double tap: all of that type on screen);
 * - tap anywhere else with a selection: the context command (move, attack, harvest, enter, rally…);
 * - drag: pan the map (the ground stays under the finger);
 * - press and hold, then drag: box select (or switch on "Box" in the toolbar to box select with plain drags);
 * - press and hold without moving: radial context menu (stop, scatter, deploy, attack-move here, patrol here,
 *   guard this, force fire, stance, formation; sell / repair / primary / rally for structures).
 * Two fingers: pan, pinch to zoom, twist to rotate the camera.
 * Toolbar (left edge): Box select, Add (taps add to / remove from the selection, and act as Shift: plan more
 * structures, more patrol waypoints), Attack-move, Force fire, Guard, Patrol, Stop, All units.
 * Sidebar cards: tap = left click, press and hold = right click (hold / cancel).
 */
import { Building, Unit, type Entity } from '../sim/entities';
import type { Command, FormationShape, Stance } from '../sim/types';
import { canCarry } from '../sim/naval';
import { CTRL_ICONS, FORMATION_INFO, RadialMenu, type RadialItem } from './orderui';
import type { InputController, InputHost, PtrLike } from './input';
import { armyTools } from './army'; // [ARMY]

/** A touch-first device (coarse pointer, or touch without hover). */
export function isTouchDevice(): boolean {
  if (typeof matchMedia === 'undefined') return false;
  return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
}

interface Finger { id: number; x: number; y: number; x0: number; y0: number; t0: number }

/**
 * Hold this long to arm box select; this long (unmoved) for the context menu. Decided from event timestamps (not
 * frame times), so a slow frame never turns a tap into a long press.
 */
const ARM_MS = 330;
const MENU_MS = 600;
const HUD_HOLD_MS = 500;
const SLOP = 11;

const STANCES: { id: Stance; label: string }[] = [
  { id: 'aggressive', label: 'Aggressive' }, { id: 'guard', label: 'Guard' }, { id: 'hold', label: 'Hold' }, { id: 'passive', label: 'Hold fire' },
];

export class TouchController {
  /** A touch gesture is in progress (edge scrolling is off meanwhile). */
  active = false;
  /** Toolbar toggles. */
  boxMode = false;
  addMode = false;
  readonly radial: RadialMenu;
  private fingers = new Map<number, Finger>();
  private state: 'idle' | 'pending' | 'pan' | 'box' | 'aim' | 'pinch' | 'lifted' = 'idle';
  private armed = false;
  private pinch0: { d: number; a: number; mx: number; my: number; dist: number; yaw: number; twist: boolean } | null = null;
  private pinchLast = { mx: 0, my: 0 };
  private enabled = false;
  private bar: HTMLElement | null = null;
  private btns = new Map<string, HTMLButtonElement>();
  private press: HTMLElement | null = null;
  private disposers: (() => void)[] = [];
  /** HUD long-press (sidebar cards, group buttons) -> right click. */
  private hudHold: { el: HTMLElement; t: number; x: number; y: number; id: number; native: boolean } | null = null;
  private swallowClickUntil = 0;

  constructor(private input: InputController, private h: InputHost) {
    this.radial = new RadialMenu();
    this.disposers.push(() => this.radial.dispose());
    const on = (t: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions | boolean) => {
      t.addEventListener(type, fn, opts);
      this.disposers.push(() => t.removeEventListener(type, fn, opts));
    };
    // long press on HUD elements = right click; the first touch anywhere switches the touch UI on
    on(document, 'pointerdown', (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      this.enable();
      const el = (e.target as HTMLElement)?.closest?.('#ui .bitem, #ui .grp') as HTMLElement | null;
      this.hudHold = el ? { el, t: e.timeStamp, x: e.clientX, y: e.clientY, id: e.pointerId, native: false } : null;
    }, true);
    on(document, 'pointermove', (e: PointerEvent) => {
      const hh = this.hudHold;
      if (hh && e.pointerId === hh.id && Math.hypot(e.clientX - hh.x, e.clientY - hh.y) > SLOP) this.hudHold = null;
    }, true);
    on(document, 'pointerup', (e: PointerEvent) => {
      const hh = this.hudHold;
      if (!hh || hh.id !== e.pointerId) return;
      this.hudHold = null;
      // held long enough and the browser showed no context menu of its own: right click
      if (!hh.native && e.timeStamp - hh.t >= HUD_HOLD_MS) {
        navigator.vibrate?.(20);
        hh.el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: hh.x, clientY: hh.y, button: 2 }));
        this.swallowClickUntil = performance.now() + 700;
      }
    }, true);
    on(document, 'pointercancel', () => { this.hudHold = null; }, true);
    on(document, 'contextmenu', (e: MouseEvent) => {
      // the browser's own long-press context menu on a card: let the HUD handle it once, never twice
      if (e.isTrusted && this.hudHold) this.hudHold.native = true;
    }, true);
    on(document, 'click', (e: MouseEvent) => {
      if (performance.now() < this.swallowClickUntil) { e.preventDefault(); e.stopPropagation(); this.swallowClickUntil = 0; }
    }, true);
    if (isTouchDevice()) this.enable();
  }

  dispose() {
    for (const d of this.disposers) d();
    this.bar?.remove();
    this.press?.remove();
    document.body.classList.remove('touch-ui');
  }

  /** Show the touch toolbar and switch the canvas to touch gestures. */
  enable() {
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add('touch-ui');
    if (this.input.spectator) return;
    const bar = document.createElement('div');
    bar.id = 'touch-bar';
    const add = (id: string, label: string, icon: string, run: () => void) => {
      const b = document.createElement('button');
      b.innerHTML = `${icon}<span>${label}</span>`;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', (e) => { e.stopPropagation(); this.input.playClick(); run(); });
      bar.appendChild(b);
      this.btns.set(id, b);
    };
    const mode = (m: 'attackMove' | 'attackGround' | 'guard' | 'patrol') => () => {
      if (!this.input.ownSelectedUnits().length) { this.input.message('Select units first'); return; }
      this.input.setMode(this.input.mode === m ? 'normal' : m);
    };
    add('box', 'Box', CTRL_ICONS.box, () => { this.boxMode = !this.boxMode; this.input.message(this.boxMode ? 'Drag to box select (two fingers pan)' : 'Drag to pan (hold, then drag to box select)'); });
    add('add', 'Add', CTRL_ICONS.add, () => { this.addMode = !this.addMode; this.input.message(this.addMode ? 'Taps add to the selection (and act as Shift)' : 'Taps select'); });
    add('attackMove', 'Attack', CTRL_ICONS.attackMove, mode('attackMove'));
    add('attackGround', 'Force', CTRL_ICONS.force, mode('attackGround'));
    add('guard', 'Guard', CTRL_ICONS.guard, mode('guard'));
    add('patrol', 'Patrol', CTRL_ICONS.patrol, mode('patrol'));
    add('stop', 'Stop', CTRL_ICONS.stop, () => this.input.keyCommand('s', true));
    add('all', 'All', CTRL_ICONS.all, () => this.input.keyCommand('e', true));
    document.body.appendChild(bar);
    this.bar = bar;
  }

  // ---------------------------------------------------------------------------
  // Canvas pointers (routed here by InputController)
  // ---------------------------------------------------------------------------
  down(e: PointerEvent) {
    this.enable();
    if (this.radial.isOpen) return;
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
    this.fingers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: e.timeStamp });
    this.active = true;
    if (this.fingers.size === 1) {
      this.state = 'pending';
      this.armed = false;
      const inp = this.input;
      if (inp.mode === 'place' || inp.mode === 'plan') {
        // placing: the finger is the cursor (a wall line is dragged from where it lands)
        inp.pointerAt(e.clientX, e.clientY);
        this.state = 'aim';
        if (inp.mode === 'place' && this.isWall()) inp.primaryPress(this.ptr(e.clientX, e.clientY));
      }
    } else if (this.fingers.size === 2) {
      this.hidePress();
      if (this.state === 'aim' && this.input.mode === 'place' && this.isWall()) this.input.setMode('normal');
      this.h.overlay.selectionBox = null;
      this.state = 'pinch';
      const m = this.metrics();
      const cam = this.h.gfx.cam;
      this.pinch0 = { ...m, dist: cam.targetDist, yaw: cam.targetYaw, twist: false };
      this.pinchLast = { mx: m.mx, my: m.my };
    }
  }

  move(e: PointerEvent) {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    const px = f.x, py = f.y;
    f.x = e.clientX;
    f.y = e.clientY;
    if (this.state === 'pinch') { this.applyPinch(); return; }
    if (this.fingers.size !== 1) return;
    if (this.state === 'aim') { this.input.pointerAt(f.x, f.y); return; }
    if (this.state === 'pending') {
      if (Math.hypot(f.x - f.x0, f.y - f.y0) < SLOP) return;
      // held still a moment before dragging: box select; straight away: pan
      this.state = this.boxMode || e.timeStamp - f.t0 >= ARM_MS ? 'box' : 'pan';
      this.hidePress();
    }
    if (this.state === 'pan') this.grabPan(px, py, f.x, f.y);
    else if (this.state === 'box') this.h.overlay.selectionBox = { x0: f.x0, y0: f.y0, x1: f.x, y1: f.y };
  }

  up(e: PointerEvent) {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    this.fingers.delete(e.pointerId);
    if (this.state === 'pinch' || this.state === 'lifted') {
      // the other finger stays down: ignore it until it lifts too
      this.state = this.fingers.size ? 'lifted' : 'idle';
      if (!this.fingers.size) this.end();
      return;
    }
    switch (this.state) {
      case 'pending':
        if (e.timeStamp - f.t0 >= MENU_MS) { navigator.vibrate?.(25); this.contextMenu(f.x, f.y); }
        else this.tap(f.x, f.y, e.timeStamp);
        break;
      case 'aim':
        this.input.pointerAt(f.x, f.y);
        if (this.input.mode === 'place' && this.isWall()) this.input.primaryRelease(this.ptr(f.x, f.y));
        else this.tap(f.x, f.y, e.timeStamp);
        break;
      case 'box':
        this.h.overlay.selectionBox = null;
        if (Math.hypot(f.x - f.x0, f.y - f.y0) > 6) this.input.boxSelect(f.x0, f.y0, f.x, f.y, this.addMode);
        break;
    }
    this.end();
  }

  cancel(e: PointerEvent) {
    if (!this.fingers.delete(e.pointerId)) return;
    this.h.overlay.selectionBox = null;
    if (!this.fingers.size) this.end();
  }

  private end() {
    this.state = 'idle';
    this.active = this.fingers.size > 0;
    this.armed = false;
    this.pinch0 = null;
    this.hidePress();
  }

  /** Per frame (from InputController.update): long-press feedback ring, toolbar state. */
  update(_dt: number) {
    if (this.state === 'pending' && this.fingers.size === 1 && !this.armed) {
      const f = [...this.fingers.values()][0];
      if (performance.now() - f.t0 >= ARM_MS) {
        this.armed = true;
        this.showPress(f.x, f.y);
        navigator.vibrate?.(12);
      }
    }
    if (this.bar) {
      const hide = this.input.spectator;
      if ((this.bar.style.display === 'none') !== hide) this.bar.style.display = hide ? 'none' : '';
      const m = this.input.mode;
      for (const [id, b] of this.btns) {
        const on = id === 'box' ? this.boxMode : id === 'add' ? this.addMode : id === m;
        if (b.classList.contains('on') !== on) b.classList.toggle('on', on);
      }
    }
  }

  // ---------------------------------------------------------------------------
  private ptr(x: number, y: number): PtrLike {
    return { clientX: x, clientY: y, shiftKey: this.addMode, ctrlKey: false, altKey: false };
  }

  private isWall(): boolean {
    const t = this.input.placeType;
    return !!t && /^(sbag|brik|fenc|barb|wood|cycl)$/.test(t);
  }

  /** Drag the map so the ground point under the finger stays under it. */
  private grabPan(px: number, py: number, x: number, y: number) {
    const [ax, ay] = this.input.screenToGround(px, py);
    const [bx, by] = this.input.screenToGround(x, y);
    if (Number.isFinite(ax + ay + bx + by)) this.h.gfx.cam.dragBy(bx - ax, by - ay);
  }

  private metrics() {
    const [a, b] = [...this.fingers.values()];
    return { d: Math.max(20, Math.hypot(b.x - a.x, b.y - a.y)), a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  private applyPinch() {
    const p0 = this.pinch0;
    if (!p0 || this.fingers.size < 2) return;
    const m = this.metrics();
    const cam = this.h.gfx.cam;
    this.grabPan(this.pinchLast.mx, this.pinchLast.my, m.mx, m.my);
    this.pinchLast = { mx: m.mx, my: m.my };
    cam.targetDist = Math.max(cam.minDist, Math.min(cam.maxDist, (p0.dist * p0.d) / m.d));
    let da = m.a - p0.a;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    // a small dead zone so a pinch doesn't wobble the camera
    if (!p0.twist && Math.abs(da) > 0.14) p0.twist = true;
    if (p0.twist) cam.targetYaw = p0.yaw - da;
  }

  private showPress(x: number, y: number) {
    this.hidePress();
    const el = document.createElement('div');
    el.className = 'touch-press';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.appendChild(el);
    this.press = el;
  }

  private hidePress() {
    this.press?.remove();
    this.press = null;
  }

  /** Short tap: select own things, otherwise the context command for the selection. */
  private tap(x: number, y: number, time = performance.now()) {
    const inp = this.input;
    inp.tapTime = time;
    inp.pointerAt(x, y);
    const p = this.ptr(x, y);
    if (inp.mode !== 'normal') {
      inp.primaryPress(p);
      inp.primaryRelease(p);
      return;
    }
    const t = inp.pickAt(x, y, 1.6);
    const units = inp.ownSelectedUnits();
    const factories = inp.ownSelectedBuildings().filter((b) => b.bt.factory && b.bt.factory !== 'building');
    if (t && t.owner === inp.local && !(units.length && this.ownTargetIsCommand(t, units))) {
      inp.primaryPress(p);
      inp.primaryRelease(p);
      return;
    }
    if (units.length || (factories.length && !t)) {
      inp.contextAt(p);
      return;
    }
    inp.primaryPress(p);
    inp.primaryRelease(p);
  }

  /** Tapping an own thing with units selected that do something with it (board, dock, repair) is a command. */
  private ownTargetIsCommand(t: Entity, units: Unit[]): boolean {
    if (t instanceof Unit) return !!t.ut.passengers && units.some((u) => canCarry(t, u));
    if (t instanceof Building) {
      return (!!t.bt.dock && units.some((u) => u.ut.harvester)) || (!!t.bt.repairPad && units.some((u) => u.kind === 'vehicle' && !u.ut.harvester))
        || (t.hp < t.maxHp && units.some((u) => u.ut.engineer));
    }
    return false;
  }

  /** Long press: radial menu of orders for the selection at this point. */
  contextMenu(x: number, y: number) {
    const inp = this.input;
    if (inp.spectator) return;
    inp.pointerAt(x, y);
    const [gx, gy] = inp.screenToGround(x, y);
    const t = inp.pickAt(x, y, 1.6);
    const items = orderMenu(inp, (c) => this.h.issue(c), gx, gy, t);
    if (items.length) this.radial.open(x, y, items, t ? t.type.name : 'Orders');
  }
}

/**
 * Radial order menu for the current selection at ground point (gx, gy), entity t under it (touch long-press and
 * the gamepad's order menu share it).
 */
export function orderMenu(inp: InputController, issue: (c: Command) => void, gx: number, gy: number, t: Entity | null): RadialItem[] {
  const player = inp.local.id;
  const units = inp.ownSelectedUnits();
  const blds = inp.ownSelectedBuildings();
  const items: RadialItem[] = [];
  if (units.length) {
    const ids = units.map((u) => u.id);
    const ground = units.filter((u) => u.kind === 'infantry' || u.kind === 'vehicle');
    items.push({ id: 'amove', label: 'Attack-move', icon: CTRL_ICONS.attackMove, key: 'A', run: () => issue({ c: 'move', player, units: ids, x: gx, y: gy, attackMove: true }) });
    if (t && !inp.local.isEnemy(t.owner) && !inp.selection.has(t.id) && !(t instanceof Building && t.bt.mine)) {
      items.push({ id: 'guard', label: 'Guard this', icon: CTRL_ICONS.guard, key: 'C', run: () => issue({ c: 'guard', player, units: ids, target: t.id }) });
    }
    items.push({ id: 'patrol', label: 'Patrol here', icon: CTRL_ICONS.patrol, key: 'P', run: () => issue({ c: 'patrol', player, units: ids, points: [[gx, gy]] }) });
    items.push({
      id: 'force', label: t ? 'Force fire' : 'Fire here', icon: CTRL_ICONS.force, key: 'G',
      run: () => issue(t ? { c: 'attack', player, units: ids, target: t.id, forced: true } : { c: 'attackGround', player, units: ids, x: gx, y: gy }),
    });
    items.push({ id: 'stop', label: 'Stop', icon: CTRL_ICONS.stop, key: 'S', run: () => issue({ c: 'stop', player, units: ids }) });
    items.push({ id: 'scatter', label: 'Scatter', icon: CTRL_ICONS.scatter, key: 'X', run: () => issue({ c: 'scatter', player, units: ids }) });
    if (units.some((u) => u.ut.deploysInto || u.ut.passengers || u.ut.minelayer || u.kind === 'aircraft' || u.kind === 'naval')) {
      items.push({ id: 'deploy', label: units.some((u) => u.ut.passengers) ? 'Unload' : 'Deploy', icon: CTRL_ICONS.deploy, key: 'D', run: () => issue({ c: 'deploy', player, units: ids }) });
    }
    const armed = units.filter((u) => u.weapons.length);
    if (armed.length) {
      const cur = armed.every((u) => u.stance === armed[0].stance) ? armed[0].stance : null;
      items.push({
        id: 'stance', label: 'Stance', icon: CTRL_ICONS.stance, key: 'F1–F4',
        sub: STANCES.map((s, k) => ({ id: s.id, label: s.label, icon: CTRL_ICONS.stance, key: `F${k + 1}`, on: cur === s.id, run: () => inp.setStance(s.id) })),
      });
    }
    if (ground.length >= 2) {
      const cur = ground.every((u) => u.formShape === ground[0].formShape) ? ground[0].formShape : null;
      items.push({
        id: 'formation', label: 'Formation', icon: CTRL_ICONS.formation, key: 'L',
        sub: FORMATION_INFO.map((f) => ({ id: f.id, label: f.title.replace(' formation', ''), icon: f.icon, on: cur === f.id, run: () => inp.setFormation(f.id as FormationShape) })),
      });
    }
  } else if (blds.length) {
    const b = blds[0];
    items.push({ id: 'sell', label: 'Sell', icon: CTRL_ICONS.sell, key: 'Z', run: () => issue({ c: 'sell', player, building: b.id }) });
    items.push({ id: 'repair', label: b.repairing ? 'Stop repair' : 'Repair', icon: CTRL_ICONS.repair, key: 'R', on: b.repairing, run: () => issue({ c: 'repair', player, building: b.id }) });
    if (b.bt.factory && b.bt.factory !== 'building') {
      items.push({ id: 'primary', label: 'Primary', icon: CTRL_ICONS.primary, key: 'P', on: b.primary, run: () => issue({ c: 'primary', player, building: b.id }) });
      const facs = blds.filter((o) => o.bt.factory && o.bt.factory !== 'building');
      items.push({ id: 'rally', label: 'Rally here', icon: CTRL_ICONS.rally, run: () => { for (const f of facs) issue({ c: 'rally', player, building: f.id, x: gx, y: gy }); } });
      if (t instanceof Unit && t.owner === inp.local && t.kind !== 'aircraft') {
        items.push({ id: 'rallyUnit', label: 'Join this unit', icon: CTRL_ICONS.guard, run: () => { for (const f of facs) issue({ c: 'rallyUnit', player, building: f.id, target: t.id }); } });
      }
    }
  } else {
    items.push({ id: 'all', label: 'All units', icon: CTRL_ICONS.all, key: 'E', run: () => inp.keyCommand('e', true) });
    items.push({ id: 'idle', label: 'Idle unit', icon: CTRL_ICONS.add, key: 'I', run: () => inp.cycleIdle(false) });
    items.push({ id: 'army', label: 'Army', icon: CTRL_ICONS.all, key: '`', run: () => armyTools()?.toggle() }); // [ARMY] army overview
    items.push({ id: 'base', label: 'Base', icon: CTRL_ICONS.home, key: 'H', run: () => inp.keyCommand('h', true) });
    items.push({ id: 'alert', label: 'Last attack', icon: CTRL_ICONS.force, key: 'Space', run: () => inp.keyCommand(' ', true) });
  }
  return items;
}
