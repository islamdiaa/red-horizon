// Accessibility: team colour palettes (mapping, colour-blind separation, contrast), the keymap (defaults identical
// to the old hard-coded keys, matching, conflicts, persistence) and the diagnostics report (content, no personal data).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CVD_COLORS, VS_COLORS, contrastRatio, deltaE, healthColors, ringColors, setTeamPalette, teamColor, teamPalette, paletteVersion,
  clampUiScale, subtitleSizeOf, type CvdKind, type PlayerLike,
} from '../src/ui/a11y';
import {
  ACTIONS, ACTION_COMMAND, actionsUsing, bindingFromEvent, bindingLabel, commandKeyLabel, defaultKeymap, findConflicts, isAction, isHeld,
  keymapOverrides, lookup, matchesBinding, normalizeBinding, reservedReason, resolveGroupMods, resolveKeymap, setKeymap, keymap, groupMods,
  type KeyLike,
} from '../src/ui/keymap';
import { formatDiagnostics, redact, recordWarning, collectDiagnostics, type DiagnosticsInfo } from '../src/ui/a11y-diagnostics';
import { TEAM_COLORS } from '../src/config';

const P = (id: number, team: number, color = TEAM_COLORS[id] ?? 0x9aa0aa): PlayerLike => ({ id, team, color });
const CVD: (CvdKind | null)[] = [null, 'protanopia', 'deuteranopia', 'tritanopia'];
const minPairDelta = (cols: number[], k: CvdKind | null) => {
  let m = Infinity;
  for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) m = Math.min(m, deltaE(cols[i], cols[j], k));
  return m;
};

