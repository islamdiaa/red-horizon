import { GAME_SUBTITLE, GAME_TITLE, VERSION } from '../config';
import type { Faction } from '../data/rules';
import type { AIDifficulty } from '../sim/ai';
import type { Quality, TimeOfDay } from '../render/renderer';
import { formatTime } from '../core/util';
import { TEAM_COLORS, type Game, type GameSetup } from '../game';
import type { AudioSystem } from '../audio';
import { ICONS, alliedEmblem, medalSvg, rankBadge, sovietEmblem, type MedalTier } from './icons';
import { UiSound, bindTilt, countUp, el as h, esc, hexColor } from './dom';
import { Embers } from './embers';
import { initLoadingScreen } from './loading';
import { applyUiSettings, loadSettings, saveSettings, type Settings } from './settings';
import { dailyPending, picto, rankBadge as commanderBadge } from '../meta';
import { showProfile } from './profile';
import { showChallenges } from './challenges';

export { loadSettings, saveSettings, type Settings };

const SETUP_KEY = 'rh.setup';

export type Weather = 'auto' | 'clear' | 'rain' | 'storm' | 'snow' | 'fog' | 'dust';
export type Climate = 'temperate' | 'winter' | 'desert';

/** Extra skirmish options the renderer can pick up (the integrator adds these to GameSetup). */
export interface AtmosphereSetup {
  weather?: Weather;
  climate?: Climate;
  dayCycle?: boolean;
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
  weather: Weather;
  climate: Climate;
  dayCycle: boolean;
}

function loadPrefs(): SkirmishPrefs {
  const def: SkirmishPrefs = {
    faction: 'allies', color: TEAM_COLORS[0], opponents: [{ faction: 'soviet', difficulty: 'normal' }],
    mapSize: 96, water: 0.5, trees: 0.5, ore: 0.6, credits: 10000, startUnits: 'light', fog: true, timeOfDay: 'day',
    weather: 'auto', climate: 'temperate', dayCycle: true,
  };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}') };
  } catch {
    return def;
  }
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
type Opt<T> = [T, string, string?]; // value, label, icon

function seg<T extends string | number | boolean>(options: Opt<T>[], value: T, onChange: (v: T) => void, cls = ''): HTMLElement {
  const box = h('div', 'seg ' + cls);
  box.style.setProperty('--n', String(options.length));
  const thumb = h('span', 'seg-thumb');
  box.appendChild(thumb);
  const place = (i: number) => { thumb.style.transform = `translateX(${i * 100}%)`; box.dataset.i = String(i); };
  options.forEach(([v, label, icon], i) => {
    const b = h('button', v === value ? 'on' : '', `${icon ?? ''}<span>${label}</span>`);
    b.dataset.v = String(v);
    b.onclick = () => {
      for (const c of box.querySelectorAll('button')) c.classList.remove('on');
      b.classList.add('on');
      place(i);
      onChange(v);
    };
    box.appendChild(b);
  });
  place(Math.max(0, options.findIndex(([v]) => v === value)));
  return box;
}

function stepper<T extends string>(options: Opt<T>[], value: T, onChange: (v: T) => void): HTMLElement {
  const box = h('div', 'stepper');
  let i = Math.max(0, options.findIndex(([v]) => v === value));
  const prev = h('button', 'st-arrow', ICONS.chevL);
  const next = h('button', 'st-arrow', ICONS.chevR);
  const mid = h('div', 'st-mid');
  const dots = h('div', 'st-dots', options.map(() => '<i></i>').join(''));
  const render = (dir: number) => {
    const [, label, icon] = options[i];
    mid.innerHTML = `<span class="st-val ${dir > 0 ? 'from-r' : dir < 0 ? 'from-l' : ''}">${icon ?? ''}<b>${label}</b></span>`;
    dots.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
  };
  const go = (d: number) => { i = (i + d + options.length) % options.length; render(d); onChange(options[i][0]); };
  prev.onclick = () => go(-1);
  next.onclick = () => go(1);
  mid.onclick = () => go(1);
  box.append(prev, mid, next, dots);
  render(0);
  return box;
}

function toggle(value: boolean, onChange: (v: boolean) => void): HTMLButtonElement {
  const b = h('button', 'toggle' + (value ? ' on' : ''), '<i></i>');
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(value));
  b.onclick = () => {
    value = !value;
    b.classList.toggle('on', value);
    b.setAttribute('aria-checked', String(value));
    onChange(value);
  };
  return b;
}

