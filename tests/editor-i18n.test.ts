// The map & mission editor in another language: its checks and defaults are translated, while the files it saves
// stay language-independent (ids, not labels) and custom missions keep emitting English in the simulation.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../src/maps';
import type { Feature } from '../src/maps/format';
import { DEFAULT_BRUSH, newDoc, newMapDef, strokeFeature } from '../src/editor/doc';
import { customMissionDef, defaultMission, OBJECTIVE_KINDS, TRIGGER_DOS, TRIGGER_WHENS, type MissionSpec } from '../src/editor/mission';
import { docToFile, parseRhMap } from '../src/editor/store';
import { checkMission, footprintProblem, validateMap, validateMission } from '../src/editor/validate';
import { englishCatalog, registerLocale, setLanguage, trSource, tx } from '../src/i18n/core';
import { loadEnglish, loadLocale } from '../tools/i18n/lib';

/** A map with a broken layout (a lake cuts start 2 off, uneven ore): plenty of checks to read. */
function brokenMap() {
  const def = newMapDef({ name: 'Broken', size: 64, symmetry: 'none', seed: 3, starter: false });
  def.features.push({ t: 'water', rect: [0, 30, 64, 34], wobble: 0 } as Feature, { t: 'ore', circle: [12, 40], r: 4 } as Feature);
  return def;
}

/** The text fields of a saved file (the author's words), blanked: what is left must not depend on the language. */
const TEXT = new Set(['name', 'desc', 'title', 'codename', 'location', 'briefing', 'tips', 'text', 'speaker', 'id', 'createdAt', 'updatedAt', 'seed']);
const structure = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(structure);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, TEXT.has(k) ? '' : structure(v)]));
  return x;
};

describe('editor in German', async () => {
  const en = await loadEnglish();
  registerLocale('de', loadLocale('de'));
  const english = new Set(Object.values(englishCatalog()));

  test('map and mission checks speak German', async () => {
    await setLanguage('de');
    try {
      const def = brokenMap();
      const r = validateMap(def, buildMap(def));
      assert.ok(r.checks.length > 3, 'several checks');
      const titles = r.checks.map((c) => c.title);
      assert.ok(titles.some((t) => /Start 2/.test(t) && /abgeschnitten/.test(t)), `the cut-off start in German: ${titles.join(' | ')}`);
      const spec = defaultMission(2, 'Broken');
      spec.objectives.push({ id: 'o2', kind: 'destroy', text: '', primary: true, tag: 'nope' });
      const issues = [...checkMission(spec, 2).map((i) => i.text), ...validateMission(spec, buildMap(def)).map((c) => c.title)];
      for (const t of [...titles, ...issues]) assert.ok(!english.has(t) || t === tx('editor.vmission.ready'), `check text left in English: "${t}"`);
      assert.equal(footprintProblem(buildMap(def), 'powr', -5, -5), 'outside', 'footprint problems are ids (the text is looked up when shown)');
    } finally {
      await setLanguage('auto');
    }
  });

  test('a new mission is written in the author\'s language, with ids for every kind', async () => {
    await setLanguage('de');
    let de: MissionSpec;
    try { de = defaultMission(2, 'Fluss'); } finally { await setLanguage('auto'); }
    const enSpec = defaultMission(2, 'Fluss');
    assert.notEqual(de.objectives[0].text, enSpec.objectives[0].text, 'the default objective is German');
    assert.equal(de.objectives[0].text, loadLocale('de')['editorMission.defaults.objective.destroyAll'], 'from the catalogue');
    assert.equal(de.objectives[0].kind, 'destroyAll', 'kinds stay ids');
    assert.deepEqual(structure(de), structure(enSpec), 'only the author\'s words differ between languages');
    for (const k of [...OBJECTIVE_KINDS, ...TRIGGER_WHENS, ...TRIGGER_DOS]) assert.match(k, /^[a-z][A-Za-z]*$/, `kind ${k} is an id`);
    // a file saved in German reads back the same in English
    const doc = newDoc(newMapDef({ name: 'Fluss', size: 64, seed: 5 }), de);
    const back = parseRhMap(JSON.stringify(docToFile(doc)));
    assert.deepEqual(back.errors, [], 'no import errors');
    assert.deepEqual(structure(back.doc!.mission), structure(de), 'mission survives the round trip');
  });

  test('custom missions emit English in the simulation and translate where shown', async () => {
    const enSpec = defaultMission(2, '');
    enSpec.location = '';
    await setLanguage('de');
    try {
      const def = customMissionDef({ ...enSpec, id: 'custom-x', briefing: [] }, newMapDef({ name: 'Zwillingsflüsse', size: 64, seed: 9 }));
      assert.equal(def.location, 'Custom map · Zwillingsflüsse', 'the runtime keeps English (lockstep, saves)');
      assert.deepEqual(def.briefing, ['No briefing.'], 'English fallback briefing');
      assert.equal(trSource(def.location), `${loadLocale('de')['editorMission.run.location'].replace('{map}', 'Zwillingsflüsse')}`, 'shown in German');
      assert.equal(trSource('3 left'), loadLocale('de')['editorMission.run.left'].replace('{n}', '3'), 'objective progress shown in German');
      assert.equal(trSource('Objective failed: Destroy all enemy forces'), `${loadLocale('de')['editorMission.run.objectiveFailed'].replace('{text}', loadLocale('de')['editorMission.defaults.objective.destroyAll'])}`, 'defeat reason and an English default objective inside it, both translated');
    } finally {
      await setLanguage('auto');
    }
    assert.ok(Object.keys(en).some((k) => k.startsWith('editor.')), 'editor strings registered');
  });

  test('brush strokes and symmetry are stored by id', () => {
    const f = strokeFeature('ore', [[3, 3]], DEFAULT_BRUSH);
    assert.equal(f.t, 'ore', 'brush kind is an id');
    const file = docToFile(newDoc(newMapDef({ name: 'x', size: 64, symmetry: 'mirror4', seed: 1 })));
    assert.equal(file.map.symmetry, 'mirror4', 'symmetry is an id');
  });
});
