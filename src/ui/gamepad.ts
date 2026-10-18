/**
 * Gamepad support (Gamepad API, "standard" mapping: Xbox / PlayStation / Switch Pro layouts).
 *
 * In battle
 *   Left stick   virtual cursor (push it against the screen edge to scroll)   Right stick  pan the camera
 *   LT / RT      zoom out / in                    A  select / confirm (hold A and move: box select)
 *   X            context command (move, attack, harvest, enter…)              B  cancel the mode / deselect
 *   Y            deploy (D)                       View / Back  radial order menu (stop, scatter, attack-move,
 *                patrol, guard, force fire, stance, formation; sell / repair / rally for structures)
 *   LB (tap)     next idle unit;  hold LB = Shift (add to selection, queue waypoints, plan more structures)
 *   RB (tap)     next control group (centred);  hold RB = Ctrl (same type / force fire)
 *   D-pad        sidebar: move between build tabs, cards, support powers and the selection panel's
 *                buttons; A builds / clicks, X = right click (hold / cancel), LB / RB switch tabs, B leaves
 *   L3           all own units on screen          R3  jump to base          Start  pause menu
 * In menus (and the pause menu): D-pad / left stick move the focus, A clicks, B goes back (Esc),
 *   left / right adjust sliders.
 *
 * The manager polls the pads every frame: from the battle's InputController.update while a battle runs,
 * from its own requestAnimationFrame loop otherwise (menus). It installs itself when this module loads.
 */
import type { InputController, InputHost, PtrLike } from './input';
import { CTRL_ICONS, injectCtrlStyles, type RadialItem } from './orderui';
import { orderMenu } from './touch';
import tControls from '../i18n/en/controls';
import { typeName } from '../i18n/names';
import { esc } from './dom';

const DEAD = 0.2;
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const axis = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), .bitem, .grp, [role="button"]';
const SIDEBAR_FOCUSABLE = '#sidebar .tab, #sidebar .bitem, #sidebar .supers button, #sidebar .mode-btn, #selpanel button, #groups .grp, #rsch.on button, .econ-ro button' // (+ Commander economy: research tree, tier badge)
  + ', #buildbar .tab, #buildbar .bitem, #buildbar .supers button, #buildbar .mode-btn' // the Modern layout's bottom build bar
  + ', .ar-chip button, #army-panel.on button' // army chip and overview
  + ', #cmdpanel button'; // commander powers panel

interface Game { input: InputController; h: InputHost }

class GamepadManager {
  private game: Game | null = null;
  private raf = 0;
  private prev: boolean[] = [];
  private polledAt = 0;
  private lastT = 0;
  cx = window.innerWidth / 2;
  cy = window.innerHeight / 2;
  private cursorEl: HTMLElement | null = null;
  private helpEl: HTMLElement | null = null;
  private focusEl: HTMLElement | null = null;
  /** D-pad focus in the sidebar / selection panel during a battle. */
  private sidebar = false;
  private repeatAt = new Map<string, number>();
  /** Bumper held: acts as a modifier; `used` = another button was pressed meanwhile (no tap action). */
  private lb = { down: false, used: false };
  private rb = { down: false, used: false };
  private groupCursor = 0;
  private uiOn = false;

