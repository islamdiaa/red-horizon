/** Styles for the game-mode UIs (replay moment panel, King of the Hill HUD, challenges). Injected once. */
const CSS = `
/* ---------- shared ---------- */
.mx-overlay { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; background: radial-gradient(ellipse at 50% 45%, rgba(0,0,0,.35), rgba(0,0,0,.78) 75%);
  animation: mxIn .25s ease-out; font-family: var(--font); color: var(--text); }
.mx-overlay.leaving { animation: mxOut .2s ease-in forwards; }
@keyframes mxIn { from { opacity: 0; } }
@keyframes mxOut { to { opacity: 0; } }
@keyframes mxUp { from { opacity: 0; transform: translateY(.8rem); } }
.mx-panel { position: relative; width: min(58rem, 94vw); max-height: 92vh; overflow-y: auto; border-radius: 1rem; padding: 1.1rem 1.3rem 1.2rem; animation: mxUp .35s var(--ease) both; scrollbar-width: thin; }
.mx-head { display: flex; align-items: center; gap: .8rem; margin-bottom: .9rem; }
.mx-head .mx-ic { font-size: 1.7rem; color: var(--accent); filter: drop-shadow(0 0 8px rgba(var(--accent-rgb), .7)); display: flex; }
.mx-head small { display: block; font-size: .64rem; font-weight: 700; letter-spacing: .32em; text-transform: uppercase; color: var(--accent); }
.mx-head h2 { margin: 0; font-size: 1.45rem; letter-spacing: .14em; text-transform: uppercase; color: #fff; }
.mx-head .mx-x { margin-left: auto; }
.mx-x { width: 2.2rem; height: 2.2rem; border-radius: .5rem; border: 1px solid var(--line-2); background: rgba(255,255,255,.04); color: var(--text-2); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1rem; }
.mx-x:hover { color: #fff; border-color: rgba(var(--danger-rgb), .7); background: rgba(var(--danger-rgb), .25); }
.mx-tabs { display: flex; gap: .4rem; margin-bottom: .9rem; border-bottom: 1px solid var(--line); }
.mx-tab { flex: 0 0 auto; display: flex; align-items: center; gap: .45rem; padding: .55rem .9rem; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--muted); cursor: pointer;
  font-size: .85rem; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; }
.mx-tab:hover { color: var(--text); }
.mx-tab.on { color: #fff; border-bottom-color: var(--accent); }
.mx-sec { font-size: .62rem; font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: var(--muted); margin: .85rem 0 .45rem; display: flex; align-items: center; gap: .5rem; }
.mx-sec::after { content: ''; flex: 1; height: 1px; background: var(--line); }
.mx-note { font-size: .8rem; color: var(--text-2); line-height: 1.4; }
.mx-note b { color: #fff; }
.mx-note.bad { color: #ff8a7a; }
.mx-row { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
.mx-chip { height: 2.2rem; padding: 0 .8rem; border-radius: .5rem; border: 1px solid var(--line-2); background: rgba(255,255,255,.04); color: var(--text-2); cursor: pointer;
  font-size: .78rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; display: inline-flex; align-items: center; gap: .4rem; transition: all .15s; }
.mx-chip:hover { color: #fff; border-color: rgba(var(--accent-rgb), .6); }
.mx-chip.on { color: #fff; border-color: rgba(var(--accent-rgb), .9); background: rgba(var(--accent-rgb), .22); box-shadow: 0 0 .8rem rgba(var(--accent-rgb), .25); }
.mx-chip:disabled { opacity: .35; cursor: default; }
.mx-input, .mx-select { height: 2.3rem; border-radius: .5rem; border: 1px solid var(--line-2); background: rgba(0,0,0,.35); color: #fff; font: inherit; font-size: .9rem; padding: 0 .7rem; min-width: 0; }
.mx-input { flex: 1; }
.mx-select { max-width: 100%; }
.mx-input:focus, .mx-select:focus { outline: none; border-color: rgba(var(--accent-rgb), .8); }
.mx-actions { display: flex; gap: .6rem; margin-top: 1.1rem; }
.mx-actions .btn-primary { flex: 1.4; height: 3rem; font-size: 1.05rem; letter-spacing: .3em; }
.mx-actions .btn { flex: 1; height: 3rem; }
.mx-stars { color: var(--gold); letter-spacing: .1em; white-space: nowrap; }
.mx-stars i { font-style: normal; color: rgba(255,255,255,.18); }

/* ---------- replay: this moment ---------- */
.mo-players { display: grid; grid-template-columns: repeat(auto-fill, minmax(12.5rem, 1fr)); gap: .5rem; }
.mo-pl { position: relative; display: grid; grid-template-columns: 2.4rem 1fr; gap: .1rem .6rem; align-items: center; padding: .55rem .7rem; border-radius: .7rem; cursor: pointer; text-align: left;
  border: 1px solid var(--line-2); background: linear-gradient(90deg, rgba(255,255,255,.05), rgba(0,0,0,.2)); color: var(--text); transition: all .15s; }
.mo-pl::before { content: ''; position: absolute; left: 0; top: .5rem; bottom: .5rem; width: 3px; border-radius: 2px; background: var(--c); box-shadow: 0 0 8px var(--c); }
.mo-pl:hover { border-color: rgba(var(--accent-rgb), .6); }
.mo-pl.on { border-color: var(--c); background: linear-gradient(90deg, color-mix(in srgb, var(--c) 28%, transparent), rgba(0,0,0,.2)); box-shadow: 0 0 1.1rem color-mix(in srgb, var(--c) 35%, transparent); }
.mo-pl.dead { opacity: .4; cursor: default; }
.mo-pl .em { grid-row: span 2; width: 2.4rem; height: 2.4rem; }
.mo-pl .em svg { width: 100%; height: 100%; }
.mo-pl b { font-size: .95rem; letter-spacing: .06em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mo-pl small { font-size: .72rem; color: var(--muted); display: flex; gap: .55rem; font-family: var(--mono); }
.mo-pl em { position: absolute; top: .35rem; right: .5rem; font-style: normal; font-size: .58rem; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: var(--gold); }
.mo-goal { display: grid; grid-template-columns: repeat(5, 1fr); gap: .45rem; }
.mo-goal button { height: 3.6rem; flex-direction: column; justify-content: center; gap: .15rem; }
.mo-goal button small { font-size: .6rem; letter-spacing: .08em; text-transform: none; font-weight: 500; color: var(--muted); }
.mo-params { display: flex; flex-direction: column; gap: .5rem; margin-top: .6rem; min-height: 2.4rem; }
.rp-btn.rp-take { width: auto; padding: 0 .7rem; gap: .35rem; font-size: .72rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--gold); border-color: rgba(var(--gold-rgb), .45); }
.rp-btn.rp-take svg { font-size: 1rem; }
.rp-btn.rp-take:hover { background: rgba(var(--gold-rgb), .18); border-color: rgba(var(--gold-rgb), .8); color: #fff; }
.rp-pre { position: absolute; left: 0; top: 0; bottom: 0; border-radius: inherit; pointer-events: none;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.14) 0 3px, transparent 3px 7px); border-right: 2px solid var(--gold); }
.rp-branchtag { color: var(--gold) !important; }

/* ---------- King of the Hill HUD ---------- */
.koth-hud { position: absolute; top: calc(var(--edge) + 3.3rem); left: 50%; transform: translateX(calc(-50% - var(--sidebar-w) / 2)); z-index: 6; pointer-events: none !important;
  width: 19rem; padding: .5rem .7rem .55rem; border-radius: .75rem; font-family: var(--font); color: var(--text); animation: mxUp .5s var(--ease) both; }
body.cine-active .koth-hud { opacity: 0; }
.kh-head { display: flex; align-items: center; gap: .45rem; font-size: .66rem; font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: var(--gold); }
.kh-head svg { font-size: .95rem; }
.kh-head small { margin-left: auto; font-size: .62rem; letter-spacing: .12em; color: var(--muted); }
.kh-state { display: flex; align-items: center; gap: .45rem; margin: .3rem 0 .4rem; font-size: .9rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #fff; }
.kh-state i { width: .65rem; height: .65rem; border-radius: 50%; background: var(--c, #9aa); box-shadow: 0 0 .5rem var(--c, #9aa); flex-shrink: 0; }
.kh-state.contested { color: #ffb43c; }
.kh-state.contested i { --c: #ff9a2a; animation: khPulse .5s ease-in-out infinite alternate; }
.kh-state.neutral { color: var(--text-2); }
@keyframes khPulse { to { opacity: .25; transform: scale(1.4); } }
.kh-rows { display: flex; flex-direction: column; gap: .22rem; }
.kh-row { display: grid; grid-template-columns: .55rem minmax(0, 6.5rem) 1fr 2.6rem; gap: .45rem; align-items: center; font-size: .78rem; }
.kh-row i { width: .55rem; height: .55rem; border-radius: 2px; background: var(--c); }
.kh-row .nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-2); }
.kh-row.me .nm { color: #fff; font-weight: 700; }
.kh-row.dead { opacity: .4; }
.kh-row .bar { position: relative; height: .42rem; border-radius: 1rem; background: rgba(255,255,255,.08); overflow: hidden; }
.kh-row .bar b { position: absolute; inset: 0 auto 0 0; border-radius: 1rem; background: var(--c); box-shadow: 0 0 .5rem var(--c); transition: width .25s linear; }
.kh-row.holding .bar b { animation: khGlow .9s ease-in-out infinite alternate; }
@keyframes khGlow { to { filter: brightness(1.6); } }
.kh-row .t { font-family: var(--mono); font-size: .78rem; text-align: right; color: #fff; }

/* ---------- branch / challenge badge (in game) ---------- */
.mode-badge { position: absolute; top: calc(var(--edge) + 3.3rem); right: calc(var(--sidebar-w) + var(--edge) + .6rem); z-index: 6; pointer-events: none !important; display: flex; align-items: center; gap: .5rem;
  padding: .35rem .65rem; border-radius: .6rem; font-family: var(--font); font-size: .72rem; letter-spacing: .14em; text-transform: uppercase; color: var(--gold); animation: mxUp .5s var(--ease) both; }
.mode-badge svg { font-size: 1rem; }
.mode-badge small { color: var(--text-2); letter-spacing: .06em; text-transform: none; font-size: .74rem; }
body.cine-active .mode-badge { opacity: 0; }
#topbar .mode-chip { border-color: rgba(var(--gold-rgb), .45); }
#topbar .mode-chip .obj-ic, #topbar .mode-chip small { color: var(--gold); }
#topbar .mode-chip b { max-width: 16rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- challenges list ---------- */
.chx { position: fixed; inset: 0; z-index: 22; display: flex; flex-direction: column; gap: .9rem; padding: 4vh 4vw 3.4vh; font-family: var(--font); color: var(--text);
  background: radial-gradient(ellipse at 30% 30%, rgba(255,200,80,.07), transparent 55%), radial-gradient(ellipse at 50% 40%, rgba(0,0,0,.35), rgba(0,0,0,.88) 75%); animation: mxIn .35s ease-out; }
.chx.leaving { animation: mxOut .25s ease-in forwards; }
.chx-top { display: flex; align-items: flex-end; gap: 1rem; }
.chx-top h1 { margin: 0; font-size: 2rem; letter-spacing: .2em; text-transform: uppercase; color: #fff; }
.chx-top small { display: block; font-size: .7rem; font-weight: 700; letter-spacing: .34em; text-transform: uppercase; color: var(--gold); }
.chx-top .sp { flex: 1; }
.chx-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 1rem; padding-right: .3rem; scrollbar-width: thin; }
.chx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(21rem, 1fr)); gap: .7rem; }
.chx-card { position: relative; display: flex; flex-direction: column; gap: .35rem; padding: .85rem 1rem .8rem; border-radius: .85rem; border: 1px solid var(--line-2);
  background: linear-gradient(160deg, rgba(255,255,255,.055), rgba(0,0,0,.25)); animation: mxUp .4s calc(var(--i) * 40ms) var(--ease) both; transition: border-color .15s, transform .15s; }
.chx-card:hover { border-color: rgba(var(--gold-rgb), .5); transform: translateY(-2px); }
.chx-card .k { display: flex; align-items: center; gap: .45rem; font-size: .6rem; font-weight: 700; letter-spacing: .26em; text-transform: uppercase; color: var(--gold); }
.chx-card .k em { font-style: normal; color: var(--muted); letter-spacing: .12em; }
.chx-card h3 { margin: 0; font-size: 1.2rem; letter-spacing: .1em; text-transform: uppercase; color: #fff; }
.chx-card p { margin: 0; font-size: .82rem; color: var(--text-2); line-height: 1.35; min-height: 2.2em; }
.chx-stats { display: flex; gap: 1rem; margin-top: .2rem; }
.chx-stats span small { display: block; font-size: .54rem; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: var(--muted); }
.chx-stats span b { font-family: var(--mono); font-weight: 400; font-size: .98rem; color: #fff; }
.chx-stats span.pb b { color: var(--gold); }
.chx-acts { display: flex; gap: .4rem; margin-top: .45rem; }
.chx-acts .btn { height: 2.3rem; font-size: .74rem; padding: 0 .8rem; }
.chx-acts .btn.go { flex: 1; color: #fff; border-color: rgba(var(--gold-rgb), .6); background: linear-gradient(180deg, rgba(var(--gold-rgb), .32), rgba(var(--gold-rgb), .1)); }
.chx-acts .rpl-btn { width: 2.3rem; height: 2.3rem; }
.chx-empty { padding: 1.4rem; border: 1px dashed var(--line-2); border-radius: .8rem; color: var(--muted); font-size: .88rem; line-height: 1.5; }
.chx-empty b { color: var(--text); }
.chx-foot { display: flex; align-items: center; gap: .8rem; }
.chx-foot .note { flex: 1; font-size: .8rem; color: var(--muted); }
.chx-foot .note.bad { color: #ff8a7a; }

/* ---------- challenge result ---------- */
.chr { width: min(40rem, 94vw); text-align: center; }
.chr .chr-k { font-size: .72rem; font-weight: 700; letter-spacing: .36em; text-transform: uppercase; color: var(--gold); }
.chr h1 { margin: .2rem 0 .1rem; font-size: 2.6rem; letter-spacing: .28em; text-transform: uppercase; color: #fff; }
.chr.lose h1 { color: #ff8a7a; }
.chr .chr-reason { color: var(--text-2); font-size: .9rem; }
.chr .chr-stars { font-size: 2.2rem; margin: .4rem 0; }
.chr table { width: 100%; border-collapse: collapse; margin: .6rem 0; font-size: .9rem; }
.chr td { padding: .3rem .4rem; border-bottom: 1px solid var(--line); text-align: left; color: var(--text-2); }
.chr td:last-child { text-align: right; font-family: var(--mono); color: #fff; }
.chr tr.total td { color: #fff; font-weight: 700; border-bottom: 0; font-size: 1.05rem; }
.chr tr.total td:last-child { color: var(--gold); font-size: 1.3rem; }
.chr .chr-pb { display: inline-flex; gap: .5rem; align-items: center; padding: .3rem .8rem; border-radius: 1rem; font-size: .78rem; letter-spacing: .16em; text-transform: uppercase;
  border: 1px solid rgba(var(--gold-rgb), .5); color: var(--gold); background: rgba(var(--gold-rgb), .1); }
.chr .chr-pb.new { animation: khGlow .7s ease-in-out infinite alternate; }
.chr .mx-actions { flex-wrap: wrap; }
.chr .mx-actions .btn-primary { flex: 1 1 100%; }

/* ---------- end screen: suggested moments ---------- */
.mom-offers { width: min(64rem, 92vw); margin: 0 auto 1rem; padding: .7rem .9rem; border-radius: .9rem; animation: mxUp .6s 1.2s var(--ease) both; }
.mom-offers .mom-h { display: flex; align-items: center; gap: .5rem; font-size: .66rem; font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: var(--gold); margin-bottom: .5rem; }
.mom-offers .mom-h small { color: var(--muted); letter-spacing: .1em; text-transform: none; font-weight: 500; font-size: .75rem; }
.mom-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: .5rem; }
.mom-card { display: flex; flex-direction: column; gap: .3rem; padding: .6rem .75rem; border-radius: .7rem; border: 1px solid var(--line-2); background: rgba(255,255,255,.04); text-align: left; }
.mom-card .t { display: flex; justify-content: space-between; gap: .5rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #fff; font-size: .9rem; }
.mom-card .t em { font-style: normal; font-family: var(--mono); color: var(--gold); font-size: .8rem; letter-spacing: 0; }
.mom-card p { margin: 0; color: var(--text-2); font-size: .78rem; line-height: 1.35; }
.mom-card .a { display: flex; gap: .4rem; margin-top: .2rem; }
.mom-card .a .btn { height: 2rem; font-size: .68rem; padding: 0 .7rem; flex: 1; }
.mom-card .a .btn.saved { color: var(--ok); border-color: rgba(var(--ok-rgb), .5); }

/* ---------- replays: branch trees ---------- */
.rpl-row.branch { margin-left: calc(var(--d, 1) * 1.5rem); position: relative; grid-template-columns: 5.2rem 4.6rem minmax(9rem, 1.2fr) minmax(10rem, 1.6fr) 4.6rem auto; }
.rpl-row.branch::before { content: ''; position: absolute; left: -1rem; top: -0.4rem; width: .75rem; height: calc(50% + .4rem); border-left: 2px solid rgba(var(--gold-rgb), .45); border-bottom: 2px solid rgba(var(--gold-rgb), .45); border-bottom-left-radius: .4rem; }
.rpl-row.branch .rpl-res { color: var(--gold); border-color: rgba(var(--gold-rgb), .45); background: rgba(var(--gold-rgb), .08); }
.rpl-row.branch.res-victory .rpl-res { color: var(--ok); }
.rpl-row.branch.res-defeat .rpl-res { color: #ff8a7a; }
.rpl-row .rpl-orphan { color: var(--warn); }
.rpl-btn.cont { color: var(--gold); border-color: rgba(var(--gold-rgb), .45); }
.rpl-btn:disabled { opacity: .3; cursor: default; }
.rpl-pl.me b { color: #fff; }
.rpl-tag { color: var(--accent-hi); text-transform: uppercase; letter-spacing: .1em; font-size: .64rem; }
.rpl-tag.mod { color: var(--warn); }

/* ---------- challenges hub additions ---------- */
.coop-sw { display: inline-flex; gap: .2rem; margin-left: .6rem; pointer-events: auto; }
.coop-sw button { height: 1.6rem; padding: 0 .5rem; border-radius: .35rem; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04); color: var(--muted, #7d8c9d); cursor: pointer;
  font: inherit; font-size: .6rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
.coop-sw button.on { color: #fff; border-color: rgba(120,210,120,.7); background: rgba(120,210,120,.2); }
.coop-sw button:hover { color: #fff; }
`;

export function ensureModesCss() {
  if (document.getElementById('modes-style')) return;
  const st = document.createElement('style');
  st.id = 'modes-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}
