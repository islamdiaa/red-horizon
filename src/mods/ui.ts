/**
 * The Mods screen: import, enable / disable, order, export and remove mods, install the bundled
 * examples (public/mods), and read a summary of every change a mod (and the active set) makes.
 */
import { BUILDINGS, UNITS } from '../data/rules';
import { checkMods, formatModValue, pristineTables, type ModIssue, type ModReport } from './engine';
import { MOD_FORMAT, MOD_VERSION, modSetHash, type ModFile, type TableName } from './format';
import { activeModSet, enabledModIds, installMod, installedMods, moveMod, removeMod, setModEnabled } from './store';
import { parseUntrustedJson, UntrustedInputError } from '../platform/untrusted';
import { assetUrl } from '../platform/paths'; // base-path helper
import tMods from '../i18n/en/mods';
import tCommon from '../i18n/en/common';
import { dt, hasKey, tx } from '../i18n/core';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CSS = `
.mods { position: fixed; inset: 0; z-index: 22; display: grid; grid-template-columns: minmax(360px, 1fr) minmax(380px, 1.1fr); grid-template-rows: auto 1fr; gap: 16px; padding: 3.2vh 2.6vw;
  background: radial-gradient(ellipse at 30% 35%, rgba(0,0,0,0.4), rgba(0,0,0,0.9) 75%); font-family: var(--font, sans-serif); color: #dfe8f2; animation: modsIn .4s ease-out; }
@keyframes modsIn { from { opacity: 0; transform: scale(1.01); } to { opacity: 1; transform: none; } }
.mods-panel { background: linear-gradient(180deg, rgba(20,28,38,0.92), rgba(8,11,16,0.94)); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.55); backdrop-filter: blur(6px); min-height: 0; }
.mods-head { grid-column: 1 / -1; display: flex; align-items: center; gap: 16px; padding: 14px 18px; }
.mods-head .ttl { flex: 1; }
.mods-kick { font-size: 12px; letter-spacing: .34em; color: #ffd34d; font-weight: 700; }
.mods-head h1 { margin: 2px 0 0; font-size: 30px; letter-spacing: .14em; }
.mods-head .set { font-family: var(--mono, monospace); font-size: 12px; color: #9fb0c2; letter-spacing: .08em; text-align: right; }
.mods-head .set b { display: block; color: #ffd34d; font-size: 16px; letter-spacing: .1em; font-family: var(--font, sans-serif); }
.mods-btn { height: 40px; padding: 0 18px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.05); color: #dfe8f2; font: inherit; font-size: 13px; font-weight: 700;
  letter-spacing: .16em; text-transform: uppercase; cursor: pointer; transition: all .15s; }
.mods-btn:hover { border-color: rgba(255,211,77,.6); color: #fff; }
.mods-btn.pri { background: linear-gradient(180deg, rgba(255,200,60,.95), rgba(220,150,30,.8)); color: #1a1200; border: 0; }
.mods-btn.sm { height: 30px; padding: 0 10px; font-size: 11px; letter-spacing: .1em; }
.mods-btn.danger:hover { border-color: #ff6a55; color: #ff8a7a; }
.mods-list { display: flex; flex-direction: column; gap: 10px; padding: 16px; overflow-y: auto; }
.mods-sec { font-size: 11px; letter-spacing: .3em; color: #8a99aa; margin: 6px 2px 0; display: flex; align-items: center; gap: 10px; }
.mods-sec::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.08); }
.mod-card { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center; padding: 12px 14px; border-radius: 12px; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.08); background: rgba(8,12,18,0.7); transition: border-color .15s, background .15s; }
.mod-card:hover { border-color: rgba(255,211,77,.45); }
.mod-card.sel { border-color: #ffd34d; background: rgba(255,200,60,.08); }
.mod-card.bad { border-color: rgba(255,90,70,.5); }
.mod-card .nm { font-size: 17px; font-weight: 700; letter-spacing: .06em; }
.mod-card .nm small { font-size: 11px; color: #8a99aa; font-weight: 600; letter-spacing: .12em; margin-left: 8px; }
.mod-card .ds { font-size: 12.5px; color: #9fb0c2; line-height: 1.4; margin-top: 3px; }
.mod-card .st { font-size: 11px; letter-spacing: .14em; margin-top: 5px; color: #7fdc8a; }
.mod-card .st.err { color: #ff8a7a; }
.mod-card .side { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.mod-card .ord { display: flex; gap: 4px; }
.mod-card .ord button { width: 26px; height: 22px; border-radius: 6px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04); color: #cfe; cursor: pointer; font-size: 11px; }
.mod-card .ord button:disabled { opacity: .3; cursor: default; }
.mod-sw { width: 46px; height: 26px; border-radius: 13px; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.06); position: relative; cursor: pointer; flex-shrink: 0; transition: background .2s; }
.mod-sw i { position: absolute; left: 3px; top: 3px; width: 18px; height: 18px; border-radius: 50%; background: #9fb0c2; transition: transform .2s, background .2s; }
.mod-sw.on { background: rgba(255,200,60,.35); border-color: #ffd34d; }
.mod-sw.on i { transform: translateX(20px); background: #ffd34d; }
.mod-sw:disabled { opacity: .35; cursor: not-allowed; }
.mods-empty { color: #8a99aa; font-size: 14px; padding: 18px; text-align: center; line-height: 1.5; border: 1px dashed rgba(255,255,255,.12); border-radius: 12px; }
.mods-detail { display: flex; flex-direction: column; padding: 16px 18px; overflow: hidden; }
.mods-detail h2 { margin: 0; font-size: 24px; letter-spacing: .1em; }
.mods-detail .by { font-size: 12px; color: #8a99aa; letter-spacing: .12em; margin: 2px 0 10px; }
.mods-detail p { color: #c8d6e4; font-size: 14px; line-height: 1.5; margin: 0 0 10px; }
.mods-changes { flex: 1; min-height: 0; overflow-y: auto; padding-right: 6px; }
.mods-changes h4 { margin: 12px 0 6px; font-size: 11px; letter-spacing: .28em; color: #ffd34d; }
.mods-row { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(90px, auto) auto; gap: 10px; align-items: baseline; padding: 5px 8px; border-radius: 6px; font-size: 13px; }
.mods-row:nth-child(even) { background: rgba(255,255,255,.03); }
.mods-row .who { color: #dfe8f2; }
.mods-row .fld { color: #8a99aa; font-family: var(--mono, monospace); font-size: 12px; }
.mods-row .val { font-family: var(--mono, monospace); font-size: 12px; white-space: nowrap; }
.mods-row .val s { color: #8a99aa; } .mods-row .val b { color: #ffd34d; font-weight: 600; } .mods-row .val i { font-style: normal; font-size: 9px; color: #8a99aa; margin-left: 3px; }
.mods-issue { font-size: 12.5px; padding: 6px 9px; border-radius: 7px; margin: 4px 0; line-height: 1.4; }
.mods-issue.e { background: rgba(255,80,60,.12); border: 1px solid rgba(255,80,60,.4); color: #ffb0a6; }
.mods-issue.w { background: rgba(255,200,60,.08); border: 1px solid rgba(255,200,60,.3); color: #f2e2b0; }
.mods-issue code { font-family: var(--mono, monospace); color: #fff; }
.mods-foot { display: flex; gap: 10px; padding-top: 12px; flex-wrap: wrap; }
.mods-help { font-size: 12px; color: #8a99aa; line-height: 1.5; margin-top: 8px; }
.mods-help code { font-family: var(--mono, monospace); color: #c8d6e4; }
`;

