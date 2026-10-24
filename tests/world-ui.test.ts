// World Conquest screens (src/ui/world): the globe's cell maths, the menu entry's footprint in the initial bundle,
// the diary lines against the rules' templates, the strings guard for the new folder, and the layout rules for
// phones. The screens themselves are checked in a browser (round-6 UI notes: every screen at 1280x720, 800x600,
// 390x844 and 844x390; QA's tools/e2e journeys).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { candidatesFromLabels, landMask, nearestSites, lonLatToVec, vecToLonLat, MAX_SITES } from '../src/ui/world/globe';
import { isWorldBattle, worldBadge, BADGE_KEY } from '../src/ui/world/entry';

const ROOT = path.join(import.meta.dirname, '..');
const src = (p: string) => fs.readFileSync(path.join(ROOT, 'src', p), 'utf8');
const WORLD_FILES = fs.readdirSync(path.join(ROOT, 'src/ui/world')).filter((f) => f.endsWith('.ts')).map((f) => `ui/world/${f}`);

// a deterministic generator for the property tests
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

describe('globe: cells', () => {
  test('lon/lat round-trips through the unit sphere', () => {
    for (const [lon, lat] of [[0, 0], [90, 10], [-120, -45], [179, 70], [-30, -80]]) {
      const [lo, la] = vecToLonLat(lonLatToVec(lon, lat));
      assert.ok(Math.abs(lo - lon) < 1e-9 && Math.abs(la - lat) < 1e-9, `${lon},${lat} -> ${lo},${la}`);
    }
  });

  test('every texel lists its true nearest site first (coarse-to-fine search = brute force)', () => {
    const r = rng(7);
    const sites = Array.from({ length: 140 }, (_, i) => ({ id: `s${i}`, lon: r() * 360 - 180, lat: Math.asin(r() * 2 - 1) * 57.29578, zone: i % 9 }));
    const w = 128, h = 64;
    const cand = nearestSites(sites, w, h);
    const vs = sites.map((s) => lonLatToVec(s.lon, s.lat));
    let checked = 0;
    for (let v = 0; v < h; v += 3) {
      for (let u = 0; u < w; u += 5) {
        const p = lonLatToVec(((u + 0.5) / w) * 360 - 180, 90 - ((v + 0.5) / h) * 180);
        let best = -1, bd = -2;
        vs.forEach((s, i) => { const d = s.dot(p); if (d > bd) { bd = d; best = i; } });
        const o = (v * w + u) * 4;
        assert.equal(cand[o], best, `texel ${u},${v}: nearest ${best}, listed ${cand[o]}`);
        const listed = [cand[o], cand[o + 1], cand[o + 2], cand[o + 3]];
        assert.equal(new Set(listed).size, 4, `texel ${u},${v}: four distinct candidates`);
        checked++;
      }
    }
    assert.ok(checked > 400, `checked ${checked} texels`);
  });

  test('the rules\' raster gives each texel its own label and its neighbours\' (cells never jump a sea)', () => {
    const w = 8, h = 4;
    const label = new Int16Array(w * h).fill(-1);
    // two territories side by side, the rest sea; column 7 wraps to column 0
    for (let y = 1; y < 3; y++) { label[y * w + 0] = 3; label[y * w + 1] = 3; label[y * w + 2] = 5; label[y * w + 7] = 9; }
    const c = candidatesFromLabels({ w, h, label });
    const at = (x: number, y: number) => [...c.slice((y * w + x) * 4, (y * w + x) * 4 + 4)].filter((v) => v !== 255);
    assert.deepEqual(at(1, 1).sort(), [3, 5, 9].filter((v) => v !== 9).sort(), 'between 3 and 5: both, nothing from across the wrap two columns away');
    assert.deepEqual(at(0, 1).sort(), [3, 9], 'column 0 sees column 7 across the antimeridian');
    assert.equal(at(1, 1)[0], 3, 'the texel\'s own label comes first');
    assert.deepEqual(at(4, 0), [], 'open sea: no candidates');
    assert.ok(MAX_SITES <= 255, 'site indices fit a byte');
  });

  test('the land mask fills rings (scanline fallback without a canvas), holes by the even-odd rule', () => {
    const square: Array<[number, number]> = [[-90, 45], [90, 45], [90, -45], [-90, -45]];
    const m = landMask([square], 64, 32);
    const px = (lon: number, lat: number) => m[Math.floor(((90 - lat) / 180) * 32) * 64 + Math.floor(((lon + 180) / 360) * 64)];
    assert.ok(px(0, 0) > 200, `inside: ${px(0, 0)}`);
    assert.ok(px(170, 0) < 30, `outside: ${px(170, 0)}`);
    assert.ok(px(0, 80) < 30, `north of it: ${px(0, 80)}`);
  });
});

