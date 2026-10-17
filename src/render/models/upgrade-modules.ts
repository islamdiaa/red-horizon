/**
 * Upgrade modules: add-on models that make a structure's upgrades visible (Commander rules).
 *
 *   applyUpgradeModules(view, ids)      attach / remove the modules for a host's completed upgrades
 *   updateCommanderView(view, b, world) per-frame hook for Commander structures (entities.ts): applies the
 *                                       upgrades when they change, the upgrade-in-progress scaffold, the research
 *                                       lab glow, the bunker garrison and the gate's orientation
 *   tickUpgradeModules(time, dt)        build-in animations and the debris of destroyed modules (once per frame)
 *   breakUpgradeModules(model, physics) the host collapsed: its modules topple off as rigid bodies
 *
 * A module is its own small model (procedural template from commander-structures.ts; an HD body is grafted on if
 * the manifest ever lists '<model>.<faction>', like any structure: none ship today, the HD set is at its size
 * budget), attached to the host's root at a per-building anchor: it moves, scales
 * (construction, selling) and hides with the host, and mirrors the host's animation state (damage variants, power).
 * One draw call per module (plus its shadow); the hologram shell exists only while a module builds.
 */
import * as THREE from 'three';
import { instantiate, type ModelFaction, type ModelTemplate, type V3 } from './builder';
import type { ModelAnimState, ModelInstance } from './types';
import { MODULE_BUILDERS } from './commander-structures';
import { hdModelsEnabled, hdReadyVersion, hdWrap, requestHd } from './hd';
import { BodyVariant } from './materials';
import { createHoloMaterial } from '../holo';

// ---------------------------------------------------------------------------------------------
// anchors: (host type, upgrade id) -> module model + where it sits in the host's model space
// ---------------------------------------------------------------------------------------------

export interface ModuleAnchor {
  /** Module model id (MODULE_BUILDERS key; HD: '<model>.<faction>'). */
  model: string;
  /** Position in the host's model space (y = the surface it stands on). */
  at: V3;
  /** Override when the host renders its HD body (roof heights differ by a few hundredths). */
  hdAt?: V3;
  rotY?: number;
}

const SLAB = 0.04; // procedural slab top
const SLAB_HD = 0.05; // HD slab top

/** def_reinforced collar per defence footprint. */
const DEF: Record<string, ModuleAnchor> = {
  '1x1': { model: 'mdf1', at: [0, SLAB, 0], hdAt: [0, SLAB_HD, 0] },
  '1x2': { model: 'mdf12', at: [0, SLAB, 0], hdAt: [0, SLAB_HD, 0] },
  '2x1': { model: 'mdf21', at: [0, SLAB, 0], hdAt: [0, SLAB_HD, 0] },
  '2x2': { model: 'mdf22', at: [0, SLAB, 0], hdAt: [0, SLAB_HD, 0] },
};

export const UPGRADE_ANCHORS: Record<string, Record<string, ModuleAnchor>> = {
  fact: {
    cy_t2: { model: 'mcy2', at: [0.9, SLAB, 0.97], hdAt: [0.9, SLAB_HD, 0.97] },
    cy_t3: { model: 'mcy3', at: [1.0, 1.535, -0.86], hdAt: [1.0, 1.6, -0.86] },
  },
  proc: { proc_processor: { model: 'mprc', at: [-0.98, SLAB, 0.74], hdAt: [-0.98, SLAB_HD, 0.74] } },
  powr: { powr_turbine: { model: 'mtrb', at: [0.62, SLAB, -0.52], hdAt: [0.62, SLAB_HD, -0.52] } },
  apwr: { powr_turbine: { model: 'mtrb', at: [1.06, SLAB, -0.72], hdAt: [1.06, SLAB_HD, -0.72] } },
  weap: {
    weap_assembly: { model: 'mwas', at: [-0.85, 0.98, -0.36], hdAt: [-0.85, 0.99, -0.36] },
    weap_armor: { model: 'mwar', at: [0.85, 0.98, -0.02], hdAt: [0.85, 0.99, -0.02] },
  },
  barr: { barr_training: { model: 'mtrs', at: [0, SLAB, 0.62], hdAt: [0, SLAB_HD, 0.62] } },
  tent: { barr_training: { model: 'mtra', at: [0.72, SLAB, -0.06], hdAt: [0.72, SLAB_HD, -0.06] } },
  dome: { dome_uplink: { model: 'mupl', at: [-0.5, 0.555, 0.44], hdAt: [-0.5, 0.56, 0.44] } },
  pbox: { def_reinforced: DEF['1x1'] },
  hbox: { def_reinforced: DEF['1x1'] },
  gun: { def_reinforced: DEF['1x1'] },
  agun: { def_reinforced: DEF['1x1'] },
  ftur: { def_reinforced: DEF['1x1'] },
  tsla: { def_reinforced: DEF['1x2'] },
  sam: { def_reinforced: DEF['2x1'] },
  bnkr: { def_reinforced: DEF['2x2'] },
  gate: { def_reinforced: { model: 'mdfg', at: [0, SLAB, 0], hdAt: [0, SLAB_HD, 0] } },
};

