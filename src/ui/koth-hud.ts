/**
 * King of the Hill presentation: the HUD panel (control state + every team's hill time) and a ring on the
 * terrain around the hill in the holder's colour (pulsing orange while contested). Reads m.flags.koth only.
 */
import * as THREE from 'three';
import type { Game } from '../game';
import { kothStandings } from '../modes/koth';
import type { KothState } from '../modes/types';
import { TICK_HZ } from '../sim/types';
import { el, esc, hexColor } from './dom';
import { picto } from '../meta';
import { ensureModesCss } from './modes-css';
import tHud from '../i18n/en/hud';
import { currentLang, trSource } from '../i18n/core';

/** A team's name for display: "Gen. Volkov & Maj. Kane" (built-in names translate) or "Team 2". */
const teamLabel = (name: string): string => name.split(' & ').map(trSource).join(' & ');

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
const SEG = 96;

export class KothHud {
  private box: HTMLElement;
  private timer = 0;
  private key = '';
  private ring: THREE.Mesh;
  private disc: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private discMat: THREE.MeshBasicMaterial;
  private raf = 0;
  private lastPing = -1;

  constructor(private game: Game) {
    ensureModesCss();
    this.box = el('div', 'koth-hud panel');
    document.getElementById('ui')?.appendChild(this.box);
    const st = this.state();
    // ring + faint disc following the terrain
    const map = game.world.map;
    const h = (x: number, y: number) => map.surfaceAt(x, y) + 0.08;
    const ringGeo = new THREE.BufferGeometry();
    const pos: number[] = [], idx: number[] = [];
    const r0 = (st?.r ?? 5) - 0.18, r1 = (st?.r ?? 5) + 0.18;
    const cx = st?.x ?? map.w / 2, cy = st?.y ?? map.h / 2;
    for (let k = 0; k <= SEG; k++) {
      const a = (k / SEG) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      for (const r of [r0, r1]) { const x = cx + c * r, y = cy + s * r; pos.push(x, h(x, y), y); }
      if (k < SEG) { const b = k * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ringGeo.setIndex(idx);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, polygonOffset: true, polygonOffsetFactor: -4 }); // (flat: one pass)
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.renderOrder = 5;
    const discGeo = new THREE.BufferGeometry();
    const dp: number[] = [cx, h(cx, cy), cy], di: number[] = [];
    for (let k = 0; k <= SEG; k++) {
      const a = (k / SEG) * Math.PI * 2, x = cx + Math.cos(a) * r0, y = cy + Math.sin(a) * r0;
      dp.push(x, h(x, y), y);
      if (k < SEG) di.push(0, k + 1, k + 2);
    }
    discGeo.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
    discGeo.setIndex(di);
    this.discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, polygonOffset: true, polygonOffsetFactor: -3 });
    this.disc = new THREE.Mesh(discGeo, this.discMat);
    this.disc.renderOrder = 4;
    game.gfx.scene.add(this.ring, this.disc);
    this.timer = window.setInterval(() => this.render(), 250);
    const anim = () => { this.raf = requestAnimationFrame(anim); this.animate(); };
    this.raf = requestAnimationFrame(anim);
    this.render();
  }

  private state(): KothState | null {
    return (this.game.world.mission?.flags.koth as KothState | undefined) ?? null;
  }

  private animate() {
    const st = this.state();
    if (!st) return;
    const t = performance.now() / 1000;
    const holder = st.holder >= 0 ? this.game.world.players.find((p) => p.team === st.holder) : null;
    if (st.contested) {
      this.ringMat.color.setHex(0xff9a2a);
      this.ringMat.opacity = 0.55 + 0.4 * Math.abs(Math.sin(t * 5));
      this.discMat.color.setHex(0xff9a2a);
      this.discMat.opacity = 0.1;
    } else if (holder) {
      this.ringMat.color.setHex(holder.color);
      this.ringMat.opacity = 0.85 + 0.15 * Math.sin(t * 2);
      this.discMat.color.setHex(holder.color);
      this.discMat.opacity = 0.13;
    } else {
      this.ringMat.color.setHex(0xe8eef5);
      this.ringMat.opacity = 0.45 + 0.2 * Math.sin(t * 1.5);
      this.discMat.color.setHex(0xffffff);
      this.discMat.opacity = 0.05;
    }
  }

  private render() {
    const st = this.state();
    const g = this.game, w = g.world;
    if (!st) { this.box.style.display = 'none'; return; }
    this.box.style.display = '';
    // (a replay's view switch rebuilds the HUD, which clears #ui)
    if (!this.box.isConnected) { document.getElementById('ui')?.appendChild(this.box); this.key = ''; }
    const rows = kothStandings(w, st);
    const holderRow = rows.find((r) => r.team === st.holder);
    const stateCls = st.contested ? 'contested' : st.holder >= 0 ? 'held' : 'neutral';
    const stateText = st.contested ? tHud('koth.contested') : holderRow ? (st.holder === g.local.team && !g.setup.replay ? tHud('koth.youHold') : tHud('koth.heldBy', { name: teamLabel(holderRow.name) })) : tHud('koth.unclaimed');
    const key = `${stateCls}|${st.holder}|${rows.map((r) => `${r.team}:${Math.floor(r.seconds)}:${r.defeated}`).join(',')}|${g.local.team}|${currentLang()}`;
    if (key === this.key) return;
    this.key = key;
    this.box.innerHTML = `<div class="kh-head">${picto('trophy', 'ic')}<span>${tHud.html('koth.title')}</span><small>${tHud.html('koth.firstTo', { time: fmt(st.target / TICK_HZ) })}</small></div>
      <div class="kh-state ${stateCls}" style="--c:${holderRow ? hexColor(holderRow.color) : '#9aa'}"><i></i><span>${esc(stateText)}</span></div>
      <div class="kh-rows">${rows.map((r) => `<div class="kh-row${r.team === g.local.team ? ' me' : ''}${r.defeated ? ' dead' : ''}${r.team === st.holder ? ' holding' : ''}" style="--c:${hexColor(r.color)}">
        <i></i><span class="nm">${esc(r.team === g.local.team && !g.setup.replay ? tHud('koth.you') : teamLabel(r.name))}</span><span class="bar"><b style="width:${(r.frac * 100).toFixed(1)}%"></b></span><span class="t">${fmt(r.seconds)}</span></div>`).join('')}</div>`;
    // radar: ping the hill when control changes
    const sig = st.contested ? -2 : st.holder;
    if (sig !== this.lastPing) {
      this.lastPing = sig;
      g.hud?.minimap.ping(st.x, st.y, st.contested ? '#ff9a2a' : holderRow ? hexColor(holderRow.color) : '#ffffff');
    }
  }

  dispose() {
    window.clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    this.box.remove();
    this.game.gfx.scene.remove(this.ring, this.disc);
    this.ring.geometry.dispose();
    this.disc.geometry.dispose();
    this.ringMat.dispose();
    this.discMat.dispose();
  }
}