describe('team colour palettes', () => {
  const me = P(0, 0), ally = P(1, 0), foe1 = P(2, 1), foe2 = P(3, 2), neutral = { id: -1, team: -1, color: 0x8a8a8a };

  test('default keeps every setup colour', () => {
    for (const p of [me, ally, foe1, foe2, neutral]) assert.equal(teamColor(p, me, 'default'), p.color, `player ${p.id} keeps its colour`);
  });

  test('colour-blind: you first, then the others by slot; neutrals stay grey', () => {
    assert.equal(teamColor(me, me, 'cvd'), CVD_COLORS[0], 'you get slot 0 (blue)');
    assert.equal(teamColor(ally, me, 'cvd'), CVD_COLORS[1], 'player 1 gets slot 1');
    assert.equal(teamColor(foe2, me, 'cvd'), CVD_COLORS[3], 'player 3 gets slot 3');
    assert.equal(teamColor(neutral, me, 'cvd'), neutral.color, 'neutral keeps its grey');
    // viewing as player 2 (replays): player 2 becomes slot 0 and the others shift up
    assert.equal(teamColor(foe1, foe1, 'cvd'), CVD_COLORS[0], 'the viewed player is slot 0');
    assert.equal(teamColor(me, foe1, 'cvd'), CVD_COLORS[1], 'player 0 moves to slot 1');
    assert.equal(teamColor(foe2, foe1, 'cvd'), CVD_COLORS[3], 'player 3 keeps slot 3');
    const four = [me, ally, foe1, foe2].map((p) => teamColor(p, me, 'cvd'));
    assert.equal(new Set(four).size, 4, 'four players, four colours');
  });

  test('you vs enemies: you blue, allies green, every enemy orange, whatever the setup colours', () => {
    const odd = { id: 0, team: 0, color: 0xd23a2c }; // you picked red
    assert.equal(teamColor(odd, odd, 'vs'), VS_COLORS.own, 'you are blue even with a red setup colour');
    assert.equal(teamColor(ally, me, 'vs'), VS_COLORS.ally, 'same team: ally colour');
    assert.equal(teamColor(foe1, me, 'vs'), VS_COLORS.enemy, 'enemy 1 orange');
    assert.equal(teamColor(foe2, me, 'vs'), VS_COLORS.enemy, 'enemy 2 orange too');
    assert.equal(teamColor(neutral, me, 'vs'), neutral.color, 'neutral unchanged');
  });

  test('the colour-blind palette separates four players better than the setup colours under every CVD type', () => {
    const cvd4 = [...CVD_COLORS].slice(0, 4), def4 = TEAM_COLORS.slice(0, 4);
    for (const k of CVD) {
      const c = minPairDelta(cvd4, k);
      assert.ok(c >= 25, `${k ?? 'normal'}: min ΔE ${c.toFixed(1)} ≥ 25`);
    }
    for (const k of ['deuteranopia', 'tritanopia'] as const) assert.ok(minPairDelta(cvd4, k) > minPairDelta(def4, k) + 5, `${k}: clearly better than the setup colours`);
    const worst = (cols: number[]) => Math.min(...CVD.map((k) => minPairDelta(cols, k)));
    assert.ok(worst(cvd4) > worst(def4) + 5, `worst case over all vision types: ${worst(cvd4).toFixed(1)} vs ${worst(def4).toFixed(1)}`);
    for (const k of CVD) {
      const d = deltaE(VS_COLORS.own, VS_COLORS.enemy, k);
      assert.ok(d >= 80, `${k ?? 'normal'}: you vs enemy ΔE ${d.toFixed(0)} ≥ 80`);
      assert.ok(deltaE(VS_COLORS.ally, VS_COLORS.enemy, k) >= 40, `${k ?? 'normal'}: ally vs enemy apart`);
    }
  });

  test('minimap and HUD contrast: every palette colour ≥ 3:1 against the dot outline and the HUD panel', () => {
    const hud = 0x0b1118, outline = 0x000000;
    const all = [...CVD_COLORS, VS_COLORS.own, VS_COLORS.ally, VS_COLORS.enemy, ...Object.values(ringColors('cvd')), ...Object.values(ringColors('vs'))];
    for (const c of all) {
      assert.ok(contrastRatio(c, outline) >= 3, `#${c.toString(16)} vs outline ${contrastRatio(c, outline).toFixed(2)}`);
      assert.ok(contrastRatio(c, hud) >= 3, `#${c.toString(16)} vs HUD ${contrastRatio(c, hud).toFixed(2)}`);
    }
    for (const mode of ['default', 'cvd', 'vs'] as const) {
      for (const h of healthColors(mode)) assert.ok(contrastRatio(parseInt(h.slice(1), 16), 0) >= 4.5, `${mode} health ${h} readable on the black bar`);
    }
  });

  test('colour-blind health bars and rings are distinguishable under deuteranopia', () => {
    const hc = healthColors('cvd').map((h) => parseInt(h.slice(1), 16));
    const rc = ringColors('cvd');
    for (const k of ['protanopia', 'deuteranopia'] as const) {
      assert.ok(minPairDelta(hc, k) >= 20, `${k}: health colours apart (${minPairDelta(hc, k).toFixed(1)})`);
      assert.ok(deltaE(rc.own, rc.enemy, k) >= 40, `${k}: own vs enemy ring apart`);
    }
    const dc = healthColors('default').map((h) => parseInt(h.slice(1), 16));
    for (const k of ['protanopia', 'deuteranopia'] as const) assert.ok(minPairDelta(hc, k) > minPairDelta(dc, k), `better than the default green / red under ${k}`);
  });

  test('the palette state is display-only and versioned', () => {
    const v = paletteVersion();
    setTeamPalette('cvd');
    assert.equal(teamPalette(), 'cvd', 'set');
    assert.ok(paletteVersion() > v, 'version bumped');
    setTeamPalette('bogus');
    assert.equal(teamPalette(), 'default', 'unknown values fall back to default');
    assert.equal(clampUiScale(3), 1.5, 'scale clamps to 150%');
    assert.equal(clampUiScale(0.1), 0.8, 'scale clamps to 80%');
    assert.equal(clampUiScale('x'), 1, 'junk scale is 100%');
    assert.equal(subtitleSizeOf('huge'), 'medium', 'junk subtitle size is medium');
  });
});

