/**
 * In-game Map & Mission Editor (opened from the main menu).
 *
 *   Terrain mode: brushes (grass, sand, dirt, rock, water, ford, forest, clear trees, ore, gems,
 *   remove ore, raise, lower), bridges, start positions; symmetry with ghost cursors.
 *   Mission mode: pre-placed structures / units per player, objectives, triggers, briefing.
 *   2D top-down view for precise painting, 3D view on the real renderer (time of day / weather
 *   preview), undo / redo, validation (bases, routes, ore fairness), playtest, IndexedDB library,
 *   .rhmap.json import / export and thumbnails.
 */
import { CURATED_MAPS } from '../maps';
import { traceBridge } from '../maps/build';
import { drawMapPreview, mapPreviewUrl } from '../maps/preview';
import { MAP_SIZE_MAX, newCustomId } from '../maps/custom';
import type { Climate, MapDef, Pt, Symmetry } from '../maps/format';
import { BUILDINGS, UNITS, type Faction } from '../data/rules';
import type { GameSetup } from '../game';
import type { Quality } from '../render/renderer';
import type { WeatherKind } from '../render/weather';
import type { AIDifficulty } from '../sim/ai';
import type { GameMap } from '../sim/map';
import {
  DEFAULT_BRUSH, EditorModel, MAX_PLAYERS, SYMMETRY_INFO, addStart, bridgeAt, bridgeDefAt, maxAuthoredStarts, moveStart, nearestStart, newDoc, newMapDef,
  removeStart, resizeMap, resizeMission, setSymmetry, strokeFeature, type BrushKind, type BrushParams, type EditorDoc, type StartRef,
} from './doc';
import { AI_MODES, OBJECTIVE_KINDS, PORTRAITS, TRIGGER_DOS, TRIGGER_WHENS, defaultMission, type MissionSpec, type ObjectiveSpec, type Placement, type TriggerAction, type TriggerSpec } from './mission';
import { PLAYER_COLORS, type OverlayState } from './overlay';
import { deleteDoc, docToFile, fileName, getDoc, initEditorStore, listDocs, loadDraft, parseRhMap, saveDoc, saveDraft } from './store';
import { openShareDialog, SHARE_ICONS } from '../share/dialog'; // share links
import { mapShareData } from '../share/content'; // share links
import { injectEditorCss } from './styles';
import { footprintProblem, validateMap, validateMission, type Check, type MapReport } from './validate';
import { View2D } from './view2d';
import { View3D } from './view3d';
import { area, button, check, el, esc, heading, num, row, select, text } from './forms';
import tEd from '../i18n/en/editor'; // interface strings
import tCommon from '../i18n/en/common';
import { tDefault } from '../i18n/en/editor-mission';
import { dt, fmtDate, fmtInt, fmtMoney, fmtNum, fmtPct, tx } from '../i18n/core';
import { typeName } from '../i18n/names';

export interface EditorOptions {
  quality: Quality;
  play?: (k: 'click' | 'tab' | 'error') => void;
  onExit(): void;
  onPlaytest(setup: GameSetup): void;
}

type ToolId = BrushKind | 'bridge' | 'start' | 'select' | 'structure' | 'unit' | 'erase';
type ToolGroup = 'TERRAIN' | 'HEIGHT' | 'NATURE' | 'RESOURCES' | 'OBJECTS' | 'MISSION';
interface ToolDef { id: ToolId; color: string; icon?: string; group: ToolGroup; key?: string; mission?: boolean }

