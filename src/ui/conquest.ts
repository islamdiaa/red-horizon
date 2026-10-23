/**
 * Conquest UI: the new-campaign screen, the strategic map of Europe (territories, front lines, sea lanes, army
 * markers, animated attack and counterattack arrows), the territory panel, battle preview, research, core army,
 * doctrines, events, perk picks, the battle report and the run summary. Plain DOM + inline SVG, styled like the
 * campaign screen (src/ui/campaign.ts). The rules live in src/conquest.
 */
import { focusTrap } from './a11y'; // Tab stays inside the screen, or the dialog on top of it
import { UNITS } from '../data/rules';
import type { SaveData } from '../sim/save';
import { deleteSave, readSave } from '../sim/save';
import { insigniaSvg, picto, PICTO } from '../meta/art';
import { showAchievementToast } from '../meta/toast';
import { loadProfile } from '../meta/profile';
import { castPortrait } from './campaign';
import { alliedEmblem, rankBadge, sovietEmblem } from './icons';
import {
  ALLOTMENT, DOCTRINES, EVENT_BY_ID, attackTargets, capitalGate, KIND_INFO, PERSONALITIES, RESOURCES, RETURN_CAP, TITLES, abandonRun, availableBattles, battleOutcome,
  buyResearch, chooseEvent, climateOf, coreCapacity, dateOf, defaultCommit, findTerritory, generateRun, income, loadMeta, loadRun, owned,
  pendingSetup, perkDef, pickPerk, planBattle, recordRunEnd, regroup, researchFor, researchState, resolveBattle, saveMeta, saveRun, startBattle,
  territory, withdraw, type BattleSpec, type ConquestMeta, type ConquestRun, type ConquestSetup, type Difficulty, type Territory,
} from '../conquest';
import { LAND_D, SEA_D, VIEW, borderEdges, buildMesh, outlineLoops, partition, polyPath, type Pt } from '../conquest/geo';
import type { World } from '../sim/world';
import type { Faction } from '../data/rules';
import type { PerkDef } from '../conquest/data';
import { fmtDateTime, fmtInt, fmtMoney, trSource } from '../i18n/core';
import { callSignName } from '../i18n/en/codenames'; // (L10N: generated operation names and call signs translate on display)
import { typeName } from '../i18n/names';
import tCq from '../i18n/en/conquest';
import tCommon from '../i18n/en/common';
import {
  doctrineDesc, doctrineName, kindDesc, kindName, monthYear, perkDesc, perkName, personalityDesc, personalityName, researchDesc, researchName,
  resourceDesc, resourceName, territoryName, titleDesc, titleName, trLog, trRun,
} from '../conquest/i18n';

export interface ConquestUiOptions {
  play(k: 'click' | 'tab'): void;
  /** Back to the main menu. */
  onBack(): void;
  /** Start (or restart from scratch) the committed battle. */
  onDeploy(setup: ConquestSetup): void;
  /** Resume the battle from a save game. */
  onResume(save: SaveData): void;
  /** Testing / screenshots: open a given screen (new | preview | research | army | perks | perk | event | report | summary). */
  demo?: string;
}

