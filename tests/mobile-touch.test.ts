// Touch-screen guards from the Android emulator lab (tools/mobile/run.mjs): the drag decision under slow frames, and
// the phone / portrait HUD rules in styles.css. The lab checks the real thing in Chrome on Android; these keep the
// fixes from quietly regressing.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slopExitTime, type MoveSample } from '../src/ui/touch';

const move = (timeStamp: number, clientX: number, clientY: number, coalesced?: MoveSample[]): MoveSample =>
  ({ timeStamp, clientX, clientY, getCoalescedEvents: coalesced ? () => coalesced : undefined });

describe('touch: pan or box select', () => {
  test('a quick drag delivered late in one coalesced event counts from when the finger moved', () => {
    // finger down at t=1000 at (400, 200); the frame took 450 ms, so the browser delivers one pointermove at
    // t=1450 that carries every sample since: the finger was already 12 px away at t=1030
    const samples = [move(1010, 397, 200), move(1020, 394, 200), move(1030, 388, 200), move(1450, 250, 260)];
    const e = move(1450, 250, 260, samples);
    assert.equal(slopExitTime(e, 400, 200), 1030, 'the first sample outside the slop circle decides');
    assert.ok(slopExitTime(e, 400, 200) - 1000 < 330, 'so it is a pan (under the 330 ms box-select arm time)');
  });
  test('a finger held still before dragging is still a box select', () => {
    const samples = [move(1100, 400, 201), move(1400, 399, 200), move(1500, 380, 205)];
    assert.equal(slopExitTime(move(1500, 380, 205, samples), 400, 200), 1500, 'it left the circle only at 1500 ms');
  });
  test('without coalesced events (or with an empty list) the event time is used', () => {
    assert.equal(slopExitTime(move(1200, 300, 200), 400, 200), 1200, 'no getCoalescedEvents');
    assert.equal(slopExitTime(move(1200, 300, 200, []), 400, 200), 1200, 'an empty list');
  });
  test('a coalesced sample is never later than the event itself', () => {
    const e = move(1300, 300, 200, [move(1350, 300, 200)]);
    assert.equal(slopExitTime(e, 400, 200), 1300, 'clamped to the event time');
  });
});

describe('touch: phone and portrait HUD', () => {
  const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
  const block = (head: string) => {
    const i = css.indexOf(head);
    assert.ok(i >= 0, `styles.css has ${head}`);
    return css.slice(i, css.indexOf('\n}', i));
  };
  test('radio panels never catch taps on touch screens', () => {
    assert.match(block('@media (pointer: coarse) {\n  /* the mission and rival radio'), /#ui > \.rv-tx, html body #ui > \.mh-tx \{ pointer-events: none; \}/, 'the faded rival / mission radio lets taps through to the map');
  });
  test('resource-bar buttons are finger-sized', () => {
    assert.match(block('@media (pointer: coarse) {\n  /* the mission and rival radio'), /#topright \.rb-btns \.tb-btn \{ width: 2\.9rem; \}/, 'menu, settings, alerts, full screen buttons are wider on touch');
  });
  test('phones in landscape get the compact HUD', () => {
    const b = block('@media (pointer: coarse) and (max-height: 500px) {');
    assert.match(b, /--mm-w: 9\.6rem/, 'a smaller minimap');
    assert.match(b, /#topbar \{ width: 13\.5rem; \}/, 'objectives narrow enough for the resource bar beside them');
    assert.match(b, /#touch-bar button span \{ display: none; \}/, 'an icon-only touch toolbar');
  });
  test('phones in landscape stack the main menu instead of cutting it off at both edges', () => {
    const b = block('@media (pointer: coarse) and (max-height: 600px) and (min-aspect-ratio: 1/1) {');
    assert.match(b, /\.main-screen \.mm-layout \{ flex-direction: column;/, 'the title column and the setup panel stack');
    assert.match(b, /\.main-screen \.mm-panel \{ position: relative;[^}]*max-height: none/, 'the setup panel is not a squeezed sticky box');
  });
  test('portrait screens stack the build bar above the minimap and the selection', () => {
    const b = block('@media (pointer: coarse) and (max-aspect-ratio: 1/1) {');
    assert.match(b, /#topright \{ left: var\(--edge\); right: var\(--edge\);/, 'the resource bar spans the top');
    assert.match(b, /#buildbar \{ left: var\(--edge\); right: var\(--edge\);/, 'the build bar spans the bottom');
    assert.match(b, /#touch-bar \{[^}]*flex-direction: row/, 'the touch toolbar is a row under the objectives');
  });
});

describe('dynamic resolution', () => {
  test('the render scale changes before the frame is drawn, never after (a resize clears the drawn canvas)', () => {
    const src = readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
    const adapt = src.indexOf('this.gfx.adaptResolution(');
    const render = src.indexOf('this.gfx.render(dt, this.time)');
    assert.ok(adapt > 0 && render > 0, 'game.ts drives dynamic resolution and the render');
    assert.ok(adapt < render, 'adaptResolution runs before gfx.render in the frame (else every step flashes a black frame)');
  });
});