const svg = (p: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const IC = {
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  file: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>'),
  open: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  save: svg('<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v6h8V3M7 21v-7h10v7"/>'),
  down: svg('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 19h16"/>'),
  up: svg('<path d="M12 15V4M7 9l5-5 5 5"/><path d="M4 19h16"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5l13 7.5-13 7.5z"/></svg>',
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  bridge: svg('<path d="M2 16h20M4 16v-4M20 16v-4M2 12h20M8 12v4M12 12v4M16 12v4"/>'),
  start: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9 11l3-3 3 3"/>'),
  select: svg('<path d="M5 3l13 8-6 1.5L9 19z"/>'),
  structure: svg('<path d="M3 21h18M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/>'),
  unit: svg('<rect x="2" y="13" width="20" height="6" rx="3"/><path d="M6 13v-3h9v3M15 11h7"/>'),
  erase: svg('<path d="M4 16l9-9 7 7-6 6H8z"/><path d="M11 20h9"/>'),
  raise: svg('<path d="M3 19l6-9 4 5 3-3 5 7z"/><path d="M12 3v5M9.5 5.5L12 3l2.5 2.5"/>'),
  lower: svg('<path d="M3 9l6 9 4-5 3 3 5-7"/><path d="M12 3v5M9.5 5.5L12 8l2.5-2.5"/>'),
  noTree: svg('<path d="M12 21v-4M12 3l6 8h-3l3 5H6l3-5H6z"/><path d="M3 3l18 18"/>'),
  noOre: svg('<path d="M12 3l6 6-6 12L6 9z"/><path d="M3 3l18 18"/>'),
  dice: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r=".8" fill="currentColor"/><circle cx="15" cy="15" r=".8" fill="currentColor"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  pin: svg('<path d="M12 22s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>'),
};

const TOOLS: ToolDef[] = [
  { id: 'clear', color: '#6a9a48', group: 'TERRAIN', key: '1' },
  { id: 'sand', color: '#d8bc84', group: 'TERRAIN', key: '2' },
  { id: 'dirt', color: '#8a6a44', group: 'TERRAIN', key: '3' },
  { id: 'rock', color: '#8c867c', group: 'TERRAIN', key: '4' },
  { id: 'water', color: '#2e7fb0', group: 'TERRAIN', key: '5' },
  { id: 'ford', color: '#c8b07a', group: 'TERRAIN', key: '6' },
  { id: 'raise', color: '#e8eef4', icon: IC.raise, group: 'HEIGHT' },
  { id: 'lower', color: '#9fb0c2', icon: IC.lower, group: 'HEIGHT' },
  { id: 'forest', color: '#2f7a2c', group: 'NATURE', key: '7' },
  { id: 'deforest', color: '#c6d8a0', icon: IC.noTree, group: 'NATURE' },
  { id: 'ore', color: '#ffc23a', group: 'RESOURCES', key: '8' },
  { id: 'gems', color: '#b46cff', group: 'RESOURCES', key: '9' },
  { id: 'noore', color: '#c0a070', icon: IC.noOre, group: 'RESOURCES' },
  { id: 'bridge', color: '#ffd34d', icon: IC.bridge, group: 'OBJECTS', key: 'B' },
  { id: 'start', color: '#5ab4ff', icon: IC.start, group: 'OBJECTS', key: 'P' },
  { id: 'select', color: '#ffffff', icon: IC.select, group: 'MISSION', key: 'V', mission: true },
  { id: 'structure', color: '#5ab4ff', icon: IC.structure, group: 'MISSION', key: 'S', mission: true },
  { id: 'unit', color: '#58ff8a', icon: IC.unit, group: 'MISSION', key: 'U', mission: true },
  { id: 'erase', color: '#ff4a3a', icon: IC.erase, group: 'MISSION', key: 'X', mission: true },
];
const BRUSHES = new Set<ToolId>(['clear', 'sand', 'dirt', 'rock', 'water', 'ford', 'forest', 'deforest', 'ore', 'gems', 'noore', 'raise', 'lower']);
/** A tool's name and hint in the interface language (src/i18n/en/editor.ts). */
const toolLabel = (id: ToolId) => tEd(`tool.${id}.label`);
const toolHint = (id: ToolId) => tEd(`tool.${id}.hint`);

const SIZES = [64, 80, 96, 112, 128, 160, 192].filter((s) => s <= MAP_SIZE_MAX);
// option lists (labels looked up when shown; the documents keep the ids)
const CLIMATES = (): [Climate, string][] => (['temperate', 'winter', 'desert'] as const).map((c) => [c, tEd(`climate.${c}`)]);
const SYMS = (): [Symmetry, string][] => (Object.keys(SYMMETRY_INFO) as Symmetry[]).map((s) => [s, tEd(`sym.${s}.label`)]);
const WEATHERS = (): [string, string][] => (['auto', 'clear', 'rain', 'storm', 'snow', 'fog', 'dust'] as const).map((w) => [w, tEd(`weather.${w}`)]);
const GROUNDS = (islands: 'water' | 'waterNew'): [NonNullable<MapDef['ground']>, string][] => [['clear', tEd('ground.clear')], ['dirt', tEd('ground.dirt')], ['sand', tEd('ground.sand')], ['water', tEd(`ground.${islands}`)]];
/** An AI level's name (passive / defensive included). */
const aiName = (a: string) => (a === 'passive' ? tEd('mission.aiPassive') : tx(`common.difficulty.${a}`, undefined, a));
const climateName = (c: string) => (c === 'temperate' || c === 'winter' || c === 'desert' ? tEd(`climate.${c}`) : c);

/** Remembered between openings (returning from a playtest reopens the same document). */
let session: { model: EditorModel; view: '2d' | '3d'; tool: ToolId; mode: 'terrain' | 'mission'; brush: BrushParams; hours: number; weather: string; tab: string } | null = null;

const typeOptions = (kind: 'unit' | 'structure') => {
  const table = kind === 'unit' ? UNITS : BUILDINGS;
  const groups: Record<'allied' | 'soviet' | 'shared', [string, string][]> = { allied: [], soviet: [], shared: [] };
  for (const t of Object.values(table)) {
    if (kind === 'unit' && (t as { supportPlane?: boolean }).supportPlane) continue;
    if (kind === 'structure' && ((t as { mine?: string }).mine)) continue;
    const g = t.owner.length > 1 ? 'shared' : t.owner[0] === 'allies' ? 'allied' : 'soviet';
    groups[g].push([t.id, typeName(t)]);
  }
  return (Object.keys(groups) as (keyof typeof groups)[]).filter((g) => groups[g].length).map((g) => ({ group: tEd(`typeGroup.${g}`), items: groups[g].sort((a, b) => a[1].localeCompare(b[1])) }));
};

export interface EditorHandle { close(): void }

export function openEditor(opts: EditorOptions): EditorHandle {
  injectEditorCss();
  const play = (k: 'click' | 'tab' | 'error') => { try { opts.play?.(k); } catch { /* audio locked */ } };
  const root = el('div', 'ed');
  document.body.appendChild(root);

  // ---------------------------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------------------------
  const model = session?.model ?? new EditorModel(loadDraft() ?? newDoc(newMapDef({ name: tEd('untitled') })));
  const ui = {
    view: session?.view ?? '2d' as '2d' | '3d',
    mode: session?.mode ?? 'terrain' as 'terrain' | 'mission',
    tool: session?.tool ?? 'clear' as ToolId,
    brush: { ...(session?.brush ?? DEFAULT_BRUSH) } as BrushParams,
    hours: session?.hours ?? 11,
    weather: session?.weather ?? 'auto',
    tab: session?.tab ?? 'map',
    hover: null as Pt | null,
    stroke: null as Pt[] | null,
    dragStart: null as StartRef | null,
    dragPlacement: -1,
    selected: null as number | null,
    placeType: { unit: '2tnk', structure: 'powr' } as Record<'unit' | 'structure', string>,
    placePlayer: 1,
    pick: null as null | { label: string; fn: (x: number, y: number) => void },
    grid: true,
    guides: true,
    flash: null as Pt | null,
    flashUntil: 0,
    pan: null as null | { x: number; y: number; moved: boolean },
    msg: '',
    msgUntil: 0,
  };
  let closed = false;
  let needsPaint = true;
  let previewMap: GameMap | null = null;
  let lastPreview = 0;
  let report: MapReport | null = null;
  let missionChecks: Check[] = [];
  let checksAt = -1;
  let rebuild3dAt = 0;
  const remember = () => { session = { model, view: ui.view, tool: ui.tool, mode: ui.mode, brush: ui.brush, hours: ui.hours, weather: ui.weather, tab: ui.tab }; };

  // ---------------------------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------------------------
  const viewHost = el('div');
  root.appendChild(viewHost);
  const v2 = new View2D(viewHost);
  let v3: View3D | null = null;
  const hit = el('div', 'ed-hit');
  root.appendChild(hit);
  const busy = el('div', 'ed-busy', esc(tEd('busy')));
  root.appendChild(busy);

  const top = el('div', 'ed-panel ed-top');
  const tools = el('div', 'ed-panel ed-tools');
  const optsBar = el('div', 'ed-panel ed-opts');
  const side = el('div', 'ed-panel ed-side');
  const status = el('div', 'ed-panel ed-status');
  root.append(top, tools, optsBar, side, status);
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';

  const toast = (text: string, bad = false) => {
    const t = el('div', 'ed-toast' + (bad ? ' bad' : ''), esc(text));
    root.appendChild(t);
    setTimeout(() => t.remove(), 2700);
  };
  const area3d = () => ({ left: 6.4 * rem(), right: 24.8 * rem(), top: 4.6 * rem(), bottom: 3 * rem() });
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

  // ---- top bar
  const nameInput = el('input', 'ed-name') as HTMLInputElement;
  nameInput.maxLength = 48;
  nameInput.spellcheck = false;
  nameInput.onchange = () => { const v = nameInput.value.trim() || tEd('untitled'); model.edit((d) => { d.map.name = v; }); };
  nameInput.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') nameInput.blur(); };
  const dirtyDot = el('span', 'ed-dirty');
  const undoB = button(IC.undo, () => doUndo(), '', tEd('top.undo'));
  const redoB = button(IC.redo, () => doRedo(), '', tEd('top.redo'));
  const modeSeg = el('div', 'ed-seg');
  const terrainB = button(esc(tEd('top.terrain')), () => setMode('terrain'), '', tEd('top.terrainTip'));
  const missionB = button(esc(tEd('top.mission')), () => setMode('mission'), '', tEd('top.missionTip'));
  modeSeg.append(terrainB, missionB);
  const viewSeg = el('div', 'ed-seg');
  const b2d = button('2D', () => setView('2d'), '', tEd('top.view2dTip'));
  const b3d = button('3D', () => setView('3d'), '', tEd('top.view3dTip'));
  viewSeg.append(b2d, b3d);
  const brand = el('div', 'ed-brand', `<small>RED HORIZON</small><b>${esc(tEd('brand'))}</b>`);
  top.append(brand, nameInput, dirtyDot, el('span', 'ed-sep'), undoB, redoB, el('span', 'ed-sep'), modeSeg, viewSeg, el('span', 'ed-sp'),
    button(`${IC.file}<span>${esc(tEd('top.new'))}</span>`, () => newDialog(), 'lbl', tEd('top.newTip')),
    button(`${IC.open}<span>${esc(tEd('top.open'))}</span>`, () => libraryDialog(), 'lbl', tEd('top.openTip')),
    button(`${IC.save}<span>${esc(tEd('top.save'))}</span>`, () => void save(), 'lbl', tEd('top.saveTip')),
    button(`${IC.up}<span>${esc(tEd('top.import'))}</span>`, () => fileInput.click(), 'lbl', tEd('top.importTip')),
    button(`${IC.down}<span>${esc(tEd('top.export'))}</span>`, () => exportFile(), 'lbl', tEd('top.exportTip')),
    button(`${SHARE_ICONS.link}<span>${esc(tEd('top.link'))}</span>`, () => void openShareDialog({ kind: 'map', title: model.doc.map.name, data: mapShareData(model.doc), exportFile, play: () => play('click') }), 'lbl', tEd('top.linkTip')), // share links
    el('span', 'ed-sep'),
    button(`${IC.play}<span>${esc(tEd('top.playtest'))}</span>`, () => playtestMenu(), 'pri', tEd('top.playtestTip')),
    button(IC.x, () => exit(), '', tEd('top.exitTip')));

  // ---------------------------------------------------------------------------------------------
  // Tools and options
  // ---------------------------------------------------------------------------------------------
  const renderTools = () => {
    tools.innerHTML = '';
    let group = '';
    for (const t of TOOLS) {
      if (!!t.mission !== (ui.mode === 'mission')) continue;
      if (t.group !== group) { group = t.group; tools.appendChild(el('h6', '', esc(tEd(`group.${t.group}`)))); }
      const b = el('button', 'ed-tool' + (ui.tool === t.id ? ' on' : ''), `${t.icon ?? `<i style="background:${t.color}"></i>`}<span>${esc(toolLabel(t.id))}</span>${t.key ? `<kbd>${t.key}</kbd>` : ''}`);
      b.title = t.key ? tEd('tool.tipKey', { label: toolLabel(t.id), key: t.key, hint: toolHint(t.id) }) : tEd('tool.tip', { label: toolLabel(t.id), hint: toolHint(t.id) });
      b.onclick = () => { setTool(t.id); play('tab'); };
      tools.appendChild(b);
    }
  };

  const slider = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void, fmt = (v: number) => String(v)) => {
    const w = el('label', 'ed-opt', `<span>${esc(label)}</span>`);
    const r = el('input') as HTMLInputElement;
    r.type = 'range';
    r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(value);
    const o = el('output', '', fmt(value));
    r.oninput = () => { set(+r.value); o.textContent = fmt(+r.value); needsPaint = true; };
    w.append(r, o);
    return w;
  };

  const renderOpts = () => {
    optsBar.innerHTML = '';
    const t = ui.tool;
    if (BRUSHES.has(t)) {
      optsBar.appendChild(slider(tEd('opt.size'), ui.brush.radius, 0.5, 16, 0.5, (v) => { ui.brush.radius = v; }, (v) => fmtNum(v, 1)));
      if (t !== 'raise' && t !== 'lower') optsBar.appendChild(slider(tEd('opt.rough'), ui.brush.rough, 0, 1, 0.05, (v) => { ui.brush.rough = v; }, (v) => fmtPct(v)));
      if (t === 'forest') optsBar.appendChild(slider(tEd('opt.density'), ui.brush.density, 0.05, 1, 0.05, (v) => { ui.brush.density = v; }, (v) => fmtPct(v)));
      if (t === 'ore' || t === 'gems') optsBar.appendChild(slider(tEd('opt.rich'), ui.brush.rich, 0.4, 2, 0.1, (v) => { ui.brush.rich = v; }, (v) => `×${fmtNum(Math.round(v * 10) / 10, 1)}`));
      if (t === 'raise' || t === 'lower') optsBar.appendChild(slider(tEd('opt.strength'), ui.brush.amount, 0.1, 2, 0.05, (v) => { ui.brush.amount = v; }, (v) => fmtNum(v, 2)));
      if (model.doc.map.symmetry !== 'none') {
        const c = check(tEd('opt.symmetric'), !ui.brush.once, (v) => { ui.brush.once = !v; needsPaint = true; });
        c.classList.add('ed-opt');
        c.title = tEd('opt.symmetricTip', { n: SYMMETRY_INFO[model.doc.map.symmetry].group });
        optsBar.appendChild(c);
      }
    } else if (t === 'structure' || t === 'unit') {
      const w = el('label', 'ed-opt', `<span>${esc(tEd('opt.type'))}</span>`);
      w.appendChild(select(ui.placeType[t], typeOptions(t), (v) => { ui.placeType[t] = v; }));
      optsBar.appendChild(w);
      const p = el('label', 'ed-opt', `<span>${esc(tEd('opt.player'))}</span>`);
      const m = model.doc.mission;
      p.appendChild(select(ui.placePlayer, (m?.players ?? []).map((pl, i) => [i, `${i + 1} · ${pl.name}`] as [number, string]), (v) => { ui.placePlayer = v; }));
      optsBar.appendChild(p);
    }
    optsBar.appendChild(el('span', 'ed-opt', `<span class="ed-hint">${esc(toolHint(t))}</span>`));
  };

  const setTool = (t: ToolId) => {
    ui.tool = t;
    ui.pick = null;
    root.classList.remove('picking');
    renderTools();
    renderOpts();
    needsPaint = true;
  };
  const setMode = (m: 'terrain' | 'mission') => {
    if (ui.mode === m) return;
    ui.mode = m;
    if (m === 'mission' && !model.doc.mission) {
      model.edit((d) => { d.mission = defaultMission(model.map().startPositions.length, d.map.name); });
    }
    ui.tool = m === 'mission' ? 'select' : 'clear';
    if (m === 'mission') ui.tab = 'mission';
    renderTop();
    setTool(ui.tool);
    renderSide();
    play('tab');
  };
  const setView = (v: '2d' | '3d') => {
    if (ui.view === v) return;
    ui.view = v;
    renderTop();
    if (v === '3d') {
      if (!v3) v3 = new View3D(viewHost, { quality: opts.quality, hours: ui.hours, weather: ui.weather as WeatherKind });
      v3.overlay.style.display = '';
      v2.canvas.style.display = 'none';
      rebuild3dAt = 1; // now
    } else {
      v2.canvas.style.display = '';
      if (v3) { v3.dispose(); v3 = null; }
      needsPaint = true;
    }
    play('tab');
  };

  const renderTop = () => {
    nameInput.value = model.doc.map.name;
    dirtyDot.classList.toggle('on', model.dirty);
    dirtyDot.title = model.dirty ? tEd('dirty') : '';
    undoB.disabled = !model.canUndo;
    redoB.disabled = !model.canRedo;
    terrainB.classList.toggle('on', ui.mode === 'terrain');
    missionB.classList.toggle('on', ui.mode === 'mission');
    b2d.classList.toggle('on', ui.view === '2d');
    b3d.classList.toggle('on', ui.view === '3d');
  };

  // ---------------------------------------------------------------------------------------------
  // Side panel
  // ---------------------------------------------------------------------------------------------
  const renderSide = () => {
    side.innerHTML = '';
    const tabs = el('div', 'ed-tabs');
    const errs = (report?.errors ?? 0) + missionChecks.filter((c) => c.level === 'error').length;
    const warns = (report?.warnings ?? 0) + missionChecks.filter((c) => c.level === 'warning').length;
    for (const id of ['map', 'check', 'mission', 'view'] as const) {
      const b = el('button', 'ed-tab' + (ui.tab === id ? ' on' : ''), esc(tEd(`tab.${id}`)) + (id === 'check' && (errs || warns) ? `<span class="badge ${errs ? 'err' : ''}">${errs || warns}</span>` : ''));
      b.onclick = () => { ui.tab = id; play('tab'); renderSide(); };
      tabs.appendChild(b);
    }
    const body = el('div', 'ed-body');
    side.append(tabs, body);
    if (ui.tab === 'map') mapTab(body);
    else if (ui.tab === 'check') checkTab(body);
    else if (ui.tab === 'mission') missionTab(body);
    else viewTab(body);
  };

  const mapTab = (body: HTMLElement) => {
    const d = model.doc.map;
    body.append(heading(tEd('map.heading')),
      row(tEd('map.name'), text(d.name, (v) => { model.edit((x) => { x.map.name = v.trim() || tEd('untitled'); }); renderTop(); }, { max: 48 })),
      row(tEd('map.desc'), area(d.desc, (v) => model.edit((x) => { x.map.desc = v.slice(0, 400); }), 3)),
      row(tEd('map.author'), text(d.author ?? '', (v) => model.edit((x) => { x.map.author = v.trim().slice(0, 40) || undefined; }), { max: 40 })),
      row(tEd('map.tags'), text((d.tags ?? []).join(', '), (v) => model.edit((x) => { const t = v.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6); x.map.tags = t.length ? t : undefined; }), { placeholder: tEd('map.tagsHint') })));
    body.append(heading(tEd('map.layout')));
    const scaleBox = check(tEd('map.scale'), true, () => {});
    body.append(row(tEd('map.size'), select(d.size, SIZES.map((s) => [s, `${s} × ${s}`] as [number, string]), (v) => {
      const scale = (scaleBox.querySelector('input') as HTMLInputElement).checked;
      const from = model.doc.map.size;
      model.edit((x) => { resizeMap(x.map, v, scale); if (x.mission) resizeMission(x.mission, from, v, scale); });
      fitView();
      renderSide();
    }), scaleBox));
    body.append(row(tEd('map.symmetry'), select(d.symmetry, SYMS(), (v) => { model.edit((x) => setSymmetry(x.map, v)); renderSide(); renderOpts(); })));
    body.append(el('div', 'ed-note', esc(`${tEd('map.summary', { players: d.players, starts: d.starts.length, group: SYMMETRY_INFO[d.symmetry].group })} ${tEd(d.symmetry === 'none' ? 'map.free' : 'map.symmetric')}`)));
    body.append(row(tEd('map.climate'), select(d.climate, CLIMATES(), (v) => { model.edit((x) => { x.map.climate = v; }); })));
    body.append(row(tEd('map.ground'), select<string>(d.ground ?? 'clear', GROUNDS('water'), (v) => model.edit((x) => { x.map.ground = v === 'clear' ? undefined : v as MapDef['ground']; }))));
    const seed = num(d.seed, (v) => model.edit((x) => { x.map.seed = Math.round(v); }), { min: 0, max: 999999999 });
    body.append(row(tEd('map.seed'), seed, button(IC.dice, () => { const s = Math.floor(Math.random() * 1e6); seed.value = String(s); model.edit((x) => { x.map.seed = s; }); }, '', tEd('map.seedTip'))));
    body.append(row(tEd('map.baseArea'), num(d.clearRadius ?? 9.5, (v) => model.edit((x) => { x.map.clearRadius = v; }), { min: 6, max: 14, step: 0.5 })));
    body.append(row(tEd('map.relief'), num(d.relief ?? 1, (v) => model.edit((x) => { x.map.relief = v; }), { min: 0, max: 3, step: 0.1 })));
    body.append(row(tEd('map.naval'), check(tEd('map.navalCheck'), !!d.naval, (v) => model.edit((x) => { x.map.naval = v || undefined; }))));
    body.append(heading(tEd('map.content')));
    body.append(el('div', 'ed-note', esc(tEd('map.contentNote', { strokes: d.features.length, bridges: (d.bridges ?? []).length, ore: model.map().oreFieldCells.length }))));
    body.append(el('div', 'row', ''), button(esc(tEd('map.clearAll')), () => { if (confirm(tEd('map.clearAllConfirm'))) model.edit((x) => { x.map.features = []; x.map.bridges = []; }); }, 'warn'));
  };

  const checkTab = (body: HTMLElement) => {
    const r = report ?? validateMap(model.doc.map, model.map());
    const mapErr = r.errors;
    const v = el('div', 'ed-verdict ' + (mapErr ? 'bad' : 'ok'), mapErr
      ? `✗ <div>${esc(tEd('check.notPlayable'))}<small>${esc(r.warnings ? tEd('check.andWarnings', { errors: mapErr, warnings: r.warnings }) : tEd('check.errorsOnly', { errors: mapErr }))}</small></div>`
      : `✓ <div>${esc(tEd('check.ready'))}<small>${esc(r.warnings ? tEd('check.warnings', { n: r.warnings }) : tEd('check.passes'))}</small></div>`);
    body.appendChild(v);
    const thumb = el('canvas', 'ed-thumb') as HTMLCanvasElement;
    drawMapPreview(thumb, model.map(), { size: 320 });
    body.appendChild(thumb);
    if (r.ore.length >= 2) {
      body.appendChild(heading(tEd('check.orePerPlayer', { spread: fmtPct(r.spread, 1) })));
      const hi = Math.max(1, ...r.ore.map((o) => o.total));
      r.ore.forEach((o, k) => body.appendChild(el('div', 'ed-ore', `<i class="ed-dot" style="background:${PLAYER_COLORS[k % PLAYER_COLORS.length]}"></i><div class="bar"><b style="width:${(o.total / hi) * 100}%;background:${PLAYER_COLORS[k % PLAYER_COLORS.length]}"></b></div><span>${fmtInt(o.total)}</span>`)));
    }
    const list = (title: string, checks: Check[]) => {
      body.appendChild(heading(title));
      for (const c of checks) {
        const it = el('div', `ed-check ${c.level}${c.at ? ' at' : ''}`, `<i>${c.level === 'ok' ? '✓' : c.level === 'warning' ? '!' : '✗'}</i><span>${esc(c.title)}</span>${c.detail ? `<small>${esc(c.detail)}</small>` : ''}`);
        if (c.at) it.onclick = () => focusOn(c.at!);
        body.appendChild(it);
      }
    };
    list(tEd('check.mapChecks'), r.checks);
    if (model.doc.mission) list(tEd('check.missionChecks'), missionChecks);
  };

  const viewTab = (body: HTMLElement) => {
    body.append(heading(tEd('view.preview')));
    const hours = el('label', 'ed-opt');
    const hr = el('input') as HTMLInputElement;
    hr.type = 'range'; hr.min = '0'; hr.max = '24'; hr.step = '0.25'; hr.value = String(ui.hours);
    const ho = el('output', '', fmtHour(ui.hours));
    hr.oninput = () => { ui.hours = +hr.value; ho.textContent = fmtHour(ui.hours); if (v3) { v3.opts.hours = ui.hours; v3.applyLook(); } };
    hours.append(hr, ho);
    body.append(row(tEd('view.time'), hours));
    body.append(row(tEd('view.weather'), select(ui.weather, WEATHERS(), (v) => { ui.weather = v; if (v3) { v3.opts.weather = v as WeatherKind; v3.applyLook(); } })));
    body.append(row(tEd('view.quality'), select(opts.quality, [['low', tEd('view.low')], ['medium', tEd('view.medium')], ['high', tEd('view.high')]] as [Quality, string][], (v) => { opts.quality = v; if (v3) { v3.opts.quality = v; v3.invalidate(); rebuild3dAt = 1; } })));
    body.append(el('div', 'ed-note', esc(tEd('view.note'))));
    body.append(heading(tEd('view.view2d')));
    body.append(row(tEd('view.grid'), check(tEd('view.gridCheck'), ui.grid, (v) => { ui.grid = v; needsPaint = true; })));
    body.append(row(tEd('view.guides'), check(tEd('view.guidesCheck'), ui.guides, (v) => { ui.guides = v; needsPaint = true; })));
    body.append(row(tEd('view.camera'), button(esc(tEd('view.fit')), () => { fitView(); }, '', tEd('view.fitTip'))));
    body.append(heading(tEd('view.keys')));
    body.append(el('div', 'ed-note', tEd.html('view.keyList')));
  };
  const fmtHour = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

  // ---- mission tab -----------------------------------------------------------------------------
  const medit = (fn: (m: MissionSpec) => void, rerender = false) => {
    model.edit((d) => { if (d.mission) fn(d.mission); });
    if (rerender) renderSide();
  };
  const tagOptions = (): [string, string][] => {
    const m = model.doc.mission!;
    return [['', tEd('mission.choose')], ...m.placements.filter((p) => p.tag).map((p) => [p.tag!, tEd('mission.tagOption', { tag: p.tag!, name: placementName(p), n: p.player + 1 })] as [string, string])];
  };
  const playerOptions = (from = 0): [number, string][] => model.doc.mission!.players.map((p, i) => [i, `${i + 1} · ${p.name}`] as [number, string]).slice(from);
  const placementName = (p: Placement) => { const t = p.kind === 'unit' ? UNITS[p.type] : BUILDINGS[p.type]; return t ? typeName(t) : p.type; };
  const pickBtn = (what: 'objectiveArea' | 'triggerArea' | 'arrival' | 'destination' | 'reveal', fn: (x: number, y: number) => void) => button(`${IC.pin}<span>${esc(tEd('mission.pick'))}</span>`, () => startPick(tEd(`pick.${what}`), fn), '', tEd('mission.pickTip'));

  const missionTab = (body: HTMLElement) => {
    const m = model.doc.mission;
    if (!m) {
      body.append(heading(tEd('mission.heading')), el('div', 'ed-note', esc(tEd('mission.intro'))),
        button(esc(tEd('mission.add')), () => setMode('mission'), 'pri'));
      return;
    }
    const starts = model.map().startPositions.length;
    // selected placement inspector
    if (ui.selected !== null && m.placements[ui.selected]) {
      const i = ui.selected, p = m.placements[i];
      body.append(heading(tEd('mission.selected'), button(esc(tEd('mission.delete')), () => { medit((mm) => { mm.placements.splice(i, 1); }); ui.selected = null; renderSide(); }, 'warn')));
      const card = el('div', 'ed-card sel');
      card.append(row(tEd('mission.type'), select(p.type, typeOptions(p.kind), (v) => medit((mm) => { mm.placements[i].type = v; }))),
        row(tEd('mission.player'), select(p.player, playerOptions(), (v) => medit((mm) => { mm.placements[i].player = v; }))),
        row(tEd('mission.tag'), text(p.tag ?? '', (v) => medit((mm) => { const s = v.trim().replace(/\s+/g, '-').slice(0, 30); mm.placements[i].tag = s || undefined; }, true), { placeholder: tEd('mission.tagHint') })),
        row(tEd('mission.health'), num(Math.round((p.health ?? 1) * 100), (v) => medit((mm) => { mm.placements[i].health = v >= 100 ? undefined : v / 100; }), { min: 1, max: 100 })));
      card.appendChild(el('div', 'ed-note', esc(tEd('mission.at', { name: placementName(p), x: fmtNum(p.x, 1), y: fmtNum(p.y, 1) }))));
      body.appendChild(card);
    }
    // briefing
    body.append(heading(tEd('mission.briefing')),
      row(tEd('mission.title'), text(m.title, (v) => medit((mm) => { mm.title = v.slice(0, 60); }), { max: 60 })),
      row(tEd('mission.codename'), text(m.codename, (v) => medit((mm) => { mm.codename = v.toUpperCase().slice(0, 30); }), { max: 30 })),
      row(tEd('mission.location'), text(m.location, (v) => medit((mm) => { mm.location = v.slice(0, 60); }), { max: 60, placeholder: tEd('mission.locationHint', { map: model.doc.map.name }) })),
      row(tEd('mission.briefingText'), area(m.briefing.join('\n\n'), (v) => medit((mm) => { mm.briefing = v.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).slice(0, 12); }), 5)),
      row(tEd('mission.tips'), area((m.tips ?? []).join('\n'), (v) => medit((mm) => { mm.tips = v.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8); }), 3)),
      row(tEd('mission.parTime'), num(m.parTime ? Math.round(m.parTime / 60) : 0, (v) => medit((mm) => { mm.parTime = Math.round(v) * 60; }), { min: 0, max: 240, placeholder: tEd('mission.minutes') })));
    body.append(heading(tEd('mission.conditions')),
      row(tEd('mission.time'), select(m.timeOfDay, [['day', tEd('mission.day')], ['dusk', tEd('mission.dusk')], ['night', tEd('mission.night')]] as [MissionSpec['timeOfDay'], string][], (v) => medit((mm) => { mm.timeOfDay = v; }))),
      row(tEd('mission.weather'), select(m.weather, WEATHERS(), (v) => medit((mm) => { mm.weather = v; }))),
      row(tEd('mission.options'), check(tEd('mission.fog'), m.fog, (v) => medit((mm) => { mm.fog = v; })), check(tEd('mission.dayCycle'), m.dayCycle, (v) => medit((mm) => { mm.dayCycle = v; }))));
    // players
    body.append(heading(tEd('mission.players', { n: m.players.length, max: Math.min(starts, 6) }), button(esc(tEd('mission.addItem')), () => {
      if (m.players.length >= Math.min(starts, 6)) { toast(tEd('mission.tooManyPlayers', { n: starts }), true); return; }
      medit((mm) => { mm.players.push({ name: tDefault('player', { n: mm.players.length + 1 }), faction: mm.players.length % 2 ? 'soviet' : 'allies', team: mm.players.length, ai: 'normal', credits: 5000, startUnits: 'none' }); }, true);
    })));
    m.players.forEach((p, i) => {
      const card = el('div', 'ed-card');
      const h = el('div', 'ed-card-h', `<i class="ed-dot" style="background:${PLAYER_COLORS[i % PLAYER_COLORS.length]}"></i><span class="grow">${i + 1} · ${esc(p.name)}${i === 0 ? `<span class="ed-pill">${esc(tEd('mission.you'))}</span>` : ''}</span>`);
      if (i > 0) h.appendChild(button('✕', () => { medit((mm) => { mm.players.splice(i, 1); mm.placements = mm.placements.filter((q) => q.player !== i).map((q) => ({ ...q, player: q.player > i ? q.player - 1 : q.player })); }, true); }, '', tEd('mission.removePlayer')));
      card.appendChild(h);
      card.append(row(tEd('mission.name'), text(p.name, (v) => medit((mm) => { mm.players[i].name = v.slice(0, 40) || tDefault('player', { n: i + 1 }); }, true), { max: 40 })),
        row(tEd('mission.side'), select(p.faction, [['allies', tCommon('faction.allies')], ['soviet', tCommon('faction.soviet')]] as [Faction, string][], (v) => medit((mm) => { mm.players[i].faction = v; })),
          select(p.team, Array.from({ length: 6 }, (_, k) => [k, tEd('mission.team', { n: k + 1 })] as [number, string]), (v) => medit((mm) => { mm.players[i].team = v; }))),
        row(tEd('mission.start'), select(p.startUnits, (['none', 'mcv', 'light', 'heavy'] as const).map((k) => [k, tEd(`mission.kit.${k}`)] as [MissionSpec['players'][number]['startUnits'], string]), (v) => medit((mm) => { mm.players[i].startUnits = v; })),
          num(p.credits, (v) => medit((mm) => { mm.players[i].credits = Math.round(v); }), { min: 0, max: 100000, step: 500 })));
      if (i > 0) card.append(row(tEd('mission.ai'), select(p.ai, AI_MODES.map((a) => [a, aiName(a)] as [string, string]), (v) => medit((mm) => { mm.players[i].ai = v as never; }))));
      body.appendChild(card);
    });
    body.append(el('div', 'ed-note', esc(tEd('mission.placements', { n: m.placements.length }))));
    // objectives
    body.append(heading(tEd('mission.objectives'), button(esc(tEd('mission.addItem')), () => {
      const id = nextId('o', m.objectives.map((o) => o.id));
      medit((mm) => { mm.objectives.push({ id, kind: 'destroyAll', text: tDefault('objective.destroyAll'), primary: true }); }, true);
    })));
    m.objectives.forEach((o, i) => body.appendChild(objectiveCard(o, i)));
    // triggers
    body.append(heading(tEd('mission.triggers'), button(esc(tEd('mission.addItem')), () => {
      const id = nextId('t', m.triggers.map((t) => t.id));
      medit((mm) => { mm.triggers.push({ id, when: 'time', seconds: 60, actions: [{ kind: 'message', speaker: tx('campaign.cast.eva'), portrait: 'eva', text: tDefault('message') }] }); }, true);
    })));
    m.triggers.forEach((t, i) => body.appendChild(triggerCard(t, i)));
    body.append(heading(tEd('mission.layer')), button(esc(tEd('mission.remove')), () => { if (confirm(tEd('mission.removeConfirm'))) { model.edit((d) => { d.mission = null; }); setMode('terrain'); } }, 'warn'));
  };

  const nextId = (prefix: string, used: string[]) => { let k = used.length + 1; while (used.includes(prefix + k)) k++; return prefix + k; };

  const objectiveCard = (o: ObjectiveSpec, i: number) => {
    const card = el('div', 'ed-card');
    const set = (fn: (x: ObjectiveSpec) => void, rerender = false) => medit((mm) => fn(mm.objectives[i]), rerender);
    const h = el('div', 'ed-card-h', `<span class="grow">${o.primary ? '◆' : '◇'} ${esc(o.id)} · ${esc(OBJECTIVE_KINDS.includes(o.kind) ? tEd(`objective.kind.${o.kind}`) : o.kind)}</span>`);
    h.appendChild(button('✕', () => medit((mm) => { mm.objectives.splice(i, 1); }, true)));
    card.appendChild(h);
    card.append(row(tEd('objective.kindLabel'), select(o.kind, OBJECTIVE_KINDS.map((k) => [k, tEd(`objective.kind.${k}`)] as [string, string]), (v) => set((x) => {
      x.kind = v as ObjectiveSpec['kind'];
      if (OBJECTIVE_KINDS.includes(x.kind)) x.text = tDefault(`objective.${x.kind}`);
      if (v === 'survive') x.seconds ??= 600;
      if (v === 'build') { x.type ??= 'powr'; x.count ??= 1; }
      if (v === 'reach') { const s = model.map().startPositions; const c = s[1] ?? { x: model.doc.map.size / 2, y: model.doc.map.size / 2 }; x.x ??= Math.round(c.x); x.y ??= Math.round(c.y); x.r ??= 4; }
    }, true))),
    row(tEd('objective.text'), text(o.text, (v) => set((x) => { x.text = v.slice(0, 200); }), { max: 200 })),
    row(tEd('objective.type'), check(tEd('objective.primary'), o.primary, (v) => set((x) => { x.primary = v; }, true)), check(tEd('objective.hidden'), !!o.hidden, (v) => set((x) => { x.hidden = v || undefined; }))));
    if (o.kind === 'destroy' || o.kind === 'protect') card.append(row(tEd('objective.target'), select(o.tag ?? '', tagOptions(), (v) => set((x) => { x.tag = v || undefined; }))));
    if (o.kind === 'destroyAll') card.append(row(tEd('objective.whose'), select(o.player ?? -1, [[-1, tEd('objective.everyEnemy')], ...playerOptions(1)] as [number, string][], (v) => set((x) => { x.player = v < 0 ? undefined : v; }))));
    if (o.kind === 'survive') card.append(row(tEd('objective.minutes'), num((o.seconds ?? 600) / 60, (v) => set((x) => { x.seconds = Math.round(v * 60); }), { min: 0.5, max: 180, step: 0.5 })));
    if (o.kind === 'reach') card.append(row(tEd('objective.area'), num(o.x, (v) => set((x) => { x.x = v; })), num(o.y, (v) => set((x) => { x.y = v; })), num(o.r ?? 4, (v) => set((x) => { x.r = v; }), { min: 1, max: 30 }), pickBtn('objectiveArea', (x, y) => set((q) => { q.x = Math.round(x * 2) / 2; q.y = Math.round(y * 2) / 2; }, true))));
    if (o.kind === 'build') card.append(row(tEd('objective.build'), select(o.type ?? 'powr', typeOptions('structure'), (v) => set((x) => { x.type = v; })), num(o.count ?? 1, (v) => set((x) => { x.count = Math.round(v); }), { min: 1, max: 50 })));
    return card;
  };

  const triggerCard = (t: TriggerSpec, i: number) => {
    const card = el('div', 'ed-card');
    const set = (fn: (x: TriggerSpec) => void, rerender = false) => medit((mm) => fn(mm.triggers[i]), rerender);
    const h = el('div', 'ed-card-h', `<span class="grow">⚑ ${esc(t.id)} · ${esc(TRIGGER_WHENS.includes(t.when) ? tEd(`trigger.when.${t.when}`) : t.when)}</span>`);
    h.appendChild(button('✕', () => medit((mm) => { mm.triggers.splice(i, 1); }, true)));
    card.appendChild(h);
    card.append(row(tEd('trigger.whenLabel'), select(t.when, TRIGGER_WHENS.map((w) => [w, tEd(`trigger.when.${w}`)] as [string, string]), (v) => set((x) => {
      x.when = v as TriggerSpec['when'];
      if (v === 'time') x.seconds ??= 60;
      if (v === 'area') { x.x ??= Math.round(model.doc.map.size / 2); x.y ??= Math.round(model.doc.map.size / 2); x.r ??= 5; }
    }, true))));
    const objOpts = (): [string, string][] => [['', tEd('mission.choose')], ...model.doc.mission!.objectives.map((o) => [o.id, `${o.id}: ${o.text}`] as [string, string])];
    if (t.when === 'time') card.append(row(tEd('trigger.after'), num((t.seconds ?? 60) / 60, (v) => set((x) => { x.seconds = Math.round(v * 60); }), { min: 0, max: 240, step: 0.25 })));
    if (t.when === 'objectiveDone' || t.when === 'objectiveFailed') card.append(row(tEd('trigger.objective'), select(t.objective ?? '', objOpts(), (v) => set((x) => { x.objective = v || undefined; }))));
    if (t.when === 'destroyed') card.append(row(tEd('trigger.tag'), select(t.tag ?? '', tagOptions(), (v) => set((x) => { x.tag = v || undefined; }))));
    if (t.when === 'area') card.append(row(tEd('trigger.area'), num(t.x, (v) => set((x) => { x.x = v; })), num(t.y, (v) => set((x) => { x.y = v; })), num(t.r ?? 5, (v) => set((x) => { x.r = v; }), { min: 1, max: 30 }), pickBtn('triggerArea', (x, y) => set((q) => { q.x = Math.round(x * 2) / 2; q.y = Math.round(y * 2) / 2; }, true))),
      row(tEd('trigger.whoseUnits'), select(t.player ?? 0, playerOptions(), (v) => set((x) => { x.player = v; }))));
    t.actions.forEach((a, k) => card.appendChild(actionRow(a, i, k)));
    card.append(row('', button(esc(tEd('trigger.addAction')), () => set((x) => { x.actions.push({ kind: 'message', speaker: tx('campaign.cast.eva'), portrait: 'eva', text: '' }); }, true))));
    return card;
  };

  const actionRow = (a: TriggerAction, ti: number, k: number) => {
    const box = el('div', 'ed-card');
    const set = (fn: (x: TriggerAction) => void, rerender = false) => medit((mm) => fn(mm.triggers[ti].actions[k]), rerender);
    const h = el('div', 'ed-card-h', '<span class="grow">→</span>');
    h.prepend(select(a.kind, TRIGGER_DOS.map((d) => [d, tEd(`action.kind.${d}`)] as [string, string]), (v) => set((x) => {
      x.kind = v as TriggerAction['kind'];
      if (v === 'reinforce') { x.player ??= 0; x.units ??= ['e1', 'e1', 'e3', model.doc.mission!.players[x.player]?.faction === 'soviet' ? '3tnk' : '2tnk']; const N = model.doc.map.size; x.x ??= 1.5; x.y ??= N / 2; x.tx ??= N / 4; x.ty ??= N / 2; }
      if (v === 'credits') { x.player ??= 0; x.amount ??= 2000; }
      if (v === 'reveal') { x.x ??= model.doc.map.size / 2; x.y ??= model.doc.map.size / 2; x.r ??= 8; }
      if (v === 'ai' || v === 'attack') { x.player ??= 1; x.mode ??= 'hard'; }
    }, true)));
    h.appendChild(button('✕', () => medit((mm) => { mm.triggers[ti].actions.splice(k, 1); }, true)));
    box.appendChild(h);
    if (a.kind === 'message') box.append(row(tEd('action.speaker'), text(a.speaker ?? '', (v) => set((x) => { x.speaker = v.slice(0, 40); })), select(a.portrait ?? 'eva', PORTRAITS.map((p) => [p, tEd(`portrait.${p}`)] as [string, string]), (v) => set((x) => { x.portrait = v as never; }))),
      row(tEd('action.text'), area(a.text ?? '', (v) => set((x) => { x.text = v.slice(0, 400); }), 2)));
    if (a.kind === 'reinforce') box.append(row(tEd('action.player'), select(a.player ?? 0, playerOptions(), (v) => set((x) => { x.player = v; }))),
      row(tEd('action.units'), text((a.units ?? []).join(', '), (v) => set((x) => { x.units = v.split(/[\s,]+/).map((s) => s.trim()).filter((s) => UNITS[s]).slice(0, 40); }, true), { placeholder: 'e1, e1, 2tnk …' })),
      row(tEd('action.from'), num(a.x, (v) => set((x) => { x.x = v; })), num(a.y, (v) => set((x) => { x.y = v; })), pickBtn('arrival', (x, y) => set((q) => { q.x = Math.round(x); q.y = Math.round(y); }, true))),
      row(tEd('action.to'), num(a.tx, (v) => set((x) => { x.tx = v; })), num(a.ty, (v) => set((x) => { x.ty = v; })), pickBtn('destination', (x, y) => set((q) => { q.tx = Math.round(x); q.ty = Math.round(y); }, true))));
    if (a.kind === 'credits') box.append(row(tEd('action.player'), select(a.player ?? 0, playerOptions(), (v) => set((x) => { x.player = v; })), num(a.amount ?? 1000, (v) => set((x) => { x.amount = Math.round(v); }), { min: -100000, max: 100000, step: 500 })));
    if (a.kind === 'reveal') box.append(row(tEd('action.area'), num(a.x, (v) => set((x) => { x.x = v; })), num(a.y, (v) => set((x) => { x.y = v; })), num(a.r ?? 8, (v) => set((x) => { x.r = v; }), { min: 1, max: 60 }), pickBtn('reveal', (x, y) => set((q) => { q.x = Math.round(x); q.y = Math.round(y); }, true))));
    if (a.kind === 'objective') box.append(row(tEd('action.show'), select(a.objective ?? '', [['', tEd('action.hiddenObjective')], ...model.doc.mission!.objectives.filter((o) => o.hidden).map((o) => [o.id, `${o.id}: ${o.text}`] as [string, string])], (v) => set((x) => { x.objective = v || undefined; }))));
    if (a.kind === 'ai') box.append(row(tEd('action.player'), select(a.player ?? 1, playerOptions(1), (v) => set((x) => { x.player = v; })), select(a.mode ?? 'hard', AI_MODES.map((m) => [m, aiName(m)] as [string, string]), (v) => set((x) => { x.mode = v as never; }))));
    if (a.kind === 'attack') box.append(row(tEd('action.player'), select(a.player ?? 1, playerOptions(1), (v) => set((x) => { x.player = v; }))));
    if (a.kind === 'lose') box.append(row(tEd('action.reason'), text(a.text ?? '', (v) => set((x) => { x.text = v.slice(0, 120); }))));
    return box;
  };

  const flashMsg = (text: string) => {
    ui.msg = text;
    ui.msgUntil = performance.now() + 4500;
    renderStatus();
    window.setTimeout(() => { if (!closed) renderStatus(); }, 4600);
  };

  const startPick = (label: string, fn: (x: number, y: number) => void) => {
    ui.pick = { label, fn };
    root.classList.add('picking');
    ui.msg = label;
    renderStatus();
  };

  // ---------------------------------------------------------------------------------------------
  // Status bar
  // ---------------------------------------------------------------------------------------------
  const renderStatus = () => {
    if (ui.msgUntil && performance.now() > ui.msgUntil && !ui.pick) { ui.msg = ''; ui.msgUntil = 0; }
    const d = model.doc.map;
    const map = previewMap ?? model.map();
    let cell = '—';
    if (ui.hover) {
      const x = Math.floor(ui.hover[0]), y = Math.floor(ui.hover[1]);
      if (map.inBounds(x, y)) {
        const i = map.idx(x, y);
        const t = (['grass', 'water', 'rock', 'sand', 'dirt'] as const)[map.terrain[i]];
        const parts = [`${x}, ${y}`, t ? tEd(`cell.${t}`) : '?'];
        if (map.tree[i]) parts.push(tEd('cell.trees'));
        if (map.ore[i]) parts.push(tEd(map.gems[i] ? 'cell.gems' : 'cell.ore', { n: map.ore[i] }));
        if (map.bridgeAt[i] || map.bridges.some((b) => b.cells.some(([bx, by]) => bx === x && by === y))) parts.push(tEd('cell.bridge'));
        parts.push(tEd('cell.height', { h: fmtNum(map.heightAt(x + 0.5, y + 0.5), 2) }));
        cell = parts.join(' · ');
      }
    }
    status.innerHTML = `<span><b>${d.size}×${d.size}</b> · ${esc(tEd('status.players', { n: d.players }))} · ${esc(tEd(`sym.${d.symmetry}.short`))} · ${esc(climateName(d.climate))}</span><span>${esc(cell)}</span>${v3?.ready && ui.view === '3d' ? `<span>${esc(tEd('status.built', { s: fmtNum(v3.lastBuild, 1) }))}</span>` : ''}<span class="msg">${esc(ui.msg)}</span>`;
  };

  // ---------------------------------------------------------------------------------------------
  // Pointer input
  // ---------------------------------------------------------------------------------------------
  const toMap = (e: { clientX: number; clientY: number }): Pt | null => {
    if (ui.view === '3d') return v3?.toMap(e.clientX, e.clientY) ?? null;
    return v2.toMap(e.clientX, e.clientY);
  };
  const inside = (p: Pt) => p[0] >= 0 && p[1] >= 0 && p[0] < model.doc.map.size && p[1] < model.doc.map.size;
  const brushColor = () => TOOLS.find((t) => t.id === ui.tool)?.color ?? '#fff';

  const placementAt = (p: Pt): number => {
    const m = model.doc.mission;
    if (!m) return -1;
    for (let i = m.placements.length - 1; i >= 0; i--) {
      const q = m.placements[i];
      if (q.kind === 'structure') {
        const bt = BUILDINGS[q.type];
        if (bt && p[0] >= q.x && p[1] >= q.y && p[0] < q.x + bt.size[0] && p[1] < q.y + bt.size[1]) return i;
      } else if (Math.hypot(q.x - p[0], q.y - p[1]) < 0.7) return i;
    }
    return -1;
  };

  const placeAt = (p: Pt) => {
    const m = model.doc.mission;
    if (!m) return;
    const kind = ui.tool === 'structure' ? 'structure' : 'unit';
    const type = ui.placeType[kind];
    const player = Math.min(ui.placePlayer, m.players.length - 1);
    let pl: Placement;
    if (kind === 'structure') {
      const bt = BUILDINGS[type];
      if (!bt) return;
      const cx = Math.round(p[0] - bt.size[0] / 2), cy = Math.round(p[1] - bt.size[1] / 2);
      const why = footprintProblem(model.map(), type, cx, cy, occupiedCells());
      if (why) { flashMsg(tEd('msg.cantPlace', { name: typeName(bt), why: tEd(`why.${why}`) })); play('error'); return; }
      pl = { kind, type, player, x: cx, y: cy };
    } else {
      if (!UNITS[type]) return;
      pl = { kind, type, player, x: Math.round(p[0] * 2) / 2, y: Math.round(p[1] * 2) / 2 };
    }
    medit((mm) => { mm.placements.push(pl); });
    ui.selected = model.doc.mission!.placements.length - 1;
    renderSide();
  };

  const occupiedCells = (skip = -1): Set<number> => {
    const s = new Set<number>();
    const m = model.doc.mission;
    const map = model.map();
    m?.placements.forEach((q, i) => {
      if (i === skip || q.kind !== 'structure') return;
      const bt = BUILDINGS[q.type];
      if (!bt) return;
      for (let dy = 0; dy < bt.size[1]; dy++) for (let dx = 0; dx < bt.size[0]; dx++) if (map.inBounds(q.x + dx, q.y + dy)) s.add(map.idx(q.x + dx, q.y + dy));
    });
    return s;
  };

  let activePointer = -1;
  hit.addEventListener('contextmenu', (e) => e.preventDefault());
  hit.addEventListener('pointerdown', (e) => {
    if (closed) return;
    hit.setPointerCapture(e.pointerId);
    activePointer = e.pointerId;
    const p = toMap(e);
    // pan: right / middle button (right-click is also "remove" for starts and bridges)
    if (e.button === 1 || e.button === 2) {
      ui.pan = { x: e.clientX, y: e.clientY, moved: false };
      return;
    }
    if (e.button !== 0 || !p) return;
    if (ui.pick) {
      const pick = ui.pick;
      ui.pick = null;
      root.classList.remove('picking');
      ui.msg = '';
      if (inside(p)) pick.fn(p[0], p[1]);
      renderStatus();
      return;
    }
    const t = ui.tool;
    if (BRUSHES.has(t)) {
      if (!inside(p)) return;
      ui.stroke = [p];
      lastPreview = 0;
    } else if (t === 'start') {
      const ref = nearestStart(model.doc.map, p[0], p[1], 3);
      if (ref) { ui.dragStart = ref; model.beginGroup(); return; }
      if (!inside(p)) return;
      if (!model.edit((d) => addStart(d.map, p[0], p[1]))) {
        flashMsg(tEd('msg.tooManyStarts', { symmetry: tEd(`sym.${model.doc.map.symmetry}.label`), n: maxAuthoredStarts(model.doc.map.symmetry), max: MAX_PLAYERS }));
        play('error');
      } else play('click');
      renderSide();
    } else if (t === 'bridge') {
      const b = bridgeAt(model.map(), p[0], p[1], e.shiftKey ? (bridgeAt(model.map(), p[0], p[1])?.axis === 'x' ? 'y' : 'x') : undefined);
      if (!b) { flashMsg(tEd('msg.bridge')); play('error'); return; }
      model.edit((d) => { (d.map.bridges ??= []).push(b); });
      play('click');
    } else if (t === 'select' || t === 'erase') {
      const i = placementAt(p);
      if (t === 'erase') {
        if (i >= 0) { medit((mm) => { mm.placements.splice(i, 1); }); ui.selected = null; renderSide(); play('click'); }
        return;
      }
      ui.selected = i >= 0 ? i : null;
      ui.dragPlacement = i;
      if (i >= 0) model.beginGroup();
      if (i >= 0) ui.tab = 'mission';
      renderSide();
    } else if (t === 'structure' || t === 'unit') {
      if (inside(p)) placeAt(p);
    }
    needsPaint = true;
  });

  hit.addEventListener('pointermove', (e) => {
    if (closed) return;
    if (ui.pan) {
      const dx = e.clientX - ui.pan.x, dy = e.clientY - ui.pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) ui.pan.moved = true;
      ui.pan.x = e.clientX; ui.pan.y = e.clientY;
      if (ui.view === '2d') v2.pan(dx, dy); else v3?.dragPixels(dx, dy);
      needsPaint = true;
      return;
    }
    const p = toMap(e);
    ui.hover = p;
    if (p && ui.stroke) {
      const last = ui.stroke[ui.stroke.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.15) ui.stroke.push([Math.max(-2, Math.min(model.doc.map.size + 2, p[0])), Math.max(-2, Math.min(model.doc.map.size + 2, p[1]))]);
    }
    if (p && ui.dragStart) {
      const ref = ui.dragStart;
      model.edit((d) => moveStart(d.map, ref, p[0], p[1]));
    }
    if (p && ui.dragPlacement >= 0 && ui.tool === 'select' && e.buttons & 1) {
      const i = ui.dragPlacement;
      const q = model.doc.mission?.placements[i];
      if (q) {
        if (q.kind === 'structure') {
          const bt = BUILDINGS[q.type];
          const cx = Math.round(p[0] - bt.size[0] / 2), cy = Math.round(p[1] - bt.size[1] / 2);
          if ((cx !== q.x || cy !== q.y) && !footprintProblem(model.map(), q.type, cx, cy, occupiedCells(i))) medit((mm) => { mm.placements[i].x = cx; mm.placements[i].y = cy; });
        } else {
          const x = Math.round(p[0] * 4) / 4, y = Math.round(p[1] * 4) / 4;
          if (x !== q.x || y !== q.y) medit((mm) => { mm.placements[i].x = x; mm.placements[i].y = y; });
        }
      }
    }
    needsPaint = true;
    renderStatus();
  });

  const endPointer = (e: PointerEvent) => {
    if (e.pointerId !== activePointer) return;
    activePointer = -1;
    const p = toMap(e);
    if (ui.pan) {
      const wasClick = !ui.pan.moved;
      ui.pan = null;
      if (wasClick && e.button === 2 && p) rightClick(p);
      return;
    }
    if (ui.stroke) {
      const pts = ui.stroke;
      ui.stroke = null;
      previewMap = null;
      const f = strokeFeature(ui.tool as BrushKind, pts, ui.brush);
      model.edit((d) => { d.map.features.push(f); });
    }
    if (ui.dragStart) { ui.dragStart = null; renderSide(); }
    if (ui.dragPlacement >= 0) renderSide();
    ui.dragPlacement = -1;
    model.endGroup();
    needsPaint = true;
  };
  hit.addEventListener('pointerup', endPointer);
  hit.addEventListener('pointercancel', endPointer);
  hit.addEventListener('pointerleave', () => { ui.hover = null; needsPaint = true; });

  const rightClick = (p: Pt) => {
    if (ui.tool === 'start') {
      const ref = nearestStart(model.doc.map, p[0], p[1], 3);
      if (ref && !model.edit((d) => removeStart(d.map, ref))) { flashMsg(tEd('msg.needStart')); play('error'); }
      renderSide();
    } else if (ui.tool === 'bridge') {
      const k = bridgeDefAt(model.doc.map, model.map(), p[0], p[1]);
      if (k >= 0) model.edit((d) => { d.map.bridges!.splice(k, 1); if (!d.map.bridges!.length) delete d.map.bridges; });
    } else if (ui.mode === 'mission') {
      const i = placementAt(p);
      if (i >= 0) { ui.selected = i; ui.tab = 'mission'; renderSide(); }
    }
    needsPaint = true;
  };

  hit.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (ui.view === '2d') v2.zoomAt(e.clientX, e.clientY, Math.pow(1.0015, -e.deltaY));
    else v3?.zoom(e.deltaY);
    needsPaint = true;
  }, { passive: false });

  // ---------------------------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------------------------
  /**
   * A letter key as the keyboard labels it (KeyboardEvent.key: Z is Z on QWERTZ and AZERTY too), or by position on a
   * non-Latin layout (Cyrillic...), as the battle's key bindings do (src/ui/keymap.ts).
   */
  const isKey = (e: KeyboardEvent, letter: string) => {
    const k = (e.key ?? '').toLowerCase();
    return k === letter || (!/^[\x20-\x7e]$/.test(k) && e.code === `Key${letter.toUpperCase()}`);
  };
  /** The 3D view's pan keys (W A S D by their labels, the arrows), as the codes View3D tracks. */
  const panCode = (e: KeyboardEvent): string | null => {
    for (const l of 'wasd') if (isKey(e, l)) return `Key${l.toUpperCase()}`;
    return e.code.startsWith('Arrow') ? e.code : null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (closed || root.querySelector('.ed-modal')) {
      if (e.key === 'Escape') root.querySelector<HTMLElement>('.ed-modal [data-close]')?.click();
      return;
    }
    const tag = (e.target as HTMLElement)?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && isKey(e, 's')) { e.preventDefault(); void save(); return; }
    if (typing) return;
    if (ctrl && isKey(e, 'z')) { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
    if (ctrl && isKey(e, 'y')) { e.preventDefault(); doRedo(); return; }
    if (ctrl) return;
    if (e.key === 'Escape') {
      if (ui.pick) { ui.pick = null; root.classList.remove('picking'); ui.msg = ''; renderStatus(); return; }
      if (ui.selected !== null) { ui.selected = null; renderSide(); needsPaint = true; return; }
      exit();
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); setView(ui.view === '2d' ? '3d' : '2d'); return; }
    const pan = ui.view === '3d' && v3 ? panCode(e) : null;
    if (pan) { v3!.keyDown(pan); return; }
    if (ui.view === '3d' && v3 && (isKey(e, 'q') || isKey(e, 'e'))) { v3.rotate(isKey(e, 'q') ? -1 : 1); return; }
    // [ ]: by label, or by the US position where [ and ] need AltGr (QWERTZ, AZERTY...)
    const bracket = e.key === '[' || e.key === ']' ? e.key : e.code === 'BracketLeft' ? '[' : e.code === 'BracketRight' ? ']' : null;
    if (bracket) { ui.brush.radius = Math.max(0.5, Math.min(16, ui.brush.radius + (bracket === ']' ? 0.5 : -0.5))); renderOpts(); needsPaint = true; return; }
    if (isKey(e, 'm')) { setMode(ui.mode === 'terrain' ? 'mission' : 'terrain'); return; }
    if (isKey(e, 'g')) { ui.grid = !ui.grid; needsPaint = true; return; }
    if (isKey(e, 'f')) { fitView(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selected !== null) { const i = ui.selected; medit((mm) => { mm.placements.splice(i, 1); }); ui.selected = null; renderSide(); return; }
    // (letters by label, as isKey; digits by label or position: AZERTY types & é " ... without Shift)
    const t = TOOLS.find((x) => x.key && (/^\d$/.test(x.key) ? e.key === x.key || e.code === `Digit${x.key}` : isKey(e, x.key.toLowerCase())) && !!x.mission === (ui.mode === 'mission'));
    if (t) setTool(t.id);
  };
  const onKeyUp = (e: KeyboardEvent) => { const c = panCode(e); if (c) v3?.keyUp(c); v3?.keyUp(e.code); };
  const onBlur = () => v3?.clearKeys();
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  /** Long labels (some languages) or a narrow window: the file buttons drop to their icons (the tooltips stay). */
  const fitTop = () => { top.classList.remove('compact'); if (top.scrollWidth > top.clientWidth + 1) top.classList.add('compact'); };
  const onResize = () => { v2.resize(); v3?.resize(); needsPaint = true; fitTop(); };
  window.addEventListener('resize', onResize);

  // ---------------------------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------------------------
  const doUndo = () => { if (model.undo()) { ui.selected = null; renderSide(); renderOpts(); play('click'); } };
  const doRedo = () => { if (model.redo()) { ui.selected = null; renderSide(); renderOpts(); play('click'); } };

  const fitView = () => {
    v2.fit(model.doc.map.size, area3d());
    needsPaint = true;
  };
  const focusOn = (at: [number, number]) => {
    ui.flash = at;
    ui.flashUntil = performance.now() + 2200;
    if (ui.view === '2d') {
      const a = area3d();
      const cx = a.left + (window.innerWidth - a.left - a.right) / 2, cy = a.top + (window.innerHeight - a.top - a.bottom) / 2;
      v2.ox = cx - at[0] * v2.zoom;
      v2.oy = cy - at[1] * v2.zoom;
    } else v3?.gfx?.cam.flyToPoint(at[0], at[1]);
    needsPaint = true;
  };

  const save = async (quiet = false): Promise<boolean> => {
    try {
      await saveDoc(model.doc);
      model.dirty = false;
      renderTop();
      if (!quiet) { toast(tEd('msg.saved', { name: model.doc.map.name })); play('click'); }
      return true;
    } catch (e) {
      toast(tEd('msg.saveFailed', { error: (e as Error).message }), true);
      return false;
    }
  };

  const exportFile = () => {
    const blob = new Blob([JSON.stringify(docToFile(model.doc), null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(model.doc);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(tEd('msg.exported', { file: fileName(model.doc) }));
  };

  fileInput.onchange = async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { toast(tEd('msg.tooLarge'), true); return; }
    const { doc, errors } = parseRhMap(await f.text());
    if (!doc) { toast(errors.slice(0, 4).join('\n'), true); play('error'); return; }
    confirmDiscard(() => {
      model.load(doc);
      afterLoad();
      toast(tEd(doc.mission ? 'msg.importedMission' : 'msg.imported', { name: doc.map.name }));
      model.dirty = true;
      renderTop();
    });
  };

  const afterLoad = () => {
    ui.selected = null;
    ui.stroke = null;
    previewMap = null;
    if (ui.mode === 'mission' && !model.doc.mission) ui.mode = 'terrain';
    ui.tool = ui.mode === 'mission' ? 'select' : BRUSHES.has(ui.tool) || ui.tool === 'bridge' || ui.tool === 'start' ? ui.tool : 'clear';
    v3?.invalidate();
    rebuild3dAt = 1;
    fitView();
    renderTop();
    renderTools();
    renderOpts();
    renderSide();
  };

  // ---- dialogs ---------------------------------------------------------------------------------
  const modal = (cls = '') => {
    const m = el('div', 'ed-modal');
    const d = el('div', 'ed-panel ed-dlg ' + cls);
    m.appendChild(d);
    const close = () => m.remove();
    const x = button(IC.x, close, 'x', tEd('dialog.close'));
    x.dataset.close = '1';
    d.appendChild(x);
    m.onpointerdown = (e) => { if (e.target === m) close(); };
    root.appendChild(m);
    return { m, d, close };
  };

  const confirmDiscard = (then: () => void) => {
    if (!model.dirty) { then(); return; }
    const { d, close } = modal('sm');
    d.append(el('div', 'kick', esc(tEd('dialog.unsaved'))), el('h2', '', esc(model.doc.map.name)), el('div', 'ed-note', esc(tEd('dialog.saveFirst'))));
    const foot = el('div', 'foot');
    foot.append(button(esc(tEd('dialog.cancel')), close), button(esc(tEd('dialog.discard')), () => { close(); then(); }, 'warn'), button(esc(tEd('dialog.save')), async () => { close(); if (await save()) then(); }, 'pri'));
    d.appendChild(foot);
  };

  const newDialog = () => {
    const { d, close } = modal('sm');
    const o = { name: tEd('newName'), size: 96, symmetry: 'rot2' as Symmetry, climate: 'temperate' as Climate, ground: 'clear' as NonNullable<MapDef['ground']> };
    d.append(el('div', 'kick', esc(tEd('dialog.kicker'))), el('h2', '', esc(tEd('dialog.newTitle'))),
      row(tEd('dialog.name'), text(o.name, (v) => { o.name = v.trim() || tEd('newName'); })),
      row(tEd('dialog.size'), select(o.size, SIZES.map((s) => [s, `${s} × ${s}`] as [number, string]), (v) => { o.size = v; })),
      row(tEd('dialog.symmetry'), select(o.symmetry, SYMS(), (v) => { o.symmetry = v; })),
      row(tEd('dialog.climate'), select(o.climate, CLIMATES(), (v) => { o.climate = v; })),
      row(tEd('dialog.ground'), select(o.ground, GROUNDS('waterNew'), (v) => { o.ground = v; })),
      el('div', 'ed-note', esc(tEd('dialog.newNote'))));
    const foot = el('div', 'foot');
    foot.append(button(esc(tEd('dialog.cancel')), close), button(esc(tEd('dialog.create')), () => {
      close();
      confirmDiscard(() => {
        model.load(newDoc(newMapDef({ name: o.name, size: o.size, symmetry: o.symmetry, climate: o.climate, ground: o.ground })));
        afterLoad();
        toast(tEd('msg.newMap', { size: o.size }));
      });
    }, 'pri'));
    d.appendChild(foot);
  };

  const libraryDialog = () => {
    const { d, close } = modal();
    d.append(el('div', 'kick', esc(tEd('library.kicker'))), el('h2', '', esc(tEd('library.title'))));
    const grid = el('div', 'ed-lib');
    const docs = listDocs();
    const card = (title: string, sub: string, pills: string, thumb: () => string, acts: [string, () => void, string?][], onOpen: () => void) => {
      const c = el('div', 'ed-lib-card', `<img alt=""><div class="meta"><b>${esc(title)}${pills}</b><small>${esc(sub)}</small></div>`);
      const img = c.querySelector('img') as HTMLImageElement;
      requestAnimationFrame(() => { try { img.src = thumb(); } catch { /* broken map */ } });
      const a = el('div', 'acts');
      for (const [label, fn, cls] of acts) a.appendChild(button(esc(label), fn, cls ?? ''));
      c.appendChild(a);
      c.onclick = onOpen;
      grid.appendChild(c);
    };
    if (!docs.length) grid.appendChild(el('div', 'ed-note', esc(tEd('library.empty'))));
    for (const doc of docs) {
      const open = () => { close(); confirmDiscard(() => { model.load(JSON.parse(JSON.stringify(doc))); afterLoad(); toast(tEd('msg.opened', { name: doc.map.name })); }); };
      card(doc.map.name, tEd('library.facts', { size: doc.map.size, n: doc.map.players, date: fmtDate(doc.updatedAt) }), doc.mission ? `<span class="ed-pill gold">${esc(tEd('library.missionPill'))}</span>` : '',
        () => mapPreviewUrl(`ed:${doc.id}:${doc.updatedAt}`, () => buildMapSafe(doc.map), { size: 200 }),
        [[tEd('library.open'), open, 'pri'], [tEd('library.copy'), () => { const c = JSON.parse(JSON.stringify(doc)) as EditorDoc; c.id = c.map.id = newCustomId(); c.map.name = tEd('library.copyName', { name: c.map.name }).slice(0, 48); c.updatedAt = Date.now(); void saveDoc(c).then(() => { close(); libraryDialog(); }); }],
          [tEd('library.delete'), () => { if (confirm(tEd('library.deleteConfirm', { name: doc.map.name }))) void deleteDoc(doc.id).then(() => { close(); libraryDialog(); }); }, 'warn']], open);
    }
    d.appendChild(grid);
    d.appendChild(heading(tEd('library.remix')));
    const g2 = el('div', 'ed-lib');
    g2.style.maxHeight = '30vh';
    for (const def of CURATED_MAPS) {
      const remix = () => {
        close();
        confirmDiscard(() => {
          const copy = JSON.parse(JSON.stringify(def)) as MapDef;
          copy.id = newCustomId();
          copy.name = tEd('library.remixName', { name: mapName(def) }).slice(0, 48);
          copy.format = 1;
          model.load(newDoc(copy));
          afterLoad();
          model.dirty = true;
          renderTop();
          toast(tEd('msg.remixing', { name: mapName(def) }));
        });
      };
      const c = el('div', 'ed-lib-card', `<img alt=""><div class="meta"><b>${esc(mapName(def))}</b><small>${def.size}×${def.size} · ${esc(tEd('status.players', { n: def.players }))} · ${esc(climateName(def.climate))}</small></div>`);
      const img = c.querySelector('img') as HTMLImageElement;
      requestAnimationFrame(() => { img.src = mapPreviewUrl(`c:${def.id}`, () => buildMapSafe(def), { size: 200 }); });
      c.onclick = remix;
      g2.appendChild(c);
    }
    d.appendChild(g2);
  };

  /** A curated map's name in the interface language. */
  const mapName = (def: MapDef) => dt('map', def.id, 'name', def.name);
  const buildMapSafe = (def: MapDef) => { const t = new EditorModel(newDoc(JSON.parse(JSON.stringify(def)))); return t.map(); };

  const playtestMenu = () => {
    const { d, close } = modal('sm');
    const map = model.map();
    const r = report ?? validateMap(model.doc.map, map);
    const n = map.startPositions.length;
    const o = { faction: (model.doc.mission?.players[0]?.faction ?? 'allies') as Faction, ai: 'normal' as AIDifficulty, credits: 10000 };
    d.append(el('div', 'kick', esc(tEd('playtest.kicker'))), el('h2', '', esc(model.doc.map.name.toUpperCase())));
    d.appendChild(heading(tEd('playtest.skirmish')));
    if (n < 2) d.appendChild(el('div', 'ed-note', esc(tEd('playtest.needStarts'))));
    else {
      d.append(row(tEd('playtest.playAs'), select(o.faction, [['allies', tCommon('faction.allies')], ['soviet', tCommon('faction.soviet')]] as [Faction, string][], (v) => { o.faction = v; })),
        row(tEd('playtest.ai', { n: n - 1 }), select(o.ai, (['recruit', 'easy', 'normal', 'hard', 'brutal'] as const).map((a) => [a, tCommon(`difficulty.${a}`)] as [AIDifficulty, string]), (v) => { o.ai = v; })),
        row(tEd('playtest.credits'), select(o.credits, [5000, 10000, 20000].map((c) => [c, fmtMoney(c)] as [number, string]), (v) => { o.credits = v; })));
      if (!r.playable) d.appendChild(el('div', 'ed-note', esc(tEd('playtest.invalid', { n: r.errors }))));
      d.appendChild(el('div', 'foot')).appendChild(button(`${IC.play}<span>${esc(tEd('playtest.start'))}</span>`, () => { close(); void launch('skirmish', o); }, 'pri'));
    }
    d.appendChild(heading(tEd('playtest.mission')));
    if (!model.doc.mission) d.appendChild(el('div', 'ed-note', esc(tEd('playtest.noMission'))));
    else {
      const errs = missionChecks.filter((c) => c.level === 'error');
      const ms = model.doc.mission;
      d.appendChild(el('div', 'ed-note', esc(errs.length ? tEd('playtest.missionErrors', { n: errs.length, first: errs[0].title }) : tEd('playtest.missionSummary', { title: ms.title, objectives: ms.objectives.length, triggers: ms.triggers.length }))));
      d.appendChild(el('div', 'foot')).appendChild(button(`${IC.play}<span>${esc(tEd('playtest.play'))}</span>`, () => { close(); void launch('mission', o); }, errs.length ? '' : 'pri'));
    }
  };

  const launch = async (kind: 'skirmish' | 'mission', o: { faction: Faction; ai: AIDifficulty; credits: number }) => {
    await save(true);
    const def = JSON.parse(JSON.stringify(model.doc.map)) as MapDef;
    const n = model.map().startPositions.length;
    const wx = ui.weather;
    const tod = ui.hours >= 19.5 || ui.hours < 5 ? 'night' : ui.hours >= 17 ? 'dusk' : 'day';
    const seed = (Math.random() * 1e9) | 0;
    const base: GameSetup = {
      faction: o.faction, color: o.faction === 'soviet' ? 0xd23a2c : 0x3d7be0,
      opponents: Array.from({ length: Math.max(1, n - 1) }, (_, i) => ({ faction: i % 2 === 0 ? (o.faction === 'allies' ? 'soviet' : 'allies') : 'random', difficulty: o.ai })),
      mapSize: def.size, water: 0.5, trees: 0.5, ore: 0.6, credits: o.credits, startUnits: 'mcv', fog: true, timeOfDay: tod, quality: opts.quality,
      seed, weather: wx, climate: def.climate, dayCycle: false, intro: false, mapId: model.doc.id, customMap: def,
    };
    let setup = base;
    if (kind === 'mission' && model.doc.mission) {
      setup = { ...base, mission: model.doc.id, customMission: { ...JSON.parse(JSON.stringify(model.doc.mission)), id: model.doc.id } };
    }
    remember();
    teardown();
    opts.onPlaytest(setup);
  };

  const exit = () => {
    confirmDiscard(() => {
      remember();
      teardown();
      opts.onExit();
    });
  };

  // ---------------------------------------------------------------------------------------------
  // Change handling and the frame loop
  // ---------------------------------------------------------------------------------------------
  let draftTimer = 0;
  model.onChange = () => {
    needsPaint = true;
    renderTop();
    renderStatus();
    checksAt = performance.now() + 250;
    rebuild3dAt = performance.now() + 900;
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => saveDraft(model.doc), 800);
  };

  const runChecks = () => {
    const map = model.map();
    report = validateMap(model.doc.map, map);
    missionChecks = model.doc.mission ? validateMission(model.doc.mission, map) : [];
    const focus = side.contains(document.activeElement) && document.activeElement !== document.body;
    // refresh the panel unless the user is typing in it (then only the tab badges)
    if (!focus) renderSide();
    else {
      {
        const tabs = side.querySelector('.ed-tabs');
        if (tabs) {
          const errs = report.errors + missionChecks.filter((c) => c.level === 'error').length;
          const warns = report.warnings + missionChecks.filter((c) => c.level === 'warning').length;
          const ck = tabs.children[1] as HTMLElement;
          ck.innerHTML = esc(tEd('tab.check')) + (errs || warns ? `<span class="badge ${errs ? 'err' : ''}">${errs || warns}</span>` : '');
        }
      }
    }
  };

  let raf = 0;
  let last = performance.now();
  let t0 = last;
  let paintedVersion = -1;
  const frame = (now: number) => {
    if (closed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const time = (now - t0) / 1000;
    if (ui.flash && now > ui.flashUntil) { ui.flash = null; needsPaint = true; }
    // live stroke preview: rebuild the map with the stroke in progress a few times a second
    if (ui.stroke && BRUSHES.has(ui.tool) && ui.view === '2d' && now - lastPreview > 140) {
      lastPreview = now;
      try { previewMap = model.preview(strokeFeature(ui.tool as BrushKind, ui.stroke, ui.brush)); v2.paint(previewMap); } catch { previewMap = null; }
      needsPaint = true;
    } else if (!ui.stroke && paintedVersion !== model.version) {
      paintedVersion = model.version;
      previewMap = null;
      v2.paint(model.map());
      needsPaint = true;
    }
    if (checksAt > 0 && now > checksAt && !ui.stroke && !ui.dragStart) { checksAt = -1; runChecks(); }
    const overlay: OverlayState = {
      def: model.doc.map, map: previewMap ?? model.map(), mission: model.doc.mission, missionMode: ui.mode === 'mission',
      hover: ui.hover, brushR: BRUSHES.has(ui.tool) && !ui.pick ? ui.brush.radius : 0, brushColor: brushColor(),
      ghosts: !ui.brush.once && model.doc.map.symmetry !== 'none' && BRUSHES.has(ui.tool), stroke: ui.stroke,
      bridgePreview: ui.tool === 'bridge' && ui.hover ? (() => { const b = bridgeAt(model.map(), ui.hover![0], ui.hover![1]); if (!b) return null; return bridgeCellsOf(model.map(), b); })() : null,
      selected: ui.selected,
      ghostFootprint: ui.tool === 'structure' && ui.hover && !ui.pick ? (() => { const bt = BUILDINGS[ui.placeType.structure]; if (!bt) return null; const cx = Math.round(ui.hover![0] - bt.size[0] / 2), cy = Math.round(ui.hover![1] - bt.size[1] / 2); return { w: bt.size[0], h: bt.size[1], ok: !footprintProblem(model.map(), bt.id, cx, cy, occupiedCells()) }; })() : null,
      guides: ui.guides, picking: !!ui.pick, flash: ui.flash,
    };
    if (ui.view === '2d') {
      if (needsPaint || ui.flash) { v2.draw(overlay, time, ui.grid); needsPaint = false; }
    } else if (v3) {
      if (rebuild3dAt > 0 && now > rebuild3dAt && !ui.stroke && !ui.dragStart && activePointer < 0) {
        rebuild3dAt = 0;
        busy.classList.add('on');
        // let the "updating" label paint before the (synchronous) rebuild
        requestAnimationFrame(() => setTimeout(() => {
          if (closed || !v3) return;
          try { v3.rebuild(model.doc.map, `${model.version}|${opts.quality}`); v3.syncModels(model.doc.mission, true); } catch (e) { console.error('editor 3D view', e); toast(tEd('msg.failed3d'), true); }
          busy.classList.remove('on');
          renderStatus();
        }, 0));
      }
      v3.syncModels(model.doc.mission, true);
      v3.frame(dt, time, overlay);
    }
  };

  const bridgeCellsOf = (map: GameMap, b: { at: Pt; axis: 'x' | 'y' }): [number, number][] | null =>
    traceBridge(map, Math.floor(b.at[0]), Math.floor(b.at[1]), b.axis)?.cells ?? null;

  const teardown = () => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(draftTimer);
    saveDraft(model.doc);
    model.onChange = null;
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('resize', onResize);
    v3?.dispose();
    v3 = null;
    v2.dispose();
    root.remove();
    delete (window as unknown as { __editor?: unknown }).__editor;
  };

  // ---- go
  renderTop();
  renderTools();
  renderOpts();
  renderSide();
  renderStatus();
  fitView();
  fitTop();
  void document.fonts?.ready.then(() => { if (!closed) fitTop(); });
  if (ui.view === '3d') { ui.view = '2d'; setView('3d'); } else v2.canvas.style.display = '';
  void initEditorStore().then(() => { if (!closed && !getDoc(model.doc.id) && listDocs().length === 0) ui.msg = tEd('status.tip'); renderStatus(); });
  checksAt = 1;
  raf = requestAnimationFrame(frame);
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) (window as unknown as { __editor: unknown }).__editor = { model, ui, view3d: () => v3, focusOn };
  return { close: () => { remember(); teardown(); } };
}