// =====================================================================================================
// Styles
// =====================================================================================================
const CSS = `
.cq { position: fixed; inset: 0; z-index: 22; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 12px; padding: 2.2vh 1.8vw;
  background: radial-gradient(ellipse at 40% 35%, rgba(0,0,0,0.42), rgba(0,0,0,0.9) 75%); font-family: var(--font, sans-serif); color: #dfe8f2; animation: cqIn .45s ease-out; }
@keyframes cqIn { from { opacity: 0; transform: scale(1.01); } to { opacity: 1; transform: none; } }
.cq-panel { background: linear-gradient(180deg, rgba(20,28,38,0.92), rgba(8,11,16,0.94)); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.55); backdrop-filter: blur(6px); }
.cq-top { display: flex; align-items: center; gap: 16px; padding: 10px 16px; min-width: 0; }
.cq-emb { width: 58px; height: 40px; flex-shrink: 0; display: grid; place-items: center; }
.cq-emb svg { width: 100%; height: 100%; }
.cq-ttl { min-width: 0; flex: 1; }
.cq-kick { font-size: 11px; letter-spacing: .34em; color: rgb(var(--accent-rgb, 90,180,255)); font-weight: 700; text-transform: uppercase; }
.cq-ttl h1 { margin: 2px 0 0; font-size: 26px; letter-spacing: .14em; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; }
.cq-stats { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.cq-stat { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 10px; background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.07); min-width: 0; }
.cq-stat .mx-ic, .cq-stat > svg { width: 20px; height: 20px; color: rgb(var(--accent-rgb, 90,180,255)); flex-shrink: 0; }
.cq-stat small { display: block; font-size: 9.5px; letter-spacing: .24em; color: #8a99aa; text-transform: uppercase; }
.cq-stat b { display: block; font-family: var(--mono, monospace); font-size: 16px; letter-spacing: .03em; color: #eef4fa; white-space: nowrap; }
.cq-stat.gold b { color: #ffd34d; }
.cq-stat.warn { border-color: rgba(255,90,70,0.5); background: rgba(80,10,5,0.35); }
.cq-hearts { display: inline-flex; gap: 3px; }
.cq-hearts i { width: 11px; height: 11px; border-radius: 3px; transform: rotate(45deg); background: rgba(255,255,255,0.12); display: inline-block; margin: 2px 2px 0; }
.cq-hearts i.on { background: linear-gradient(135deg, #ffe08a, #ff9d3d); box-shadow: 0 0 6px rgba(255,170,60,0.7); }
.cq-main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(330px, 25vw); gap: 12px; min-height: 0; }
.cq-map { position: relative; overflow: hidden; padding: 0; background: radial-gradient(ellipse at 45% 40%, #0c1824, #03070b 80%); min-height: 0; }
.cq-map > svg.cq-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.cq-map::before { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 2; border-radius: 16px; background: repeating-linear-gradient(0deg, rgba(255,255,255,0.022) 0 1px, transparent 1px 4px); mix-blend-mode: screen; }
.cq-sweep { position: absolute; left: 50%; top: 50%; width: 160%; aspect-ratio: 1; transform: translate(-50%, -50%); pointer-events: none; z-index: 1; border-radius: 50%;
  background: conic-gradient(from 0deg, transparent 0deg, transparent 300deg, rgba(var(--accent-rgb, 90,180,255),0.04) 340deg, rgba(var(--accent-rgb, 90,180,255),0.13) 359deg, transparent 360deg); animation: cqSweep 10s linear infinite; }
@keyframes cqSweep { to { transform: translate(-50%, -50%) rotate(360deg); } }
.cq-coords { position: absolute; right: 14px; top: 10px; z-index: 3; font-family: var(--mono, monospace); font-size: 11px; color: rgba(var(--accent-rgb, 90,180,255),0.8); letter-spacing: .14em; text-align: right; pointer-events: none; }
.cq-legend { position: absolute; left: 14px; top: 12px; z-index: 3; display: flex; flex-direction: column; gap: 5px; font-family: var(--mono, monospace); font-size: 10.5px; letter-spacing: .12em; color: #8a99aa; pointer-events: none; }
.cq-legend i { display: inline-block; width: 12px; height: 10px; border-radius: 2px; margin-right: 7px; vertical-align: -1px; }
.cq-hint { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 3; padding: 7px 16px; border-radius: 999px; background: rgba(6,10,14,0.82); border: 1px solid rgba(var(--accent-rgb, 90,180,255),0.35);
  font-size: 13px; letter-spacing: .14em; text-transform: uppercase; white-space: nowrap; pointer-events: none; }
.cq-hint.warn { border-color: rgba(255,90,70,0.8); color: #ffc0b4; animation: cqWarn 1.6s ease-in-out infinite; }
@keyframes cqWarn { 50% { box-shadow: 0 0 18px rgba(255,80,60,0.55); } }
.cq-bar { position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 4; display: flex; gap: 8px; align-items: flex-end; pointer-events: none; }
.cq-bar > * { pointer-events: auto; }
.cq-bar .grow { flex: 1; pointer-events: none; }
.cq-btn { height: 42px; padding: 0 18px; border-radius: 11px; border: 1px solid rgba(255,255,255,0.14); cursor: pointer; font: inherit; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; font-size: 12.5px;
  color: #dfe8f2; background: rgba(8,12,18,0.88); display: inline-flex; align-items: center; gap: 8px; transition: all .15s; position: relative; }
.cq-btn:hover:not(:disabled) { border-color: rgba(var(--accent-rgb, 90,180,255),0.7); color: #fff; transform: translateY(-1px); }
.cq-btn .mx-ic { width: 18px; height: 18px; color: rgb(var(--accent-rgb, 90,180,255)); }
.cq-btn.pri { border: 0; color: #fff; background: linear-gradient(180deg, rgba(var(--accent-rgb, 90,180,255),0.95), rgba(var(--accent-rgb, 90,180,255),0.55)); box-shadow: 0 0 26px rgba(var(--accent-rgb, 90,180,255),0.38); font-size: 15px; height: 50px; padding: 0 26px; letter-spacing: .3em; }
.cq-btn.pri .mx-ic { color: #fff; }
.cq-btn.danger { border-color: rgba(255,90,70,0.55); color: #ffb4a6; }
.cq-btn.danger.pri { background: linear-gradient(180deg, rgba(220,60,40,0.95), rgba(150,30,20,0.7)); box-shadow: 0 0 26px rgba(255,70,50,0.35); color: #fff; }
.cq-btn:disabled { opacity: .4; cursor: not-allowed; }
.cq-btn em { position: absolute; top: -7px; right: -7px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #ffd34d; color: #1a1408; font-style: normal; font-size: 11px; letter-spacing: 0; display: grid; place-items: center; font-family: var(--mono, monospace); }
.cq-side { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.cq-info { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 16px 18px; }
.cq-info h2 { margin: 2px 0 6px; font-size: 28px; letter-spacing: .12em; text-transform: uppercase; line-height: 1.05; }
.cq-own { font-size: 11px; letter-spacing: .3em; font-weight: 700; text-transform: uppercase; }
.cq-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 12px; }
.cq-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); color: #d4e0ec; letter-spacing: .04em; }
.cq-chip .mx-ic { width: 14px; height: 14px; color: rgb(var(--accent-rgb, 90,180,255)); }
.cq-chip.gold { color: #ffe08a; border-color: rgba(255,211,77,0.35); }
.cq-chip.cap { text-transform: capitalize; }
.cq-chip.red { color: #ffb0a0; border-color: rgba(255,90,70,0.45); }
.cq-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 10px 0; }
.cq-cell { padding: 9px 11px; border-radius: 10px; background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.06); min-width: 0; }
.cq-cell small { display: block; font-size: 9.5px; letter-spacing: .24em; color: #8a99aa; text-transform: uppercase; margin-bottom: 3px; }
.cq-cell b { font-size: 15px; letter-spacing: .04em; }
.cq-cell.wide { grid-column: 1 / -1; }
.cq-pips { display: inline-flex; gap: 3px; vertical-align: middle; }
.cq-pips i { width: 9px; height: 14px; border-radius: 2px; background: rgba(255,255,255,0.1); }
.cq-pips i.on { background: linear-gradient(180deg, #ff8a6a, #c43a28); box-shadow: 0 0 5px rgba(255,90,60,0.6); }
.cq-cmdr { display: flex; gap: 12px; align-items: center; margin: 10px 0; padding: 10px; border-radius: 12px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); }
.cq-pt { width: 58px; height: 68px; border-radius: 8px; overflow: hidden; flex-shrink: 0; background: radial-gradient(ellipse at 50% 30%, rgba(255,90,70,0.3), #05080c 75%); border: 1px solid rgba(255,90,70,0.45); }
.cq-pt svg { width: 100%; height: 100%; display: block; }
.cq-cmdr b { display: block; font-size: 15px; letter-spacing: .08em; }
.cq-cmdr span { display: block; font-size: 12.5px; color: #a9b8c8; line-height: 1.35; margin-top: 2px; }
.cq-cmdr .pers { color: #ffb0a0; font-size: 11px; letter-spacing: .2em; text-transform: uppercase; margin-top: 0; }
.cq-p { font-size: 14px; line-height: 1.5; color: #c8d6e4; margin: 8px 0; }
.cq-actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.cq-log { flex: 0 0 auto; max-height: 34%; min-height: 120px; overflow-y: auto; padding: 12px 14px; }
.cq-log h4, .cq-h4 { margin: 0 0 8px; font-size: 11px; letter-spacing: .3em; color: rgb(var(--accent-rgb, 90,180,255)); text-transform: uppercase; }
.cq-le { display: flex; gap: 8px; font-size: 12.5px; line-height: 1.35; color: #b8c8d8; margin: 5px 0; }
.cq-le i { flex-shrink: 0; font-style: normal; font-family: var(--mono, monospace); font-size: 10px; color: #7c8b9b; padding-top: 2px; width: 26px; }
.cq-le.win { color: #b9ffcf; } .cq-le.loss { color: #ffb0a0; } .cq-le.threat { color: #ffcf8a; } .cq-le.perk, .cq-le.research { color: #cfe6ff; } .cq-le.event { color: #e8dcff; }
/* --- map svg --- */
.cq-svg .ter { cursor: pointer; transition: fill-opacity .2s; }
.cq-svg .ter.player { fill-opacity: .5; } .cq-svg .ter.enemy { fill-opacity: .36; } .cq-svg .ter.neutral { fill-opacity: .34; }
.cq-svg .ter:hover { fill-opacity: .72; }
.cq-svg .ter.target { fill-opacity: .55; }
.cq-svg .ter.sel { fill-opacity: .82; }
.cq-svg .front { stroke-dasharray: 7 5; animation: cqDash 1.2s linear infinite; }
@keyframes cqDash { to { stroke-dashoffset: -24; } }
.cq-svg .arrow { fill: none; stroke-linecap: round; pointer-events: none; }
.cq-svg .arrow.opt { stroke-dasharray: 3 5; opacity: .75; animation: cqFlow 2.2s linear infinite; }
.cq-svg .pulse.slow { animation-duration: 2.6s; }
.cq-svg .arrow.go { stroke-dasharray: 10 7; animation: cqFlow .7s linear infinite; }
.cq-svg .arrow.threat { stroke-dasharray: 10 7; animation: cqFlow .55s linear infinite; }
@keyframes cqFlow { to { stroke-dashoffset: -34; } }
.cq-svg .pulse { transform-box: fill-box; transform-origin: center; animation: cqPulse 1.6s ease-out infinite; pointer-events: none; }
@keyframes cqPulse { from { transform: scale(1); opacity: .9; } to { transform: scale(2.6); opacity: 0; } }
.cq-svg .lbl { font-family: var(--font, sans-serif); font-size: 9.6px; letter-spacing: .1em; fill: #d7e3ef; paint-order: stroke; stroke: rgba(0,0,0,0.9); stroke-width: 3px; text-anchor: middle; text-transform: uppercase; pointer-events: none; font-weight: 600; }
.cq-svg .lbl.cap { font-size: 11.5px; font-weight: 800; fill: #fff; }
.cq-svg .cnt { pointer-events: none; }
.cq-svg .cnt text { font-family: var(--mono, monospace); font-size: 10px; font-weight: 700; text-anchor: middle; dominant-baseline: central; }
.cq-svg .army { animation: cqBreathe 2.4s ease-in-out infinite; }
@keyframes cqBreathe { 50% { filter: drop-shadow(0 0 6px rgba(var(--accent-rgb, 90,180,255),0.95)); } }
.cq-svg .lane { fill: none; stroke-dasharray: 3 5; pointer-events: none; }
/* --- modals --- */
.cq-modal { position: fixed; inset: 0; z-index: 41; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.62); animation: cqIn .3s ease-out; font-family: var(--font, sans-serif); color: #dfe8f2; }
.cq-dlg { width: min(940px, 94vw); max-height: 92vh; overflow-y: auto; padding: 22px 26px; position: relative; }
.cq-dlg.narrow { width: min(620px, 94vw); }
.cq-dlg.wide { width: min(1120px, 96vw); }
.cq-dlg h1 { margin: 4px 0 2px; font-size: 34px; letter-spacing: .14em; line-height: 1.05; text-transform: uppercase; }
.cq-dlg h3 { margin: 2px 0 10px; font-size: 13px; letter-spacing: .26em; color: #9fb0c2; font-weight: 600; text-transform: uppercase; }
.cq-dlg .cq-actions { justify-content: flex-end; margin-top: 18px; }
.cq-x { position: absolute; right: 14px; top: 12px; width: 34px; height: 34px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #9fb0c2; cursor: pointer; font-size: 18px; }
.cq-x:hover { color: #fff; border-color: rgba(var(--accent-rgb, 90,180,255),0.6); }
.cq-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 22px; }
.cq-sec { padding: 12px 14px; border-radius: 12px; background: rgba(0,0,0,0.26); border: 1px solid rgba(255,255,255,0.06); }
.cq-vets { display: flex; flex-wrap: wrap; gap: 6px; }
.cq-vet { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px 4px 6px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); font-size: 12.5px; }
.cq-vet .rank-svg { width: 15px; height: 15px; color: #ffd34d; }
.cq-vet small { color: #8a99aa; font-size: 11px; }
.cq-vet.lost { border-color: rgba(255,90,70,0.5); color: #ffb0a0; text-decoration: line-through; }
.cq-vet.promoted, .cq-vet.recruit { border-color: rgba(120,255,160,0.45); color: #c9ffd9; }
.cq-vet.recovered { border-color: rgba(255,211,77,0.45); }
.cq-slider { width: 100%; accent-color: rgb(var(--accent-rgb, 90,180,255)); }
.cq-funds { display: flex; justify-content: space-between; font-family: var(--mono, monospace); font-size: 13px; color: #b8c8d8; margin-top: 6px; }
.cq-funds b { color: #ffd34d; font-size: 16px; }
.cq-rows { display: flex; flex-direction: column; gap: 5px; }
.cq-row { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; color: #c8d6e4; padding: 4px 0; border-bottom: 1px dashed rgba(255,255,255,0.07); opacity: 0; animation: cqRowIn .35s ease-out forwards; }
.cq-row b { font-family: var(--mono, monospace); color: #ffe08a; }
.cq-row.total { border-bottom: 0; font-size: 18px; font-weight: 800; color: #fff; padding-top: 8px; }
.cq-row.total b { font-size: 22px; }
@keyframes cqRowIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
.cq-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 10px; }
.cq-card { position: relative; padding: 18px 16px 16px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.12); background: linear-gradient(180deg, rgba(30,40,54,0.9), rgba(10,14,20,0.95)); cursor: pointer; transition: all .18s; text-align: left; color: inherit; font: inherit; display: flex; flex-direction: column; gap: 8px; min-height: 200px; }
.cq-card:hover:not(.locked) { transform: translateY(-4px); border-color: rgb(var(--accent-rgb, 90,180,255)); box-shadow: 0 10px 34px rgba(var(--accent-rgb, 90,180,255),0.25); }
.cq-card.on { border-color: rgb(var(--accent-rgb, 90,180,255)); background: linear-gradient(180deg, rgba(var(--accent-rgb, 90,180,255),0.22), rgba(10,14,20,0.95)); box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb, 90,180,255),0.6); }
.cq-card.locked { opacity: .45; cursor: not-allowed; }
.cq-card .ic { width: 54px; height: 54px; border-radius: 14px; display: grid; place-items: center; background: radial-gradient(circle at 40% 30%, rgba(var(--accent-rgb, 90,180,255),0.35), rgba(0,0,0,0.4)); border: 1px solid rgba(var(--accent-rgb, 90,180,255),0.45); }
.cq-card .ic .mx-ic { width: 30px; height: 30px; color: #fff; }
.cq-card b { font-size: 18px; letter-spacing: .08em; text-transform: uppercase; }
.cq-card span { font-size: 13.5px; line-height: 1.45; color: #b8c8d8; }
.cq-card .tag { position: absolute; top: 14px; right: 14px; font-size: 10px; letter-spacing: .24em; color: rgb(var(--accent-rgb, 90,180,255)); text-transform: uppercase; }
.cq-card .lk { font-size: 11px; letter-spacing: .14em; color: #ffcf8a; text-transform: uppercase; margin-top: auto; }
.cq-res { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
.cq-rs { display: flex; gap: 12px; align-items: flex-start; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.28); }
.cq-rs .ic { width: 40px; height: 40px; flex-shrink: 0; border-radius: 10px; display: grid; place-items: center; background: rgba(var(--accent-rgb, 90,180,255),0.14); border: 1px solid rgba(var(--accent-rgb, 90,180,255),0.35); }
.cq-rs .ic .mx-ic { width: 22px; height: 22px; color: rgb(var(--accent-rgb, 90,180,255)); }
.cq-rs b { display: block; font-size: 14.5px; letter-spacing: .06em; }
.cq-rs span { display: block; font-size: 12.5px; color: #a9b8c8; line-height: 1.35; margin: 3px 0 8px; }
.cq-rs.done { border-color: rgba(120,255,160,0.4); background: rgba(20,60,30,0.25); }
.cq-rs.done .ic { background: rgba(120,255,160,0.15); border-color: rgba(120,255,160,0.5); }
.cq-rs.done .ic .mx-ic { color: #8dffb0; }
.cq-rs.locked { opacity: .5; }
.cq-rs .cq-btn { height: 32px; font-size: 11px; padding: 0 12px; }
.cq-tbl { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.cq-tbl th { text-align: left; font-size: 10px; letter-spacing: .24em; color: #8a99aa; font-weight: 600; padding: 4px 8px; text-transform: uppercase; }
.cq-tbl td { padding: 7px 8px; border-top: 1px solid rgba(255,255,255,0.06); }
.cq-tbl .rank-svg { width: 16px; height: 16px; color: #ffd34d; vertical-align: -3px; }
.cq-banner { position: fixed; left: 50%; top: 40%; transform: translate(-50%, -50%); z-index: 45; pointer-events: none; text-align: center; font-family: var(--font, sans-serif); animation: cqBanner 2.4s ease-in-out forwards; }
.cq-banner small { display: block; font-size: 13px; letter-spacing: .5em; color: rgb(var(--accent-rgb, 90,180,255)); }
.cq-banner b { display: block; font-size: 52px; letter-spacing: .24em; color: #fff; text-shadow: 0 0 34px rgba(var(--accent-rgb, 90,180,255),0.7); }
@keyframes cqBanner { 0% { opacity: 0; transform: translate(-50%, -40%); } 15%, 75% { opacity: 1; transform: translate(-50%, -50%); } 100% { opacity: 0; transform: translate(-50%, -58%); } }
.cq-big { text-align: center; }
.cq-big h1 { font-size: 50px; letter-spacing: .22em; text-shadow: 0 0 30px rgba(var(--accent-rgb, 90,180,255),0.45); }
.cq-big.lose h1 { color: #ff8a7a; text-shadow: 0 0 30px rgba(255,80,60,0.5); }
.cq-event { display: flex; gap: 18px; align-items: flex-start; }
.cq-event .ic { width: 86px; height: 86px; flex-shrink: 0; border-radius: 18px; display: grid; place-items: center; background: radial-gradient(circle at 40% 30%, rgba(255,211,77,0.32), rgba(0,0,0,0.5)); border: 1px solid rgba(255,211,77,0.45); }
.cq-event .ic .mx-ic { width: 48px; height: 48px; color: #ffe08a; }
.cq-choices { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
.cq-choice { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.14); background: rgba(8,12,18,0.85); cursor: pointer; color: inherit; font: inherit; text-align: left; transition: all .15s; }
.cq-choice:hover:not(:disabled) { border-color: rgb(var(--accent-rgb, 90,180,255)); transform: translateX(3px); }
.cq-choice b { font-size: 16px; letter-spacing: .06em; }
.cq-choice span { font-size: 12.5px; color: #a9b8c8; letter-spacing: .04em; }
.cq-choice:disabled { opacity: .4; cursor: not-allowed; }
.cq-new { position: fixed; inset: 0; z-index: 22; overflow-y: auto; padding: 3vh 3vw; background: radial-gradient(ellipse at 40% 30%, rgba(0,0,0,0.4), rgba(0,0,0,0.92) 75%); font-family: var(--font, sans-serif); color: #dfe8f2; animation: cqIn .45s ease-out; }
.cq-new-in { max-width: 1240px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; }
.cq-new-in > .cq-panel { padding: 20px 22px; }
.cq-facs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 10px 0 16px; }
.cq-fac { position: relative; height: 128px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.12); cursor: pointer; overflow: hidden; display: flex; align-items: center; gap: 14px; padding: 0 18px; transition: all .18s; color: inherit; font: inherit; text-align: left; }
.cq-fac.allies { background: linear-gradient(135deg, rgba(61,123,224,0.35), rgba(8,12,18,0.95) 70%); }
.cq-fac.soviet { background: linear-gradient(135deg, rgba(210,58,44,0.38), rgba(8,12,18,0.95) 70%); }
.cq-fac.on { border-color: #fff; box-shadow: 0 0 0 1px #fff, 0 10px 30px rgba(0,0,0,0.5); }
.cq-fac .emb { width: 110px; height: 80px; flex-shrink: 0; }
.cq-fac .emb svg { width: 100%; height: 100%; }
.cq-fac b { font-size: 22px; letter-spacing: .16em; display: block; }
.cq-fac span { font-size: 12.5px; color: #b8c8d8; line-height: 1.4; display: block; margin-top: 4px; }
.cq-seg { display: inline-flex; border-radius: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.14); }
.cq-seg button { height: 38px; padding: 0 18px; border: 0; background: rgba(0,0,0,0.3); color: #9fb0c2; font: inherit; font-size: 12.5px; letter-spacing: .2em; text-transform: uppercase; cursor: pointer; }
.cq-seg button.on { background: rgba(var(--accent-rgb, 90,180,255),0.32); color: #fff; }
.cq-seed { display: flex; gap: 8px; align-items: center; }
.cq-seed input { width: 150px; height: 38px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.14); background: rgba(0,0,0,0.35); color: #fff; font-family: var(--mono, monospace); font-size: 15px; padding: 0 12px; }
.cq-docs { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.cq-docs .cq-card { min-height: 150px; padding: 14px; }
.cq-docs .cq-card .ic { width: 42px; height: 42px; }
.cq-docs .cq-card .ic .mx-ic { width: 24px; height: 24px; }
.cq-docs .cq-card b { font-size: 15px; }
.cq-docs .cq-card span { font-size: 12.5px; }
.cq-metab { display: flex; flex-direction: column; gap: 10px; }
.cq-renown { font-family: var(--mono, monospace); font-size: 30px; color: #ffd34d; }
.cq-bar2 { height: 8px; border-radius: 5px; background: rgba(255,255,255,0.08); overflow: hidden; }
.cq-bar2 i { display: block; height: 100%; background: linear-gradient(90deg, rgba(255,211,77,0.5), #ffd34d); }
.cq-hist { font-size: 12.5px; color: #b8c8d8; display: flex; flex-direction: column; gap: 5px; }
.cq-hist div { display: flex; justify-content: space-between; gap: 8px; }
.cq-hist .w { color: #b9ffcf; } .cq-hist .l { color: #ffb0a0; }
@media (max-width: 600px) {
  .cq-facs { grid-template-columns: minmax(0, 1fr); }
  .cq-fac { height: auto; min-height: 96px; padding: 10px 14px; }
  .cq-fac .emb { width: 72px; height: 56px; }
  .cq-new { padding: 12px 10px; }
  .cq-new-in > .cq-panel { padding: 16px 14px; }
}
@media (max-width: 1100px) { .cq-main { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; } .cq-side { max-height: 38vh; } .cq-new-in { grid-template-columns: 1fr; } .cq-cards { grid-template-columns: 1fr; } }
`;