function slider(value: number, onChange: (v: number) => void): HTMLElement {
  const wrap = h('div', 'slider-wrap');
  const s = h('input', 'slider') as HTMLInputElement;
  s.type = 'range';
  s.min = '0'; s.max = '1'; s.step = '0.01';
  s.value = String(value);
  const out = h('span', 'sv');
  const sync = () => { const p = Math.round(+s.value * 100); s.style.setProperty('--p', `${p}%`); out.textContent = `${p}%`; };
  s.oninput = () => { sync(); onChange(+s.value); };
  sync();
  wrap.append(s, out);
  return wrap;
}

function field(label: string, icon: string, control: HTMLElement, cls = ''): HTMLElement {
  const f = h('div', 'field ' + cls);
  f.append(h('label', '', `${icon}<span>${label}</span>`), control);
  return f;
}

function settingRow(icon: string, title: string, sub: string, control: HTMLElement): HTMLElement {
  const r = h('div', 'set-row');
  r.append(h('span', 'set-l', `<span class="set-ic">${icon}</span><span><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>`), control);
  return r;
}

function keycaps(k: string): string {
  return k.split(/( \+ | \/ | · )/).map((part) => (/^( \+ | \/ | · )$/.test(part) ? `<span class="kc-sep">${part.trim()}</span>` : `<kbd>${esc(part)}</kbd>`)).join('');
}

export interface MenuCallbacks {
  start(setup: GameSetup): void;
  resume(): void;
  /** Restart the match: the same map by default, a fresh one for "Play again". */
  restart(newMap?: boolean): void;
  quit(): void;
  settingsChanged(s: Settings): void;
  /** Open the campaign / special-ops screen. */
  openCampaign?(): void;
  /** Most recent saved game, if any. */
  continueInfo?(): { label: string; savedAt: number } | null;
  continueGame?(): void;
  /** Save the running game; returns success. */
  saveGame?(): boolean;
  /** Open the challenges hub (daily challenge, survival). Falls back to a built-in screen that deploys via start(). */
  openChallenges?(): void;
  /** Open the commander profile (rank, medals, history). Falls back to a built-in screen. */
  openProfile?(): void;
}

export class Menus {
  private screen: HTMLElement | null = null;
  private escAction: (() => void) | null = null;
  private sound: UiSound;
  settings = loadSettings();

