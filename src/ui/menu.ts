import { GAME_SUBTITLE, GAME_TITLE, VERSION } from '../config';
import type { Faction } from '../data/rules';
import type { AIDifficulty } from '../sim/ai';
import type { Quality, TimeOfDay } from '../render/renderer';
import { formatTime } from '../core/util';
import { TEAM_COLORS, type Game, type GameSetup } from '../game';
import type { AudioSystem } from '../audio';

export interface Settings {
  quality: Quality;
  edgeScroll: boolean;
  unitVoices: boolean;
  hints: boolean;
}

const SETTINGS_KEY = 'rh.settings';
const SETUP_KEY = 'rh.setup';

export function loadSettings(): Settings {
  const def: Settings = { quality: 'high', edgeScroll: true, unitVoices: true, hints: true };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return def;
  }
}
export function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

interface SkirmishPrefs {
  faction: Faction;
  color: number;
  opponents: { faction: Faction | 'random'; difficulty: AIDifficulty }[];
  mapSize: number;
  water: number;
  trees: number;
  ore: number;
  credits: number;
  startUnits: 'mcv' | 'light' | 'heavy';
  fog: boolean;
  timeOfDay: TimeOfDay;
}

function loadPrefs(): SkirmishPrefs {
  const def: SkirmishPrefs = {
    faction: 'allies', color: TEAM_COLORS[0], opponents: [{ faction: 'soviet', difficulty: 'normal' }],
    mapSize: 96, water: 0.5, trees: 0.5, ore: 0.6, credits: 10000, startUnits: 'light', fog: true, timeOfDay: 'day',
  };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}') };
  } catch {
    return def;
  }
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function seg<T extends string | number | boolean>(options: [T, string][], value: T, onChange: (v: T) => void): HTMLElement {
  const box = h('div', 'seg');
  for (const [v, label] of options) {
    const b = h('button', v === value ? 'on' : '', label);
    b.onclick = () => {
      for (const c of box.children) c.classList.remove('on');
      b.classList.add('on');
      onChange(v);
    };
    box.appendChild(b);
  }
  return box;
}

function row(label: string, control: HTMLElement): HTMLElement {
  const r = h('div', 'row');
  r.append(h('label', '', label), control);
  return r;
}

export interface MenuCallbacks {
  start(setup: GameSetup): void;
  resume(): void;
  restart(): void;
  quit(): void;
  settingsChanged(s: Settings): void;
}

export class Menus {
  private screen: HTMLElement | null = null;
  settings = loadSettings();

  constructor(private audio: AudioSystem, private cb: MenuCallbacks) {}

  hide() {
    this.screen?.remove();
    this.screen = null;
  }

  private open(dim = true): HTMLElement {
    this.hide();
    const s = h('div', 'screen fade-in' + (dim ? ' dim' : ''));
    document.body.appendChild(s);
    this.screen = s;
    s.addEventListener('click', (e) => { if ((e.target as HTMLElement).tagName === 'BUTTON') this.audio.play('click'); });
    return s;
  }