function injectCss() {
  if (document.getElementById('cq-style')) return;
  const st = document.createElement('style');
  st.id = 'cq-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (n: number) => fmtMoney(Math.round(n));
const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const unitName = (t: string) => (UNITS[t] ? typeName(UNITS[t]) : t);
const SIDE_RGB: Record<Faction | 'neutral', string> = { allies: '61,123,224', soviet: '210,58,44', neutral: '201,166,64' };
const TERRAIN_ICON: Record<string, string> = { plains: 'sun', forest: 'tree', mountain: 'chevrons', lakes: 'wave', river: 'bridge', coast: 'anchor', urban: 'building', steppe: 'dust', islands: 'anchor' };
const CLIMATE_ICON: Record<string, string> = { temperate: 'sun', winter: 'snow', desert: 'dust' };
type CqKey = Parameters<typeof tCq>[0];
const terrainName = (t: string) => tCq(`terrain.${t}` as CqKey);
const climateName = (c: string) => tCq(`climate.${c}` as CqKey);
const difficultyName = (d: string) => tCq(`difficulty.${d}` as CqKey);
const perkTag = (p: PerkDef) => tCq(`tag.${p.tag.toLowerCase()}` as CqKey);

// =====================================================================================================
// Map geometry (cached per run)
// =====================================================================================================
interface Geometry { paths: string[]; borders: Map<string, string> }
const geoCache = new Map<string, Geometry>();

function geometry(run: ConquestRun): Geometry {
  const key = `${run.id}:${run.seed}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const mesh = buildMesh(run.seed);
  const part = partition(mesh, run.territories.map((t) => [t.x, t.y] as Pt));
  const paths = run.territories.map((_, k) => outlineLoops(mesh, part.draw, k).map((l) => polyPath(l, true)).join(''));
  const borders = new Map<string, string>();
  for (const e of borderEdges(mesh, part.draw)) {
    const k = `${e.a}:${e.b}`;
    borders.set(k, (borders.get(k) ?? '') + `M${e.p[0].toFixed(1)} ${e.p[1].toFixed(1)}L${e.q[0].toFixed(1)} ${e.q[1].toFixed(1)}`);
  }
  const g = { paths, borders };
  geoCache.set(key, g);
  return g;
}

/** Curved arrow path between two sites (shortened at both ends). */
function arrowPath(a: Territory, b: Territory, bend = 0.18, trimA = 11, trimB = 14): string {
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  const ax = a.x + (dx / l) * trimA, ay = a.y + (dy / l) * trimA, bx = b.x - (dx / l) * trimB, by = b.y - (dy / l) * trimB;
  const mx = (ax + bx) / 2 - (dy / l) * l * bend, my = (ay + by) / 2 + (dx / l) * l * bend;
  return `M${ax.toFixed(1)} ${ay.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
}

function pictoAt(name: string, x: number, y: number, size: number, color: string): string {
  const s = size / 24;
  return `<g transform="translate(${(x - size / 2).toFixed(1)} ${(y - size / 2).toFixed(1)}) scale(${s.toFixed(3)})" color="${color}" fill="none" stroke="${color}" stroke-width="${(1.7 / Math.max(0.5, s)).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${PICTO[name] ?? ''}</g>`;
}

function ownerRgb(run: ConquestRun, t: Territory): string {
  return t.owner === 'player' ? SIDE_RGB[run.faction] : t.owner === 'enemy' ? SIDE_RGB[run.enemy] : SIDE_RGB.neutral;
}

function mapSvg(run: ConquestRun, selected: string | null): string {
  const g = geometry(run);
  const idx = new Map(run.territories.map((t, k) => [t.id, k]));
  const P = SIDE_RGB[run.faction], E = SIDE_RGB[run.enemy];
  const battles = availableBattles(run);
  const attackable = new Set(battles.filter((b) => b.action === 'attack').map((b) => b.target));
  // territories
  let ters = '', hatchE = '', hatchN = '';
  run.territories.forEach((t, k) => {
    const cls = `ter ${t.owner}${t.id === selected ? ' sel' : ''}${attackable.has(t.id) ? ' target' : ''}`;
    ters += `<path class="${cls}" data-id="${t.id}" d="${g.paths[k]}" fill="rgb(${ownerRgb(run, t)})"><title>${esc(territoryName(t))}</title></path>`;
    if (t.owner === 'enemy') hatchE += g.paths[k];
    if (t.owner === 'neutral') hatchN += g.paths[k];
  });
  // borders and the front line
  let borders = '', front = '';
  for (const [k, d] of g.borders) {
    const [a, b] = k.split(':').map(Number);
    const ta = run.territories[a], tb = run.territories[b];
    borders += d;
    if ((ta.owner === 'player') !== (tb.owner === 'player') && (ta.owner === 'enemy' || tb.owner === 'enemy')) front += d;
  }
  const sel = selected ? findTerritory(run, selected) : undefined;
  const selPath = sel ? g.paths[idx.get(sel.id)!] : '';
  // sea lanes
  let lanes = '';
  for (const l of run.links) {
    if (!l.sea) continue;
    const a = territory(run, l.a), b = territory(run, l.b);
    const mine = a.owner === 'player' || b.owner === 'player';
    lanes += `<path class="lane" d="${arrowPath(a, b, 0.12, 6, 6)}" stroke="rgba(120,200,255,${mine ? 0.55 : 0.22})" stroke-width="${mine ? 1.4 : 1}"/>`;
  }
  // arrows: attack options, the selected attack, the enemy counterattack
  let arrows = '';
  for (const b of battles) {
    if (b.action !== 'attack') continue;
    const from = territory(run, b.from), to = territory(run, b.target);
    const on = b.target === selected;
    arrows += `<path class="arrow ${on ? 'go' : 'opt'}" d="${arrowPath(from, to)}" stroke="${on ? 'rgb(255,221,120)' : `rgba(${P},0.9)`}" stroke-width="${on ? 3.2 : 2}" marker-end="url(#${on ? 'cqArrG' : 'cqArrP'})"${on ? ' filter="url(#cqGlow)"' : ''}/>`;
    if (!on) arrows += `<circle class="pulse slow" cx="${to.x}" cy="${to.y}" r="14" fill="none" stroke="rgba(255,236,170,0.75)" stroke-width="1.2"/>`;
  }
  if (run.threat) {
    const from = territory(run, run.threat.from), to = territory(run, run.threat.target);
    arrows += `<path class="arrow threat" d="${arrowPath(from, to, -0.2)}" stroke="rgb(255,70,50)" stroke-width="3.4" marker-end="url(#cqArrR)" filter="url(#cqGlow)"/>`;
    arrows += `<circle class="pulse" cx="${to.x}" cy="${to.y}" r="10" fill="none" stroke="#ff4632" stroke-width="2"/>`;
  }
  // markers: garrisons, capitals, the army, resources, labels
  let marks = '';
  for (const t of run.territories) {
    const x = t.x, y = t.y;
    const rgb = ownerRgb(run, t);
    if (t.capital) {
      const star = `M${x} ${y - 9}l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6-4.6-4.1 6.1-.6z`;
      marks += `<circle cx="${x}" cy="${y}" r="12" fill="rgba(0,0,0,0.55)" stroke="rgb(${rgb})" stroke-width="1.6"/><path d="${star}" fill="${t.capital === 'enemy' ? '#ff6a50' : '#ffd34d'}" transform="translate(0 1.6)"/>`;
      if (t.capital === 'enemy') marks += `<circle class="pulse" cx="${x}" cy="${y}" r="12" fill="none" stroke="rgba(255,90,70,0.8)" stroke-width="1.5"/>`;
    } else if (t.owner !== 'player') {
      marks += `<g class="cnt"><rect x="${x - 12}" y="${y - 7.5}" width="24" height="15" rx="3" fill="rgba(8,6,6,0.88)" stroke="rgb(${rgb})" stroke-width="1.3"/>
        <path d="M${x - 9} ${y - 5}L${x - 1} ${y + 5}M${x - 1} ${y - 5}L${x - 9} ${y + 5}" stroke="rgb(${rgb})" stroke-width="1.2"/>
        <text x="${x + 5.5}" y="${y + 0.5}" fill="#fff">${t.strength}</text></g>`;
    } else if (t.fort > 0) {
      marks += pictoAt('tower', x, y, 14, `rgb(${rgb})`);
    } else {
      marks += `<circle cx="${x}" cy="${y}" r="3" fill="rgb(${rgb})" stroke="rgba(0,0,0,0.8)" stroke-width="1.2"/>`;
    }
    if (t.res) marks += pictoAt(RESOURCES[t.res].icon, x + 15, y - 9, 11, '#ffd34d');
    if (t.partisans && t.owner !== 'player') marks += pictoAt('flag', x - 15, y - 9, 11, '#8dffb0');
    if (run.superThreat?.territory === t.id) marks += `<circle class="pulse" cx="${x}" cy="${y}" r="9" fill="none" stroke="#ffd34d" stroke-width="2"/>${pictoAt('nuke', x - 16, y - 10, 13, '#ffd34d')}`;
    const stars = t.value >= 2 ? ' ' + '★'.repeat(t.value - 1) : '';
    marks += `<text class="lbl${t.capital ? ' cap' : ''}" x="${x}" y="${y + (t.capital ? 24 : 19)}">${esc(territoryName(t))}<tspan fill="#ffd34d">${stars}</tspan></text>`;
  }
  const army = findTerritory(run, run.armyAt);
  if (army) {
    const ax = army.x + 14, ay = army.y + 2;
    marks += `<g class="army" pointer-events="none"><rect x="${ax - 2}" y="${ay - 9}" width="30" height="18" rx="4" fill="rgba(4,10,18,0.92)" stroke="rgb(${P})" stroke-width="1.8"/>
      <ellipse cx="${ax + 8}" cy="${ay}" rx="6.5" ry="4" fill="none" stroke="rgb(${P})" stroke-width="1.3"/>
      <text x="${ax + 21}" y="${ay + 0.5}" fill="#fff" font-family="var(--mono, monospace)" font-size="10" font-weight="700" text-anchor="middle" dominant-baseline="central">${run.core.length}</text></g>`;
  }
  const grat: string[] = [];
  for (let lon = -10; lon <= 50; lon += 10) { const x = (lon + 11) * 14.6; grat.push(`M${x.toFixed(1)} ${VIEW.y} V${VIEW.y + VIEW.h}`); }
  for (let lat = 35; lat <= 70; lat += 5) { const y = (72.5 - lat) * 15.6; grat.push(`M${VIEW.x} ${y.toFixed(1)} H${VIEW.x + VIEW.w}`); }
  return `<svg class="cq-svg" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="cqSea" cx="45%" cy="40%" r="75%"><stop offset="0" stop-color="#0c1824"/><stop offset="1" stop-color="#03070b"/></radialGradient>
      <linearGradient id="cqLand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c2a36"/><stop offset="1" stop-color="#121c25"/></linearGradient>
      <clipPath id="cqClip"><path d="${LAND_D}${SEA_D}" clip-rule="evenodd"/></clipPath>
      <pattern id="cqHatchE" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0 V7" stroke="rgba(${E},0.42)" stroke-width="2"/></pattern>
      <pattern id="cqHatchN" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><path d="M0 0 V9" stroke="rgba(${SIDE_RGB.neutral},0.32)" stroke-width="1.5"/></pattern>
      <filter id="cqGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <marker id="cqArrP" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="rgb(${P})"/></marker>
      <marker id="cqArrG" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="rgb(255,221,120)"/></marker>
      <marker id="cqArrR" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="rgb(255,70,50)"/></marker>
    </defs>
    <rect x="${VIEW.x}" y="${VIEW.y}" width="${VIEW.w}" height="${VIEW.h}" fill="url(#cqSea)"/>
    <path d="${grat.join('')}" stroke="rgba(var(--accent-rgb, 90,180,255),0.07)" stroke-width="1" fill="none"/>
    <path d="${LAND_D}" fill="url(#cqLand)" stroke="rgba(var(--accent-rgb, 90,180,255),0.4)" stroke-width="1.1" stroke-linejoin="round" filter="url(#cqGlow)"/>
    <path d="${SEA_D}" fill="#08121b" stroke="rgba(var(--accent-rgb, 90,180,255),0.32)" stroke-width="1"/>
    <g clip-path="url(#cqClip)">
      ${ters}
      <path d="${hatchE}" fill="url(#cqHatchE)" pointer-events="none"/>
      <path d="${hatchN}" fill="url(#cqHatchN)" pointer-events="none"/>
      <path d="${borders}" fill="none" stroke="rgba(0,0,0,0.6)" stroke-width="2.4" pointer-events="none"/>
      <path d="${borders}" fill="none" stroke="rgba(210,228,245,0.28)" stroke-width="0.8" pointer-events="none"/>
      <path d="${front}" fill="none" stroke="rgba(255,170,60,0.35)" stroke-width="5" filter="url(#cqGlow)" pointer-events="none"/>
      <path class="front" d="${front}" fill="none" stroke="#ffb347" stroke-width="2" pointer-events="none"/>
      ${selPath ? `<path d="${selPath}" fill="none" stroke="#fff" stroke-width="2.2" pointer-events="none" filter="url(#cqGlow)"/>` : ''}
    </g>
    <path d="${LAND_D}" fill="none" stroke="rgba(var(--accent-rgb, 90,180,255),0.35)" stroke-width="0.9" pointer-events="none"/>
    ${lanes}
    ${arrows}
    ${marks}
  </svg>`;
}

// =====================================================================================================
// Screen
// =====================================================================================================
let current: { close(): void } | null = null;

/** The Conquest screen: new campaign setup, or the strategic map of the active run. */
export function showConquest(opts: ConquestUiOptions): () => void {
  injectCss();
  current?.close();
  const screen = new ConquestScreen(opts);
  current = screen;
  screen.open();
  return () => screen.close();
}

/** A battle of a run just ended: record it, then show the report over the paused battle. */
export function showConquestAfterBattle(world: World, setup: ConquestSetup, opts: { play(k: 'click' | 'tab'): void; onContinue(): void; onMenu(): void }) {
  injectCss();
  const run = loadRun();
  const outcome = battleOutcome(world, setup.battle);
  let ok = false;
  if (run && run.id === setup.runId && run.pending?.spec.id === setup.battle.id) {
    resolveBattle(run, outcome);
    ok = true;
    saveRun(run);
    clearBattleSaves(setup.battle.id);
  }
  document.body.classList.toggle('faction-soviet', setup.battle.faction === 'soviet');
  const host = document.createElement('div');
  host.className = 'cq-modal';
  document.body.appendChild(host);
  const close = () => { host.remove(); window.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); close(); ok ? opts.onContinue() : opts.onMenu(); } };
  window.addEventListener('keydown', onKey);
  if (ok && run?.report) {
    run.reportSeen = true;
    saveRun(run);
    host.innerHTML = `<div class="cq-panel cq-dlg">${reportHtml(run, run.report, tCommon('continue'))}</div>`;
  } else {
    host.innerHTML = `<div class="cq-panel cq-dlg narrow cq-big ${outcome.won ? '' : 'lose'}"><div class="cq-kick">${esc(tCq('report.conquest'))}</div><h1>${esc(tCommon(outcome.won ? 'victory' : 'defeat'))}</h1>
      <p class="cq-p">${esc(tCq('report.orphan'))}</p><div class="cq-actions"><button class="cq-btn pri" data-act="go">${esc(tCq('report.mainMenu'))}</button></div></div>`;
  }
  animateRows(host);
  (host.querySelector('[data-act="go"]') as HTMLElement).onclick = () => { opts.play('click'); close(); ok ? opts.onContinue() : opts.onMenu(); };
}