describe('menu entry (initial bundle)', () => {
  test('the entry module stays tiny and imports nothing', () => {
    const e = src('ui/world/entry.ts');
    assert.ok(!/^import /m.test(e), 'entry.ts has no imports (it would pull them into the initial bundle)');
    assert.ok(e.length < 4500, `entry.ts is ${e.length} bytes of source`);
  });
  test('the menu and main.ts load the mode on demand', () => {
    const menu = src('ui/menu.ts'), main = src('main.ts');
    assert.deepEqual([...menu.matchAll(/from '\.\/world\/([\w-]+)'/g)].map((m) => m[1]), ['entry'], 'menu.ts imports only the entry');
    assert.deepEqual([...main.matchAll(/from '\.\/ui\/world\/([\w-]+)'/g)].map((m) => m[1]), ['entry'], 'main.ts imports only the entry statically');
    assert.match(main, /import\('\.\/ui\/world'\)/, 'main.ts loads the screens with a dynamic import');
  });
  test('the badge reads only an active run, and world battles are told apart', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
    assert.equal(worldBadge(), null, 'no run: no badge');
    store.set(BADGE_KEY, JSON.stringify({ active: true, turn: 12 }));
    assert.deepEqual(worldBadge(), { turn: 12 }, 'a run in progress shows its turn');
    store.set(BADGE_KEY, '{oops');
    assert.equal(worldBadge(), null, 'a corrupt badge is ignored');
    store.set(BADGE_KEY, JSON.stringify({ active: false, turn: 3 }));
    assert.equal(worldBadge(), null, 'a finished run has no badge');
    assert.equal(isWorldBattle({ battle: { world: { region: 'x' } } }), true, 'a spec with world fields is a world battle');
    assert.equal(isWorldBattle({ battle: { id: 'b1' } }), false, 'a Europe Conquest spec is not');
    assert.equal(isWorldBattle(undefined), false, 'no setup');
  });
});