  install() {
    if (typeof window === 'undefined' || !('getGamepads' in navigator)) return;
    injectCtrlStyles();
    window.addEventListener('gamepadconnected', () => this.start());
    // the mouse takes over again
    window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && (Math.abs(e.movementX) + Math.abs(e.movementY) > 2)) this.setUi(false); });
    if (this.pad()) this.start();
  }

  private start() {
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (now: number) => {
    this.raf = 0;
    const pad = this.pad();
    // a battle polls from its frame; otherwise poll here
    if (pad && now - this.polledAt > 60) this.poll(pad, now);
    if (pad || navigator.getGamepads().some(Boolean)) this.raf = requestAnimationFrame(this.loop);
  };

  /** Called from InputController.update every frame of a battle. */
  frame() {
    const pad = this.pad();
    if (!pad) return;
    const now = performance.now();
    this.polledAt = now;
    this.poll(pad, now);
  }

  attach(game: Game): () => void {
    this.game = game;
    this.sidebar = false;
    this.cx = window.innerWidth / 2;
    this.cy = window.innerHeight / 2;
    return () => {
      if (this.game === game) this.game = null;
      this.sidebar = false;
      this.setFocus(null);
      this.cursorEl?.remove();
      this.helpEl?.remove();
      this.cursorEl = this.helpEl = null;
    };
  }

  private pad(): Gamepad | null {
    for (const p of navigator.getGamepads?.() ?? []) if (p && p.connected) return p;
    return null;
  }

  private setUi(on: boolean) {
    if (on === this.uiOn) return;
    this.uiOn = on;
    document.body.classList.toggle('gamepad-ui', on);
    if (!on) this.setFocus(null);
  }

  private poll(pad: Gamepad, now: number) {
    const dt = Math.min(0.1, this.lastT ? (now - this.lastT) / 1000 : 0.016);
    this.lastT = now;
    const btn = pad.buttons.map((b) => !!b && (b.pressed || b.value > 0.5));
    const pressed = (i: number) => btn[i] && !this.prev[i];
    const released = (i: number) => !btn[i] && this.prev[i];
    const lx = axis(pad.axes[0] ?? 0), ly = axis(pad.axes[1] ?? 0), rx = axis(pad.axes[2] ?? 0), ry = axis(pad.axes[3] ?? 0);
    const lt = pad.buttons[B.LT]?.value ?? 0, rt = pad.buttons[B.RT]?.value ?? 0;
    const any = btn.some(Boolean) || lx || ly || rx || ry;
    if (any) this.setUi(true);
    const g = this.game;
    if (g && !g.input.paused && document.getElementById('ui')?.firstChild) this.battle(g, btn, pressed, released, lx, ly, rx, ry, lt, rt, dt, now);
    else this.menu(pressed, lx, ly, now);
    this.prev = btn;
  }

  // ---------------------------------------------------------------------------
  // Battle
  // ---------------------------------------------------------------------------
  private battle(g: Game, _btn: boolean[], pressed: (i: number) => boolean, released: (i: number) => boolean,
    lx: number, ly: number, rx: number, ry: number, lt: number, rt: number, dt: number, now: number) {
    const inp = g.input;
    this.ensureCursor();
    // bumpers: modifiers while held, actions on a clean tap
    for (const [b, st] of [[B.LB, this.lb], [B.RB, this.rb]] as const) {
      if (pressed(b)) { st.down = true; st.used = false; }
      if (released(b)) {
        st.down = false;
        if (!st.used && !this.sidebar && !inp.touch.radial.isOpen) {
          if (b === B.LB) inp.cycleIdle(false);
          else this.nextGroup(inp);
        }
      }
    }
    const others = [B.A, B.B, B.X, B.Y, B.BACK, B.UP, B.DOWN, B.LEFT, B.RIGHT].some((i) => pressed(i));
    if (others) { if (this.lb.down) this.lb.used = true; if (this.rb.down) this.rb.used = true; }
    const ptr = (): PtrLike => ({ clientX: this.cx, clientY: this.cy, shiftKey: this.lb.down, ctrlKey: this.rb.down, altKey: false });
    // camera: right stick pans, triggers zoom (also while a menu is up)
    inp.padPan = [rx, ry];
    if (lt > 0.05 || rt > 0.05) g.h.gfx.cam.zoomBy((lt - rt) * 1500 * dt);
    if (pressed(B.START)) { inp.touch.radial.close(); inp.pause(); return; }

    // --- radial order menu
    const radial = inp.touch.radial;
    if (radial.isOpen) {
      radial.aim(lx, ly);
      if (pressed(B.LEFT) || pressed(B.UP)) radial.step(-1);
      if (pressed(B.RIGHT) || pressed(B.DOWN)) radial.step(1);
      if (pressed(B.A)) radial.confirm();
      if (pressed(B.B) || pressed(B.BACK)) radial.back();
      return;
    }

    // --- sidebar focus (D-pad)
    const dpad = this.dir(pressed, now, 'pad', 0, 0);
    if (dpad && !this.sidebar) { this.sidebar = true; if (!this.focusEl || !this.focusEl.isConnected) { this.setFocus(this.firstCard()); return; } }
    if (this.sidebar) {
      if (Math.hypot(lx, ly) > 0.5 || pressed(B.B)) { this.sidebar = false; this.setFocus(null); return; }
      if (!this.focusEl || !this.focusEl.isConnected) this.setFocus(this.firstCard());
      if (dpad) this.move(dpad, SIDEBAR_FOCUSABLE);
      if (pressed(B.LB) || pressed(B.RB)) this.switchTab(pressed(B.RB) ? 1 : -1);
      if (pressed(B.A) && this.focusEl) this.click(this.focusEl, this.lb.down);
      if (pressed(B.X) && this.focusEl) this.focusEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
      if (pressed(B.Y) && this.focusEl) this.focusEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true, view: window })); // Y: loop the card
      return;
    }

    // --- virtual cursor
    const mag = Math.hypot(lx, ly);
    if (mag > 0) {
      const speed = 260 + 1300 * mag ** 1.8;
      this.cx = Math.max(0, Math.min(window.innerWidth - 1, this.cx + (lx / mag) * speed * mag * dt));
      this.cy = Math.max(0, Math.min(window.innerHeight - 1, this.cy + (ly / mag) * speed * mag * dt));
    }
    if (mag > 0 || pressed(B.A) || pressed(B.X)) inp.pointerAt(this.cx, this.cy);
    this.drawCursor(inp);

    if (pressed(B.A)) inp.primaryPress(ptr());
    if (released(B.A)) inp.primaryRelease(ptr());
    if (pressed(B.X)) inp.contextAt(ptr());
    if (pressed(B.B)) {
      if (inp.mode !== 'normal') inp.setMode('normal');
      else inp.selection.clear();
    }
    if (pressed(B.Y)) inp.keyCommand('d', true);
    if (pressed(B.L3)) inp.selectOnScreen();
    if (pressed(B.R3)) inp.keyCommand('h', true);
    if (pressed(B.BACK)) this.orders(g);
  }

  /** Radial order menu at the cursor. */
  private orders(g: Game) {
    const inp = g.input;
    const [gx, gy] = inp.screenToGround(this.cx, this.cy);
    const t = inp.pickAt(this.cx, this.cy, 1.4);
    const items: RadialItem[] = orderMenu(inp, (c) => g.h.issue(c), gx, gy, t);
    const units = inp.ownSelectedUnits();
    if (units.length) {
      // modes that need a second click, plus the camera bookmarks
      items.splice(2, 0, { id: 'guardMode', label: tControls('radial.guardMode'), icon: CTRL_ICONS.guard, key: 'C', run: () => inp.setMode('guard') });
      items.push({ id: 'patrolMode', label: tControls('radial.patrolRoute'), icon: CTRL_ICONS.patrol, key: 'P', run: () => inp.setMode('patrol') });
    }
    if (items.length) inp.touch.radial.open(this.cx, this.cy, items, t ? typeName(t.type) : tControls('radial.orders'));
  }

  private nextGroup(inp: InputController) {
    const gs = [...inp.groups.entries()].filter(([, ids]) => ids.some((id) => inp.world.getEntity(id)?.alive)).map(([k]) => k).sort((a, b) => (a || 10) - (b || 10));
    if (!gs.length) { inp.message(tControls('gamepad.noGroups')); return; }
    const k = gs.find((x) => (x || 10) > (this.groupCursor || 10)) ?? gs[0];
    this.groupCursor = k;
    inp.recallGroup(k);
    inp.centreOn(inp.groups.get(k) ?? []);
    inp.message(tControls('gamepad.group', { g: k }));
  }

  /** Where D-pad focus starts in a battle: the first build card (else anything in the sidebar / panel). */
  private firstCard(): HTMLElement | null {
    return this.firstIn('#sidebar .bitem:not(.locked), #buildbar .bitem:not(.locked)') ?? this.firstIn(SIDEBAR_FOCUSABLE); // either layout
  }

  private switchTab(d: number) {
    const tabs = [...document.querySelectorAll<HTMLElement>('#sidebar .tab, #buildbar .tab')].filter((t) => t.offsetParent); // either layout
    if (!tabs.length) return;
    const cur = tabs.findIndex((t) => t.classList.contains('on') || t.classList.contains('active'));
    const next = tabs[(Math.max(0, cur) + d + tabs.length) % tabs.length];
    next.click();
    // the grid rebuilds on the next HUD update: focus its first card then
    setTimeout(() => { if (this.sidebar) this.setFocus(this.firstIn('#sidebar .bitem, #buildbar .bitem') ?? next); }, 120); // either layout
  }

  private ensureCursor() {
    if (this.cursorEl) return;
    const c = document.createElement('div');
    c.id = 'gp-cursor';
    c.innerHTML = `<svg viewBox="0 0 34 34" width="34" height="34"><circle class="gp-ring" cx="17" cy="17" r="11" fill="none" stroke="currentColor" stroke-width="2.4"/>
      <path d="M17 1v8M17 25v8M1 17h8M25 17h8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="17" cy="17" r="2.2" fill="currentColor"/></svg>`;
    document.body.appendChild(c);
    this.cursorEl = c;
    const help = document.createElement('div');
    help.id = 'gp-help';
    const h = (btn: string, cls: string, k: 'select' | 'command' | 'deploy' | 'cancel' | 'orders' | 'idle' | 'groups' | 'sidebar') => `<span><b${cls ? ` class="${cls}"` : ''}>${btn}</b>${esc(tControls(`gamepad.${k}`))}</span>`;
    help.innerHTML = h('A', 'A', 'select') + h('X', 'X', 'command') + h('Y', 'Y', 'deploy') + h('B', 'B', 'cancel') + h('☰', '', 'orders') + h('LB', '', 'idle') + h('RB', '', 'groups') + h('✚', '', 'sidebar');
    document.body.appendChild(help);
    this.helpEl = help;
  }

  private drawCursor(inp: InputController) {
    const c = this.cursorEl;
    if (!c) return;
    c.style.transform = `translate(${this.cx}px, ${this.cy}px)`;
    const kind = inp.cursorKind;
    const col = kind === 'attack' || kind === 'target' || kind === 'nomove' ? '#ff5a46' : kind === 'guard' ? '#5fd8ff' : kind === 'patrol' || kind === 'rally' || kind === 'enter' || kind === 'harvest' ? '#ffd34d' : '#7dff9e';
    if (c.style.color !== col) c.style.color = col;
  }

  // ---------------------------------------------------------------------------
  // Menus: spatial focus navigation
  // ---------------------------------------------------------------------------
  private menu(pressed: (i: number) => boolean, lx: number, ly: number, now: number) {
    const d = this.dir(pressed, now, 'menu', lx, ly);
    const f = this.focusEl && this.focusEl.isConnected && this.visible(this.focusEl) ? this.focusEl : null;
    if (!f) this.focusEl = null;
    if (d) {
      if (!f) { this.setFocus(this.preferred()); return; }
      // sliders take left / right
      if ((d === 'left' || d === 'right') && f instanceof HTMLInputElement && f.type === 'range') {
        const step = +(f.step || 0.01) * 5;
        f.value = String(Math.max(+f.min, Math.min(+f.max, +f.value + (d === 'right' ? step : -step))));
        f.dispatchEvent(new Event('input', { bubbles: true }));
        f.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      if ((d === 'left' || d === 'right') && f instanceof HTMLSelectElement) {
        f.selectedIndex = Math.max(0, Math.min(f.options.length - 1, f.selectedIndex + (d === 'right' ? 1 : -1)));
        f.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      this.move(d, FOCUSABLE);
    }
    if (pressed(B.A)) {
      if (f) this.click(f, false);
      else this.setFocus(this.preferred());
    }
    if (pressed(B.B) || pressed(B.START)) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      this.setFocus(null);
    }
  }

  /** Direction from the D-pad (and in menus the left stick), with key-repeat. */
  private dir(pressed: (i: number) => boolean, now: number, ch: string, lx: number, ly: number): 'up' | 'down' | 'left' | 'right' | null {
    let d: 'up' | 'down' | 'left' | 'right' | null = null;
    if (pressed(B.UP)) d = 'up';
    else if (pressed(B.DOWN)) d = 'down';
    else if (pressed(B.LEFT)) d = 'left';
    else if (pressed(B.RIGHT)) d = 'right';
    if (d) { this.repeatAt.set(ch, now + 380); return d; }
    // held D-pad / stick: repeat
    const pad = this.pad();
    const hold = (i: number) => !!pad?.buttons[i]?.pressed;
    let h: 'up' | 'down' | 'left' | 'right' | null = hold(B.UP) ? 'up' : hold(B.DOWN) ? 'down' : hold(B.LEFT) ? 'left' : hold(B.RIGHT) ? 'right' : null;
    if (!h && Math.hypot(lx, ly) > 0.6) h = Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? 'right' : 'left') : ly > 0 ? 'down' : 'up';
    if (!h) { this.repeatAt.delete(ch); return null; }
    const at = this.repeatAt.get(ch);
    if (at === undefined) { this.repeatAt.set(ch, now + 380); return h; }
    if (now >= at) { this.repeatAt.set(ch, now + 140); return h; }
    return null;
  }

  private visible(el: HTMLElement): boolean {
    if ((el as HTMLButtonElement).disabled) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return false;
    const x = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  }

  private candidates(sel: string): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => !el.closest('#gp-cursor, #gp-help') && this.visible(el));
  }

  private firstIn(sel: string): HTMLElement | null {
    const c = this.candidates(sel);
    c.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return ra.top - rb.top || ra.left - rb.left; });
    return c[0] ?? null;
  }

  private preferred(): HTMLElement | null {
    return this.firstIn('.btn.primary, .btn-primary, button.primary') ?? this.firstIn(FOCUSABLE);
  }

  private move(d: 'up' | 'down' | 'left' | 'right', sel: string) {
    const cur = this.focusEl;
    if (!cur) { this.setFocus(this.firstIn(sel)); return; }
    const r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    const [dx, dy] = d === 'up' ? [0, -1] : d === 'down' ? [0, 1] : d === 'left' ? [-1, 0] : [1, 0];
    let best: HTMLElement | null = null, bestS = Infinity;
    for (const el of this.candidates(sel)) {
      if (el === cur || el.contains(cur) || cur.contains(el)) continue;
      const r = el.getBoundingClientRect();
      const vx = r.left + r.width / 2 - cx, vy = r.top + r.height / 2 - cy;
      const along = vx * dx + vy * dy;
      if (along < 4) continue;
      const perp = Math.abs(vx * dy - vy * dx);
      const s = along + perp * 2.2;
      if (s < bestS) { bestS = s; best = el; }
    }
    if (best) this.setFocus(best);
  }

  private setFocus(el: HTMLElement | null) {
    if (this.focusEl) this.focusEl.classList.remove('gp-focus');
    this.focusEl = el;
    if (!el) return;
    el.classList.add('gp-focus');
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (el.matches('input, select, textarea, button, a[href]')) el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
  }

  private click(el: HTMLElement, shift: boolean) {
    if (el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'number')) { el.focus(); return; }
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: shift, view: window }));
  }
}

const manager = new GamepadManager();
if (typeof window !== 'undefined') manager.install();

/** Hook a battle's InputController up to the pads; returns the detach function. */
export function attachGamepad(input: InputController, h: InputHost): () => void {
  return manager.attach({ input, h });
}

/** Poll the pads (InputController.update, once per frame). */
export function gamepadFrame() {
  manager.frame();
}
