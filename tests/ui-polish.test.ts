// Interface polish guards: the first-launch defaults, the main menu on every screen shape, keyboard focus kept
// inside full-screen menus, and the calm opening of a first battle. The layout itself is checked in a browser by
// tools/qa/ui-sweep.mjs (every screen, language and viewport); these keep the fixes from quietly regressing.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSettings } from '../src/ui/settings';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

describe('first launch', () => {
  test('hints are on and the performance overlay is opt-in', () => {
    const s = loadSettings();
    assert.equal(s.hints, true, 'the Field Manual is on for a new profile');
    assert.equal(s.showFps, false, 'no renderer stats chip in a first battle');
  });
  test('a fresh skirmish setup starts against a Recruit AI', () => {
    assert.match(src('ui/menu.ts'), /opponents: \[\{ faction: 'soviet', difficulty: 'recruit' \}\]/, 'the default opponent is Recruit');
  });
});

describe('main menu layout', () => {
  const css = src('ui/styles.css');
  test('portrait screens stack the navigation above the skirmish setup', () => {
    const m = css.match(/@media \(max-aspect-ratio: 1\/1\) \{([\s\S]*?)\n\}/);
    assert.ok(m, 'a portrait rule for the main menu exists');
    assert.match(m![1], /\.main-screen \.mm-layout \{[^}]*flex-direction: column/, 'the two columns stack');
    assert.match(m![1], /\.main-screen \{[^}]*overflow-y: auto/, 'the stacked menu scrolls');
  });
  test('short landscape screens scroll the menu', () => {
    assert.match(css, /@media \(max-height: 600px\) and \(min-aspect-ratio: 1\/1\) \{\s*\.main-screen \{[^}]*overflow-y: auto/, 'phones in landscape scroll');
  });
  test('the navigation numbers run on without gaps', () => {
    assert.ok(!/navItem\(String\(nav\.childElementCount/.test(src('ui/menu.ts')), 'editor and mods are not numbered by the element count');
  });
});

describe('keyboard focus', () => {
  test('every full-screen menu keeps Tab inside it', () => {
    for (const f of ['ui/menu.ts', 'ui/campaign.ts', 'ui/conquest.ts', 'ui/challenges.ts', 'ui/challenge-list.ts', 'ui/profile.ts', 'ui/rivals.ts', 'ui/locker.ts']) {
      assert.match(src(f), /focusTrap\(/, `${f} traps focus`);
    }
  });
  test('Enter on a focused campaign button presses that button, not Deploy', () => {
    const c = src('ui/campaign.ts');
    assert.equal((c.match(/e\.key === 'Enter' && !\(e\.target as HTMLElement \| null\)\?\.closest\?\.\('button/g) ?? []).length, 2, 'mission select and debrief both defer to the focused button');
  });
});

describe('portrait screens', () => {
  test('challenges, campaign and conquest have portrait or phone layouts', () => {
    assert.match(src('ui/challenges.ts'), /@media \(max-aspect-ratio: 1\/1\) \{\s*\.chl \{ grid-template-columns: minmax\(0, 1fr\)/, 'challenges: one column in portrait');
    assert.match(src('ui/campaign.ts'), /@media \(max-aspect-ratio: 1\/1\) \{\s*\.cmp \{ grid-template-columns: minmax\(0, 1fr\)/, 'campaign: one column in portrait');
    assert.match(src('ui/conquest.ts'), /@media \(max-width: 600px\) \{\s*\.cq-facs \{ grid-template-columns: minmax\(0, 1fr\)/, 'conquest: stacked sides on phones');
  });
});

describe('mods screen', () => {
  test('the rule preview names the changed fields in the interface language', () => {
    const ui = src('mods/ui.ts');
    assert.match(ui, /hasKey\(`mods\.field\.\$\{field\}`\)/, 'field labels come from the catalogue');
    assert.match(ui, /<span class="fld" title="\$\{esc\(c\.field\)\}">\$\{esc\(fieldLabel\(c\.field\)\)\}<\/span>/, 'the label is escaped, the file name stays in the tooltip');
    for (const l of ['de', 'ru', 'es', 'pt-BR', 'fr', 'zh-CN']) {
      const cat = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${l}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      for (const f of ['cost', 'speed', 'strength']) assert.ok(cat[`mods.field.${f}`], `${l} translates the ${f} field`);
    }
  });
});

describe('calm opening', () => {
  test('with hints on, the commander panel waits for the opening steps before its first hint', () => {
    const c = src('ui/commander.ts');
    assert.match(c, /private openingDone\(\)/, 'the panel knows when the opening is over');
    assert.match(c, /if \(this\.quiet && this\.openingDone\(\)\) this\.introduce\(\);/, 'the introduction follows the opening');
    assert.match(c, /#cmdpanel\.quiet \.cmdp-pw\[data-state="buy"\] \{ animation: none;/, 'no glow while quiet');
  });
});
