/**
 * The key rebinding panel (Settings → Key bindings, or Controls → Customise keys). The menu hosts it in a
 * sub-screen; changes are written to the settings at once (`save`), which re-applies the active keymap.
 *
 * Click a key chip (or focus it and press Enter), then press the new key: Esc cancels, reserved keys are
 * refused, a key already used elsewhere is flagged as a conflict (both rows, plus a summary).
 */
import {
  ACTIONS, GROUP_ORDER, MAX_BINDINGS, actionName, actionsUsing, bindingFromEvent, bindingLabel, defaultKeymap, findConflicts,
  groupModLabel, groupName, keymapOverrides, reservedReason, resolveGroupMods, resolveKeymap, type ActionDef, type ActionId,
  type GroupMod, type GroupMods, type Keymap, type KeymapOverrides,
} from './keymap';
import { CONTROLS_TEXT, fmt } from './a11y-strings';

export interface KeySettings { keys?: KeymapOverrides; groupMods?: Partial<GroupMods> }

const CSS = `
.keys-panel { width: min(64rem, 94vw); }
.kb-intro { margin: 0 0 0.7rem; color: var(--text-dim, #9fb3c8); font-size: 0.86rem; }
.kb-conf { display: none; margin: 0 0 0.7rem; padding: 0.5rem 0.75rem; border-radius: 0.4rem; font-size: 0.84rem;
  color: #ffd9cf; background: rgba(255, 106, 26, 0.14); border: 1px solid rgba(255, 106, 26, 0.55); }
.kb-conf.on { display: block; }
.kb-status { min-height: 1.2rem; margin: 0 0 0.4rem; font-size: 0.82rem; color: var(--accent-hi, #b9e0ff); }
.kb-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: 0.4rem 1.2rem; max-height: min(58vh, 40rem); overflow-y: auto; padding-right: 0.4rem; }
.kb-sec { display: flex; flex-direction: column; gap: 0.18rem; margin-bottom: 0.6rem; }
.kb-sec h3 { margin: 0.2rem 0 0.25rem; font-size: 0.72rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent, #5ab4ff); }
.kb-row { display: flex; align-items: center; gap: 0.4rem; padding: 0.16rem 0.3rem; border-radius: 0.35rem; }
.kb-row.conflict { background: rgba(255, 106, 26, 0.12); box-shadow: inset 3px 0 0 #ff6a1a; }
.kb-name { flex: 1; font-size: 0.86rem; min-width: 0; }
.kb-name small { display: block; color: #ffb59a; font-size: 0.72rem; }
.kb-keys { display: flex; gap: 0.25rem; align-items: center; }
.kb-key { min-width: 2.4rem; padding: 0.18rem 0.5rem; border-radius: 0.3rem; font: 600 0.82rem var(--mono, monospace); cursor: pointer;
  color: #f3f7fb; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.22); }
.kb-key:hover { border-color: rgba(var(--accent-rgb, 90, 180, 255), 0.8); }
.kb-key.add { color: #8a9aab; border-style: dashed; font-weight: 500; }
.kb-key.capturing { color: #111; background: #ffd34d; border-color: #ffd34d; }
.kb-x, .kb-reset { width: 1.4rem; height: 1.4rem; padding: 0; border-radius: 0.3rem; cursor: pointer; font-size: 0.8rem; line-height: 1;
  color: #9fb3c8; background: transparent; border: 1px solid transparent; }
.kb-x:hover, .kb-reset:hover { color: #fff; border-color: rgba(255, 255, 255, 0.3); }
.kb-reset { visibility: hidden; }
.kb-row.changed .kb-reset { visibility: visible; }
.kb-mods { display: flex; flex-wrap: wrap; gap: 0.5rem 1.2rem; align-items: center; margin: 0.2rem 0 0.6rem; font-size: 0.86rem; }
.kb-mods > div { display: flex; gap: 0.3rem; align-items: center; }
.kb-mod { padding: 0.16rem 0.55rem; border-radius: 0.3rem; cursor: pointer; font: 600 0.8rem var(--mono, monospace); color: #cfe0f0;
  background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.18); }
.kb-mod[aria-pressed="true"] { color: #111; background: var(--accent, #5ab4ff); border-color: var(--accent, #5ab4ff); }
.kb-mods small { color: #8a9aab; }
.kb-foot { display: flex; gap: 0.6rem; flex-wrap: wrap; justify-content: space-between; align-items: center; margin-top: 0.7rem; }
.kb-fixed { font-size: 0.74rem; color: #8a9aab; }
`;