/** The module anchor of an upgrade on a host type, or undefined (research and the like have no module). */
export function moduleAnchor(hostType: string, upgradeId: string): ModuleAnchor | undefined {
  return UPGRADE_ANCHORS[hostType]?.[upgradeId];
}

// ---------------------------------------------------------------------------------------------
// module models (lazily built templates, HD grafted like any structure)
// ---------------------------------------------------------------------------------------------

const templates = new Map<string, ModelTemplate>();

function moduleTemplate(model: string, fac: ModelFaction): ModelTemplate {
  const key = `${model}|${fac}`;
  let t = templates.get(key);
  if (!t) {
    const b = MODULE_BUILDERS[model];
    if (!b) throw new Error(`[modules] unknown module model '${model}'`);
    t = b(fac);
    templates.set(key, t);
  }
  return t;
}

/** A module instance (HD when its model is loaded, procedural otherwise). */
export function createModuleModel(model: string, color: THREE.Color, fac: ModelFaction): ModelInstance {
  const tpl = moduleTemplate(model, fac);
  const inst = instantiate(tpl, color, model);
  if (!hdModelsEnabled()) return inst;
  return hdWrap(inst, tpl, model, fac, color.getHex(), true);
}

/** The procedural body of a module model (tests, budgets). */
export function moduleBodyGeometry(model: string, fac: ModelFaction = 'soviet'): THREE.BufferGeometry | null {
  return moduleTemplate(model, fac).skin?.geo ?? null;
}

// ---------------------------------------------------------------------------------------------
// per-host state
// ---------------------------------------------------------------------------------------------

/** What applyUpgradeModules needs from a view (entities.ts View is structurally compatible). */
export interface UpgradeView {
  model: ModelInstance;
  /** Host type id (the perceived type); defaults to model.typeId. */
  ptype?: string;
  ent?: { owner: { color: number; faction: string } };
  anim?: ModelAnimState;
  /** Chimney emitters made from model.smokePoints: dropped (and so re-made) when module stacks join. */
  chimneys?: { dispose(): void }[];
  /** The construction hologram (entities.ts): a gate's hologram turns with its wall line too. */
  holo?: ModelInstance | null;
}

/** Build-in animation length (seconds). */
export const MODULE_BUILD_TIME = 1.6;

interface Slot {
  upgrade: string;
  anchor: ModuleAnchor;
  inst: ModelInstance;
  /** 0..1 build progress (1 = finished). */
  t: number;
  /** Scaffold of an upgrade in progress (not completed yet). */
  scaffold: boolean;
  holo: ModelInstance | null;
  hd: boolean;
  /** An HD model exists for it (loaded or loading): swap when it is ready. */
  wantHd: boolean;
  /** Smoke points already handed to the host. */
  smoked: boolean;
}

