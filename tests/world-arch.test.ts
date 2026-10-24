// World Conquest landmark and civilian building models (src/render/landmarks, src/render/civilian): every landmark
// and every style builds at both details within its triangle budget, fits its sim footprint, is deterministic and
// carries no NaN / zero normals (real GPUs turn normalize(0) into NaN). Pure geometry: no WebGL context.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type * as THREE from 'three';
import { LANDMARK_IDS, type Culture } from '../src/conquest/world/types';
import { LANDMARK_FOOTPRINTS } from '../src/sim/landmarks';
import { CIVILIAN_FOOTPRINTS, type CivilianKind } from '../src/sim/civilian';
import { landmarkGeometry, buildLandmark } from '../src/render/landmarks';
import { civilianTemplate, buildCivilian, STYLES, CIV_VARIANTS } from '../src/render/civilian';
import { sceneryLit, sceneryType } from '../src/render/scenery';

const LOW_BUDGET = 3600;
const HIGH_BUDGET = 22000;

/** Problems in a geometry: non-finite positions / normals / colours, zero normals. */
function badValues(g: THREE.BufferGeometry): string[] {
  const out: string[] = [];
  for (const name of ['position', 'normal', 'color', 'pbr', 'wear', 'uv']) {
    const a = g.getAttribute(name);
    if (!a) continue;
    const arr = a.array as ArrayLike<number>;
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) { out.push(`${name}[${i}] = ${arr[i]}`); break; }
  }
  const n = g.getAttribute('normal');
  if (n) {
    for (let i = 0; i < n.count; i++) {
      const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
      if (!(l > 0.5)) { out.push(`normal ${i} has length ${l}`); break; }
    }
  }
  return out;
}

/** A cheap content hash of a geometry's positions. */
function hashGeo(g: THREE.BufferGeometry): string {
  const p = g.getAttribute('position').array as ArrayLike<number>;
  let h = 0x811c9dc5;
  for (let i = 0; i < p.length; i++) h = Math.imul(h ^ Math.round(p[i] * 1e4), 0x01000193);
  return `${p.length}:${(h >>> 0).toString(16)}`;
}

describe('world-arch: landmarks', () => {
  for (const id of LANDMARK_IDS) {
    test(`${id} builds at both details within budget, fits its footprint, no NaN`, () => {
      const fp = LANDMARK_FOOTPRINTS[id];
      for (const detail of ['low', 'high'] as const) {
        const b = landmarkGeometry(id, detail);
        const budget = detail === 'low' ? LOW_BUDGET : HIGH_BUDGET;
        assert.ok(b.tris > 10 && b.tris <= budget, `${id} ${detail}: ${b.tris} triangles (budget ${budget})`);
        const bad = badValues(b.geo);
        assert.equal(bad.length, 0, `${id} ${detail}: ${bad.join(', ')}`);
        const bb = b.geo.boundingBox!;
        assert.ok(bb.max.x <= fp.w / 2 + 0.06 && bb.min.x >= -fp.w / 2 - 0.06, `${id} ${detail}: x ${bb.min.x.toFixed(2)}..${bb.max.x.toFixed(2)} fits w ${fp.w}`);
        assert.ok(bb.max.z <= fp.h / 2 + 0.06 && bb.min.z >= -fp.h / 2 - 0.06, `${id} ${detail}: z ${bb.min.z.toFixed(2)}..${bb.max.z.toFixed(2)} fits h ${fp.h}`);
        assert.ok(bb.max.y > 0.5 && bb.min.y > -1.5, `${id} ${detail}: stands on the ground (y ${bb.min.y.toFixed(2)}..${bb.max.y.toFixed(2)})`);
      }
    });
  }

  test('landmarks are deterministic (a fresh build matches the cached one)', () => {
    for (const id of ['eiffel-tower', 'pyramids', 'statue-of-liberty'] as const) {
      for (const detail of ['low', 'high'] as const) {
        assert.equal(hashGeo(landmarkGeometry(id, detail, true).geo), hashGeo(landmarkGeometry(id, detail).geo), `${id} ${detail} rebuilds identically`);
      }
    }
  });

  test('buildLandmark gives one mesh that casts shadows', () => {
    const m = buildLandmark('eiffel-tower', 'low');
    assert.ok((m as THREE.Mesh).isMesh, 'a single mesh (one draw call)');
    assert.ok(m.castShadow && m.receiveShadow, 'casts and receives shadows');
    assert.equal(m.children.length, 0, 'no child meshes');
  });
});

