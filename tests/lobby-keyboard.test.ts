// The multiplayer lobby keeps the field being typed in visible above a phone's on-screen keyboard
// (src/ui/lobby.ts revealFieldsAboveKeyboard). Regression: on a landscape phone (about 844 x 390) the keyboard left
// about 60 px of page and the room code field stayed hidden under it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { revealFieldsAboveKeyboard, type KeyboardEnv } from '../src/ui/lobby';

type Listener = () => void;

function fakes(height = 390) {
  const vvListeners = new Set<Listener>();
  const vv = {
    height,
    addEventListener: (_t: 'resize', f: Listener) => { vvListeners.add(f); },
    removeEventListener: (_t: 'resize', f: Listener) => { vvListeners.delete(f); },
  };
  const rootListeners = new Set<Listener>();
  const scrolled: { field: string; opts: unknown }[] = [];
  const field = (name: string, inRoot = true, tag = 'input') => ({
    name, inRoot,
    matches: (sel: string) => sel.split(',').map((s) => s.trim()).includes(tag),
    scrollIntoView: (opts: unknown) => { scrolled.push({ field: name, opts }); },
  });
  type Field = ReturnType<typeof field>;
  let active: Field | null = null;
  const root = {
    contains: (el: Field) => !!el && el.inRoot,
    addEventListener: (_t: string, f: Listener) => { rootListeners.add(f); },
    removeEventListener: (_t: string, f: Listener) => { rootListeners.delete(f); },
  };
  const env: KeyboardEnv = {
    visualViewport: vv, activeElement: () => active as unknown as Element, innerHeight: () => height, requestAnimationFrame: (f) => f(),
  };
  return {
    vv, root: root as unknown as HTMLElement, env, scrolled, field,
    focus(f: Field | null) { active = f; for (const l of [...rootListeners]) l(); },
    keyboard(h: number) { vv.height = h; for (const l of [...vvListeners]) l(); },
    listeners: () => vvListeners.size + rootListeners.size,
  };
}

describe('lobby fields stay visible above the on-screen keyboard', () => {
  test('the keyboard opening over the focused room code field scrolls it to the middle', () => {
    const f = fakes();
    revealFieldsAboveKeyboard(f.root, f.env);
    f.focus(f.field('code'));
    assert.equal(f.scrolled.length, 0, 'no scroll while the keyboard is still down');
    f.keyboard(58); // a landscape phone's keyboard leaves about 58 px
    assert.deepEqual(f.scrolled, [{ field: 'code', opts: { block: 'center', inline: 'nearest' } }], 'the code field is centred in what is left');
  });

  test('moving to another field while the keyboard is up reveals that field too', () => {
    const f = fakes();
    revealFieldsAboveKeyboard(f.root, f.env);
    f.focus(f.field('name'));
    f.keyboard(58);
    f.focus(f.field('code'));
    assert.deepEqual(f.scrolled.map((s) => s.field), ['name', 'code'], 'each focused field is brought into view');
  });

  test('the keyboard closing, fields outside the lobby and non-fields cause no scroll', () => {
    const f = fakes();
    revealFieldsAboveKeyboard(f.root, f.env);
    f.focus(f.field('elsewhere', false));
    f.keyboard(58);
    f.focus(f.field('button', true, 'button'));
    f.keyboard(390);
    assert.equal(f.scrolled.length, 0, `nothing outside the lobby, no buttons, no scroll on close (got ${JSON.stringify(f.scrolled)})`);
  });

  test('closing the lobby removes the listeners; no visualViewport is harmless', () => {
    const f = fakes();
    const off = revealFieldsAboveKeyboard(f.root, f.env);
    assert.equal(f.listeners(), 2, 'one viewport and one focus listener');
    off();
    assert.equal(f.listeners(), 0, 'both removed');
    f.focus(f.field('code'));
    f.keyboard(58);
    assert.equal(f.scrolled.length, 0, 'no reveal after the lobby closed');
    const none = revealFieldsAboveKeyboard(f.root, { ...f.env, visualViewport: null });
    assert.doesNotThrow(() => none(), 'a browser without visualViewport gets a no-op');
  });
});