interface HostState {
  view: UpgradeView;
  host: ModelInstance;
  hostType: string;
  fac: ModelFaction;
  color: THREE.Color;
  hd: boolean;
  slots: Map<string, Slot>;
  /** The slots as an array (per-frame loops without iterator allocations), and whether one is a scaffold. */
  list: Slot[];
  hasScaffold: boolean;
  /** Upgrades applied last (for change detection). */
  ids: string[];
  fresh: boolean;
  origUpdate: ModelInstance['update'];
  origDispose: ModelInstance['dispose'];
  origSetVariant?: ModelInstance['setVariant'];
  hdVer: number;
  /** Gate: last computed orientation (0 E-W, 1 N-S) and the wall signature it came from. */
  gateAxis?: number;
  gateSig?: number;
}

const hosts = new WeakMap<ModelInstance, HostState>();
/** Hosts with a module building in, a scaffold, or a procedural module waiting for its HD model. */
const busy = new Set<HostState>();
let holoMat: THREE.ShaderMaterial | null = null;
let holoMatSk: THREE.ShaderMaterial | null = null;
let clock = 0;

function holoFor(mesh: THREE.Mesh): THREE.ShaderMaterial {
  if (!holoMat) {
    holoMat = createHoloMaterial(0x46c8ff);
    holoMatSk = holoMat.clone();
    holoMatSk.uniforms = holoMat.uniforms;
  }
  return (mesh as THREE.SkinnedMesh).isSkinnedMesh ? holoMatSk! : holoMat;
}

function isHd(m: ModelInstance): boolean {
  return (m as { hd?: boolean }).hd === true;
}

function stateOf(view: UpgradeView): HostState {
  const host = view.model;
  let st = hosts.get(host);
  if (st && st.view !== view) st.view = view;
  if (st) return st;
  const fac: ModelFaction = view.ent?.owner.faction === 'allies' ? 'allies' : 'soviet';
  const color = new THREE.Color(view.ent?.owner.color ?? 0x8a8a8a);
  st = {
    view, host, hostType: view.ptype ?? host.typeId ?? '', fac, color, hd: isHd(host), slots: new Map(), list: [], hasScaffold: false, ids: [], fresh: true,
    origUpdate: host.update, origDispose: host.dispose, origSetVariant: host.setVariant, hdVer: -1,
  };
  const s = st;
  // modules mirror the host's animation state (damage variants, power) and go away with it
  host.update = function (state: ModelAnimState) {
    s.origUpdate.call(host, state);
    const l = s.list;
    for (let i = 0; i < l.length; i++) l[i].inst.update(state);
  };
  if (s.origSetVariant) {
    host.setVariant = function (v: number) {
      s.origSetVariant!.call(host, v);
      const l = s.list;
      for (let i = 0; i < l.length; i++) l[i].inst.setVariant?.(v);
    };
  }
  host.dispose = function () {
    for (const sl of s.slots.values()) disposeSlot(sl);
    s.slots.clear();
    sync(s);
    busy.delete(s);
    s.origDispose.call(host);
  };
  hosts.set(host, st);
  // start loading the HD models of every module this host type can carry (ready by the time one completes)
  if (hdModelsEnabled()) for (const a of Object.values(UPGRADE_ANCHORS[st.hostType] ?? {})) requestHd(a.model, fac, true);
  return st;
}

/** Refresh the slot array after the map changed. */
function sync(st: HostState): void {
  st.list = [...st.slots.values()];
  st.hasScaffold = st.list.some((sl) => sl.scaffold);
}

function disposeSlot(sl: Slot): void {
  sl.holo?.dispose();
  sl.holo = null;
  sl.inst.dispose();
}

function place(st: HostState, sl: Slot): void {
  const a = sl.anchor;
  const p = st.hd && a.hdAt ? a.hdAt : a.at;
  const r = sl.inst.root;
  r.position.set(p[0], p[1], p[2]);
  r.rotation.set(0, a.rotY ?? 0, 0);
  if (sl.holo) {
    sl.holo.root.position.copy(r.position);
    sl.holo.root.rotation.copy(r.rotation);
  }
}