describe('test screens never touch the player (QA UI-1)', () => {
  const memKV = (init: Record<string, string>) => {
    const m = new Map(Object.entries(init));
    return { m, kv: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } };
  };
  test('?world=<state> needs ?debug=1 (or a development build); challenge links do not', async () => {
    const { demoAllowed } = await import('../src/ui/world/entry');
    assert.equal(demoAllowed('?world=won&seed=5'), false, 'a shared ?world=won link runs no test state');
    assert.equal(demoAllowed('?world=fresh&debug=1'), true, 'tests opt in with debug=1');
    assert.equal(demoAllowed('?world=fresh&debug=0'), false, 'debug=0 is not debug');
    assert.match(src('ui/world/index.ts'), /demo: opts\.demo && demoAllowed\(\) \? opts\.demo : undefined/, 'showWorld drops an unauthorised demo before the app exists');
    assert.match(src('ui/world/entry.ts'), /has\('world'\) && demoAllowed\(\)/, 'main.ts only opens the screens for ?world= in debug');
  });

  test('a demo store leaves the campaign, the profile, XP and medals as they were', async () => {
    const { W } = await import('../src/ui/world/api');
    const { WorldStore } = await import('../src/ui/world/store');
    // the player's real state
    const real = W.newWorldRun({ seed: 3, home: 'japan', size: 'blitz', difficulty: 'easy', nonce: 1 });
    const { m, kv } = memKV({ 'rh.world.run': JSON.stringify(real), 'rh.profile': '{"v":2,"xp":1234}', 'rh.world.meta': '{"v":1,"runs":2,"medals":["continent:asia"]}', 'rh.world.badge': '{"active":true,"turn":1}', 'rh.world.coach': '2' });
    const before = JSON.stringify([...m].sort());
    // what ?world=won / fresh / attack do with their own run
    const demo = new WorldStore(true, kv);
    const run = W.newWorldRun({ seed: 99, home: 'britain', size: 'blitz', difficulty: 'normal' });
    const mine = run.territories.find((t) => t.owner === run.player)!;
    W.placeTroops(run, mine.id, run.toPlace);
    demo.save(run);
    run.status = 'won';
    for (const t of run.territories) t.owner = run.player;
    assert.equal(demo.recordEnd(run), null, 'no record, no XP, no medals');
    demo.badge(run); demo.clear(); demo.set('rh.world.coach', '9'); demo.set('rh.world.recorded', run.id);
    assert.equal(JSON.stringify([...m].sort()), before, 'storage is byte-for-byte unchanged');
    // (the same calls on the player's own store do write: the guard is the demo flag, not a broken store)
    const own = new WorldStore(false, kv);
    own.save(run);
    assert.notEqual(m.get('rh.world.run'), JSON.stringify(real), 'a real store saves the campaign');
  });

  test('only store.ts writes to storage', () => {
    const offenders: string[] = [];
    for (const f of WORLD_FILES) {
      if (f.endsWith('/store.ts')) continue;
      const code = src(f);
      for (const m of code.matchAll(/localStorage\.(?:setItem|removeItem|clear)|W\.(?:saveWorldRun|recordWorldEnd|clearWorldRun|saveWorldMeta)\(/g)) offenders.push(`${f}: ${m[0]}`);
    }
    assert.deepEqual(offenders, [], 'storage writes must go through WorldStore (a demo store writes nothing)');
  });
});

describe('newcomers (QA UI-2, UI-3)', () => {
  test('a first campaign starts in the homeland of the browser\'s language region', async () => {
    const { localeHomeId, HOME_ISO } = await import('../src/ui/world/setup');
    const { WORLD_HOMELANDS } = await import('../src/conquest/world/regions');
    const ids = new Set(WORLD_HOMELANDS.map((h) => h.id));
    for (const [iso, id] of Object.entries(HOME_ISO)) assert.ok(ids.has(id), `${iso} -> ${id} is a homeland`);
    const covered = new Set(Object.values(HOME_ISO));
    assert.deepEqual(WORLD_HOMELANDS.filter((h) => !covered.has(h.id)).map((h) => h.id), [], 'every homeland has a country code');
    const cases: [string, string | undefined][] = [['en-GB', 'britain'], ['en-US', 'usa'], ['en', 'usa'], ['de', 'germany'], ['de-AT', undefined], ['fr', 'france'], ['es', 'spain'], ['pt-BR', 'brazil'], ['ru', 'soviet-union'], ['zh-CN', 'china'], ['ja', 'japan'], ['xx-ZZ', undefined]];
    for (const [lang, want] of cases) assert.equal(localeHomeId(lang), want, `${lang} -> ${want}`);
    assert.match(src('ui/world/setup.ts'), /const FALLBACK_HOME = 'france'/, 'no match: France (land neighbours, an easy first battle), not the list\'s first entry');
  });

  test('every homeland has a measured start difficulty for both sizes', async () => {
    const { startRating, startWinRate } = await import('../src/ui/world/start');
    const { WORLD_HOMELANDS } = await import('../src/conquest/world/regions');
    for (const size of ['world', 'blitz'] as const) {
      const seen = new Set<string>();
      for (const h of WORLD_HOMELANDS) {
        const r = startRating(h.id, size);
        assert.ok(r, `${h.id} (${size}) has a rating`);
        assert.ok(startWinRate(h.id, size)! >= 0 && startWinRate(h.id, size)! <= 1, `${h.id}: a rate`);
        seen.add(r!);
      }
      assert.deepEqual([...seen].sort(), ['easy', 'hard', 'medium'], `${size}: all three ratings occur`);
    }
    assert.equal(startRating('afghanistan', 'world'), 'hard', 'the hardest World start (30%)');
    assert.equal(startRating('indonesia', 'world'), 'easy', 'the easiest World start (95%)');
  });

  test('the coach\'s first target is a land battle when there is one, a sea crossing only when there is not', async () => {
    const { W } = await import('../src/ui/world/api');
    const { easyTarget } = await import('../src/ui/world/coach');
    const turn1 = (home: string) => {
      const run = W.newWorldRun({ seed: 1, home, size: 'blitz', difficulty: 'easy' });
      const cap = run.territories.find((t) => t.owner === run.player && t.capital === run.player)!;
      W.placeTroops(run, cap.id, run.toPlace);
      W.endPhase(run);
      return run;
    };
    for (const home of ['britain', 'france', 'germany', 'usa', 'china', 'soviet-union', 'india', 'brazil']) {
      const run = turn1(home);
      const t = easyTarget(run);
      assert.ok(t, `${home}: a target`);
      const kinds = W.attackTargets(run).map((a) => (a.sea ? 'naval' : W.attackKind(run, a.from, a.to)));
      // assault first, then hold, then capture (it needs an Engineer: QA UI-6), a sea crossing last
      const want = ['assault', 'hold', 'capture'].find((k) => kinds.includes(k));
      if (want) assert.equal(t!.kind, want, `${home}: ${want} first (${kinds.join(', ')})`);
      else if (kinds.some((k) => k !== 'naval')) assert.notEqual(t!.kind, 'naval', `${home}: not across the sea while a land target exists`);
      assert.equal(run.territories.find((x) => x.id === t!.to)!.owner, -1, `${home}: a neutral on turn 1`);
    }
    assert.equal(easyTarget(turn1('britain'))!.kind, 'hold', 'Britain: the Thames hold, not a crossing to Normandy');
  });
});