const ev = (key: string, code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, code, ...mods });

describe('keymap', () => {
  test('defaults reproduce the old hard-coded keys', () => {
    const km = defaultKeymap();
    const expect: Record<string, string[]> = {
      attackMove: ['a'], stop: ['s'], scatter: ['x'], attackGround: ['g'], deploy: ['d'], sell: ['z'], repair: ['r'], patrol: ['p'], guard: ['c'],
      selectCombat: ['e'], selectType: ['w'], powers: ['t'], speedDown: ['['], speedUp: [']'], photo: ['u'], rotateLeft: ['q', ','], rotateRight: ['.'],
      stanceAggressive: ['f1'], stancePassive: ['f4'], bookmark1: ['f6'], bookmark4: ['f9'], army: ['#Backquote'], lastAttack: ['space'],
      camUp: ['arrowup'], selectScreen: ['Ctrl+a'], selectDamaged: ['Shift+#KeyE'], sendRepair: ['Shift+#KeyR'],
    };
    for (const [id, keys] of Object.entries(expect)) assert.deepEqual(km[id as keyof typeof km], keys, `${id} default`);
    // every single-key command still maps to the command id the HUD / touch / gamepad buttons use
    for (const [id, cmd] of Object.entries(ACTION_COMMAND)) assert.ok(typeof cmd === 'string' && cmd.length >= 1, `${id} has a command`);
    assert.equal(commandKeyLabel('s', km), 'S', 'Stop button shows S');
    assert.equal(commandKeyLabel('d', km), 'D', 'Deploy button shows D');
  });

  test('matching keeps the old modifier behaviour', () => {
    assert.ok(matchesBinding('s', ev('S', 'KeyS', { shiftKey: true })), 'Shift+S still stops');
    assert.ok(!matchesBinding('s', ev('s', 'KeyS', { ctrlKey: true })), 'Ctrl+S is not S');
    assert.ok(matchesBinding('s', ev('s', 'KeyS', { altKey: true })), 'Alt is ignored');
    assert.ok(!matchesBinding('s', ev('s', 'KeyS', { altKey: true }), { exactAlt: true }), 'unless exactAlt');
    assert.ok(matchesBinding('Ctrl+a', ev('a', 'KeyA', { metaKey: true })), 'Cmd counts as Ctrl');
    assert.ok(matchesBinding('#Backquote', ev('Dead', 'Backquote')), 'the army key works on layouts with a dead key there');
    assert.ok(matchesBinding('space', ev(' ', 'Space')), 'space bar');
    assert.ok(matchesBinding('q', ev('й', 'KeyQ')), 'letters fall back to the key position on non-Latin layouts');
    assert.ok(!matchesBinding('q', ev('a', 'KeyQ')), 'but not on AZERTY (A is where Q is: the letter wins)');
    assert.ok(matchesBinding('f1', ev('F1', 'F1', { shiftKey: true, ctrlKey: true }), { anyMods: true }), 'stances ignore modifiers');
    const km = defaultKeymap();
    assert.equal(lookup(ev('E', 'KeyE', { shiftKey: true }), ['selectCombat', 'selectDamaged'], {}, km), 'selectDamaged', 'Shift+E prefers the exact binding');
    assert.equal(lookup(ev('e', 'KeyE'), ['selectCombat', 'selectDamaged'], {}, km), 'selectCombat', 'plain E');
    assert.ok(isHeld('camLeft', new Set(['arrowleft']), km), 'held arrow scrolls');
  });

  test('conflicts are found, and Shift variants are not conflicts', () => {
    const km = defaultKeymap();
    assert.deepEqual(findConflicts(km), [], 'the defaults have no conflicts');
    km.attackMove = ['s'];
    const c = findConflicts(km);
    assert.equal(c.length, 1, 'one conflict');
    assert.deepEqual(c[0].actions.sort(), ['attackMove', 'stop'], 'attack-move and stop share S');
    assert.deepEqual(actionsUsing(km, 's', 'attackMove'), ['stop'], 'actionsUsing names the other action');
    assert.ok(findConflicts(defaultKeymap(), { assign: 'shift', add: 'shift' }).length > 0, 'same group modifiers conflict');
  });

  test('reserved keys and event capture', () => {
    for (const b of ['escape', '1', 'Ctrl+5', '#Digit3', 'b', 'tab', 'enter', 'f5', 'Ctrl+w']) assert.ok(reservedReason(normalizeBinding(b)!), `${b} is reserved`);
    assert.ok(reservedReason('Shift+b'), 'Shift+B also arms the build bar');
    for (const b of ['a', 'Alt+b', 'f10', 'Ctrl+b', 'k']) assert.equal(reservedReason(normalizeBinding(b)!), null, `${b} is free`);
    assert.equal(bindingFromEvent(ev('Shift', 'ShiftLeft', { shiftKey: true })), null, 'a lone modifier is not a binding');
    assert.equal(bindingFromEvent(ev('K', 'KeyK', { shiftKey: true })), 'Shift+k', 'Shift+K');
    assert.equal(bindingFromEvent(ev('k', 'KeyK', { ctrlKey: true, altKey: true })), 'Ctrl+Alt+k', 'modifier order is canonical');
    assert.equal(bindingFromEvent(ev('Dead', 'Backquote')), '#Backquote', 'dead keys bind by position');
    assert.equal(bindingLabel('Shift+#KeyE'), 'Shift + E', 'label');
    assert.equal(bindingLabel('arrowup'), '↑', 'arrow label');
    assert.equal(normalizeBinding('Shift+Ctrl+k'), 'Ctrl+Shift+k', 'modifiers are put in canonical order');
    assert.equal(normalizeBinding('A'), null, 'upper-case bases are rejected');
    assert.equal(normalizeBinding('Ctrl++'), 'Ctrl++', 'the plus key with a modifier');
  });

  test('persistence: overrides round-trip, junk is dropped, defaults are not stored', () => {
    const km = defaultKeymap();
    assert.deepEqual(keymapOverrides(km), {}, 'nothing stored for the defaults');
    km.attackMove = ['k', 'Shift+q'];
    km.photo = [];
    const stored = JSON.parse(JSON.stringify(keymapOverrides(km)));
    assert.deepEqual(stored, { attackMove: ['k', 'Shift+q'], photo: [] }, 'only the changes');
    const back = resolveKeymap(stored);
    assert.deepEqual(back.attackMove, ['k', 'Shift+q'], 'restored');
    assert.deepEqual(back.photo, [], 'unbound stays unbound');
    assert.deepEqual(back.stop, ['s'], 'others default');
    const junk = resolveKeymap({ attackMove: ['k', 'k', 7, 'escape', 'Q', 'x', 'y'], nope: ['a'], stop: 'z', __proto__: { a: 1 } });
    assert.deepEqual(junk.attackMove, ['k', 'x'], 'duplicates, non-strings, reserved and malformed keys dropped; at most two');
    assert.deepEqual(junk.stop, ['s'], 'a non-array keeps the default');
    assert.ok(!('nope' in junk), 'unknown actions ignored');
    assert.deepEqual(resolveKeymap('garbage'), defaultKeymap(), 'garbage storage gives the defaults');
    assert.deepEqual(resolveGroupMods({ assign: 'alt', add: 'alt' }), { assign: 'ctrl', add: 'shift' }, 'clashing group modifiers reset');
    assert.deepEqual(resolveGroupMods({ assign: 'shift', add: 'ctrl' }), { assign: 'shift', add: 'ctrl' }, 'swapped modifiers kept');
    // the active keymap follows the settings
    setKeymap({ stop: ['k'] }, { assign: 'alt', add: 'shift' });
    assert.ok(isAction('stop', ev('k', 'KeyK')), 'K stops');
    assert.ok(!isAction('stop', ev('s', 'KeyS')), 'S no longer stops');
    assert.equal(groupMods().assign, 'alt', 'group modifier applied');
    setKeymap(undefined, undefined);
    assert.deepEqual(keymap().stop, ['s'], 'reset');
    assert.equal(ACTIONS.length, new Set(ACTIONS.map((a) => a.id)).size, 'action ids are unique');
  });
});