function makeSlot(st: HostState, upgrade: string, anchor: ModuleAnchor, t: number, scaffold: boolean): Slot {
  const inst = createModuleModel(anchor.model, st.color, st.fac);
  inst.root.name = `module:${upgrade}`;
  const hd = isHd(inst);
  const wantHd = !hd && hdModelsEnabled() && requestHd(anchor.model, st.fac, true) !== 'none';
  const sl: Slot = { upgrade, anchor, inst, t, scaffold, holo: null, hd, wantHd, smoked: false };
  st.host.root.add(inst.root);
  place(st, sl);
  if (st.view.anim) inst.update(st.view.anim);
  return sl;
}

function ensureHolo(st: HostState, sl: Slot): void {
  if (sl.holo) return;
  const h = createModuleModel(sl.anchor.model, st.color, st.fac);
  h.root.name = `module-holo:${sl.upgrade}`;
  h.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = holoFor(m);
    m.castShadow = false;
    m.receiveShadow = false;
  });
  sl.holo = h;
  st.host.root.add(h.root);
  place(st, sl);
}

/** Module scale (y) for a build progress: rises with an ease, overshoots a touch at the end. */
function riseScale(t: number): number {
  if (t >= 1) return 1;
  const e = 1 - Math.pow(1 - t, 2.2);
  return Math.max(0.02, e + Math.sin(Math.min(1, t) * Math.PI) * 0.04 * t);
}

function showProgress(sl: Slot): void {
  const k = sl.scaffold ? Math.max(0.02, sl.t * 0.92) : riseScale(sl.t);
  sl.inst.root.scale.set(1, k, 1);
  if (sl.holo) sl.holo.root.visible = sl.t < 1;
}

/** Hand a finished module's stacks to the host's smoke (entities.ts re-makes the chimney emitters). */
function addSmoke(st: HostState, sl: Slot): void {
  if (sl.smoked || !sl.inst.smokePoints?.length) return;
  sl.smoked = true;
  const host = st.host;
  host.smokePoints = [...(host.smokePoints ?? []), ...sl.inst.smokePoints];
  const ch = st.view.chimneys;
  if (ch) {
    for (const c of ch) c.dispose();
    ch.length = 0;
  }
}

function dropSmoke(st: HostState, sl: Slot): void {
  if (!sl.smoked || !st.host.smokePoints) return;
  const own = new Set(sl.inst.smokePoints ?? []);
  st.host.smokePoints = st.host.smokePoints.filter((p) => !own.has(p));
  const ch = st.view.chimneys;
  if (ch) {
    for (const c of ch) c.dispose();
    ch.length = 0;
  }
}

/**
 * Attach the modules of `ids` (completed upgrades) to the view's model and remove the ones no longer listed.
 * The first call for a model shows its modules finished at once (a new view, a recreated model); upgrades that
 * join later build in (MODULE_BUILD_TIME). Upgrade ids without a module for the host type are ignored.
 * Cheap when nothing changed (no allocation).
 */
export function applyUpgradeModules(view: UpgradeView, ids: readonly string[] | undefined | null): void {
  const list = ids ?? EMPTY;
  const st = hosts.get(view.model);
  if (st && sameIds(st.ids, list)) return;
  if (!st && !list.length) return;
  const s = stateOf(view);
  const table = UPGRADE_ANCHORS[s.hostType];
  for (const id of list) {
    const anchor = table?.[id];
    if (!anchor) continue;
    const have = s.slots.get(id);
    if (have) {
      if (have.scaffold) {
        // the upgrade in progress completed: finish its rise
        have.scaffold = false;
        have.t = Math.min(have.t, 0.9);
        busy.add(s);
      }
      continue;
    }
    const sl = makeSlot(s, id, anchor, s.fresh ? 1 : 0, false);
    s.slots.set(id, sl);
    if (sl.t < 1) {
      ensureHolo(s, sl);
      busy.add(s);
    } else addSmoke(s, sl);
    if (sl.wantHd) busy.add(s);
    showProgress(sl);
  }
  for (const [id, sl] of s.slots) {
    if (sl.scaffold || list.includes(id)) continue;
    dropSmoke(s, sl);
    disposeSlot(sl);
    s.slots.delete(id);
  }
  sync(s);
  s.fresh = false;
  s.ids = list.slice();
}