  constructor(private audio: AudioSystem, private cb: MenuCallbacks) {
    this.sound = new UiSound(audio);
    applyUiSettings(this.settings);
    initLoadingScreen();
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.escAction || !this.screen) return;
      e.preventDefault();
      e.stopPropagation();
      this.escAction();
    });
  }

  hide() {
    const old = this.screen;
    this.screen = null;
    this.escAction = null;
    if (old) this.retire(old);
  }

  private retire(s: HTMLElement) {
    s.classList.add('leaving');
    s.style.pointerEvents = 'none';
    setTimeout(() => s.remove(), 420);
  }

  private open(cls: string, dim = true): HTMLElement {
    const old = this.screen;
    if (old) this.retire(old);
    this.escAction = null;
    const s = h('div', `screen ${cls}${dim ? ' dim' : ''}`);
    document.body.appendChild(s);
    this.screen = s;
    this.sound.bind(s, 'button:not(:disabled), .faction-card, .sw');
    s.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('button, .faction-card, .sw');
      if (t && !(t as HTMLButtonElement).disabled) this.sound.play('click');
    });
    return s;
  }

  private header(kicker: string, title: string, icon = ''): HTMLElement {
    return h('div', 'mp-head', `${icon ? `<span class="mp-ic">${icon}</span>` : ''}<div><small>${kicker}</small><h2>${title}</h2></div>`);
  }

  // ---------------------------------------------------------------------------
  showMain() {
    const s = this.open('main-screen', false);
    const prefs = loadPrefs();
    document.body.classList.toggle('faction-soviet', prefs.faction === 'soviet');
    s.innerHTML = `<div class="mm-shade"></div><canvas class="mm-embers"></canvas><div class="mm-lines"></div>`;
    const embers = new Embers(s.querySelector('.mm-embers') as HTMLCanvasElement);
    const layout = h('div', 'mm-layout');
    s.appendChild(layout);
    s.addEventListener('pointermove', (e) => {
      const x = e.clientX / window.innerWidth - 0.5, y = e.clientY / window.innerHeight - 0.5;
      layout.style.setProperty('--mx', x.toFixed(3));
      layout.style.setProperty('--my', y.toFixed(3));
      embers.pointer(x, y);
    });

    // ---- left column: title + navigation
    const words = GAME_TITLE.split(' ');
    const left = h('div', 'mm-left');
    left.innerHTML = `
      <div class="mm-kicker"><i></i><span>${esc(GAME_SUBTITLE)}</span></div>
      <h1 class="game-title">${words.map((w, i) => `<span class="gt-line" style="--d:${i}" data-text="${esc(w)}"><span class="gt-fill">${esc(w)}</span></span>`).join('')}</h1>
      <div class="mm-horizon"><i></i></div>
      <p class="mm-tag">Build a base, harvest ore and crush the enemy.<br>Allied technology versus Soviet steel — reimagined for the web.</p>`;
    const nav = h('nav', 'mm-nav');
    const navItem = (n: string, label: string, icon: string, fn: () => void, active = false) => {
      const b = h('button', 'mm-nav-btn' + (active ? ' on' : ''), `<span class="nb-idx">${n}</span><span class="nb-ic">${icon}</span><span class="nb-label">${label}</span><span class="nb-arrow">${ICONS.arrowR}</span>`);
      b.onclick = fn;
      nav.appendChild(b);
    };
    const cont = this.cb.continueInfo?.();
    if (cont) navItem('▶', `Continue · ${cont.label}`, ICONS.play, () => { this.hide(); this.cb.continueGame!(); });
    if (this.cb.openCampaign) navItem('01', 'Campaign', ICONS.flag, () => { this.hide(); this.cb.openCampaign!(); });
    navItem('02', 'Skirmish', ICONS.target, () => { panel.classList.remove('attn'); void panel.offsetWidth; panel.classList.add('attn'); }, true);
    navItem('03', `Challenges${dailyPending() ? '<em class="rh-daily-pill">Daily</em>' : ''}`, picto('trophy', 'ic'), () => this.openChallenges());
    navItem('04', 'Commander', picto('chevrons', 'ic'), () => this.openProfile());
    navItem('05', 'Settings', ICONS.gear, () => this.showSettings(() => this.showMain()));
    navItem('06', 'Controls', ICONS.keyboard, () => this.showHelp(() => this.showMain()));
    nav.querySelectorAll<HTMLElement>('.mm-nav-btn').forEach((b, i) => { b.style.animationDelay = `${(0.65 + i * 0.08).toFixed(2)}s`; });
    left.appendChild(nav);
    // commander badge (rank insignia + name) next to the title; opens the profile
    const cmdr = h('div', 'mm-cmdr', commanderBadge());
    cmdr.style.cssText = 'margin-bottom:1.3rem;animation:fadeUp .8s .05s var(--ease) both';
    cmdr.onclick = () => { this.sound.play('click'); this.openProfile(); };
    left.prepend(cmdr);
    left.appendChild(h('div', 'mm-foot', `<span class="live"><i></i>Live battlefield feed</span><span>v${VERSION}</span>`));

    // ---- right column: skirmish setup
    const panel = h('div', 'menu-panel panel mm-panel');
    panel.appendChild(this.header('Operation setup', 'Skirmish'));

    // factions
    const fac = h('div', 'factions');
    const mkFaction = (f: Faction, name: string, desc: string, traits: string[], emblem: string) => {
      const c = h('div', `faction-card ${f}${prefs.faction === f ? ' on' : ''}`, `<div class="fc-bg"></div><div class="fc-emblem">${emblem}</div>
        <div class="fc-text"><div class="fc-name">${name}</div><div class="fc-desc">${desc}</div><div class="fc-traits">${traits.map((t) => `<span>${t}</span>`).join('')}</div></div>
        <span class="fc-check">${ICONS.check}</span><div class="fc-glare"></div>`);
      c.onclick = () => {
        if (prefs.faction === f) return;
        prefs.faction = f;
        for (const x of fac.children) x.classList.remove('on');
        c.classList.add('on');
        document.body.classList.toggle('faction-soviet', f === 'soviet');
        if (f === 'soviet' && prefs.color === TEAM_COLORS[0]) setColor(TEAM_COLORS[1]);
        if (f === 'allies' && prefs.color === TEAM_COLORS[1]) setColor(TEAM_COLORS[0]);
        this.audio.play('tab');
      };
      bindTilt(c, 6);
      fac.appendChild(c);
    };
    mkFaction('allies', 'Allies', 'Speed, precision &amp; technology', ['Chronosphere', 'Air power', 'Artillery'], alliedEmblem());
    mkFaction('soviet', 'Soviets', 'Armour, firepower &amp; Tesla tech', ['Tesla Coils', 'Mammoth Tanks', 'Iron Curtain'], sovietEmblem());
    panel.appendChild(fac);

    // colour
    const colors = h('div', 'colors');
    const setColor = (c: number) => {
      prefs.color = c;
      for (const sw of colors.children) sw.classList.toggle('on', +(sw as HTMLElement).dataset.c! === c);
      renderOpps();
    };
    for (const c of TEAM_COLORS) {
      const sw = h('div', 'sw' + (c === prefs.color ? ' on' : ''));
      sw.style.setProperty('--c', hexColor(c));
      sw.dataset.c = String(c);
      sw.onclick = () => setColor(c);
      colors.appendChild(sw);
    }

    // opponents
    const oppBox = h('div', 'opponents');
    const oppCount = h('span', 'sec-count');
    const renderOpps = () => {
      oppBox.innerHTML = '';
      const used = new Set([prefs.color]);
      prefs.opponents.forEach((o, i) => {
        const color = TEAM_COLORS.find((c) => !used.has(c))!;
        used.add(color);
        const r = h('div', 'opponent');
        r.style.setProperty('--i', String(i));
        r.appendChild(h('span', 'op-id', `<i style="--c:${hexColor(color)}"></i>${ICONS.cpu}<b>AI ${i + 1}</b>`));
        r.appendChild(seg<Faction | 'random'>([['allies', 'Allies'], ['soviet', 'Soviet'], ['random', 'Random']], o.faction, (v) => { o.faction = v; }, 'op-fac'));
        r.appendChild(seg<AIDifficulty>([['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['brutal', 'Brutal']], o.difficulty, (v) => { o.difficulty = v; r.dataset.diff = v; }, 'op-diff'));
        r.dataset.diff = o.difficulty;
        const x = h('button', 'op-x', ICONS.close);
        x.title = 'Remove opponent';
        x.disabled = prefs.opponents.length <= 1;
        x.onclick = () => { prefs.opponents.splice(i, 1); renderOpps(); };
        r.appendChild(x);
        oppBox.appendChild(r);
      });
      if (prefs.opponents.length < 3) {
        const add = h('button', 'op-add', `${ICONS.plus}<span>Add opponent</span>`);
        add.onclick = () => { prefs.opponents.push({ faction: 'random', difficulty: 'normal' }); renderOpps(); };
        oppBox.appendChild(add);
      }
      oppCount.textContent = `${prefs.opponents.length} / 3`;
    };
    renderOpps();
    const forces = h('div', 'mp-section');
    const secHead = h('div', 'sec-title', `<span>Opponents</span>`);
    secHead.appendChild(oppCount);
    const colorRow = h('div', 'color-row', `<span class="cr-label">${ICONS.flag}<span>Team colour</span></span>`);
    colorRow.appendChild(colors);
    forces.append(colorRow, secHead, oppBox);
    panel.appendChild(forces);

    // battlefield / conditions
    const grid = h('div', 'mp-grid');
    const bf = h('div', 'mp-col');
    bf.appendChild(h('div', 'sec-title', '<span>Battlefield</span>'));
    bf.appendChild(field('Map size', ICONS.map, seg<number>([[64, 'Small'], [96, 'Medium'], [128, 'Large']], prefs.mapSize, (v) => { prefs.mapSize = v; })));
    bf.appendChild(field('Terrain', ICONS.water, seg<number>([[0, 'Dry'], [0.5, 'Lakes'], [1, 'Wet']], prefs.water, (v) => { prefs.water = v; })));
    bf.appendChild(field('Climate', ICONS.tree, seg<Climate>([['temperate', 'Temperate', ICONS.tree], ['winter', 'Winter', ICONS.snow], ['desert', 'Desert', ICONS.desert]], prefs.climate, (v) => { prefs.climate = v; }, 'with-ic')));
    bf.appendChild(field('Weather', ICONS.rain, stepper<Weather>([
      ['auto', 'Auto', ICONS.auto], ['clear', 'Clear', ICONS.clear], ['rain', 'Rain', ICONS.rain], ['storm', 'Storm', ICONS.storm],
      ['snow', 'Snow', ICONS.snow], ['fog', 'Fog', ICONS.fog], ['dust', 'Dust', ICONS.dust]], prefs.weather, (v) => { prefs.weather = v; })));
    const cond = h('div', 'mp-col');
    cond.appendChild(h('div', 'sec-title', '<span>Conditions</span>'));
    cond.appendChild(field('Time of day', ICONS.sun, seg<TimeOfDay>([['day', 'Day', ICONS.sun], ['dusk', 'Dusk', ICONS.dusk], ['night', 'Night', ICONS.moon]], prefs.timeOfDay, (v) => { prefs.timeOfDay = v; }, 'with-ic')));
    cond.appendChild(field('Credits', ICONS.coin, seg<number>([[5000, '$5k'], [10000, '$10k'], [20000, '$20k']], prefs.credits, (v) => { prefs.credits = v; })));
    cond.appendChild(field('Start units', ICONS.vehicle, seg<'mcv' | 'light' | 'heavy'>([['mcv', 'MCV only'], ['light', 'Squad'], ['heavy', 'Company']], prefs.startUnits, (v) => { prefs.startUnits = v; })));
    const toggles = h('div', 'toggle-pair');
    const tp = (icon: string, label: string, v: boolean, fn: (v: boolean) => void) => {
      const t = h('label', 'tp', `${icon}<span>${label}</span>`);
      t.appendChild(toggle(v, fn));
      toggles.appendChild(t);
    };
    tp(ICONS.cycle, 'Day / night cycle', prefs.dayCycle, (v) => { prefs.dayCycle = v; });
    tp(ICONS.eyeOff, 'Fog of war', prefs.fog, (v) => { prefs.fog = v; });
    cond.appendChild(toggles);
    grid.append(bf, cond);
    panel.appendChild(grid);

    const go = h('button', 'btn-primary deploy', `<span>Deploy</span>${ICONS.arrowR}<i class="shine"></i>`);
    go.onclick = () => {
      try { localStorage.setItem(SETUP_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
      this.audio.unlock().catch(() => {});
      const setup: GameSetup & AtmosphereSetup = {
        faction: prefs.faction, color: prefs.color, opponents: prefs.opponents.map((o) => ({ ...o })), mapSize: prefs.mapSize,
        water: prefs.water, trees: prefs.trees, ore: prefs.ore, credits: prefs.credits, startUnits: prefs.startUnits, fog: prefs.fog,
        timeOfDay: prefs.timeOfDay, quality: this.settings.quality, seed: (Math.random() * 1e9) | 0,
        weather: prefs.weather, climate: prefs.climate, dayCycle: prefs.dayCycle,
      };
      this.cb.start(setup);
    };
    panel.appendChild(go);
    layout.append(left, panel);
  }

  /** Challenges hub (daily challenge + survival); built-in fallback deploys through cb.start(). */
  openChallenges() {
    this.hide();
    if (this.cb.openChallenges) { this.cb.openChallenges(); return; }
    showChallenges({
      play: (k) => this.sound.play(k),
      onBack: () => this.showMain(),
      onProfile: () => this.openProfile(),
      onDeploy: (id) => this.cb.start({
        faction: 'allies', color: TEAM_COLORS[0], opponents: [], mapSize: 64, water: 0.5, trees: 0.5, ore: 0.6, credits: 5000,
        startUnits: 'mcv', fog: true, timeOfDay: 'day', quality: this.settings.quality, seed: 0, mission: id, intro: true,
      }),
    });
  }

  /** Commander profile; built-in fallback when main.ts does not provide openProfile. */
  openProfile() {
    this.hide();
    if (this.cb.openProfile) { this.cb.openProfile(); return; }
    showProfile({ play: (k) => this.sound.play(k), onBack: () => this.showMain() });
  }

  // ---------------------------------------------------------------------------
  showSettings(back: () => void) {
    const s = this.open('sub-screen');
    const panel = h('div', 'menu-panel panel settings-panel');
    panel.appendChild(this.header('Options', 'Settings', ICONS.gear));
    const apply = () => { saveSettings(this.settings); this.cb.settingsChanged(this.settings); };
    const sec = (icon: string, title: string) => {
      const x = h('section', 'set-sec', `<div class="sec-title">${icon}<span>${title}</span></div>`);
      return x;
    };
    const gfx = sec(ICONS.monitor, 'Graphics');
    gfx.appendChild(settingRow(ICONS.monitor, 'Quality', 'Applies to the next battle', seg<Quality>([['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], this.settings.quality, (v) => { this.settings.quality = v; apply(); })));
    gfx.appendChild(settingRow(ICONS.gauge, 'Performance overlay', 'FPS and renderer stats in the top bar', toggle(this.settings.showFps !== false, (v) => { this.settings.showFps = v; apply(); })));
    gfx.appendChild(settingRow(ICONS.motion, 'Reduce motion', 'Calmer UI animations', toggle(!!this.settings.reduceMotion, (v) => { this.settings.reduceMotion = v; apply(); })));
    const aud = sec(ICONS.volume, 'Audio');
    const vols = this.audio.getVolumes();
    const VOL: Record<string, [string, string]> = { master: ['Master', ICONS.volume], sfx: ['Effects', ICONS.bolt], music: ['Music', ICONS.music], voice: ['Voices', ICONS.mic], ambience: ['Ambience', ICONS.tree] };
    for (const k of Object.keys(vols) as (keyof typeof vols)[]) {
      const [label, icon] = VOL[k] ?? [k.charAt(0).toUpperCase() + k.slice(1), ICONS.volume];
      aud.appendChild(settingRow(icon, label, '', slider(vols[k], (v) => this.audio.setVolumes({ [k]: v } as Partial<typeof vols>))));
    }
    const play = sec(ICONS.mouse, 'Gameplay');
    play.appendChild(settingRow(ICONS.mouse, 'Edge scrolling', 'Scroll when the cursor touches the screen edge', toggle(this.settings.edgeScroll, (v) => { this.settings.edgeScroll = v; apply(); })));
    play.appendChild(settingRow(ICONS.mic, 'Unit voices', 'Acknowledgements when giving orders', toggle(this.settings.unitVoices, (v) => { this.settings.unitVoices = v; apply(); })));
    play.appendChild(settingRow(ICONS.bulb, 'Field manual hints', 'Contextual tips for new commanders', toggle(this.settings.hints, (v) => { this.settings.hints = v; apply(); })));
    play.appendChild(settingRow(ICONS.eye, 'Skip intro cinematic', 'Start every battle at your base', toggle(!!this.settings.skipIntro, (v) => { this.settings.skipIntro = v; apply(); })));
    const g = h('div', 'set-grid');
    g.append(gfx, aud, play);
    panel.appendChild(g);
    const done = () => { apply(); back(); };
    const b = h('button', 'btn btn-back', `${ICONS.chevL}<span>Back</span><kbd>Esc</kbd>`);
    b.onclick = done;
    panel.appendChild(b);
    s.appendChild(panel);
    this.escAction = done;
  }

  showHelp(back: () => void) {
    const s = this.open('sub-screen');
    const panel = h('div', 'menu-panel panel help-panel');
    panel.appendChild(this.header('Field manual', 'Controls', ICONS.keyboard));
    const groups: [string, string, [string, string][]][] = [
      ['Selection', ICONS.target, [
        ['LMB', 'Select · drag to box select'], ['Double-click', 'All of that type on screen'], ['Ctrl + LMB', 'All of that type on screen'],
        ['Ctrl + A', 'All combat units'], ['Ctrl + 1–9', 'Assign control group'], ['1–9', 'Recall group · double tap to jump'],
      ]],
      ['Orders', ICONS.attackMove, [
        ['RMB', 'Move · attack · harvest · enter'], ['Shift + RMB', 'Queue waypoints'], ['Ctrl + RMB', 'Force fire'], ['Alt + RMB', 'Force move'],
        ['A', 'Attack-move'], ['S / X / G', 'Stop · scatter · fire at ground'], ['D', 'Deploy · unload · return to base'],
      ]],
      ['Base', ICONS.building, [
        ['Z / R / P', 'Sell · repair · primary factory'], ['LMB', 'Sidebar: build (Shift ×5) · place'], ['RMB', 'Sidebar: hold / cancel'],
        ['RMB', 'Factory selected: set rally point'],
      ]],
      ['Camera', ICONS.eye, [
        ['Arrows', 'Scroll (or touch the screen edge)'], ['MMB / RMB drag', 'Pan the battlefield'], ['Wheel', 'Zoom'],
        ['H / Space', 'Home base · last attack'], ['Alt', 'Hold: show all health bars'], ['Esc', 'Cancel · pause menu'],
      ]],
    ];
    const g = h('div', 'help-grid');
    for (const [title, icon, rows] of groups) {
      const sct = h('section', 'help-sec', `<div class="sec-title">${icon}<span>${title}</span></div>`);
      for (const [k, v] of rows) sct.appendChild(h('div', 'help-row', `<span class="keys">${keycaps(k)}</span><span>${v}</span>`));
      g.appendChild(sct);
    }
    panel.appendChild(g);
    const b = h('button', 'btn btn-back', `${ICONS.chevL}<span>Back</span><kbd>Esc</kbd>`);
    b.onclick = back;
    panel.appendChild(b);
    s.appendChild(panel);
    this.escAction = back;
  }

  // ---------------------------------------------------------------------------
  showPause(game: Game) {
    const s = this.open('sub-screen pause-screen');
    const panel = h('div', 'menu-panel panel pause-panel');
    panel.appendChild(h('div', 'mp-head', `<span class="mp-ic pause-ic"><i></i><i></i></span><div><small>Mission on hold</small><h2>Paused</h2></div>`));
    const me = game.local;
    const foes = game.world.players.filter((o) => me.isEnemy(o));
    const alive = foes.filter((o) => !o.defeated).length;
    panel.appendChild(h('div', 'pp-stats', `
      <div>${ICONS.clock}<small>Mission time</small><b>${formatTime(game.world.time)}</b></div>
      <div>${ICONS.target}<small>Hostiles</small><b>${alive} / ${foes.length}</b></div>
      <div>${ICONS.coin}<small>Credits</small><b>$${me.credits.toLocaleString('en-US')}</b></div>`));
    const list = h('div', 'pp-list');
    const mk = (label: string, icon: string, fn: () => void, cls = '') => {
      const b = h('button', 'pp-btn ' + cls, `<span class="pp-bic">${icon}</span><span>${label}</span>${cls.includes('primary') ? '<kbd>Esc</kbd>' : ICONS.chevR}`);
      b.onclick = fn;
      list.appendChild(b);
    };
    const resume = () => { this.hide(); this.cb.resume(); };
    mk('Resume', ICONS.play, resume, 'primary');
    if (this.cb.saveGame) mk('Save game', ICONS.history, () => {
      const ok = this.cb.saveGame!();
      const lbl = list.querySelector('.pp-btn:nth-child(2) span:nth-child(2)');
      if (lbl) lbl.textContent = ok ? 'Game saved ✓' : 'Save failed';
    });
    mk('Settings', ICONS.gear, () => this.showSettings(() => this.showPause(game)));
    mk('Controls', ICONS.keyboard, () => this.showHelp(() => this.showPause(game)));
    mk('Restart', ICONS.restart, () => { this.hide(); this.cb.restart(); });
    mk('Quit to menu', ICONS.exit, () => { this.hide(); this.cb.quit(); }, 'danger');
    panel.appendChild(list);
    s.appendChild(panel);
    this.escAction = resume;
  }

  // ---------------------------------------------------------------------------
  showEnd(game: Game, won: boolean) {
    const s = this.open(`sub-screen end-screen ${won ? 'win' : 'lose'}`);
    const me = game.local;
    const rating = rateCommander(game, won);
    const title = won ? 'VICTORY' : 'DEFEAT';
    s.innerHTML = `<div class="end-wash"></div><div class="end-rays"></div>`;
    const wrap = h('div', 'end-wrap');
    const foes = game.world.players.filter((o) => me.isEnemy(o));
    wrap.innerHTML = `
      <div class="end-kicker">${won ? 'Mission accomplished' : 'Mission failed'}</div>
      <h1 class="end-title" data-text="${title}">${[...title].map((c, i) => `<span class="ltr" style="--i:${i}">${c}</span>`).join('')}</h1>
      <div class="end-meta"><span>${ICONS.clock}${formatTime(game.world.time)}</span><span>${ICONS.map}${game.world.map.w}×${game.world.map.h}</span><span>${ICONS.target}${foes.length} opponent${foes.length === 1 ? '' : 's'}</span></div>`;
    const body = h('div', 'end-body');
    // medal / rank
    const rank = h('div', 'end-rank panel', `<div class="er-medal">${medalSvg(rating.tier)}</div>
      <div class="er-grade">${rating.grade}</div><div class="er-title">${rating.title}</div>
      <div class="er-score"><small>Score</small><b data-count="${rating.score}">0</b></div>`);
    // stats
    const right = h('div', 'end-right');
    const rows = game.world.players.map((p) => {
      const kills = p.stats.unitsKilled + p.stats.buildingsKilled;
      return `<tr class="${p === me ? 'me' : ''}${p.defeated ? ' dead' : ''}" style="--c:${hexColor(p.color)}">
        <td><span class="pl"><i></i><span><b>${esc(p.name)}</b><small>${p.faction === 'soviet' ? 'Soviet' : 'Allied'}${p.defeated ? ' · eliminated' : p.team === game.world.winnerTeam ? ' · victor' : ''}</small></span></span></td>
        <td data-count="${p.stats.unitsBuilt}">0</td><td data-count="${p.stats.unitsLost}">0</td><td data-count="${kills}">0</td>
        <td data-count="${p.stats.buildingsLost}">0</td><td data-count="${Math.round(p.stats.harvested)}" data-prefix="$">$0</td></tr>`;
    }).join('');
    const table = h('table', 'stats-table');
    table.innerHTML = `<thead><tr><th>Commander</th><th>Built</th><th>Lost</th><th>Kills</th><th>Structures lost</th><th>Harvested</th></tr></thead><tbody>${rows}</tbody>`;
    right.appendChild(table);
    const mvp = game.world.units.filter((u) => u.alive && u.owner === me && u.kills > 0).sort((a, b) => b.kills - a.kills || b.xp - a.xp)[0];
    if (mvp) {
      const img = game.thumbs.get(mvp.type.id);
      right.appendChild(h('div', 'end-mvp', `<div class="mvp-tag">${ICONS.trophy}<span>MVP</span></div>
        <div class="mvp-por">${img ? `<img src="${img}" alt="">` : ICONS.vehicle}<span class="mvp-rank">${rankBadge(mvp.rank)}</span></div>
        <div class="mvp-info"><b>${esc(mvp.type.name)}</b><small>${['Rookie', 'Veteran', 'Elite'][mvp.rank]}</small></div>
        <div class="mvp-stat"><b data-count="${mvp.kills}">0</b><small>kills</small></div>`));
    } else {
      right.appendChild(h('div', 'end-mvp none', `<div class="mvp-tag">${ICONS.trophy}<span>MVP</span></div><div class="mvp-info"><b>No surviving veterans</b><small>Every hero fell in the line of duty</small></div>`));
    }
    body.append(rank, right);
    wrap.appendChild(body);
    const btns = h('div', 'btn-row end-btns');
    const again = h('button', 'btn-primary', `${ICONS.restart}<span>Play again</span>`);
    again.onclick = () => { this.hide(); this.cb.restart(true); };
    const watch = h('button', 'btn', `${ICONS.eye}<span>Keep watching</span>`);
    watch.onclick = () => { this.hide(); this.cb.resume(); };
    const quit = h('button', 'btn', `${ICONS.exit}<span>Main menu</span>`);
    quit.onclick = () => { this.hide(); this.cb.quit(); };
    btns.append(again, watch, quit);
    wrap.appendChild(btns);
    s.appendChild(wrap);
    setTimeout(() => countUp(wrap, 1300, 60), 900);
  }
}

/** Performance rating for the end screen medal. */
export function rateCommander(game: Game, won: boolean): { score: number; tier: MedalTier; grade: string; title: string } {
  const st = game.local.stats;
  const kills = st.unitsKilled + st.buildingsKilled;
  const lost = st.unitsLost + st.buildingsLost;
  const mins = game.world.time / 60;
  let r = won ? 45 : 8;
  r += Math.min(22, (kills / Math.max(1, lost)) * 7);
  r += Math.min(14, st.harvested / 1200);
  r += Math.min(8, st.buildingsKilled * 0.8);
  if (won) r += mins < 12 ? 11 : mins < 20 ? 7 : mins < 30 ? 3 : 0;
  r = Math.max(0, Math.min(100, r));
  const score = Math.round(r * 97 + kills * 25 + st.harvested * 0.05);
  const tiers: [number, MedalTier, string, string][] = [
    [88, 's', 'S', 'General of the Army'], [74, 'a', 'A', 'Colonel'], [60, 'b', 'B', 'Major'],
    [45, 'c', 'C', 'Captain'], [28, 'd', 'D', 'Lieutenant'], [0, 'e', 'E', 'Sergeant'],
  ];
  const [, tier, grade, title] = tiers.find(([min]) => r >= min)!;
  return { score, tier, grade, title };
}