function injectCss() {
  if (document.getElementById('kb-style')) return;
  const st = document.createElement('style');
  st.id = 'kb-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

function mk<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/**
 * Build the panel body. `save` persists `s.keys` / `s.groupMods` (the caller writes the settings). Returns the
 * element and a dispose function (removes the key capture listener).
 */
export function buildKeysPanel(s: KeySettings, save: () => void): { el: HTMLElement; dispose(): void } {
  injectCss();
  let km: Keymap = resolveKeymap(s.keys);
  let mods: GroupMods = resolveGroupMods(s.groupMods);
  const root = mk('div', 'kb-body');
  const intro = mk('p', 'kb-intro', CONTROLS_TEXT.intro);
  const conf = mk('div', 'kb-conf');
  conf.setAttribute('role', 'alert');
  const status = mk('div', 'kb-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const modsBox = mk('div', 'kb-mods');
  const grid = mk('div', 'kb-grid');
  root.append(intro, conf, status, modsBox, grid);

  let capture: { id: ActionId; slot: number; btn: HTMLButtonElement } | null = null;
  const rows = new Map<ActionId, HTMLElement>();

  const commit = () => {
    s.keys = keymapOverrides(km);
    s.groupMods = { ...mods };
    save();
  };

  const renderMods = () => {
    modsBox.textContent = '';
    const label = mk('b', '', CONTROLS_TEXT.groupMods);
    modsBox.append(label);
    const pick = (which: 'assign' | 'add', title: string) => {
      const box = mk('div', '');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', title);
      box.append(mk('span', '', title));
      for (const m of ['ctrl', 'shift', 'alt'] as GroupMod[]) {
        const b = mk('button', 'kb-mod', groupModLabel(m));
        b.type = 'button';
        b.setAttribute('aria-pressed', String(mods[which] === m));
        b.onclick = () => {
          const other = which === 'assign' ? 'add' : 'assign';
          if (mods[other] === m) { status.textContent = CONTROLS_TEXT.groupModsSame; return; }
          mods = { ...mods, [which]: m };
          status.textContent = m === 'alt' ? CONTROLS_TEXT.altWarning : CONTROLS_TEXT.saved;
          commit();
          renderMods();
          (modsBox.querySelector(`[role=group][aria-label="${window.CSS.escape(title)}"] .kb-mod[aria-pressed="true"]`) as HTMLElement | null)?.focus(); // (the title is translated: quote-safe)
        };
        box.append(b);
      }
      modsBox.append(box);
    };
    pick('assign', CONTROLS_TEXT.groupAssign);
    pick('add', CONTROLS_TEXT.groupAdd);
    modsBox.append(mk('small', '', CONTROLS_TEXT.groupModsSub));
  };

  const renderConflicts = () => {
    const list = findConflicts(km, mods).filter((c) => c.actions.length > 1);
    const bad = new Map<ActionId, string[]>();
    for (const c of list) for (const a of c.actions) bad.set(a, [...(bad.get(a) ?? []), ...c.actions.filter((x) => x !== a).map(actionName)]);
    conf.classList.toggle('on', list.length > 0);
    conf.textContent = list.length === 1 ? CONTROLS_TEXT.conflictOne : fmt(CONTROLS_TEXT.conflictMany, { n: list.length });
    for (const [id, row] of rows) {
      row.classList.toggle('conflict', bad.has(id));
      const note = row.querySelector('.kb-name small');
      if (note) note.textContent = bad.has(id) ? fmt(CONTROLS_TEXT.conflictWith, { action: [...new Set(bad.get(id))].join(', ') }) : '';
    }
  };

  const renderRow = (a: ActionDef) => {
    const row = rows.get(a.id)!;
    const list = km[a.id] ?? [];
    const keys = row.querySelector('.kb-keys')!;
    keys.textContent = '';
    const name = actionName(a.id);
    for (let i = 0; i < Math.min(MAX_BINDINGS, list.length + 1); i++) {
      const b = list[i];
      const btn = mk('button', 'kb-key' + (b ? '' : ' add'), b ? bindingLabel(b) : CONTROLS_TEXT.unbound);
      btn.type = 'button';
      btn.setAttribute('aria-label', b ? `${name}: ${bindingLabel(b)}` : `${name}: ${CONTROLS_TEXT.unbound}`);
      btn.onclick = () => startCapture(a.id, i, btn);
      keys.append(btn);
      if (b) {
        const x = mk('button', 'kb-x', '×');
        x.type = 'button';
        x.setAttribute('aria-label', `${name}: ${CONTROLS_TEXT.clear} (${bindingLabel(b)})`);
        x.title = CONTROLS_TEXT.clear;
        x.onclick = () => { km[a.id] = list.filter((_, k) => k !== i); commit(); renderRow(a); renderConflicts(); (row.querySelector('.kb-key') as HTMLElement | null)?.focus(); };
        keys.append(x);
      }
    }
    const def = a.def;
    row.classList.toggle('changed', list.length !== def.length || list.some((b, k) => b !== def[k]));
  };

  const renderAll = () => {
    grid.textContent = '';
    rows.clear();
    for (const g of GROUP_ORDER) {
      const sec = mk('section', 'kb-sec');
      sec.setAttribute('aria-label', groupName(g));
      sec.append(mk('h3', '', groupName(g)));
      for (const a of ACTIONS.filter((x) => x.group === g)) {
        const row = mk('div', 'kb-row');
        const nm = mk('span', 'kb-name', actionName(a.id));
        nm.append(mk('small', ''));
        const keys = mk('span', 'kb-keys');
        const reset = mk('button', 'kb-reset', '↺');
        reset.type = 'button';
        reset.title = CONTROLS_TEXT.resetRow;
        reset.setAttribute('aria-label', `${actionName(a.id)}: ${CONTROLS_TEXT.resetRow}`);
        reset.onclick = () => { km[a.id] = [...a.def]; commit(); renderRow(a); renderConflicts(); };
        row.append(nm, keys, reset);
        rows.set(a.id, row);
        sec.append(row);
        renderRow(a);
      }
      grid.append(sec);
    }
    renderConflicts();
  };

  const stopCapture = () => {
    if (!capture) return;
    capture.btn.classList.remove('capturing');
    const a = ACTIONS.find((x) => x.id === capture!.id)!;
    capture = null;
    renderRow(a);
  };

  const startCapture = (id: ActionId, slot: number, btn: HTMLButtonElement) => {
    if (capture) stopCapture();
    const fresh = rows.get(id)?.querySelectorAll<HTMLButtonElement>('.kb-key')[slot] ?? btn;
    capture = { id, slot, btn: fresh };
    fresh.classList.add('capturing');
    fresh.textContent = CONTROLS_TEXT.press;
    fresh.focus();
    status.textContent = `${actionName(id)}: ${CONTROLS_TEXT.press}`;
  };

  const onKey = (e: KeyboardEvent) => {
    if (!capture || !root.isConnected) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // the menu must not treat Esc as "back" while a key is being captured
    if (e.key === 'Escape') {
      const { id: was, slot: at } = capture;
      stopCapture();
      status.textContent = '';
      rows.get(was)?.querySelectorAll<HTMLElement>('.kb-key')[at]?.focus();
      return;
    }
    const b = bindingFromEvent(e);
    if (!b) return; // a lone modifier: wait for the key
    const why = reservedReason(b);
    const { id, slot } = capture;
    if (why) { status.textContent = `${bindingLabel(b)}: ${why}`; return; }
    const list = [...(km[id] ?? [])];
    if (slot < list.length) list[slot] = b; else list.push(b);
    km[id] = list.filter((x, i) => list.indexOf(x) === i).slice(0, MAX_BINDINGS);
    const others = actionsUsing(km, b, id);
    status.textContent = fmt(CONTROLS_TEXT.bound, { key: bindingLabel(b), action: actionName(id) }) + (others.length ? ` · ${fmt(CONTROLS_TEXT.conflictWith, { action: others.map(actionName).join(', ') })}` : '');
    const a = ACTIONS.find((x) => x.id === id)!;
    capture.btn.classList.remove('capturing');
    capture = null;
    commit();
    renderRow(a);
    renderConflicts();
    (rows.get(id)?.querySelectorAll<HTMLElement>('.kb-key')[Math.min(slot, (km[id]?.length ?? 1) - 1)] as HTMLElement | undefined)?.focus();
  };
  const onDown = (e: PointerEvent) => { if (capture && !(e.target as HTMLElement).closest('.kb-key.capturing')) stopCapture(); };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onDown, true);

  const foot = mk('div', 'kb-foot');
  const resetAll = mk('button', 'btn', CONTROLS_TEXT.resetAll);
  resetAll.type = 'button';
  resetAll.onclick = () => {
    km = defaultKeymap();
    mods = resolveGroupMods(null);
    commit();
    renderMods();
    renderAll();
    status.textContent = CONTROLS_TEXT.resetDone;
  };
  foot.append(mk('span', 'kb-fixed', CONTROLS_TEXT.fixedKeys), resetAll);
  root.append(foot);

  renderMods();
  renderAll();
  return {
    el: root,
    dispose() {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    },
  };
}