function injectCss() {
  if (document.getElementById('mods-ui-css')) return;
  const st = document.createElement('style');
  st.id = 'mods-ui-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const ONE: Record<TableName, 'unit' | 'building' | 'weapon' | 'warhead'> = { units: 'unit', buildings: 'building', weapons: 'weapon', warheads: 'warhead' };
const nameOf = (table: TableName, id: string, tables = pristineTables()) => {
  const e = tables[table][id] as { name?: string } | undefined;
  const name = e?.name ?? (table === 'units' ? UNITS[id]?.name : table === 'buildings' ? BUILDINGS[id]?.name : undefined);
  if (!name) return id;
  return table === 'units' || table === 'buildings' ? dt(table === 'units' ? 'unit' : 'building', id, 'name', name) : name; // (the base rules: game data)
};

/** A changed field's name in the player's language (the common gameplay fields; any other as written in the file). */
const fieldLabel = (field: string): string => (hasKey(`mods.field.${field}`) ? tx(`mods.field.${field}`) : field);

/** A checker message in the player's language (the engine's English when the code is unknown). */
export function issueText(e: ModIssue): string {
  const key = `mods.issue.${e.code}`;
  if (!e.code || !hasKey(key)) return e.message;
  const p: Record<string, string> = { ...(e.params ?? {}) };
  if (p.table && hasKey(`mods.tableWord.${p.table}`)) p.table = tx(`mods.tableWord.${p.table}`);
  if (p.why && hasKey(`mods.why.${p.why}`)) p.why = tx(`mods.why.${p.why}`);
  p.hint = e.suggest ? ` ${tMods('issue.didYouMean', { s: e.suggest })}` : '';
  return tx(key, p);
}

/** HTML of a translation with `{name}` parameters replaced by trusted markup (after escaping). */
function htmlWith(html: (params: Record<string, string>) => string, markup: Record<string, string>): string {
  const marks = Object.keys(markup);
  let out = html(Object.fromEntries(marks.map((k, i) => [k, `\u0000${i}\u0000`])));
  marks.forEach((k, i) => { out = out.split(`\u0000${i}\u0000`).join(markup[k]); });
  return out;
}

function changeRows(r: ModReport): string {
  const tables = pristineTables();
  let html = '';
  if (r.added.length) {
    html += `<h4>${tMods.html('changes.variants')}</h4>` + r.added.map((a) => `<div class="mods-row"><span class="who">${esc(a.name ?? a.id)}</span><span class="fld">${tMods.html('changes.copyOf', { id: a.id, name: nameOf(a.table, a.base, tables) })}</span><span class="val">${tMods.html(`table.${ONE[a.table]}`)}</span></div>`).join('');
  }
  for (const t of ['units', 'buildings', 'weapons', 'warheads'] as TableName[]) {
    const ch = r.changes.filter((c) => c.table === t);
    if (!ch.length) continue;
    html += `<h4>${tMods.html('changes.head', { table: tMods(`table.${t}`), n: ch.length })}</h4>`;
    html += ch.map((c) => {
      const dir = typeof c.from === 'number' && typeof c.to === 'number' ? (c.to > c.from ? '▲' : '▼') : '';
      return `<div class="mods-row"><span class="who">${esc(t === 'weapons' || t === 'warheads' ? c.id : nameOf(t, c.id, tables))}</span><span class="fld" title="${esc(c.field)}">${esc(fieldLabel(c.field))}</span><span class="val"><s>${esc(formatModValue(c.from))}</s> → <b>${esc(formatModValue(c.to))}</b><i>${dir}</i></span></div>`;
    }).join('');
  }
  return html || `<div class="mods-empty">${tMods.html('changes.none')}</div>`;
}

function issues(r: ModReport): string {
  return r.errors.map((e) => `<div class="mods-issue e"><code>${esc(e.path || 'mod')}</code> ${esc(issueText(e))}</div>`).join('')
    + r.warnings.map((w) => `<div class="mods-issue w"><code>${esc(w.path || 'mod')}</code> ${esc(issueText(w))}</div>`).join('');
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Read and validate a mod file; throws a user-facing (translated) message. */
export async function readModFile(file: File): Promise<ModFile> {
  if (file.size > 2 * 1024 * 1024) throw new Error(tMods('file.tooLarge'));
  let data: unknown;
  try { data = parseUntrustedJson(await file.text(), { maxChars: 2 << 20 }); } catch (e) {
    throw new Error(e instanceof UntrustedInputError ? e.message : tMods('file.invalidJson'));
  }
  const r = checkMods([data as ModFile]);
  if (!r.ok) throw new Error(r.errors.slice(0, 6).map((e) => `${e.path || 'mod'}: ${issueText(e)}`).join('\n'));
  return data as ModFile;
}

/** Bundled example mods (public/mods/index.json). */
async function fetchExamples(): Promise<ModFile[]> {
  try {
    const idx = await (await fetch(assetUrl('mods/index.json'))).json() as { mods: string[] }; // base-path helper
    const out: ModFile[] = [];
    for (const f of idx.mods ?? []) {
      try { out.push(await (await fetch(assetUrl(`mods/${f}`))).json() as ModFile); } catch { /* skip a broken example */ }
    }
    return out;
  } catch {
    return [];
  }
}

/** Open the Mods screen. Returns a function that closes it. */
export function showMods(opts: { onBack: () => void; play?: (k: 'click' | 'tab') => void }): () => void {
  injectCss();
  const root = document.createElement('div');
  root.className = 'mods';
  document.body.appendChild(root);
  let selected: string | null = enabledModIds()[0] ?? installedMods()[0]?.id ?? null;
  let examples: ModFile[] = [];
  let message: { text: string; bad: boolean } | null = null;
  let closed = false;
  const play = (k: 'click' | 'tab') => { try { opts.play?.(k); } catch { /* audio locked */ } };

  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey);
    root.remove();
  };
  const back = () => { play('click'); close(); opts.onBack(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); back(); } };
  window.addEventListener('keydown', onKey);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.onchange = async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    try {
      const mod = await readModFile(f);
      const replaced = installMod(mod);
      selected = mod.id;
      message = { text: tMods(replaced ? 'file.updated' : 'file.installed', { name: mod.name }), bad: false };
    } catch (e) {
      message = { text: (e as Error).message, bad: true };
    }
    render();
  };

  const render = () => {
    if (closed) return;
    const mods = installedMods();
    const enabled = enabledModIds();
    const set = activeModSet();
    const all = checkMods(enabled.map((id) => mods.find((m) => m.id === id)!).filter(Boolean));
    const sel = mods.find((m) => m.id === selected) ?? examples.find((m) => m.id === selected) ?? null;
    const selReport = sel ? checkMods([sel]) : null;
    const card = (m: ModFile, installed: boolean) => {
      const r = checkMods([m]);
      const on = enabled.includes(m.id);
      const i = enabled.indexOf(m.id);
      return `<div class="mod-card ${m.id === selected ? 'sel' : ''} ${r.ok ? '' : 'bad'}" data-id="${esc(m.id)}">
        ${installed ? `<button class="mod-sw ${on ? 'on' : ''}" data-act="toggle" title="${esc(tMods(on ? 'card.disable' : 'card.enable'))}" ${r.ok ? '' : 'disabled'}><i></i></button>` : '<span></span>'}
        <div><div class="nm">${esc(m.name)}<small>${esc(m.modVersion ? 'v' + m.modVersion : '')}${m.author ? ' · ' + esc(m.author) : ''}</small></div>
          <div class="ds">${esc((m.description ?? '').slice(0, 160))}${(m.description ?? '').length > 160 ? '…' : ''}</div>
          <div class="st ${r.ok ? '' : 'err'}">${r.ok ? (on ? tMods.html('card.changesActive', { n: r.changes.length + r.added.length, pos: String(i + 1) }) : tMods.html('card.changes', { n: r.changes.length + r.added.length })) : tMods.html('card.errors', { n: r.errors.length })}</div></div>
        <div class="side">${installed
          ? `${on && enabled.length > 1 ? `<span class="ord"><button data-act="up" ${i === 0 ? 'disabled' : ''} title="${esc(tMods('card.earlier'))}">▲</button><button data-act="down" ${i === enabled.length - 1 ? 'disabled' : ''} title="${esc(tMods('card.later'))}">▼</button></span>` : ''}
             <button class="mods-btn sm" data-act="export">${tMods.html('card.export')}</button><button class="mods-btn sm danger" data-act="remove">${tMods.html('card.remove')}</button>`
          : `<button class="mods-btn sm pri" data-act="install">${tMods.html('card.install')}</button>`}</div>
      </div>`;
    };
    const notInstalled = examples.filter((e) => !mods.some((m) => m.id === e.id));
    root.innerHTML = `
      <div class="mods-panel mods-head">
        <div class="ttl"><div class="mods-kick">${tMods.html('screen.kicker')}</div><h1>${tMods.html('screen.title')}</h1></div>
        <div class="set">${set ? `<b>${tMods.html('screen.active', { n: set.mods.length })}</b>${tMods.html('screen.ruleSet', { hash: set.hash.slice(0, 8).toUpperCase() })}` : enabled.length ? `<b style="color:#ff8a7a">${tMods.html('screen.conflict')}</b>${tMods.html('screen.conflictSub')}` : `<b>${tMods.html('screen.baseRules')}</b>${tMods.html('screen.noMods')}`}</div>
        <button class="mods-btn" data-act="import">${tMods.html('screen.import')}</button>
        <button class="mods-btn" data-act="back">${tCommon.html('back')}</button>
      </div>
      <div class="mods-panel mods-list">
        ${message ? `<div class="mods-issue ${message.bad ? 'e' : 'w'}" style="white-space:pre-line">${esc(message.text)}</div>` : ''}
        <div class="mods-sec">${tMods.html('screen.installed')}</div>
        ${mods.length ? mods.map((m) => card(m, true)).join('') : `<div class="mods-empty">${tMods.html('screen.empty')}<br>${htmlWith((p) => tMods.html('screen.emptyHint', p), { file: '<code>.rhmod.json</code>' })}</div>`}
        ${notInstalled.length ? `<div class="mods-sec">${tMods.html('screen.examples')}</div>${notInstalled.map((m) => card(m, false)).join('')}` : ''}
        <div class="mods-help">${tMods.html('screen.help')}
          ${htmlWith((p) => tMods.html('screen.format', p), { format: `<code>${esc('{ "id", "name", "units": { "2tnk": { "cost": 600 } }, "scale": [ … ] }')}</code>` })}</div>
      </div>
      <div class="mods-panel mods-detail">
        ${sel && selReport ? `<h2>${esc(sel.name.toUpperCase())}</h2><div class="by">${esc([sel.author, sel.modVersion ? 'v' + sel.modVersion : '', sel.id].filter(Boolean).join(' · ').toUpperCase())}</div>
          <p>${esc(sel.description ?? '')}</p>${issues(selReport)}<div class="mods-changes">${changeRows(selReport)}</div>`
          : `<h2>${tMods.html('screen.activeSet')}</h2><div class="by">${tMods.html('screen.enabled', { n: enabled.length })}</div>`}
        ${enabled.length > 1 ? `<div class="mods-changes" style="flex:0 0 auto;max-height:30%"><h4>${tMods.html('screen.combined', { n: enabled.length })}</h4>${issues(all)}<div class="mods-row"><span class="who">${tMods.html('screen.combinedSummary', { changes: all.changes.length, added: all.added.length })}</span><span class="fld">${tMods.html('screen.hash')}</span><span class="val">${esc(modSetHash(enabled.map((id) => mods.find((m) => m.id === id)!).filter(Boolean)).slice(0, 12))}</span></div></div>` : ''}
      </div>`;
    root.querySelectorAll<HTMLElement>('.mod-card').forEach((c) => {
      const id = c.dataset.id!;
      c.onclick = (e) => {
        const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
        const mod = mods.find((m) => m.id === id) ?? examples.find((m) => m.id === id);
        message = null;
        if (act === 'toggle') { setModEnabled(id, !enabled.includes(id)); play('tab'); }
        else if (act === 'up') moveMod(id, -1);
        else if (act === 'down') moveMod(id, 1);
        else if (act === 'remove') { if (confirm(tMods('card.confirmRemove', { name: mod?.name ?? id }))) { removeMod(id); if (selected === id) selected = null; } }
        else if (act === 'export' && mod) download(`${id}.rhmod.json`, JSON.stringify({ format: MOD_FORMAT, version: MOD_VERSION, ...mod }, null, 2));
        else if (act === 'install' && mod) { installMod(mod); setModEnabled(id, true); message = { text: tMods('file.installedEnabled', { name: mod.name }), bad: false }; play('click'); }
        selected = id;
        render();
      };
    });
    (root.querySelector('[data-act="import"]') as HTMLElement).onclick = () => fileInput.click();
    (root.querySelector('[data-act="back"]') as HTMLElement).onclick = back;
  };
  render();
  void fetchExamples().then((ex) => { examples = ex; if (!selected && ex[0]) selected = ex[0].id; render(); });
  return close;
}