const EMPTY: readonly string[] = [];

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The upgrade in progress on a host (the sim's building.task of kind 'upgrade'): its module rises inside a
 * hologram shell with the progress. null clears a scaffold that never completed (cancelled).
 */
export function setUpgradeScaffold(view: UpgradeView, upgrade: string | null, progress = 0): void {
  const st = hosts.get(view.model);
  if (!upgrade) {
    if (!st) return;
    if (!st.hasScaffold) return;
    for (const [id, sl] of st.slots) {
      if (!sl.scaffold) continue;
      disposeSlot(sl);
      st.slots.delete(id);
    }
    sync(st);
    return;
  }
  const s = st ?? stateOf(view);
  if (s.fresh) s.fresh = false; // a scaffold seen first: everything after it builds in
  let sl = s.slots.get(upgrade);
  if (!sl) {
    const anchor = UPGRADE_ANCHORS[s.hostType]?.[upgrade];
    if (!anchor) return;
    // drop any other scaffold (one task at a time)
    setUpgradeScaffold(view, null);
    sl = makeSlot(s, upgrade, anchor, 0, true);
    s.slots.set(upgrade, sl);
    sync(s);
    ensureHolo(s, sl);
    busy.add(s);
  }
  if (!sl.scaffold) return;
  sl.t = Math.max(0, Math.min(1, progress));
  showProgress(sl);
}

/** Per-frame: build-in animations, hologram clock, late HD swaps, falling debris. */
export function tickUpgradeModules(time: number, dt: number): void {
  clock = time;
  if (holoMat) holoMat.uniforms.uTime.value = time;
  if (busy.size) {
    const ver = hdReadyVersion();
    for (const st of busy) {
      let more = false;
      const l = st.list;
      for (let i = 0; i < l.length; i++) {
        const sl = l[i];
        if (!sl.scaffold && sl.t < 1) {
          sl.t = Math.min(1, sl.t + dt / MODULE_BUILD_TIME);
          showProgress(sl);
          if (sl.t >= 1) {
            sl.holo?.dispose();
            sl.holo = null;
            addSmoke(st, sl);
          } else more = true;
        } else if (sl.scaffold) more = true;
        // a procedural module swaps to its HD model when it loads, while building or with the host hidden
        if (sl.wantHd && !sl.hd) {
          if (st.hdVer !== ver && (sl.t < 1 || !st.host.root.visible)) swapHd(st, sl);
          if (!sl.hd && sl.wantHd) more = true;
        }
      }
      st.hdVer = ver;
      if (!more) busy.delete(st);
    }
  }
  if (debris.length) tickDebris(dt);
}

function swapHd(st: HostState, sl: Slot): void {
  const state = requestHd(sl.anchor.model, st.fac, true);
  if (state === 'none') sl.wantHd = false; // failed or not in the manifest: stays procedural
  if (state !== 'ready') return;
  const next = createModuleModel(sl.anchor.model, st.color, st.fac);
  if (!isHd(next)) {
    next.dispose();
    return;
  }
  dropSmoke(st, sl);
  const old = sl.inst;
  next.root.name = old.root.name;
  st.host.root.add(next.root);
  sl.inst = next;
  sl.hd = true;
  sl.smoked = false;
  place(st, sl);
  showProgress(sl);
  if (st.view.anim) next.update(st.view.anim);
  old.dispose();
  if (sl.t >= 1 && !sl.scaffold) addSmoke(st, sl);
}

// ---------------------------------------------------------------------------------------------
// Commander structures: the per-frame hook (entities.ts updateBuilding)
// ---------------------------------------------------------------------------------------------

/** The sim fields this hook reads (Commander rules; Classic buildings carry none of them). */
export interface CommanderBuilding {
  cx: number;
  cy: number;
  bt: { id: string; garrison?: number; gate?: boolean };
  upgrades?: readonly string[];
  task?: { kind: string; id: string; progress: number } | null;
  garrison?: readonly number[];
}

/** What the gate needs from the world: cell occupants and their structure types. */
export interface CommanderWorld {
  map: { inBounds(x: number, y: number): boolean; idx(x: number, y: number): number; occupant: Int32Array };
  getEntity(id: number): object | undefined;
}

/**
 * Per-frame Commander visuals of a structure: its completed upgrades (applied when the list changes), the scaffold
 * of an upgrade in progress, the research lab's glow (anim.load), the bunker's garrison (anim.load) and the gate's
 * orientation along its wall line. Call after the view's anim state is filled in for the frame.
 */
export function updateCommanderView(view: UpgradeView, b: CommanderBuilding, world?: CommanderWorld): void {
  const st = hosts.get(view.model);
  const ups = b.upgrades;
  if (ups ? !st || !sameIds(st.ids, ups) : st && st.ids.length) applyUpgradeModules(view, ups);
  const task = b.task;
  if (task && task.kind === 'upgrade' && !(ups && ups.includes(task.id))) setUpgradeScaffold(view, task.id, task.progress);
  else if (st && st.hasScaffold) setUpgradeScaffold(view, null);
  const anim = view.anim;
  if (!anim) return;
  const type = b.bt.id;
  if (type === 'rlab') anim.load = task && task.kind === 'research' ? 1 : 0;
  else if (b.bt.garrison) anim.load = (b.garrison?.length ?? 0) / b.bt.garrison;
  if (b.bt.gate && world) orientGate(view, b, world);
}

/** Turn a gate along its wall line: walls (or gates) north / south of it and none east / west = N-S. */
function orientGate(view: UpgradeView, b: CommanderBuilding, w: CommanderWorld): void {
  const m = w.map;
  const wallAt = (x: number, y: number): number => {
    if (!m.inBounds(x, y)) return 0;
    const id = m.occupant[m.idx(x, y)];
    if (!id) return 0;
    const bt = (w.getEntity(id) as { bt?: { wall?: boolean; gate?: boolean } } | undefined)?.bt;
    return bt && (bt.wall || bt.gate) ? 1 : 0;
  };
  const ew = wallAt(b.cx - 1, b.cy) + wallAt(b.cx + 1, b.cy);
  const ns = wallAt(b.cx, b.cy - 1) + wallAt(b.cx, b.cy + 1);
  const yaw = ns > ew ? Math.PI / 2 : 0;
  turnGate(view.model, yaw);
  if (view.holo) turnGate(view.holo, yaw);
}

function turnGate(m: ModelInstance, yaw: number): void {
  const node = m.node?.('gate');
  if (node && node.rotation.y !== yaw) {
    node.rotation.y = yaw;
    node.updateMatrix();
  }
}

// ---------------------------------------------------------------------------------------------
// destruction: modules break off as rigid bodies when their host collapses
// ---------------------------------------------------------------------------------------------

/** The bits of the destruction system's physics this needs (destruction.ts Destruction.physics). */
export interface ModulePhysics {
  alloc(): ModuleBody | null;
  release(b: ModuleBody): void;
}
export interface ModuleBody {
  readonly p: THREE.Vector3;
  readonly q: THREE.Quaternion;
  readonly v: THREE.Vector3;
  readonly w: THREE.Vector3;
  setBox(hx: number, hy: number, hz: number, mass?: number): unknown;
  restitution: number;
  friction: number;
  maxAwake: number;
  group: number;
}

interface Debris {
  inst: ModelInstance;
  body: ModuleBody | null;
  physics: ModulePhysics;
  /** Body-local offset of the module origin (module space, from its bounds centre). */
  off: THREE.Vector3;
  q0: THREE.Quaternion;
  t: number;
  sink: number;
}

const debris: Debris[] = [];
const MAX_DEBRIS = 12;
const DEBRIS_LIFE = 5.5;
const _box = new THREE.Box3();
const _c = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _o = new THREE.Vector3();

/**
 * The host structure collapsed (destruction.ts took its model's place): its finished modules come off whole and
 * topple away under the debris physics, charred, then sink into the rubble. Scaffolds just vanish.
 */
export function breakUpgradeModules(model: ModelInstance, physics: ModulePhysics | null): void {
  const st = hosts.get(model);
  if (!st || !st.slots.size) return;
  const parent = model.root.parent;
  model.root.updateMatrixWorld(true);
  for (const [id, sl] of st.slots) {
    sl.holo?.dispose();
    sl.holo = null;
    if (sl.scaffold || !parent || debris.length >= MAX_DEBRIS) {
      sl.inst.dispose();
      st.slots.delete(id);
      continue;
    }
    const inst = sl.inst;
    const root = inst.root;
    // bounds of the module in its own frame
    _box.makeEmpty();
    root.updateMatrixWorld(true);
    _m.copy(root.matrixWorld).invert();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry || !mesh.visible) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(_m);
      _box.union(bb);
    });
    if (_box.isEmpty()) _box.set(_c.set(-0.2, 0, -0.2), _s.set(0.2, 0.4, 0.2));
    _box.getCenter(_c);
    _box.getSize(_s);
    // re-parent into the scene at the same world transform
    root.matrixWorld.decompose(_o, _q, _s.clone());
    parent.add(root);
    root.position.copy(_o);
    root.quaternion.copy(_q);
    root.scale.set(1, 1, 1);
    inst.setVariant?.(BodyVariant.Wrecked);
    const body = physics?.alloc() ?? null;
    const d: Debris = { inst, body, physics: physics!, off: _c.clone().negate(), q0: _q.clone(), t: 0, sink: 0 };
    if (body) {
      body.setBox(Math.max(0.05, _s.x * 0.42), Math.max(0.05, _s.y * 0.45), Math.max(0.05, _s.z * 0.42));
      const centre = _c.clone().applyQuaternion(_q).add(_o);
      body.p.copy(centre);
      body.q.copy(_q);
      // away from the host's centre, toppling outward; tall parts pop higher
      const dx = centre.x - model.root.position.x;
      const dz = centre.z - model.root.position.z;
      const l = Math.hypot(dx, dz) || 1;
      const k = 0.6 + Math.min(1.2, _s.y);
      body.v.set((dx / l) * 0.9 * k, 0.8 + _s.y * 0.6, (dz / l) * 0.9 * k);
      body.w.set((dz / l) * 2.2 * k, (Math.random() - 0.5) * 1.2, (-dx / l) * 2.2 * k);
      body.restitution = 0.15;
      body.friction = 0.85;
      body.maxAwake = 3.5;
      body.group = 0;
    }
    debris.push(d);
    st.slots.delete(id);
  }
  sync(st);
  busy.delete(st);
}