  // ---------------------------------------------------------------------------
  showMain() {
    const s = this.open(false);
    s.style.background = 'radial-gradient(ellipse at 30% 50%, rgba(0,0,0,0.1), rgba(0,0,0,0.65) 70%)';
    const prefs = loadPrefs();
    document.body.classList.toggle('faction-soviet', prefs.faction === 'soviet');
    const wrap = h('div', 'menu-wrap');
    const title = h('div', 'title-block', `<h1 class="game-title">${GAME_TITLE.replace(' ', '<br>')}</h1><div class="game-sub">${GAME_SUBTITLE}</div>
      <div class="small" style="margin-top:28px;max-width:420px;line-height:1.6">Build a base, harvest ore, and crush the enemy.<br>Allied technology versus Soviet steel — reimagined for the web.</div>
      <div class="small" style="margin-top:16px;opacity:.6">v${VERSION}</div>`);
    const panel = h('div', 'menu-panel panel glow-edge');
    panel.appendChild(h('h2', '', 'Skirmish'));

    // faction cards
    const fac = h('div', 'factions');
    const mk = (f: Faction, name: string, desc: string, emblem: string) => {
      const c = h('div', `faction-card ${f}${prefs.faction === f ? ' on' : ''}`, `<span class="emblem">${emblem}</span><div class="fname">${name}</div><div class="fdesc">${desc}</div>`);
      c.onclick = () => {
        prefs.faction = f;
        for (const x of fac.children) x.classList.remove('on');
        c.classList.add('on');
        document.body.classList.toggle('faction-soviet', f === 'soviet');
        if (f === 'soviet' && prefs.color === TEAM_COLORS[0]) setColor(TEAM_COLORS[1]);
        if (f === 'allies' && prefs.color === TEAM_COLORS[1]) setColor(TEAM_COLORS[0]);
        this.audio.play('tab');
      };
      fac.appendChild(c);
    };
    mk('allies', 'ALLIES', 'Speed, precision & technology', '★');
    mk('soviet', 'SOVIETS', 'Armour, firepower & Tesla tech', '☭');
    panel.appendChild(fac);

    const colors = h('div', 'colors');
    const setColor = (c: number) => {
      prefs.color = c;
      for (const sw of colors.children) sw.classList.toggle('on', +(sw as HTMLElement).dataset.c! === c);
    };
    for (const c of TEAM_COLORS) {
      const sw = h('div', 'sw' + (c === prefs.color ? ' on' : ''));
      sw.style.background = '#' + c.toString(16).padStart(6, '0');
      sw.dataset.c = String(c);
      sw.onclick = () => setColor(c);
      colors.appendChild(sw);
    }
    panel.appendChild(row('Color', colors));

    // opponents
    const oppBox = h('div');
    oppBox.style.display = 'flex';
    oppBox.style.flexDirection = 'column';
    oppBox.style.gap = '6px';
    oppBox.style.flex = '1';
    const renderOpps = () => {
      oppBox.innerHTML = '';
      prefs.opponents.forEach((o, i) => {
        const r = h('div', 'opponent');
        r.appendChild(seg<Faction | 'random'>([['allies', 'Allies'], ['soviet', 'Soviet'], ['random', '?']], o.faction, (v) => { o.faction = v; }));
        r.appendChild(seg<AIDifficulty>([['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['brutal', 'Brutal']], o.difficulty, (v) => { o.difficulty = v; }));
        if (prefs.opponents.length > 1) {
          const x = h('button', 'btn', '✕');
          x.style.width = '38px';
          x.onclick = () => { prefs.opponents.splice(i, 1); renderOpps(); };
          r.appendChild(x);
        }
        oppBox.appendChild(r);
      });
      if (prefs.opponents.length < 3) {
        const add = h('button', 'btn', '+ Add opponent');
        add.onclick = () => { prefs.opponents.push({ faction: 'random', difficulty: 'normal' }); renderOpps(); };
        oppBox.appendChild(add);
      }
    };
    renderOpps();
    panel.appendChild(row('Opponents', oppBox));
    panel.appendChild(row('Map size', seg<number>([[64, 'Small'], [96, 'Medium'], [128, 'Large']], prefs.mapSize, (v) => { prefs.mapSize = v; })));
    panel.appendChild(row('Terrain', seg<number>([[0, 'Dry'], [0.5, 'Lakes'], [1, 'Wet']], prefs.water, (v) => { prefs.water = v; })));
    panel.appendChild(row('Credits', seg<number>([[5000, '5k'], [10000, '10k'], [20000, '20k']], prefs.credits, (v) => { prefs.credits = v; })));
    panel.appendChild(row('Start units', seg<'mcv' | 'light' | 'heavy'>([['mcv', 'MCV only'], ['light', 'Squad'], ['heavy', 'Company']], prefs.startUnits, (v) => { prefs.startUnits = v; })));
    panel.appendChild(row('Time of day', seg<TimeOfDay>([['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']], prefs.timeOfDay, (v) => { prefs.timeOfDay = v; })));
    panel.appendChild(row('Fog of war', seg<boolean>([[true, 'On'], [false, 'Off']], prefs.fog, (v) => { prefs.fog = v; })));

    const go = h('button', 'btn-primary', 'Deploy');
    go.onclick = () => {
      localStorage.setItem(SETUP_KEY, JSON.stringify(prefs));
      this.audio.unlock().catch(() => {});
      this.cb.start({
        faction: prefs.faction, color: prefs.color, opponents: prefs.opponents.map((o) => ({ ...o })), mapSize: prefs.mapSize,
        water: prefs.water, trees: prefs.trees, ore: prefs.ore, credits: prefs.credits, startUnits: prefs.startUnits, fog: prefs.fog,
        timeOfDay: prefs.timeOfDay, quality: this.settings.quality, seed: (Math.random() * 1e9) | 0,
      });
    };
    panel.appendChild(go);
    const btns = h('div', 'btn-row');
    const st = h('button', 'btn', 'Settings');
    st.onclick = () => this.showSettings(() => this.showMain());
    const help = h('button', 'btn', 'Controls');
    help.onclick = () => this.showHelp(() => this.showMain());
    btns.append(st, help);
    panel.appendChild(btns);
    wrap.append(title, panel);
    s.appendChild(wrap);
  }

  // ---------------------------------------------------------------------------
  showSettings(back: () => void) {
    const s = this.open();
    const panel = h('div', 'menu-panel panel glow-edge');
    panel.appendChild(h('h2', '', 'Settings'));
    panel.appendChild(row('Graphics', seg<Quality>([['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], this.settings.quality, (v) => { this.settings.quality = v; })));
    panel.appendChild(row('Edge scroll', seg<boolean>([[true, 'On'], [false, 'Off']], this.settings.edgeScroll, (v) => { this.settings.edgeScroll = v; })));
    panel.appendChild(row('Unit voices', seg<boolean>([[true, 'On'], [false, 'Off']], this.settings.unitVoices, (v) => { this.settings.unitVoices = v; })));
    panel.appendChild(row('Hints', seg<boolean>([[true, 'On'], [false, 'Off']], this.settings.hints, (v) => { this.settings.hints = v; })));
    const vols = this.audio.getVolumes();
    for (const [k, label] of [['master', 'Master'], ['sfx', 'Effects'], ['music', 'Music'], ['voice', 'Voices']] as const) {
      const sl = h('input', 'slider') as HTMLInputElement;
      sl.type = 'range';
      sl.min = '0'; sl.max = '1'; sl.step = '0.01';
      sl.value = String(vols[k]);
      sl.oninput = () => this.audio.setVolumes({ [k]: +sl.value });
      panel.appendChild(row(label, sl));
    }
    panel.appendChild(h('div', 'small', 'Graphics quality applies to the next game.'));
    const b = h('button', 'btn', 'Back');
    b.onclick = () => { saveSettings(this.settings); this.cb.settingsChanged(this.settings); back(); };
    panel.appendChild(b);
    s.appendChild(panel);
  }

  showHelp(back: () => void) {
    const s = this.open();
    const panel = h('div', 'menu-panel panel glow-edge');
    panel.style.width = '640px';
    panel.appendChild(h('h2', '', 'Controls'));
    const rows: [string, string][] = [
      ['Left click / drag', 'Select units · box select'],
      ['Double-click / Ctrl+click', 'Select all of that type on screen'],
      ['Right click', 'Move · attack · harvest · enter (context sensitive)'],
      ['Shift + right click', 'Queue waypoints'],
      ['Ctrl + right click', 'Force fire (ground or friendly)'],
      ['Alt + right click', 'Force move'],
      ['A', 'Attack-move'],
      ['S / X / G', 'Stop · Scatter · Fire at ground'],
      ['D', 'Deploy MCV (or click a selected MCV)'],
      ['Z / R / P', 'Sell · Repair · Primary factory'],
      ['Ctrl + 1-9 / 1-9', 'Assign / select group (double tap to jump)'],
      ['H / Space', 'Home base · Jump to last attack'],
      ['Arrows · edge · middle/right drag', 'Scroll the battlefield'],
      ['Mouse wheel', 'Zoom'],
      ['Hold Alt', 'Show all health bars'],
      ['Esc', 'Cancel · Pause menu'],
      ['Sidebar: left / right click', 'Build (Shift ×5) · hold / cancel'],
    ];
    const g = h('div', 'help-grid');
    for (const [k, v] of rows) g.append(h('div', '', `<kbd>${k}</kbd>`), h('div', '', v));
    panel.appendChild(g);
    const b = h('button', 'btn', 'Back');
    b.onclick = back;
    panel.appendChild(b);
    s.appendChild(panel);
  }

  // ---------------------------------------------------------------------------
  showPause(game: Game) {
    const s = this.open();
    const panel = h('div', 'menu-panel panel glow-edge');
    panel.style.width = '380px';
    panel.appendChild(h('h2', '', 'Paused'));
    panel.appendChild(h('div', 'small', `Mission time ${formatTime(game.world.time)}`));
    const mk = (label: string, fn: () => void, primary = false) => {
      const b = h('button', primary ? 'btn-primary' : 'btn', label);
      b.onclick = fn;
      panel.appendChild(b);
    };
    mk('Resume', () => { this.hide(); this.cb.resume(); }, true);
    mk('Settings', () => this.showSettings(() => this.showPause(game)));
    mk('Controls', () => this.showHelp(() => this.showPause(game)));
    mk('Restart', () => { this.hide(); this.cb.restart(); });
    mk('Quit to menu', () => { this.hide(); this.cb.quit(); });
    s.appendChild(panel);
  }

  showEnd(game: Game, won: boolean) {
    const s = this.open();
    const box = h('div', 'menu-panel panel glow-edge');
    box.style.width = '720px';
    box.appendChild(h('h1', 'end-title ' + (won ? 'win' : 'lose'), won ? 'VICTORY' : 'DEFEAT'));
    box.appendChild(h('div', 'small', `Mission time ${formatTime(game.world.time)}`));
    const t = h('table', 'stats-table');
    t.innerHTML = `<tr><th>Commander</th><th>Units built</th><th>Units lost</th><th>Kills</th><th>Structures lost</th><th>Ore harvested</th></tr>` +
      game.world.players.map((p) => `<tr><td style="color:#${p.color.toString(16).padStart(6, '0')}">${p.name}${p.defeated ? ' ✝' : ''}</td><td>${p.stats.unitsBuilt}</td><td>${p.stats.unitsLost}</td><td>${p.stats.unitsKilled + p.stats.buildingsKilled}</td><td>${p.stats.buildingsLost}</td><td>$${Math.round(p.stats.harvested).toLocaleString('en-US')}</td></tr>`).join('');
    box.appendChild(t);
    const btns = h('div', 'btn-row');
    const again = h('button', 'btn-primary', 'Play again');
    again.onclick = () => { this.hide(); this.cb.restart(); };
    const quit = h('button', 'btn', 'Main menu');
    quit.onclick = () => { this.hide(); this.cb.quit(); };
    const watch = h('button', 'btn', 'Keep watching');
    watch.onclick = () => { this.hide(); this.cb.resume(); };
    btns.append(again, watch, quit);
    box.appendChild(btns);
    s.appendChild(box);
  }
}