describe('war diary and playback lines', () => {
  test('every event kind fills every placeholder of its template', async () => {
    await import('../src/i18n/en/world');
    const { tx } = await import('../src/i18n/core');
    const { W } = await import('../src/ui/world/api');
    const { eventParams } = await import('../src/ui/world/drawers');
    const run = W.newWorldRun({ seed: 11, home: 'britain', size: 'blitz', difficulty: 'normal' });
    const [a, b] = run.territories.map((t) => t.id);
    const events: import('../src/conquest/world/state').WorldEvent[] = [
      { kind: 'turn', power: 1, turn: 3 }, { kind: 'reinforce', power: 1, to: a, n: 4 }, { kind: 'trade', power: 0, cards: ['infantry', 'armour', 'air'], n: 6 },
      { kind: 'attack', power: 1, from: a, to: b, defender: 0, attLoss: 2, defLoss: 3, rolls: 4, conquered: true },
      { kind: 'conquer', power: 1, from: a, to: b, n: 3, prev: 0 }, { kind: 'fortify', power: 0, from: a, to: b, n: 2 }, { kind: 'card', power: 0, card: 'air' },
      { kind: 'eliminated', power: 2, by: 0, cards: 3 }, { kind: 'zone', power: 0, zone: run.territories[0].zone }, { kind: 'ceasefire', power: 2, with: 0, turns: 5 },
      { kind: 'refused', power: 2, with: 0 }, { kind: 'break', power: 0, with: 2 }, { kind: 'offer', power: 3, turns: 5 }, { kind: 'defence', power: 1, from: a, to: b, n: 7 },
      { kind: 'battle', power: 0, from: a, to: b, won: true, attLoss: 1, defLoss: 5 }, { kind: 'medal', power: 0, medal: 'victory:blitz:hard' },
      { kind: 'won', power: 0, ending: 'capitals' }, { kind: 'lost', power: 0, ending: 'wiped' },
    ];
    for (const e of events) {
      const line = tx(`world.event.${e.kind}`, eventParams(run, e));
      assert.ok(!/[{}]/.test(line), `${e.kind}: "${line}"`);
      assert.ok(!/\b[a-z]+-[a-z]+-\d\b/.test(line), `${e.kind}: no raw ids in "${line}"`);
    }
  });
});

