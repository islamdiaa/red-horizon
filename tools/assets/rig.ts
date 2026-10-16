// [PIPE] Dump a procedural model's rig, so HD models match it: node tree (names, local / model-space rest
// positions, bones), muzzles, smoke / steam points, height, radius, body bounds and triangle counts.
//
//   node --import tsx tools/assets/rig.ts 3tnk            # units
//   node --import tsx tools/assets/rig.ts powr soviet     # structures: owner faction (dressing)
//   node --import tsx tools/assets/rig.ts powr soviet --json > /tmp/powr.json
//
// HD part / point names must be the procedural node names (the game's animation drives those nodes); pivots
// should sit within a few hundredths of the procedural ones (the far LOD is the procedural body).
import * as THREE from 'three';
import type { ModelFaction } from '../../src/render/models';

// a no-op canvas so the procedural textures (tread, rotor) can be created outside a browser
const ctx2d = new Proxy({}, {
  get: (_t, k) => (k === 'getImageData' ? (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
    : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
  set: () => true,
});
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
const { BUILDINGS, UNITS } = await import('../../src/data/rules');
const { createModel, modelBodyGeometry } = await import('../../src/render/models');

const [id, facArg, ...rest] = process.argv.slice(2);
if (!id) {
  console.error('usage: node --import tsx tools/assets/rig.ts <typeId> [soviet|allies] [--json]');
  process.exit(1);
}
const fac = (facArg === 'allies' ? 'allies' : 'soviet') as ModelFaction;
const json = rest.includes('--json') || facArg === '--json';
const m = createModel(id, new THREE.Color(fac === 'soviet' ? 0xd23a2c : 0x3d7be0), fac);
m.root.updateMatrixWorld(true);
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const v3 = (v: THREE.Vector3) => [r4(v.x), r4(v.y), r4(v.z)];
interface N { name: string; bone: boolean; local: number[]; rot: number[]; model: number[]; children: N[] }
const tree = (o: THREE.Object3D): N | null => {
  if ((o as THREE.Mesh).isMesh || (o as THREE.LOD).isLOD) return null;
  const p = new THREE.Vector3();
  o.getWorldPosition(p);
  return {
    name: o.name, bone: (o as THREE.Bone).isBone === true, local: v3(o.position), rot: [r4(o.rotation.x), r4(o.rotation.y), r4(o.rotation.z)],
    model: v3(p), children: o.children.map(tree).filter((c): c is N => !!c),
  };
};
const geo = modelBodyGeometry(id, false, fac);
const geoLo = modelBodyGeometry(id, true, fac);
const box = new THREE.Box3();
if (geo) { geo.computeBoundingBox(); box.copy(geo.boundingBox!); }
const b = BUILDINGS[id];
const u = UNITS[id];
const out = {
  id, faction: fac, kind: b ? 'structure' : u?.kind ?? 'unknown',
  footprint: b ? (b as unknown as { size: number[] }).size : null,
  height: r4(m.height), radius: r4(m.radius),
  turret: m.turret?.name ?? null,
  muzzles: m.muzzles.map((x) => x.name),
  smoke: (m.smokePoints ?? []).map((x) => x.name),
  fx: (m.fxPoints ?? []).map((x) => `${x.kind}:${x.node.name}`),
  bodyBounds: geo ? { min: v3(box.min), max: v3(box.max) } : null,
  tris: { near: geo ? (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3 : 0, far: geoLo ? (geoLo.index ? geoLo.index.count : 0) / 3 : null },
  nodes: tree(m.root.children[0]),
};
if (json) console.log(JSON.stringify(out, null, 1));
else {
  console.log(`${id} (${fac}) kind=${out.kind} footprint=${JSON.stringify(out.footprint)} height=${out.height} radius=${out.radius}`);
  console.log(`body bounds ${JSON.stringify(out.bodyBounds)}  tris near=${out.tris.near} far=${out.tris.far}`);
  console.log(`turret=${out.turret} muzzles=${out.muzzles.join(',')} smoke=${out.smoke.join(',')} fx=${out.fx.join(',')}`);
  const pr = (n: N, d: number) => {
    console.log(`${'  '.repeat(d)}${n.name}${n.bone ? ' [bone]' : ''}  local=${JSON.stringify(n.local)}${n.rot.some((x) => x) ? ` rot=${JSON.stringify(n.rot)}` : ''}  model=${JSON.stringify(n.model)}`);
    n.children.forEach((c) => pr(c, d + 1));
  };
  if (out.nodes) pr(out.nodes, 0);
}