describe('diagnostics', () => {
  const info = (over: Partial<DiagnosticsInfo> = {}): DiagnosticsInfo => ({
    version: '0.1.0', simVersion: 2, build: 'production', time: '2026-10-18T10:00:00.000Z',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0', platform: 'Linux', language: 'en-GB',
    gpu: 'ANGLE (NVIDIA GeForce RTX 3070)', webgl: 'WebGL2, max texture 16384', screen: '2560x1440 @1.5x, window 1700x956',
    device: '16 threads, 8 GB, touch points 0, pointer fine', display: 'browser tab, https, online, service worker active',
    settings: { quality: 'high', layout: 'modern', uiScale: '100%', colours: 'cvd', subtitles: 'medium', reduceMotion: false },
    blocks: [['Battle', { quality: 'high', hd: 'high 30 loaded / 0 pending / 0 failed, 120 MB', terrain: 'ready (winter, 48 MB)' }]],
    errors: [{ time: Date.UTC(2026, 9, 18, 9, 59), kind: 'error', name: 'TypeError', message: 'x is undefined', stack: 'TypeError: x is undefined\n    at f (https://play.example.org/assets/index.js:1:2)', count: 3 }],
    warnings: [{ time: Date.UTC(2026, 9, 18, 9, 58), text: 'THREE.WebGLProgram: shader warning', count: 1 }],
    ...over,
  });

  test('the report holds versions, browser, GPU, settings, battle status, errors and warnings', () => {
    const t = formatDiagnostics(info(), [], 'https://play.example.org');
    for (const want of ['0.1.0', 'simulation 2', 'Chrome/140.0', 'RTX 3070', '2560x1440 @1.5x', 'quality=high', 'colours=cvd', 'reduceMotion=off',
      'Battle', 'terrain=ready (winter, 48 MB)', 'TypeError: x is undefined', 'x3', 'shader warning']) {
      assert.ok(t.includes(want), `report contains "${want}"`);
    }
    assert.ok(!t.includes('play.example.org'), 'the page origin is removed from stacks');
    assert.ok(t.includes('/assets/index.js:1:2'), 'the path stays');
  });

  test('no personal data: callsign and profile name are redacted wherever they appear', () => {
    const d = info({ errors: [{ time: 0, kind: 'manual', name: 'Error', message: 'lobby join failed for Viper-7', stack: '', count: 1 }], warnings: [{ time: 0, text: 'profile Jane Doe loaded', count: 1 }] });
    const t = formatDiagnostics(d, ['Viper-7', 'Jane Doe']);
    assert.ok(!t.includes('Viper-7') && !t.includes('Jane Doe'), 'names removed');
    assert.ok(t.includes('<name>'), 'replaced by a placeholder');
    assert.equal(redact('Commander Commander', ['Commander']), 'Commander Commander', 'the default name is not personal and stays');
    assert.equal(redact('a.b+c', ['a.b+c']), '<name>', 'names are matched literally');
  });

  test('the live collector runs without a browser and holds no names', () => {
    recordWarning('test warning', { a: 1 });
    const d = collectDiagnostics();
    assert.equal(d.simVersion > 0, true, 'sim version present');
    assert.ok(d.warnings.some((w) => w.text.includes('test warning')), 'warnings ring');
    const t = formatDiagnostics(d);
    assert.ok(!/callsign|profile name/i.test(t), 'no name fields');
    assert.ok(t.split('\n').length > 10, 'a full report');
  });
});