describe('strings', () => {
  test('no hard-coded player-facing text in src/ui/world', async () => {
    const { parseAst } = await import('rolldown/parseAst');
    // (KeyboardEvent.key names and the game's title are not prose)
    const ALLOW = new Set(['Red Horizon', 'RED HORIZON', 'Escape', 'Enter', 'Tab', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AbortError']);
    type N = { type?: string; start: number; value?: unknown; quasis?: { value: { cooked?: string; raw: string } }[] };
    const walk = (n: unknown, fn: (n: N) => void) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { for (const c of n) walk(c, fn); return; }
      if (typeof (n as N).type === 'string') fn(n as N);
      for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v, fn);
    };
    const prose = (s: string) => { const t = s.replace(/\u0001/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim(); return /[A-Za-z]{2,}/.test(t) && !ALLOW.has(t) ? t : null; };
    const found: string[] = [];
    for (const f of WORLD_FILES) {
      const code = src(f);
      const html = (s: string) => {
        for (const m of s.matchAll(/>([^<>]*)</g)) { const p = prose(m[1]); if (p) found.push(`${f}: text "${p}"`); }
        for (const m of s.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]*)"/g)) { const p = prose(m[1]); if (p) found.push(`${f}: attribute "${p}"`); }
      };
      walk(parseAst(code, { lang: 'ts' }), (n) => {
        if (n.type === 'TemplateLiteral' && n.quasis) { const t = n.quasis.map((q) => q.value.cooked ?? q.value.raw).join('\u0001'); if (!/\bgl_\w+/.test(t)) html(t); } // (GLSL shaders are code)
        else if (n.type === 'Literal' && typeof n.value === 'string') {
          const v = n.value.trim();
          if (/[<>]/.test(v)) html(v);
          if ((/^[A-Z][a-z]+(?:[ '’-][A-Za-z]+)+[.!?…]?$/.test(v) || /^[A-Z][a-z]{2,}[.!?…]?$/.test(v)) && !ALLOW.has(v)) found.push(`${f}: literal "${v}"`);
        }
      });
    }
    assert.deepEqual(found, [], `put these in src/i18n/en/world-ui.ts:\n${found.join('\n')}`);
  });

  test('every worldUi key the screens name exists in English', async () => {
    const { WORLD_UI } = await import('../src/i18n/en/world-ui');
    const keys = new Set<string>();
    const flat = (o: Record<string, unknown>, p = '') => { for (const [k, v] of Object.entries(o)) typeof v === 'string' ? keys.add(p + k) : flat(v as Record<string, unknown>, `${p}${k}.`); };
    flat(WORLD_UI as unknown as Record<string, unknown>);
    const used = new Set<string>();
    for (const f of WORLD_FILES) for (const m of src(f).matchAll(/\btW(?:\.html)?\('([\w.-]+)'/g)) used.add(m[1]);
    const missing = [...used].filter((k) => !keys.has(k));
    assert.deepEqual(missing, [], `keys used but not defined: ${missing.join(', ')}`);
    assert.ok(used.size > 150, `the screens use ${used.size} keys`);
  });
});

describe('layouts and motion', () => {
  const css = src('ui/world/css.ts');
  test('phones: a bottom sheet in portrait, a slim side panel in landscape', () => {
    assert.match(css, /@media \(max-aspect-ratio: 4\/5\), \(max-width: 620px\) \{[\s\S]*?\.wc \.wc-side \{[^}]*bottom: 0/, 'portrait: the panel is a bottom sheet');
    assert.match(css, /@media \(max-height: 460px\) and \(min-aspect-ratio: 4\/5\) \{[\s\S]*?--side-w: 300px/, 'landscape phones: a 300 px side panel');
  });
  test('touch targets are at least 40 px and reduced motion stops the animations', () => {
    assert.match(css, /\.wc-btn \{[^}]*min-height: 42px/, 'buttons are 42 px tall');
    assert.match(css, /\.wc-row \{[^}]*min-height: 44px/, 'list rows are 44 px tall');
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.wc-die\.roll/, 'the dice do not tumble with reduced motion');
    assert.match(src('ui/world/dice.ts'), /if \(reduce\)/, 'the dice show their result at once with reduced motion');
  });
});