describe('world-arch: civilian buildings', () => {
  const kinds = Object.keys(CIVILIAN_FOOTPRINTS) as CivilianKind[];
  for (const style of Object.keys(STYLES) as Culture[]) {
    test(`${style}: every kind and variant builds at both details, fits, no NaN`, () => {
      for (const kind of kinds) {
        const fp = CIVILIAN_FOOTPRINTS[kind];
        for (let v = 0; v < CIV_VARIANTS; v++) {
          for (const detail of ['low', 'high'] as const) {
            const t = civilianTemplate(style, kind, v, detail, 0);
            const g = t.skin!.geo;
            const tris = g.index!.count / 3;
            assert.ok(tris > 8 && tris <= (detail === 'low' ? 1200 : 4500), `${style} ${kind} v${v} ${detail}: ${tris} triangles`);
            const bad = badValues(g);
            assert.equal(bad.length, 0, `${style} ${kind} v${v} ${detail}: ${bad.join(', ')}`);
            g.computeBoundingBox();
            const bb = g.boundingBox!;
            const m = 0.16; // eaves and awnings may reach a little over the street
            assert.ok(bb.max.x <= fp.w / 2 + m && bb.min.x >= -fp.w / 2 - m, `${style} ${kind} v${v} ${detail}: x ${bb.min.x.toFixed(2)}..${bb.max.x.toFixed(2)} in w ${fp.w}`);
            assert.ok(bb.max.z <= fp.h / 2 + m && bb.min.z >= -fp.h / 2 - m, `${style} ${kind} v${v} ${detail}: z ${bb.min.z.toFixed(2)}..${bb.max.z.toFixed(2)} in h ${fp.h}`);
            assert.ok(bb.max.y > 0.25, `${style} ${kind} v${v}: has some height`);
          }
        }
      }
    });
  }

  test('civilian buildings are deterministic and facings rotate the footprint', () => {
    const a = civilianTemplate('western', 'hall', 2, 'high', 0, true).skin!.geo;
    const b = civilianTemplate('western', 'hall', 2, 'high', 0).skin!.geo;
    assert.equal(hashGeo(a), hashGeo(b), 'a fresh build matches the cached template');
    const r = civilianTemplate('western', 'hall', 2, 'high', 1).skin!.geo;
    r.computeBoundingBox();
    const bb = r.boundingBox!;
    assert.ok(bb.max.x - bb.min.x < 2.4 && bb.max.z - bb.min.z > 2.4, `facing 1 turns the 3x2 hall to 2x3 (${(bb.max.x - bb.min.x).toFixed(2)} x ${(bb.max.z - bb.min.z).toFixed(2)})`);
    const m = buildCivilian('slavic', 'apartment', 7, 'low');
    assert.ok((m as THREE.Mesh).isMesh && m.children.length === 0, 'one mesh per building');
  });

  test('the renderer hook names a template per look and lights windows building by building', () => {
    const e = { id: 7, scenery: { culture: 'nordic', kind: 'house', seed: 13, facing: 3 } } as unknown as Parameters<typeof sceneryType>[0];
    assert.match(sceneryType(e) ?? '', /^civ:nordic:house:1:(low|high):3$/, 'template key');
    assert.equal(sceneryType({ id: 3 } as unknown as Parameters<typeof sceneryType>[0]), null, 'other entities: no key');
    let lit = 0;
    for (let id = 1; id <= 200; id++) {
      const ent = { id } as unknown as Parameters<typeof sceneryLit>[0];
      assert.equal(sceneryLit(ent, 0), false, 'dark by day');
      if (sceneryLit(ent, 0.55)) lit++;
      assert.equal(sceneryLit(ent, 1), true, 'all lit late at night');
    }
    assert.ok(lit > 40 && lit < 170, `about half lit at dusk (${lit}/200)`);
  });
});