/** Saves of a battle that has been resolved must not be resumed again. */
function clearBattleSaves(battleId: string) {
  for (const slot of ['conquest', 'auto', 'manual']) {
    const s = readSave(slot);
    if (s?.game?.setup?.conquest?.battle?.id === battleId) deleteSave(slot);
  }
}

/** The latest save game of the run's committed battle, if any. */
export function battleSave(run: ConquestRun | null): SaveData | null {
  if (!run?.pending) return null;
  let best: SaveData | null = null;
  for (const slot of ['conquest', 'auto', 'manual']) {
    const s = readSave(slot);
    if (s?.game?.setup?.conquest?.battle?.id === run.pending.spec.id && (!best || s.savedAt > best.savedAt)) best = s;
  }
  return best;
}

function animateRows(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.cq-row').forEach((r, k) => { r.style.animationDelay = `${0.15 + k * 0.08}s`; });
}

function reportHtml(run: ConquestRun, rep: NonNullable<ConquestRun['report']>, goLabel: string): string {
  const title = tCq(rep.won ? (rep.action === 'defend' ? 'report.lineHeld' : 'report.victory') : rep.action === 'defend' ? 'report.territoryLost' : 'report.repulsed');
  const territory = territoryName({ id: rep.territory, name: rep.name });
  const sub = tCq(rep.won ? (rep.captured ? 'report.captured' : 'report.defended') : rep.lost ? 'report.fallen' : 'report.failed', { territory });
  const rows: [string, string][] = [];
  rows.push([tCq('report.time'), tCq('report.timePar', { time: fmtT(rep.time), par: fmtT(rep.par) })]);
  rows.push([tCq('report.committed'), money(rep.committed)]);
  rows.push([tCq('report.returned'), money(rep.returned)]);
  if (rep.loot) rows.push([tCq(rep.captured ? 'report.spoils' : 'report.bounty'), money(rep.loot)]);
  for (const b of rep.bonus) rows.push([trRun(b.label), [b.credits ? money(b.credits) : '', b.rp ? tCq('report.rpPlus', { n: b.rp }) : ''].filter(Boolean).join(' · ')]);
  if (rep.rp) rows.push([tCq('report.researchPoints'), tCq('report.plus', { n: rep.rp })]);
  if (rep.morale) rows.push([tCq('report.morale'), rep.morale > 0 ? '+1' : '-1']);
  rows.push([tCq('report.kills'), fmtInt(rep.kills)]);
  rows.push([tCq('report.losses'), fmtInt(rep.losses)]);
  const vets = rep.veterans.map((v) => `<span class="cq-vet ${v.fate}" title="${esc(unitName(v.type))}">${rankBadge(v.rank)}${esc(callSignName(v.name))} <small>${esc(unitName(v.type))} · ${esc(tCq(`fate.${v.fate}`))}</small></span>`).join('');
  const objs = rep.objectives.map((o) => `<div class="cq-le ${o.state === 'done' ? 'win' : o.state === 'failed' ? 'loss' : ''}"><i>${o.state === 'done' ? '✔' : o.state === 'failed' ? '✖' : '·'}</i>${esc(trRun(o.text))}${o.primary ? '' : ` <small style="color:#7c8b9b">${esc(tCq('report.optional'))}</small>`}</div>`).join('');
  return `
    <div class="cq-big ${rep.won ? '' : 'lose'}"><div class="cq-kick">${esc(tCq('report.kick', { kind: kindName(rep.kind), operation: trSource(run.name) }))}</div><h1>${esc(title)}</h1><h3>${esc(sub)}</h3></div>
    <div class="cq-cols">
      <div class="cq-sec"><div class="cq-h4">${esc(tCq('report.rewards'))}</div><div class="cq-rows">${rows.map(([l, v]) => `<div class="cq-row"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div></div>
      <div class="cq-sec"><div class="cq-h4">${esc(tCq('report.objectives'))}</div>${objs || `<div class="cq-p">${esc(tCq('report.noObjectives'))}</div>`}
        <div class="cq-h4" style="margin-top:14px">${esc(tCq('report.coreArmy'))}</div><div class="cq-vets">${vets || `<span class="cq-p">${esc(tCq('report.noVeterans'))}</span>`}</div>
        ${rep.perkOffered ? `<p class="cq-p" style="color:#ffe08a">${esc(tCq('report.perkOffered'))}</p>` : ''}</div>
    </div>
    <div class="cq-actions"><button class="cq-btn pri" data-act="go">${esc(goLabel)}</button></div>`;
}

class ConquestScreen {
  private root: HTMLElement | null = null;
  private modalEl: HTMLElement | null = null;
  private run: ConquestRun | null = null;
  private meta: ConquestMeta = loadMeta();
  private selected: string | null = null;
  private closed = false;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private untrap: (() => void) | null = null;
  private untrapModal: (() => void) | null = null;

  constructor(private opts: ConquestUiOptions) {}

  open() {
    this.run = loadRun();
    window.addEventListener('keydown', this.keyHandler);
    if (this.run && this.run.status !== 'active' && !this.run.unlocks) this.finishMeta();
    if (!this.run || this.opts.demo === 'new' || (this.run.status !== 'active' && this.run.unlocks && this.summarySeen())) this.newRunScreen();
    else this.render(true);
    if (this.run && this.opts.demo) this.demo(this.opts.demo);
  }

  /** Screenshot / test states. */
  private demo(what: string) {
    const run = this.run!;
    const target = availableBattles(run).find((b) => b.action === 'attack')?.target;
    if (what === 'preview' && target) { this.selected = target; this.render(); this.previewModal(target); }
    else if (what === 'select' && target) { this.selected = target; this.render(); }
    else if (what === 'research') this.researchModal();
    else if (what === 'army') this.armyModal();
    else if (what === 'perks') this.perksModal();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('keydown', this.keyHandler);
    this.untrapModal?.(); this.untrapModal = null;
    this.untrap?.(); this.untrap = null;
    this.modalEl?.remove();
    this.root?.remove();
    document.body.classList.remove('faction-soviet');
    if (current === this) current = null;
  }

  private summarySeen() { return localStorage.getItem('rh.conquest.seen') === this.run?.id; }

  private onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (this.modalEl) { const x = this.modalEl.querySelector<HTMLElement>('[data-close]'); if (x) x.click(); return; }
    if (this.selected) { this.selected = null; this.render(); return; }
    this.back();
  }

  private back() {
    this.opts.play('click');
    this.close();
    this.opts.onBack();
  }

  private save() {
    if (this.run) saveRun(this.run);
  }

  private setRoot(el: HTMLElement) {
    this.untrap?.();
    this.root?.remove();
    this.root = el;
    document.body.appendChild(el);
    this.untrap = focusTrap(el, { initial: false, restore: false });
  }

  // ---------------------------------------------------------------------------------------------------
  // New campaign
  // ---------------------------------------------------------------------------------------------------
  private newRunScreen() {
    const meta = this.meta = loadMeta();
    let faction: Faction = (localStorage.getItem('rh.conquest.faction') as Faction) === 'soviet' ? 'soviet' : 'allies';
    let difficulty: Difficulty = (localStorage.getItem('rh.conquest.diff') as Difficulty) || 'normal';
    let doctrine = localStorage.getItem('rh.conquest.doctrine') ?? 'combined_arms';
    let seed = (Math.random() * 1e9) >>> 0;
    const root = document.createElement('div');
    root.className = 'cq-new';
    const draw = () => {
      document.body.classList.toggle('faction-soviet', faction === 'soviet');
      const unlockedDoc = (d: (typeof DOCTRINES)[number]) => meta.renown >= d.renown;
      if (!DOCTRINES.some((d) => d.id === doctrine && unlockedDoc(d))) doctrine = 'combined_arms';
      const nextDoc = DOCTRINES.filter((d) => d.renown > meta.renown).sort((a, b) => a.renown - b.renown)[0];
      const prevDoc = DOCTRINES.filter((d) => d.renown <= meta.renown).sort((a, b) => b.renown - a.renown)[0];
      const frac = nextDoc ? (meta.renown - (prevDoc?.renown ?? 0)) / Math.max(1, nextDoc.renown - (prevDoc?.renown ?? 0)) : 1;
      const titleDef = meta.title ? TITLES.find((t) => t.id === meta.title) : undefined;
      const title = titleDef ? titleName(titleDef) : null;
      root.innerHTML = `<div class="cq-new-in">
        <div class="cq-panel">
          <div class="cq-kick">${esc(tCq('new.kick'))}</div>
          <h1 style="margin:4px 0 2px;font-size:38px;letter-spacing:.16em">${esc(tCq('new.title'))}</h1>
          <p class="cq-p">${esc(tCq('new.intro'))}</p>
          <div class="cq-h4" style="margin-top:14px">${esc(tCq('new.side'))}</div>
          <div class="cq-facs">
            <button class="cq-fac allies ${faction === 'allies' ? 'on' : ''}" data-fac="allies"><span class="emb">${alliedEmblem()}</span><div><b>${esc(tCq('new.allies'))}</b><span>${esc(tCq('new.alliesBlurb'))}</span></div></button>
            <button class="cq-fac soviet ${faction === 'soviet' ? 'on' : ''}" data-fac="soviet"><span class="emb">${sovietEmblem()}</span><div><b>${esc(tCq('new.soviet'))}</b><span>${esc(tCq('new.sovietBlurb'))}</span></div></button>
          </div>
          <div style="display:flex;gap:26px;flex-wrap:wrap;align-items:flex-end">
            <div><div class="cq-h4">${esc(tCq('new.difficulty'))}</div><div class="cq-seg">${(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => `<button data-diff="${d}" class="${d === difficulty ? 'on' : ''}">${esc(difficultyName(d))}</button>`).join('')}</div></div>
            <div><div class="cq-h4">${esc(tCq('new.seed'))}</div><div class="cq-seed"><input data-seed value="${seed}" inputmode="numeric" aria-label="${esc(tCq('new.seed'))}"><button class="cq-btn" data-act="dice" title="${esc(tCq('new.newSeed'))}" aria-label="${esc(tCq('new.newSeed'))}">${picto('crate')}</button></div></div>
          </div>
          <div class="cq-h4" style="margin-top:18px">${esc(tCq('new.doctrine'))}</div>
          <div class="cq-docs">${DOCTRINES.map((d) => {
            const ok = unlockedDoc(d);
            return `<button class="cq-card ${d.id === doctrine ? 'on' : ''} ${ok ? '' : 'locked'}" data-doc="${d.id}"><div class="ic">${picto(d.icon)}</div><b>${esc(doctrineName(d))}</b><span>${esc(doctrineDesc(d))}</span>${ok ? '' : `<div class="lk">${picto('lock')} ${esc(tCq('new.renownNeeded', { n: d.renown }))}</div>`}</button>`;
          }).join('')}</div>
          <div class="cq-actions"><button class="cq-btn" data-act="back">${esc(tCommon('back'))}</button><button class="cq-btn pri" data-act="begin">${picto('flag')}${esc(tCq('new.begin'))}</button></div>
        </div>
        <div class="cq-panel cq-metab">
          <div class="cq-kick">${esc(tCq('new.record'))}</div>
          ${title ? `<div class="cq-chip gold">${picto('laurel')}${esc(title)}</div>` : ''}
          <div><div class="cq-renown">${fmtInt(meta.renown)}</div><small style="letter-spacing:.24em;color:#8a99aa">${esc(tCq('new.renown'))}</small></div>
          <div class="cq-bar2"><i style="width:${Math.round(frac * 100)}%"></i></div>
          <div style="font-size:12.5px;color:#a9b8c8">${nextDoc ? tCq.html('new.nextUnlock', { name: doctrineName(nextDoc), n: nextDoc.renown }).replace('<b>', '<b style="color:#ffe08a">') : esc(tCq('new.allUnlocked'))}</div>
          <div class="cq-grid">
            <div class="cq-cell"><small>${esc(tCq('new.campaigns'))}</small><b>${fmtInt(meta.runs)}</b></div><div class="cq-cell"><small>${esc(tCq('new.victories'))}</small><b>${fmtInt(meta.victories)}</b></div>
            <div class="cq-cell"><small>${esc(tCq('new.bestScore'))}</small><b>${fmtInt(meta.bestScore)}</b></div><div class="cq-cell"><small>${esc(tCq('new.fastestWin'))}</small><b>${meta.bestTurns ? esc(tCq('new.turns', { n: meta.bestTurns })) : '—'}</b></div>
          </div>
          <div class="cq-h4">${esc(tCq('new.titles'))}</div>
          <div class="cq-chips">${TITLES.map((t) => `<span class="cq-chip ${meta.titles.includes(t.id) ? 'gold' : ''}" title="${esc(titleDesc(t))}" style="${meta.titles.includes(t.id) ? 'cursor:pointer' : 'opacity:.45'}" data-title="${t.id}">${meta.titles.includes(t.id) ? picto('laurel') : picto('lock')}${esc(titleName(t))}</span>`).join('')}</div>
          <div class="cq-h4">${esc(tCq('new.recent'))}</div>
          <div class="cq-hist">${meta.history.length ? meta.history.slice(0, 6).map((h) => `<div><span class="${h.status === 'won' ? 'w' : 'l'}">${esc(tCommon(h.status === 'won' ? 'victory' : 'defeat'))} · ${esc(tCommon(h.faction === 'allies' ? 'faction.allies' : 'faction.soviet'))}</span><span>${esc(tCq('new.turnsScore', { n: h.turns, score: fmtInt(h.score) }))}</span></div>`).join('') : `<div>${esc(tCq('new.noCampaigns'))}</div>`}</div>
        </div>
      </div>`;
      root.querySelectorAll<HTMLElement>('[data-fac]').forEach((b) => (b.onclick = () => { faction = b.dataset.fac as Faction; this.opts.play('tab'); draw(); }));
      root.querySelectorAll<HTMLElement>('[data-diff]').forEach((b) => (b.onclick = () => { difficulty = b.dataset.diff as Difficulty; this.opts.play('tab'); draw(); }));
      root.querySelectorAll<HTMLElement>('[data-doc]').forEach((b) => (b.onclick = () => {
        const d = DOCTRINES.find((x) => x.id === b.dataset.doc)!;
        if (!unlockedDoc(d)) return;
        doctrine = d.id; this.opts.play('click'); draw();
      }));
      root.querySelectorAll<HTMLElement>('[data-title]').forEach((b) => (b.onclick = () => {
        if (!meta.titles.includes(b.dataset.title!)) return;
        meta.title = b.dataset.title!; saveMeta(meta); this.opts.play('click'); draw();
      }));
      const seedIn = root.querySelector<HTMLInputElement>('[data-seed]')!;
      seedIn.onchange = () => { seed = (Math.abs(parseInt(seedIn.value, 10)) || 1) >>> 0; };
      (root.querySelector('[data-act="dice"]') as HTMLElement).onclick = () => { seed = (Math.random() * 1e9) >>> 0; this.opts.play('click'); draw(); };
      (root.querySelector('[data-act="back"]') as HTMLElement).onclick = () => this.back();
      (root.querySelector('[data-act="begin"]') as HTMLElement).onclick = () => {
        seed = (Math.abs(parseInt(seedIn.value, 10)) || seed) >>> 0;
        localStorage.setItem('rh.conquest.faction', faction);
        localStorage.setItem('rh.conquest.diff', difficulty);
        localStorage.setItem('rh.conquest.doctrine', doctrine);
        this.opts.play('click');
        this.run = generateRun({ seed, faction, difficulty, doctrine, now: Date.now(), renown: meta.renown });
        this.save();
        this.selected = null;
        this.render(true);
      };
    };
    draw();
    this.setRoot(root);
  }

  // ---------------------------------------------------------------------------------------------------
  // Strategic map
  // ---------------------------------------------------------------------------------------------------
  private render(fresh = false) {
    const run = this.run!;
    document.body.classList.toggle('faction-soviet', run.faction === 'soviet');
    const root = document.createElement('div');
    root.className = 'cq';
    const date = monthYear(run.turn);
    const inc = income(run);
    const hint = run.status !== 'active' ? tCq(run.status === 'won' ? 'map.hintWon' : 'map.hintOver')
      : run.pending ? tCq('map.hintBattle', { territory: territoryName({ id: run.pending.spec.territory, name: run.pending.spec.name }) })
      : run.threat ? tCq('map.hintThreat', { territory: territoryName(territory(run, run.threat.target)) })
      : tCq('map.hintChoose');
    root.innerHTML = `
      <div class="cq-panel cq-top">
        <div class="cq-emb">${run.faction === 'allies' ? alliedEmblem() : sovietEmblem()}</div>
        <div class="cq-ttl"><div class="cq-kick">${esc(tCq(run.faction === 'allies' ? 'map.kickAllies' : 'map.kickSoviet', { difficulty: difficultyName(run.difficulty) }))}</div><h1>${esc(trSource(run.name))}</h1></div>
        <div class="cq-stats">
          <div class="cq-stat">${picto('calendar')}<div><small>${esc(tCq('map.turn', { n: run.turn }))}</small><b>${esc(date)}</b></div></div>
          <div class="cq-stat gold" title="${esc(tCq('map.incomeTip', { money: money(inc.credits) }))}">${picto('coin')}<div><small>${esc(tCq('map.warChest'))}</small><b>${money(run.warChest)}</b></div></div>
          <div class="cq-stat">${picto('chart')}<div><small>${esc(tCq('map.research'))}</small><b>${esc(tCq('map.rp', { n: run.rp }))}</b></div></div>
          <div class="cq-stat ${run.morale <= 1 ? 'warn' : ''}" title="${esc(tCq('map.moraleTip'))}">${picto('ironwill')}<div><small>${esc(tCq('map.morale'))}</small><b class="cq-hearts" role="img" aria-label="${run.morale} / ${run.moraleMax}">${Array.from({ length: run.moraleMax }, (_, k) => `<i class="${k < run.morale ? 'on' : ''}"></i>`).join('')}</b></div></div>
          <div class="cq-stat">${picto('chevrons')}<div><small>${esc(tCq('map.coreArmy'))}</small><b>${esc(tCq('map.slots', { n: run.core.length, max: coreCapacity(run) }))}</b></div></div>
        </div>
      </div>
      <div class="cq-main">
        <div class="cq-panel cq-map">
          <div class="cq-sweep"></div>
          ${mapSvg(run, this.selected)}
          <div class="cq-legend">
            <span><i style="background:rgba(${SIDE_RGB[run.faction]},0.75)"></i>${esc(tCq(run.faction === 'allies' ? 'map.alliesYou' : 'map.sovietYou'))}</span>
            <span><i style="background:repeating-linear-gradient(35deg,rgba(${SIDE_RGB[run.enemy]},0.8) 0 2px,rgba(${SIDE_RGB[run.enemy]},0.35) 2px 5px)"></i>${esc(tCq(run.enemy === 'allies' ? 'map.allied' : 'map.soviet'))}</span>
            <span><i style="background:rgba(${SIDE_RGB.neutral},0.6)"></i>${esc(tCq('map.neutral'))}</span>
            <span><i style="background:#ffb347;height:3px;vertical-align:3px"></i>${esc(tCq('map.frontLine'))}</span>
            <span><i style="background:transparent;border-top:2px dashed rgba(120,200,255,0.8);height:0;vertical-align:3px"></i>${esc(tCq('map.seaLane'))}</span>
          </div>
          <div class="cq-coords">${esc(tCq('map.theatre', { date: date.toUpperCase() }))}<br>${esc(tCq('map.held', { n: owned(run).length, total: run.territories.length }))}</div>
          <div class="cq-hint ${run.threat && !run.pending ? 'warn' : ''}">${esc(hint)}</div>
          <div class="cq-bar">
            <button class="cq-btn" data-act="research">${picto('chart')}${esc(tCq('map.research'))}${run.rp && researchFor(run).some((r) => researchState(run, r) === 'available') ? `<em>${run.rp}</em>` : ''}</button>
            <button class="cq-btn" data-act="army">${picto('chevrons')}${esc(tCq('map.coreArmy'))}</button>
            <button class="cq-btn" data-act="perks">${picto('medal')}${esc(tCq('map.doctrines'))}</button>
            <div class="grow"></div>
            <button class="cq-btn" data-act="regroup" ${run.status !== 'active' || run.pending ? 'disabled' : ''} title="${esc(tCq('map.regroupTip'))}">${picto('clock')}${esc(tCq('map.regroup'))}</button>
            <button class="cq-btn" data-act="menu">${picto('back')}${esc(tCommon('menu'))}</button>
          </div>
        </div>
        <div class="cq-side">
          <div class="cq-panel cq-info">${this.infoHtml()}</div>
          <div class="cq-panel cq-log"><h4>${esc(tCq('map.diary'))}</h4>${[...run.log].reverse().slice(0, 40).map((l) => `<div class="cq-le ${l.kind}"><i>${esc(tCq('map.diaryTurn', { n: l.turn }))}</i><span>${esc(trLog(l))}</span></div>`).join('')}</div>
        </div>
      </div>`;
    this.setRoot(root);
    this.bind();
    if (fresh) this.flow();
  }

  private bind() {
    const root = this.root!;
    root.querySelectorAll<SVGPathElement>('.ter').forEach((p) => p.addEventListener('click', () => {
      const id = p.dataset.id!;
      this.selected = this.selected === id ? null : id;
      this.opts.play('click');
      this.render();
    }));
    const on = (act: string, fn: () => void) => { const b = root.querySelector<HTMLElement>(`[data-act="${act}"]`); if (b) b.onclick = () => { this.opts.play('click'); fn(); }; };
    on('research', () => this.researchModal());
    on('army', () => this.armyModal());
    on('perks', () => this.perksModal());
    on('menu', () => this.menuModal());
    on('regroup', () => this.confirm(tCq('confirm.regroupTitle'), [tCq('confirm.regroup'), this.threatWarning(), tCq('confirm.regroupEnd')].filter(Boolean).join(' '), tCq('confirm.regroupYes'), () => {
      regroup(this.run!);
      this.after();
    }));
    on('attack', () => this.selected && this.previewModal(this.selected));
    on('defend', () => this.run!.threat && this.previewModal(this.run!.threat.target));
    on('resume', () => { const s = battleSave(this.run); if (s) { this.close(); this.opts.onResume(s); } });
    on('restart', () => this.deploy());
    on('withdraw', () => this.confirm(tCq('confirm.withdrawTitle'), tCq('confirm.withdraw'), tCq('confirm.withdrawYes'), () => {
      withdraw(this.run!);
      this.after();
    }, true));
    on('summary', () => this.summaryModal());
    on('newrun', () => { localStorage.setItem('rh.conquest.seen', this.run!.id); this.newRunScreen(); });
    on('select-threat', () => { this.selected = this.run!.threat?.target ?? null; this.render(); });
  }

  /** What ignoring the declared counterattack means. */
  private threatWarning(): string {
    const run = this.run!;
    if (!run.threat) return '';
    const t = territory(run, run.threat.target);
    return tCq(t.capital === 'player' ? 'confirm.threatCapital' : 'confirm.threat', { territory: territoryName(t) });
  }

  /** After a state change: save, then walk through the pending screens (report, perks, event, summary). */
  private after() {
    this.save();
    const turnBefore = Number(this.root?.dataset.turn ?? 0);
    this.selected = null;
    this.render(true);
    if (this.run && this.run.turn !== turnBefore && this.run.status === 'active') this.banner();
  }

  private banner() {
    const run = this.run!;
    const b = document.createElement('div');
    b.className = 'cq-banner';
    b.innerHTML = `<small>${esc(tCq('map.banner', { n: run.turn }))}</small><b>${esc(monthYear(run.turn).toUpperCase())}</b>`;
    document.body.appendChild(b);
    window.setTimeout(() => b.remove(), 2500);
  }

  private flow() {
    const run = this.run!;
    if (this.root) this.root.dataset.turn = String(run.turn);
    if (this.modalEl) return;
    if (run.report && !run.reportSeen) { this.reportModal(); return; }
    if (run.status !== 'active') { if (!run.unlocks) this.finishMeta(); this.summaryModal(); return; }
    if (run.perkChoice) { this.perkPickModal(); return; }
    if (run.event) { this.eventModal(); return; }
  }

  private finishMeta() {
    const run = this.run!;
    const s = recordRunEnd(run);
    if (s) saveRun(run);
    this.meta = loadMeta();
    if (s && s.rankAfter > s.rankBefore) {
      const faction = loadProfile().faction;
      showAchievementToast({ kind: 'rank', title: s.rankName, xp: 0, icon: insigniaSvg(s.rankAfter, faction), desc: tCq('map.promoted', { name: trSource(run.name) }) });
    }
  }

  // ---------------------------------------------------------------------------------------------------
  // Side panel
  // ---------------------------------------------------------------------------------------------------
  private infoHtml(): string {
    const run = this.run!;
    if (run.status !== 'active') {
      return `<div class="cq-own" style="color:${run.status === 'won' ? '#8dffb0' : '#ff8a7a'}">${esc(tCommon(run.status === 'won' ? 'victory' : 'defeat'))}</div><h2>${esc(tCq(run.status === 'won' ? 'info.wonTitle' : 'info.overTitle'))}</h2>
        <p class="cq-p">${esc(trRun(run.ending ?? ''))}</p><div class="cq-actions"><button class="cq-btn pri" data-act="summary">${picto('trophy')}${esc(tCq('info.summary'))}</button><button class="cq-btn" data-act="newrun">${esc(tCq('info.newCampaign'))}</button></div>`;
    }
    if (run.pending) {
      const S = run.pending.spec;
      const save = battleSave(run);
      return `<div class="cq-own" style="color:#ffcf8a">${esc(tCq('info.inProgress'))}</div><h2>${esc(tCq('info.battleOf', { territory: territoryName({ id: S.territory, name: S.name }) }))}</h2>
        <div class="cq-chips"><span class="cq-chip">${picto(KIND_INFO[S.kind].icon)}${esc(kindName(S.kind))}</span><span class="cq-chip">${picto('globe')}${esc(trRun(S.mapLabel))}</span><span class="cq-chip gold">${picto('coin')}${money(S.credits)}</span></div>
        <p class="cq-p">${esc(save ? tCq('info.saved', { when: fmtDateTime(save.savedAt), time: fmtT(save.game?.time ?? 0) }) : tCq('info.noSave'))}</p>
        <div class="cq-actions">${save ? `<button class="cq-btn pri" data-act="resume">${picto('play')}${esc(tCq('info.resume'))}</button>` : ''}<button class="cq-btn ${save ? '' : 'pri'}" data-act="restart">${picto('flag')}${esc(tCq(save ? 'info.restart' : 'info.deploy'))}</button><button class="cq-btn danger" data-act="withdraw">${esc(tCq('info.withdraw'))}</button></div>`;
    }
    const t = findTerritory(run, this.selected);
    if (!t) {
      const inc = income(run);
      const opts = availableBattles(run).filter((b) => b.action === 'attack').length;
      const threatT = run.threat ? territoryName(territory(run, run.threat.target)) : '';
      return `<div class="cq-own" style="color:rgb(var(--accent-rgb))">${esc(tCq('info.yourMove'))}</div><h2>${esc(monthYear(run.turn))}</h2>
        ${run.threat ? `<div class="cq-cell wide" style="border-color:rgba(255,90,70,0.6);background:rgba(80,10,5,0.35)"><small style="color:#ffb0a0">${esc(tCq('info.counterattack'))}</small><b>${esc(tCq('info.route', { from: territoryName(territory(run, run.threat.from)), territory: threatT }))}</b>
          <p class="cq-p" style="margin:6px 0 8px">${esc(tCq('info.defendIt'))}</p><button class="cq-btn danger pri" data-act="defend">${picto('shield')}${esc(tCq('info.defendTerritory', { territory: threatT }))}</button></div>` : ''}
        <p class="cq-p">${tCq.html('info.plan', { n: opts, capital: territoryName(run.territories.find((x) => x.capital === 'enemy')!) })}</p>
        <div class="cq-grid">
          <div class="cq-cell"><small>${esc(tCq('info.incomePerTurn'))}</small><b>${esc(inc.rp ? tCq('info.incomeRp', { money: money(inc.credits), rp: inc.rp }) : money(inc.credits))}</b></div>
          <div class="cq-cell"><small>${esc(tCq('info.territories'))}</small><b>${esc(tCq('info.ofTotal', { n: owned(run).length, total: run.territories.length }))}</b></div>
          <div class="cq-cell"><small>${esc(tCq('info.battlesWon'))}</small><b>${fmtInt(run.stats.battlesWon)}</b></div>
          <div class="cq-cell"><small>${esc(tCq('info.doctrines'))}</small><b>${fmtInt(run.perks.length)}</b></div>
          ${run.superThreat ? `<div class="cq-cell wide" style="border-color:rgba(255,211,77,0.5)"><small style="color:#ffe08a">${esc(tCq('info.superThreat'))}</small><b>${esc(tCq('info.strikesIn', { territory: territoryName(territory(run, run.superThreat.territory)), n: run.superThreat.turns }))}</b></div>` : ''}
        </div>`;
    }
    const owner = tCq(t.owner === 'player' ? (run.faction === 'allies' ? 'info.alliedTerritory' : 'info.sovietTerritory') : t.owner === 'enemy' ? (run.enemy === 'allies' ? 'info.alliedTerritory' : 'info.sovietTerritory') : 'info.neutralTerritory');
    const ownColor = `rgb(${ownerRgb(run, t)})`;
    const climate = this.climateFor(t);
    const chips = [
      `<span class="cq-chip">${picto(TERRAIN_ICON[t.terrain])}${esc(terrainName(t.terrain))}</span>`,
      `<span class="cq-chip cap">${picto(CLIMATE_ICON[climate])}${esc(climateName(climate))}</span>`,
      t.coastal ? `<span class="cq-chip">${picto('anchor')}${esc(tCq('info.coastal'))}</span>` : '',
      `<span class="cq-chip gold">${esc(tCq('info.value', { stars: '★'.repeat(t.value) }))}</span>`,
      t.res ? `<span class="cq-chip gold" title="${esc(resourceDesc(t.res))}">${picto(RESOURCES[t.res].icon)}${esc(resourceName(t.res))}</span>` : '',
      t.capital ? `<span class="cq-chip ${t.capital === 'enemy' ? 'red' : 'gold'}">${picto('flag')}${esc(tCq('info.capital'))}</span>` : '',
      t.partisans && t.owner !== 'player' ? `<span class="cq-chip" style="color:#8dffb0">${picto('flag')}${esc(tCq('info.partisans'))}</span>` : '',
    ].join('');
    const opt = availableBattles(run).find((b) => b.target === t.id);
    let body = '';
    if (t.owner === 'player') {
      body = `<div class="cq-grid"><div class="cq-cell"><small>${esc(tCq('info.income'))}</small><b>${esc(tCq('info.perTurn', { money: money(t.income) }))}</b></div><div class="cq-cell"><small>${esc(tCq('info.fortifications'))}</small><b>${t.fort ? '▮'.repeat(t.fort) + ' ' + esc(tCq('info.fortLevel', { n: t.fort })) : esc(tCommon('none'))}</b></div>
        ${t.res ? `<div class="cq-cell wide"><small>${esc(resourceName(t.res))}</small><b style="font-size:13px">${esc(resourceDesc(t.res))}</b></div>` : ''}
        <div class="cq-cell wide"><small>${esc(tCq('info.heldSince'))}</small><b>${esc(t.captured ? tCq('info.turnN', { n: t.captured }) : tCq('info.sinceStart'))}</b></div></div>`;
      if (opt?.action === 'defend') body += `<div class="cq-actions"><button class="cq-btn danger pri" data-act="defend">${picto('shield')}${esc(tCq('info.defend'))}</button></div>`;
    } else {
      const pers = t.owner === 'enemy' ? (t.capital === 'enemy' ? run.boss : run.fronts[t.front]) : null;
      const P = pers ? PERSONALITIES[pers.personality] : null;
      const kind = opt ? planBattle(run, t.id, 0).kind : t.capital === 'enemy' ? 'boss' : t.objective;
      body = `<div class="cq-grid">
          <div class="cq-cell"><small>${esc(tCq('info.garrison'))}</small><b><span class="cq-pips" role="img" aria-label="${t.strength} / 6">${Array.from({ length: 6 }, (_, k) => `<i class="${k < t.strength ? 'on' : ''}"></i>`).join('')}</span></b></div>
          <div class="cq-cell"><small>${esc(tCq('info.incomeIfTaken'))}</small><b>${esc(tCq('info.perTurn', { money: money(t.income) }))}</b></div>
          <div class="cq-cell wide"><small>${esc(tCq('info.battle'))}</small><b>${picto(KIND_INFO[kind].icon, 'mx-ic')} ${esc(kindName(kind))}</b><div style="font-size:12.5px;color:#a9b8c8;margin-top:2px">${esc(kindDesc(kind))}</div></div>
        </div>
        ${pers && P ? `<div class="cq-cmdr"><div class="cq-pt">${castPortrait(pers.commander, run.enemy === 'soviet' ? 'enemy' : 'commander')}</div><div><b>${esc(trRun(pers.commander))}</b><span class="pers">${picto(P.icon, 'mx-ic')} ${esc(personalityName(pers.personality))}</span><span>${esc(personalityDesc(pers.personality))}</span></div></div>` : t.owner === 'neutral' ? `<p class="cq-p">${esc(tCq('info.neutralPower'))}</p>` : ''}
        <div class="cq-actions">${opt ? `<button class="cq-btn pri" data-act="attack">${picto('crosshair')}${esc(tCq('info.planAttack'))}</button>`
          : t.capital === 'enemy' && attackTargets(run).some((a) => a.target === t.id) ? `<span class="cq-p" style="color:#ffcf8a">${esc(tCq('info.capitalGate', { territory: territoryName(t), n: capitalGate(run), held: owned(run).length }))}</span>`
          : `<span class="cq-p" style="color:#8a99aa">${esc(tCq('info.notFront'))}</span>`}</div>`;
    }
    return `<div class="cq-own" style="color:${ownColor}">${esc(owner)}</div><h2>${esc(territoryName(t))}</h2><div class="cq-chips">${chips}</div>${body}`;
  }

  private climateFor(t: Territory): string {
    return climateOf(t, this.run!.turn); // this month's battle climate
  }

  // ---------------------------------------------------------------------------------------------------
  // Modals
  // ---------------------------------------------------------------------------------------------------
  private modal(html: string, cls = '', onClose?: () => void): HTMLElement {
    this.modalEl?.remove();
    const m = document.createElement('div');
    m.className = 'cq-modal';
    m.innerHTML = `<div class="cq-panel cq-dlg ${cls}">${onClose ? `<button class="cq-x" data-close title="${esc(tCommon('close'))}" aria-label="${esc(tCommon('close'))}">✕</button>` : ''}${html}</div>`;
    document.body.appendChild(m);
    this.modalEl = m;
    this.untrapModal?.();
    this.untrapModal = focusTrap(m, { initial: false });
    const x = m.querySelector<HTMLElement>('[data-close]');
    if (x) x.onclick = () => { this.opts.play('click'); this.closeModal(); onClose?.(); };
    animateRows(m);
    return m;
  }

  private closeModal() {
    this.untrapModal?.(); this.untrapModal = null;
    this.modalEl?.remove();
    this.modalEl = null;
  }

  private confirm(title: string, text: string, yes: string, fn: () => void, danger = false) {
    const m = this.modal(`<div class="cq-kick">${esc(tCommon('confirm'))}</div><h1 style="font-size:28px">${esc(title)}</h1><p class="cq-p">${esc(text)}</p>
      <div class="cq-actions"><button class="cq-btn" data-act="no">${esc(tCommon('cancel'))}</button><button class="cq-btn pri ${danger ? 'danger' : ''}" data-act="yes">${esc(yes)}</button></div>`, 'narrow', () => {});
    (m.querySelector('[data-act="no"]') as HTMLElement).onclick = () => { this.opts.play('click'); this.closeModal(); };
    (m.querySelector('[data-act="yes"]') as HTMLElement).onclick = () => { this.opts.play('click'); this.closeModal(); fn(); };
  }

  private menuModal() {
    const run = this.run!;
    const m = this.modal(`<div class="cq-kick">${esc(trSource(run.name))}</div><h1 style="font-size:28px">${esc(tCq('menu.title'))}</h1>
      <p class="cq-p">${esc(tCq('menu.text'))}</p>
      <div class="cq-actions" style="justify-content:space-between"><button class="cq-btn danger" data-act="abandon">${picto('skull')}${esc(tCq('menu.abandon'))}</button><button class="cq-btn pri" data-act="leave">${picto('back')}${esc(tCq('menu.mainMenu'))}</button></div>`, 'narrow', () => {});
    (m.querySelector('[data-act="leave"]') as HTMLElement).onclick = () => { this.closeModal(); this.back(); };
    (m.querySelector('[data-act="abandon"]') as HTMLElement).onclick = () => {
      this.opts.play('click');
      this.confirm(tCq('menu.abandonTitle'), tCq('menu.abandonText'), tCq('menu.abandonYes'), () => {
        abandonRun(this.run!);
        this.after();
      }, true);
    };
  }

  private previewModal(targetId: string) {
    const run = this.run!;
    let commit = defaultCommit(run);
    let S: BattleSpec;
    try { S = planBattle(run, targetId, commit); } catch { return; }
    const t = territory(run, targetId);
    const P = PERSONALITIES[S.personality];
    const mods: string[] = [];
    if (S.mods.tanks) mods.push(tCq('preview.mods.tanks', { n: S.mods.tanks }));
    if (S.mods.drops.length) mods.push(tCq('preview.mods.drops', { n: S.mods.drops.length }));
    if (S.mods.income > 1) mods.push(tCq('preview.mods.ore', { n: Math.round((S.mods.income - 1) * 100) }));
    if (S.mods.buildSpeed > 1) mods.push(tCq('preview.mods.production', { n: Math.round((S.mods.buildSpeed - 1) * 100) }));
    if (S.mods.outpost) mods.push(tCq(run.faction === 'soviet' ? 'preview.mods.teslaOutpost' : 'preview.mods.bridgehead'));
    if (S.mods.commandos) mods.push(tCq('preview.mods.commandos'));
    if (S.mods.engineers) mods.push(tCq('preview.mods.engineers', { n: S.mods.engineers }));
    if (S.mods.recon) mods.push(tCq('preview.mods.recon'));
    if (S.mods.escorts) mods.push(tCq('preview.mods.warships', { n: S.mods.escorts }));
    if (S.mods.drill) mods.push(tCq('preview.mods.infantry'));
    if (S.mods.tankAces) mods.push(tCq('preview.mods.vetTanks'));
    if (S.mods.bounty) mods.push(tCq('preview.mods.bounty'));
    const lootPreview = S.kind === 'defend' ? 800 + 300 * t.value : Math.round((600 + 700 * t.value) * (run.perks.includes('plunder') ? 1.5 : 1));
    const m = this.modal(`
      <div class="cq-kick">${esc(S.kind === 'defend' ? tCq('preview.defence') : S.from ? tCq('preview.attackFrom', { from: trSource(S.from) }) : tCq('preview.attack'))} · ${esc(monthYear(S.turn))}</div>
      <h1>${esc(tCq('info.battleOf', { territory: territoryName({ id: S.territory, name: S.name }) }))}</h1>
      <h3>${esc(kindName(S.kind))} · ${esc(kindDesc(S.kind))}</h3>
      <div class="cq-cols">
        <div>
          <div class="cq-grid">
            <div class="cq-cell"><small>${esc(tCq('preview.battlefield'))}</small><b>${esc(trRun(S.mapLabel))}</b></div>
            <div class="cq-cell"><small>${esc(tCq('preview.climateTime'))}</small><b style="text-transform:capitalize">${picto(CLIMATE_ICON[S.climate], 'mx-ic')} ${esc(climateName(S.climate))} · ${String(Math.floor(S.map.hour ?? 12)).padStart(2, '0')}:00</b></div>
            <div class="cq-cell"><small>${esc(tCq('preview.strength'))}</small><b><span class="cq-pips" role="img" aria-label="${S.strength} / 6">${Array.from({ length: 6 }, (_, k) => `<i class="${k < S.strength ? 'on' : ''}"></i>`).join('')}</span></b></div>
            <div class="cq-cell"><small>${esc(tCq('preview.enemyAi'))}</small><b style="text-transform:capitalize">${esc(tCommon(`difficulty.${S.ai}`))}</b></div>
            <div class="cq-cell"><small>${esc(tCq('preview.par'))}</small><b>${fmtT(S.parTime)}</b></div>
            <div class="cq-cell"><small>${esc(tCq('preview.mapSize'))}</small><b>${S.map.size} × ${S.map.size}</b></div>
          </div>
          <div class="cq-cmdr"><div class="cq-pt">${castPortrait(S.commander, S.enemy === 'soviet' ? 'enemy' : 'commander')}</div><div><b>${esc(trRun(S.commander))}</b><span class="pers">${picto(P.icon, 'mx-ic')} ${esc(S.neutral ? tCq('preview.neutralMilitia') : personalityName(S.personality))}</span><span>${esc(S.neutral ? tCq('preview.neutralDesc') : personalityDesc(S.personality))}</span></div></div>
          ${S.superweapon && S.kind !== 'boss' ? `<p class="cq-p" style="color:#ffe08a">${picto('nuke', 'mx-ic')} ${esc(tCq('preview.superweapon'))}</p>` : ''}
          ${S.partisans ? `<p class="cq-p" style="color:#8dffb0">${picto('flag', 'mx-ic')} ${esc(tCq('preview.partisans'))}</p>` : ''}
          ${run.threat && S.kind !== 'defend' ? `<p class="cq-p" style="color:#ffb0a0">${picto('shield', 'mx-ic')} ${esc(this.threatWarning())}</p>` : ''}
        </div>
        <div>
          <div class="cq-sec"><div class="cq-h4">${esc(tCq('preview.forces'))}</div>
            <div class="cq-vets">${S.core.length ? S.core.map((c) => `<span class="cq-vet">${rankBadge(c.rank)}${esc(callSignName(c.name))} <small>${esc(unitName(c.type))}</small></span>`).join('') : `<span class="cq-p">${esc(tCq('preview.noVeterans'))}</span>`}</div>
            ${run.core.length > S.core.length ? `<p class="cq-p" style="font-size:12px;color:#8a99aa">${esc(tCq('preview.inPort', { n: run.core.length - S.core.length }))}</p>` : ''}
            <p class="cq-p" style="font-size:13px">${esc(tCq(S.kind === 'defend' ? 'preview.standingBase' : 'preview.landing'))}${mods.length ? ` · ${esc(mods.join(' · '))}` : ''}</p>
          </div>
          <div class="cq-sec" style="margin-top:10px"><div class="cq-h4">${esc(tCq('preview.funds'))}</div>
            <input class="cq-slider" type="range" min="0" max="${run.warChest}" step="250" value="${commit}" data-commit aria-label="${esc(tCq('preview.funds'))}">
            <div class="cq-funds"><span>${tCq.html('preview.commit', { money: money(commit), total: money(run.warChest) }).replace('<b>', '<b data-commitv>')}</span><span>${tCq.html('preview.fundsTotal', { money: money(S.credits) }).replace('<b>', '<b data-funds>')}</span></div>
            <p class="cq-p" style="font-size:12px;color:#8a99aa;margin-bottom:0">${esc(tCq(run.perks.includes('war_bonds') ? 'preview.allotmentBonds' : 'preview.allotment', { money: money(ALLOTMENT), cap: money(RETURN_CAP) }))}</p>
          </div>
          <div class="cq-sec" style="margin-top:10px"><div class="cq-h4">${esc(tCq('preview.ifWon'))}</div>
            <div class="cq-chips" style="margin:0">${S.kind === 'defend' ? `<span class="cq-chip gold">${picto('coin')}${money(lootPreview)}</span><span class="cq-chip">${esc(tCq('preview.rp', { n: 1 }))}</span><span class="cq-chip">${picto('tower')}${esc(tCq('preview.fortify'))}</span>` : `<span class="cq-chip gold">${picto('coin')}${esc(tCq('preview.spoils', { money: money(lootPreview) }))}</span><span class="cq-chip">${esc(tCq('preview.rp', { n: t.value + (t.res === 'science' ? 1 : 0) }))}</span><span class="cq-chip">${esc(tCq('info.perTurn', { money: money(t.income) }))}</span>${t.value >= 2 ? `<span class="cq-chip gold">${picto('medal')}${esc(tCq('preview.doctrinePick'))}</span>` : ''}${t.capital === 'enemy' ? `<span class="cq-chip gold">${picto('trophy')}${esc(tCq('preview.winWar'))}</span>` : ''}`}</div>
            <p class="cq-p" style="font-size:12px;color:#ffb0a0;margin-bottom:0">${esc(tCq(S.kind === 'defend' ? 'preview.defeatCostDefence' : 'preview.defeatCost'))}</p>
          </div>
        </div>
      </div>
      <div class="cq-actions"><button class="cq-btn" data-act="cancel">${esc(tCommon('cancel'))}</button><button class="cq-btn pri" data-act="deploy">${picto('flag')}${esc(tCq('preview.deploy'))}</button></div>`, 'wide', () => {});
    const slider = m.querySelector<HTMLInputElement>('[data-commit]')!;
    slider.oninput = () => {
      commit = +slider.value;
      (m.querySelector('[data-commitv]') as HTMLElement).textContent = money(commit);
      (m.querySelector('[data-funds]') as HTMLElement).textContent = money(ALLOTMENT + commit + (run.perks.includes('war_bonds') ? 1500 : 0));
    };
    (m.querySelector('[data-act="cancel"]') as HTMLElement).onclick = () => { this.opts.play('click'); this.closeModal(); };
    (m.querySelector('[data-act="deploy"]') as HTMLElement).onclick = () => {
      this.opts.play('click');
      startBattle(run, targetId, commit);
      this.save();
      this.closeModal();
      this.deploy();
    };
  }

  private deploy() {
    const setup = pendingSetup(this.run!);
    if (!setup) return;
    this.close();
    this.opts.onDeploy(setup);
  }

  private researchModal() {
    const run = this.run!;
    const draw = () => {
      const list = researchFor(run);
      const m = this.modal(`<div class="cq-kick">${esc(tCq('research.kick', { n: run.rp }))}</div><h1>${esc(tCq('research.title'))}</h1>
        <h3>${esc(tCq('research.sub'))}</h3>
        <div class="cq-res">${list.map((r) => {
          const st = researchState(run, r);
          const needs = (r.needs ?? []).filter((n) => !run.research.includes(n)).map((n) => { const d = list.find((x) => x.id === n); return d ? researchName(d) : n; });
          const units = (r.unlocks ?? []).filter((u) => UNITS[u] && UNITS[u].owner.includes(run.faction)).map(unitName);
          return `<div class="cq-rs ${st}"><div class="ic">${picto(r.icon)}</div><div style="flex:1;min-width:0"><b>${esc(researchName(r))}</b><span>${esc(researchDesc(r))}${units.length ? `<br><small style="color:#7fa7cf">${esc(units.join(', '))}</small>` : ''}</span>
            ${st === 'done' ? `<span style="color:#8dffb0;font-size:11px;letter-spacing:.2em">${esc(tCq('research.done'))}</span>` : st === 'locked' ? `<span style="color:#ffcf8a;font-size:11px">${esc(tCq('research.needs', { list: needs.join(', ') }))}</span>` : `<button class="cq-btn ${st === 'available' ? 'pri' : ''}" data-buy="${r.id}" ${st === 'available' ? '' : 'disabled'} style="height:32px;font-size:11px;padding:0 12px">${esc(tCq('research.buy', { n: r.cost }))}</button>`}</div></div>`;
        }).join('')}</div>`, 'wide', () => this.render());
      m.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => (b.onclick = () => {
        if (buyResearch(run, b.dataset.buy!)) { this.opts.play('click'); this.save(); draw(); }
      }));
    };
    draw();
  }

  private armyModal() {
    const run = this.run!;
    const rows = run.core.map((v) => `<tr><td>${rankBadge(v.rank)} ${esc(tCq(v.rank >= 2 ? 'army.elite' : 'army.veteran'))}</td><td><b>${esc(callSignName(v.name))}</b></td><td>${esc(unitName(v.type))}</td><td>${fmtInt(v.battles)}</td><td>${fmtInt(v.xp)}</td><td>${esc(tCq('army.joinedTurn', { n: v.joined }))}</td></tr>`).join('');
    this.modal(`<div class="cq-kick">${esc(tCq('army.kick', { n: run.core.length, max: coreCapacity(run) }))}</div><h1>${esc(tCq('army.title'))}</h1>
      <h3>${esc(tCq('army.sub'))}</h3>
      ${run.core.length ? `<table class="cq-tbl"><thead><tr><th>${esc(tCq('army.rank'))}</th><th>${esc(tCq('army.callSign'))}</th><th>${esc(tCq('army.unit'))}</th><th>${esc(tCq('army.battles'))}</th><th>${esc(tCq('army.xp'))}</th><th>${esc(tCq('army.joined'))}</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="cq-p">${esc(tCq('army.empty'))}</p>`}
      <p class="cq-p" style="font-size:12.5px;color:#8a99aa">${esc(tCq('army.capacity'))}</p>`, '', () => {});
  }

  private perksModal() {
    const run = this.run!;
    const doc = DOCTRINES.find((d) => d.id === run.doctrine);
    this.modal(`<div class="cq-kick">${esc(tCq('perks.kick', { name: doc ? doctrineName(doc) : run.doctrine }))}</div><h1>${esc(tCq('perks.title'))}</h1>
      <h3>${esc(tCq('perks.sub'))}</h3>
      <div class="cq-res">${run.perks.map((id) => { const p = perkDef(id, run.faction); return p ? `<div class="cq-rs done"><div class="ic">${picto(p.icon)}</div><div><b>${esc(perkName(p))}</b><span>${esc(perkDesc(p))}</span><span style="font-size:10px;letter-spacing:.2em;color:#8a99aa">${esc(perkTag(p).toUpperCase())}</span></div></div>` : ''; }).join('') || `<p class="cq-p">${esc(tCq('perks.none'))}</p>`}</div>
      ${run.research.length ? `<div class="cq-h4" style="margin-top:16px">${esc(tCq('perks.research'))}</div><div class="cq-chips">${run.research.map((r) => { const d = researchFor(run).find((x) => x.id === r); return `<span class="cq-chip">${esc(d ? researchName(d) : r)}</span>`; }).join('')}</div>` : ''}`, 'wide', () => {});
  }

  private perkPickModal() {
    const run = this.run!;
    const ids = run.perkChoice ?? [];
    const m = this.modal(`<div class="cq-kick">${esc(tCq('pick.kick'))}</div><h1>${esc(tCq('pick.title'))}</h1><h3>${esc(tCq('pick.sub'))}</h3>
      <div class="cq-cards">${ids.map((id) => { const p = perkDef(id, run.faction)!; return `<button class="cq-card" data-perk="${id}"><span class="tag">${esc(perkTag(p))}</span><div class="ic">${picto(p.icon)}</div><b>${esc(perkName(p))}</b><span>${esc(perkDesc(p))}</span></button>`; }).join('')}</div>`, 'wide');
    m.querySelectorAll<HTMLElement>('[data-perk]').forEach((b) => (b.onclick = () => {
      this.opts.play('click');
      pickPerk(run, b.dataset.perk!);
      this.closeModal();
      this.save();
      this.render(true);
    }));
  }

  private eventModal() {
    const run = this.run!;
    const ev = run.event!;
    const def = EVENT_BY_ID[ev.id];
    if (!def) { run.event = null; this.save(); return; }
    const choices = def.choices(run, ev);
    const m = this.modal(`<div class="cq-kick">${esc(tCq('event.kick', { date: monthYear(run.turn) }))}</div>
      <div class="cq-event" style="margin-top:8px"><div class="ic">${picto(def.icon)}</div><div style="flex:1"><h1 style="font-size:30px">${esc(trRun(def.title))}</h1><p class="cq-p" style="font-size:15.5px">${esc(trRun(def.text(run, ev)))}</p></div></div>
      <div class="cq-choices">${choices.map((c, k) => `<button class="cq-choice" data-choice="${k}" ${c.cost && run.warChest < c.cost ? 'disabled' : ''}><b>${esc(trRun(c.label))}</b><span>${esc(trRun(c.hint))}</span></button>`).join('')}</div>`, 'narrow');
    m.querySelectorAll<HTMLElement>('[data-choice]').forEach((b) => (b.onclick = () => {
      this.opts.play('click');
      const text = chooseEvent(run, +b.dataset.choice!);
      this.save();
      const r = this.modal(`<div class="cq-kick">${esc(trRun(def.title))}</div><div class="cq-event" style="margin-top:8px"><div class="ic">${picto(def.icon)}</div><div><h1 style="font-size:26px">${esc(tCq('event.outcome'))}</h1><p class="cq-p" style="font-size:15.5px">${esc(trRun(text))}</p></div></div>
        <div class="cq-actions"><button class="cq-btn pri" data-act="ok">${esc(tCommon('continue'))}</button></div>`, 'narrow');
      (r.querySelector('[data-act="ok"]') as HTMLElement).onclick = () => { this.opts.play('click'); this.closeModal(); this.render(true); };
    }));
  }

  private reportModal() {
    const run = this.run!;
    const m = this.modal(reportHtml(run, run.report!, tCommon('continue')), '');
    (m.querySelector('[data-act="go"]') as HTMLElement).onclick = () => {
      this.opts.play('click');
      run.reportSeen = true;
      this.save();
      this.closeModal();
      this.render(true);
    };
  }

  private summaryModal() {
    const run = this.run!;
    const sc = run.score;
    const won = run.status === 'won';
    const m = this.modal(`<div class="cq-big ${won ? '' : 'lose'}"><div class="cq-kick">${esc(tCq('summary.kick', { name: trSource(run.name), n: run.turn }))}</div><h1>${esc(tCommon(won ? 'victory' : 'defeat'))}</h1><h3>${esc(trRun(run.ending ?? ''))}</h3></div>
      <div class="cq-cols">
        <div class="cq-sec"><div class="cq-h4">${esc(tCq('summary.score'))}</div><div class="cq-rows">
          ${(sc?.lines ?? []).map((l) => `<div class="cq-row"><span>${esc(trRun(l.label))}</span><b>${fmtInt(l.value)}</b></div>`).join('')}
          ${sc && sc.multiplier !== 1 ? `<div class="cq-row"><span>${esc(tCq('summary.difficulty'))}</span><b>×${sc.multiplier}</b></div>` : ''}
          <div class="cq-row total"><span>${esc(tCq('summary.total'))}</span><b>${fmtInt(sc?.total ?? 0)}</b></div></div></div>
        <div class="cq-sec"><div class="cq-h4">${esc(tCq('summary.rewards'))}</div><div class="cq-rows">
          <div class="cq-row"><span>${esc(tCq('summary.renown'))}</span><b>+${fmtInt(sc?.renown ?? 0)}</b></div><div class="cq-row"><span>${esc(tCq('summary.xp'))}</span><b>+${fmtInt(sc?.xp ?? 0)}</b></div>
          <div class="cq-row"><span>${esc(tCq('summary.battles'))}</span><b>${run.stats.battlesWon} / ${run.stats.battlesLost}</b></div><div class="cq-row"><span>${esc(tCq('summary.captured'))}</span><b>${fmtInt(run.stats.captured)}</b></div>
          <div class="cq-row"><span>${esc(tCq('summary.veteransLost'))}</span><b>${fmtInt(run.stats.veteransLost)}</b></div></div>
          ${run.unlocks?.length ? `<div class="cq-h4" style="margin-top:14px">${esc(tCq('summary.unlocked'))}</div><div class="cq-chips">${run.unlocks.map((u) => `<span class="cq-chip gold">${picto('laurel')}${esc(trRun(u))}</span>`).join('')}</div>` : ''}
        </div>
      </div>
      <div class="cq-actions"><button class="cq-btn" data-act="map">${esc(tCq('summary.viewMap'))}</button><button class="cq-btn" data-act="menu">${esc(tCq('summary.mainMenu'))}</button><button class="cq-btn pri" data-act="new">${picto('flag')}${esc(tCq('summary.newCampaign'))}</button></div>`, 'wide');
    (m.querySelector('[data-act="map"]') as HTMLElement).onclick = () => { this.opts.play('click'); this.closeModal(); };
    (m.querySelector('[data-act="menu"]') as HTMLElement).onclick = () => { localStorage.setItem('rh.conquest.seen', run.id); this.closeModal(); this.back(); };
    (m.querySelector('[data-act="new"]') as HTMLElement).onclick = () => { this.opts.play('click'); localStorage.setItem('rh.conquest.seen', run.id); this.closeModal(); this.newRunScreen(); };
  }
}

/** Whether there is a Conquest campaign to continue (main menu). */
export function conquestInfo(): { label: string } | null {
  const run = loadRun();
  if (!run || run.status !== 'active') return null;
  return { label: `${trSource(run.name)} · ${monthYear(run.turn)}` };
}

