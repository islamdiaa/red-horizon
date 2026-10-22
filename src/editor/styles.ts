/** Editor styles (injected once; same design language as the menus: glass panels, accent colour). */
const CSS = `
.ed { position: fixed; inset: 0; z-index: 20; font-family: var(--font); color: var(--text); user-select: none; overflow: hidden; background: #03060a; }
.ed-canvas { position: absolute; inset: 0; width: 100vw; height: 100vh; display: block; }
.ed-3d-overlay { pointer-events: none; z-index: 1; }
.ed-hit { position: absolute; inset: 0; z-index: 2; touch-action: none; }
.ed.picking .ed-hit { cursor: crosshair; }
.ed-panel { position: absolute; z-index: 5; background: var(--glass); border: 1px solid var(--line-2); border-radius: 0.9rem; box-shadow: 0 1rem 3rem rgba(0,0,0,0.5); backdrop-filter: blur(6px); }
/* ---- top bar */
.ed-top { left: 0.8rem; right: 0.8rem; top: 0.7rem; height: 3.2rem; display: flex; align-items: center; gap: 0.5rem; padding: 0 0.7rem; }
.ed-brand { display: flex; flex-direction: column; line-height: 1; margin-right: 0.4rem; flex-shrink: 0; white-space: nowrap; }
.ed-brand small { font-size: 0.62rem; letter-spacing: 0.32em; color: rgb(var(--accent-rgb)); font-weight: 700; }
.ed-brand b { font-size: 1.15rem; letter-spacing: 0.16em; text-transform: uppercase; }
.ed-name { width: 13rem; min-width: 7rem; flex: 0 1 13rem; height: 2.1rem; border-radius: 0.5rem; border: 1px solid var(--line-2); background: rgba(0,0,0,0.3); color: #fff; font: inherit; font-size: 1rem; font-weight: 700; padding: 0 0.6rem; letter-spacing: 0.04em; }
.ed-name:focus { outline: none; border-color: rgb(var(--accent-rgb)); }
.ed-dirty { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--warn); box-shadow: 0 0 0.5rem var(--warn); opacity: 0; transition: opacity .2s; }
.ed-dirty.on { opacity: 1; }
.ed-sep { width: 1px; height: 1.8rem; background: var(--line-2); margin: 0 0.2rem; }
.ed-sp { flex: 1; }
.ed-b { height: 2.2rem; min-width: 2.2rem; padding: 0 0.7rem; border-radius: 0.5rem; border: 1px solid var(--line-2); background: rgba(255,255,255,0.04); color: var(--text-2);
  font-size: 0.82rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; transition: all .15s; white-space: nowrap; }
.ed-b svg { width: 1.05rem; height: 1.05rem; flex-shrink: 0; }
.ed-top > * { flex-shrink: 0; }
.ed-top > .ed-name, .ed-top > .ed-sp { flex-shrink: 1; }
.ed-top.compact .ed-b.lbl span { display: none; }
.ed-b:hover:not(:disabled) { color: #fff; border-color: rgba(var(--accent-rgb),0.6); background: rgba(var(--accent-rgb),0.12); }
.ed-b:disabled { opacity: 0.35; cursor: default; }
.ed-b.on { color: #fff; border-color: rgb(var(--accent-rgb)); background: rgba(var(--accent-rgb),0.25); box-shadow: inset 0 -2px 0 rgb(var(--accent-rgb)); }
.ed-b.pri { color: #04121e; background: linear-gradient(180deg, rgba(var(--accent-rgb),1), rgba(var(--accent-rgb),0.7)); border: 0; box-shadow: 0 0 1.2rem rgba(var(--accent-rgb),0.4); }
.ed-b.pri:hover { filter: brightness(1.12); color: #000; }
.ed-b.warn { color: var(--warn); }
.ed-seg { display: inline-flex; border: 1px solid var(--line-2); border-radius: 0.55rem; overflow: hidden; }
.ed-seg .ed-b { border: 0; border-radius: 0; }
/* ---- left tools */
.ed-tools { left: 0.8rem; top: 4.6rem; width: 4.6rem; padding: 0.45rem; display: flex; flex-direction: column; gap: 0.3rem; max-height: calc(100vh - 5.4rem); overflow-y: auto; }
.ed-tools h6 { margin: 0.35rem 0 0.05rem; font-size: 0.55rem; letter-spacing: 0.12em; color: var(--muted); text-align: center; font-weight: 700; text-transform: uppercase; overflow-wrap: anywhere; line-height: 1.15; }
.ed-tool { position: relative; height: 3.3rem; border-radius: 0.55rem; border: 1px solid var(--line); background: rgba(255,255,255,0.03); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.15rem;
  color: var(--text-2); font-size: 0.62rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; transition: all .12s; padding: 0; }
.ed-tool i { width: 1.35rem; height: 1.35rem; border-radius: 0.35rem; display: block; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18), 0 2px 6px rgba(0,0,0,0.4); }
.ed-tool svg { width: 1.35rem; height: 1.35rem; }
.ed-tool kbd { position: absolute; right: 0.2rem; top: 0.15rem; font-size: 0.5rem; padding: 0.05rem 0.2rem; border-bottom-width: 1px; opacity: 0.7; }
.ed-tool:hover { color: #fff; border-color: rgba(var(--accent-rgb),0.5); }
.ed-tool.on { color: #fff; border-color: rgb(var(--accent-rgb)); background: rgba(var(--accent-rgb),0.2); box-shadow: 0 0 0.8rem rgba(var(--accent-rgb),0.35); }
/* ---- tool options (floating under the top bar) */
.ed-opts { left: 6.1rem; top: 4.6rem; padding: 0.55rem 0.8rem; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; max-width: calc(100vw - 31rem); }
.ed-opt { display: flex; align-items: center; gap: 0.5rem; font-size: 0.78rem; color: var(--text-2); letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; }
.ed-opt input[type=range] { width: 7rem; accent-color: rgb(var(--accent-rgb)); }
.ed-opt output { font-family: var(--mono); color: #fff; min-width: 2.4rem; font-size: 0.8rem; text-transform: none; }
.ed-opt select, .ed-f select, .ed-f input, .ed-f textarea { height: 1.9rem; border-radius: 0.4rem; border: 1px solid var(--line-2); background: rgba(0,0,0,0.35); color: #fff; font: inherit; font-size: 0.85rem; padding: 0 0.4rem; }
.ed-opt select option, .ed-f select option { background: #0c1219; }
.ed-opt .ed-hint { text-transform: none; letter-spacing: 0.02em; font-weight: 600; color: var(--muted); font-size: 0.8rem; }
.ed-chk { display: inline-flex; align-items: center; gap: 0.4rem; cursor: pointer; white-space: nowrap; font-size: 0.85rem; color: var(--text-2); }
.ed-f .row > .ed-chk { flex: 0 1 auto; }
.ed-chk input { accent-color: rgb(var(--accent-rgb)); width: 1rem; height: 1rem; }
/* ---- right side panel */
.ed-side { right: 0.8rem; top: 4.6rem; bottom: 2.9rem; width: 23rem; display: flex; flex-direction: column; overflow: hidden; }
.ed-tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.25rem; padding: 0.45rem; border-bottom: 1px solid var(--line); }
.ed-tab { height: 2rem; border-radius: 0.45rem; border: 1px solid transparent; background: transparent; color: var(--muted); cursor: pointer; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; position: relative; }
.ed-tab:hover { color: #fff; }
.ed-tab.on { color: #fff; background: rgba(var(--accent-rgb),0.18); border-color: rgba(var(--accent-rgb),0.6); }
.ed-tab .badge { position: absolute; right: 0.25rem; top: 0.1rem; min-width: 1rem; height: 1rem; border-radius: 0.5rem; font-size: 0.6rem; line-height: 1rem; color: #000; background: var(--warn); padding: 0 0.2rem; letter-spacing: 0; }
.ed-tab .badge.err { background: var(--danger); color: #fff; }
.ed-body { flex: 1; min-height: 0; overflow-y: auto; padding: 0.7rem 0.85rem 1rem; }
.ed-h { margin: 0.9rem 0 0.45rem; font-size: 0.66rem; letter-spacing: 0.26em; color: rgb(var(--accent-rgb)); font-weight: 700; display: flex; align-items: center; gap: 0.5rem; text-transform: uppercase; }
.ed-h:first-child { margin-top: 0.1rem; }
.ed-h .ln { flex: 1; height: 1px; background: var(--line); }
.ed-h .ed-b { height: 1.6rem; font-size: 0.65rem; padding: 0 0.45rem; }
.ed-f { display: grid; grid-template-columns: 6.4rem 1fr; align-items: center; gap: 0.35rem 0.6rem; margin: 0.3rem 0; font-size: 0.85rem; }
.ed-f > label:first-child { color: var(--muted); font-size: 0.74rem; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; }
.ed-f input, .ed-f select { width: 100%; }
.ed-f textarea { width: 100%; height: 5.5rem; padding: 0.35rem; resize: vertical; line-height: 1.35; font-size: 0.85rem; }
.ed-f input:focus, .ed-f select:focus, .ed-f textarea:focus { outline: none; border-color: rgb(var(--accent-rgb)); }
.ed-f .row { display: flex; gap: 0.35rem; align-items: center; }
.ed-f .row > * { flex: 1; min-width: 0; }
.ed-note { font-size: 0.78rem; color: var(--muted); line-height: 1.4; margin: 0.3rem 0; }
.ed-card { border: 1px solid var(--line); border-radius: 0.6rem; background: rgba(0,0,0,0.22); padding: 0.45rem 0.55rem; margin: 0.4rem 0; }
.ed-card.sel { border-color: rgba(var(--accent-rgb),0.7); }
.ed-card-h { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; font-weight: 700; }
.ed-card-h .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ed-card-h .ed-b { height: 1.6rem; min-width: 1.6rem; padding: 0 0.35rem; font-size: 0.65rem; }
.ed-dot { width: 0.8rem; height: 0.8rem; border-radius: 50%; flex-shrink: 0; box-shadow: 0 0 0 2px rgba(255,255,255,0.25); }
.ed-check { display: grid; grid-template-columns: 1.3rem 1fr; gap: 0.1rem 0.4rem; padding: 0.4rem 0.45rem; border-radius: 0.45rem; margin: 0.2rem 0; font-size: 0.86rem; cursor: default; }
.ed-check.at { cursor: pointer; }
.ed-check.at:hover { background: rgba(255,255,255,0.05); }
.ed-check i { font-style: normal; font-weight: 800; text-align: center; }
.ed-check.ok i { color: var(--ok); } .ed-check.warning i { color: var(--warn); } .ed-check.error i { color: var(--danger); }
.ed-check small { grid-column: 2; color: var(--muted); font-size: 0.76rem; line-height: 1.35; }
.ed-ore { display: grid; grid-template-columns: 1.4rem 1fr 3.6rem; align-items: center; gap: 0.45rem; font-size: 0.8rem; margin: 0.25rem 0; }
.ed-ore .bar { height: 0.55rem; border-radius: 0.3rem; background: rgba(255,255,255,0.06); overflow: hidden; }
.ed-ore .bar b { display: block; height: 100%; border-radius: 0.3rem; }
.ed-ore span { font-family: var(--mono); text-align: right; color: var(--text-2); }
.ed-thumb { display: block; width: 100%; aspect-ratio: 1; border-radius: 0.6rem; border: 1px solid var(--line-2); image-rendering: auto; background: #000; }
.ed-verdict { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.7rem; border-radius: 0.6rem; margin-bottom: 0.4rem; font-weight: 700; letter-spacing: 0.06em; }
.ed-verdict.ok { background: rgba(var(--ok-rgb),0.1); border: 1px solid rgba(var(--ok-rgb),0.4); color: var(--ok); }
.ed-verdict.bad { background: rgba(var(--danger-rgb),0.1); border: 1px solid rgba(var(--danger-rgb),0.4); color: #ff9c90; }
.ed-verdict small { display: block; color: var(--text-2); font-weight: 600; letter-spacing: 0.02em; font-size: 0.78rem; margin-top: 0.1rem; }
/* ---- status bar */
.ed-status { left: 6.1rem; right: 24.6rem; bottom: 0.7rem; height: 1.8rem; display: flex; align-items: center; gap: 1.2rem; padding: 0 0.8rem; font-family: var(--mono); font-size: 0.78rem; color: var(--text-2); border-radius: 0.55rem; }
.ed-status b { color: #fff; font-weight: 400; }
.ed-status .msg { margin-left: auto; color: rgb(var(--accent-rgb)); font-family: var(--font); font-weight: 700; letter-spacing: 0.06em; }
.ed-busy { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 6; padding: 0.8rem 1.4rem; border-radius: 0.7rem; background: rgba(0,0,0,0.7); border: 1px solid var(--line-2); font-weight: 700; letter-spacing: 0.2em; font-size: 0.85rem; display: none; text-transform: uppercase; }
.ed-busy.on { display: block; }
.ed-toast { position: absolute; left: 50%; top: 4.6rem; transform: translateX(-50%); z-index: 9; padding: 0.55rem 1.1rem; border-radius: 0.6rem; background: rgba(8,14,20,0.92); border: 1px solid rgba(var(--accent-rgb),0.6); font-weight: 700; letter-spacing: 0.06em; font-size: 0.9rem;
  box-shadow: 0 0.6rem 2rem rgba(0,0,0,0.5); animation: edToast 2.6s ease forwards; pointer-events: none; white-space: pre-line; text-align: center; }
.ed-toast.bad { border-color: var(--danger); color: #ffb0a6; }
@keyframes edToast { 0% { opacity: 0; transform: translate(-50%, -0.5rem); } 8%, 82% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; } }
/* ---- dialogs */
.ed-modal { position: absolute; inset: 0; z-index: 10; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; animation: edFade .2s ease; }
@keyframes edFade { from { opacity: 0; } to { opacity: 1; } }
.ed-dlg { position: relative; width: min(56rem, 92vw); max-height: 88vh; display: flex; flex-direction: column; padding: 1rem 1.2rem; }
.ed-dlg.sm { width: min(30rem, 92vw); }
.ed-dlg h2 { margin: 0 0 0.2rem; font-size: 1.4rem; letter-spacing: 0.14em; text-transform: uppercase; }
.ed-dlg .kick { font-size: 0.65rem; letter-spacing: 0.3em; color: rgb(var(--accent-rgb)); font-weight: 700; text-transform: uppercase; }
.ed-dlg .x { position: absolute; right: 0.8rem; top: 0.8rem; }
.ed-dlg .foot { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.9rem; }
.ed-lib { display: grid; grid-template-columns: repeat(auto-fill, minmax(12.5rem, 1fr)); gap: 0.7rem; overflow-y: auto; padding: 0.3rem 0.1rem; min-height: 8rem; }
.ed-lib-card { border: 1px solid var(--line); border-radius: 0.7rem; background: rgba(0,0,0,0.25); overflow: hidden; display: flex; flex-direction: column; cursor: pointer; transition: border-color .15s, transform .15s; }
.ed-lib-card:hover { border-color: rgba(var(--accent-rgb),0.7); transform: translateY(-2px); }
.ed-lib-card img { width: 100%; aspect-ratio: 1; display: block; background: #000; }
.ed-lib-card .meta { padding: 0.45rem 0.55rem; }
.ed-lib-card b { display: block; font-size: 0.95rem; letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ed-lib-card small { color: var(--muted); font-size: 0.72rem; letter-spacing: 0.06em; }
.ed-lib-card .acts { display: flex; gap: 0.3rem; padding: 0 0.5rem 0.5rem; }
.ed-lib-card .acts .ed-b { height: 1.7rem; font-size: 0.62rem; padding: 0 0.4rem; flex: 1; }
.ed-pill { display: inline-block; font-size: 0.6rem; letter-spacing: 0.14em; font-weight: 800; padding: 0.12rem 0.35rem; border-radius: 0.3rem; background: rgba(var(--accent-rgb),0.2); color: rgb(var(--accent-rgb)); margin-left: 0.3rem; vertical-align: 0.1rem; text-transform: uppercase; }
.ed-pill.gold { background: rgba(var(--gold-rgb),0.18); color: var(--gold); }
.ed-menu { position: absolute; z-index: 11; min-width: 15rem; padding: 0.35rem; display: flex; flex-direction: column; gap: 0.2rem; }
.ed-menu .ed-b { justify-content: flex-start; height: auto; padding: 0.5rem 0.7rem; text-align: left; flex-direction: column; align-items: flex-start; gap: 0.1rem; }
.ed-menu .ed-b small { text-transform: none; letter-spacing: 0.02em; font-weight: 600; color: var(--muted); font-size: 0.74rem; }
.ed-help { position: absolute; left: 6.1rem; bottom: 2.9rem; z-index: 4; font-size: 0.74rem; color: var(--muted); padding: 0.5rem 0.7rem; line-height: 1.6; }
.ed-help kbd { margin: 0 0.1rem; }
`;

export function injectEditorCss() {
  if (document.getElementById('ed-css')) return;
  const st = document.createElement('style');
  st.id = 'ed-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}