function tickDebris(dt: number): void {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.t += dt;
    const root = d.inst.root;
    if (d.body) {
      // module origin = body centre + R * (origin - bounds centre)
      _o.copy(d.off).applyQuaternion(d.body.q).add(d.body.p);
      root.position.copy(_o);
      root.quaternion.copy(d.body.q);
    }
    if (d.t > DEBRIS_LIFE - 1.6) {
      if (d.t > DEBRIS_LIFE - 3 && d.inst.setVariant) d.inst.setVariant(BodyVariant.Charred);
      d.sink += dt * 0.35;
      root.position.y -= d.sink;
    }
    if (d.t >= DEBRIS_LIFE) {
      if (d.body) d.physics.release(d.body);
      d.inst.dispose();
      debris[i] = debris[debris.length - 1];
      debris.pop();
    }
  }
}

/** Test / debug: modules attached to a model ({ upgrade, model, progress, hd }). */
export function upgradeModulesOf(model: ModelInstance): { upgrade: string; model: string; t: number; scaffold: boolean; hd: boolean; root: THREE.Object3D }[] {
  const st = hosts.get(model);
  if (!st) return [];
  return [...st.slots.values()].map((s) => ({ upgrade: s.upgrade, model: s.anchor.model, t: s.t, scaffold: s.scaffold, hd: s.hd, root: s.inst.root }));
}

/** Test hook: the module clock (last tick time). */
export function upgradeModuleClock(): number {
  return clock;
}
