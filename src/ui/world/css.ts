/** World Conquest screen styles (injected once with the chunk). Prefix: wc-. */
const CSS = `
.wc { position: fixed; inset: 0; z-index: 22; overflow: hidden; font-family: var(--font, sans-serif); color: #dfe8f2; --side-w: 352px; --top-h: 58px;
  background: radial-gradient(ellipse at 42% 46%, #0d1b2a 0%, #050b12 55%, #010204 100%); animation: wcIn .4s ease-out; }
.wc::before { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .55;
  background-image: radial-gradient(1px 1px at 12% 18%, #fff8, transparent), radial-gradient(1px 1px at 72% 12%, #fff6, transparent), radial-gradient(1px 1px at 33% 82%, #fff5, transparent),
    radial-gradient(1px 1px at 88% 64%, #fff7, transparent), radial-gradient(1.5px 1.5px at 52% 30%, #fff4, transparent), radial-gradient(1px 1px at 6% 58%, #fff6, transparent), radial-gradient(1px 1px at 94% 90%, #fff5, transparent); }
@keyframes wcIn { from { opacity: 0; } to { opacity: 1; } }
.wc-stage { position: absolute; left: 0; top: 0; bottom: 0; right: var(--side-w); }
.wc-stage .wg-globe { cursor: grab; }
.wc-stage .wg-globe:active { cursor: grabbing; }
.wc-panel { background: linear-gradient(180deg, rgba(20,28,38,0.93), rgba(8,11,16,0.95)); border: 1px solid rgba(255,255,255,0.09); border-radius: 14px; box-shadow: 0 18px 50px rgba(0,0,0,0.55); }
.wc-kick { font-size: 11px; letter-spacing: .32em; color: rgb(var(--accent-rgb, 90,180,255)); font-weight: 700; text-transform: uppercase; }
.wc-h1 { margin: 2px 0 6px; font-size: 26px; letter-spacing: .12em; line-height: 1.08; text-transform: uppercase; }
.wc-h4 { margin: 14px 0 7px; font-size: 11px; letter-spacing: .28em; color: rgb(var(--accent-rgb, 90,180,255)); text-transform: uppercase; font-weight: 700; }
.wc-p { font-size: 14px; line-height: 1.45; color: #c2d0de; margin: 6px 0; }
.wc-small { font-size: 12.5px; color: #9fb0c2; line-height: 1.4; }
.wc-btn { min-height: 42px; padding: 0 16px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.15); cursor: pointer; font: inherit; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; font-size: 12.5px;
  color: #dfe8f2; background: rgba(8,12,18,0.88); display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: transform .12s, border-color .15s, background .15s; position: relative; text-align: center; line-height: 1.15; }
.wc-btn:hover:not(:disabled) { border-color: rgba(var(--accent-rgb, 90,180,255),0.75); color: #fff; }
.wc-btn:active:not(:disabled) { transform: translateY(1px); }
.wc-btn:focus-visible, .wc-row:focus-visible, .wc-home:focus-visible, .wc-seg button:focus-visible, .wc-card:focus-visible { outline: 2px solid rgb(var(--accent-rgb, 90,180,255)); outline-offset: 2px; }
.wc-btn .mx-ic, .wc-btn svg { width: 18px; height: 18px; flex-shrink: 0; }
.wc-btn.pri { border: 0; color: #fff; background: linear-gradient(180deg, rgba(var(--accent-rgb, 90,180,255),0.95), rgba(var(--accent-rgb, 90,180,255),0.6)); box-shadow: 0 0 22px rgba(var(--accent-rgb, 90,180,255),0.35); font-size: 14px; min-height: 48px; letter-spacing: .2em; }
.wc-btn.gold { border-color: rgba(255,211,77,0.6); color: #ffe7a3; background: linear-gradient(180deg, rgba(120,90,10,0.55), rgba(40,30,4,0.7)); }
.wc-btn.gold.pri { color: #1a1306; background: linear-gradient(180deg, #ffe08a, #e0a83a); box-shadow: 0 0 24px rgba(255,200,80,0.4); }
.wc-btn.danger { border-color: rgba(255,90,70,0.55); color: #ffb4a6; }
.wc-btn.ghost { background: transparent; }
.wc-btn.sm { min-height: 34px; padding: 0 11px; font-size: 11px; letter-spacing: .12em; }
.wc-btn.icon { width: 42px; padding: 0; }
.wc-btn:disabled { opacity: .42; cursor: not-allowed; }
.wc-btn em { position: absolute; top: -7px; right: -7px; min-width: 19px; height: 19px; padding: 0 5px; border-radius: 10px; background: #ffd34d; color: #1a1408; font-style: normal; font-size: 11px; letter-spacing: 0; display: grid; place-items: center; font-family: var(--mono, monospace); }
.wc-row2 { display: flex; gap: 8px; flex-wrap: wrap; }
.wc-row2 > .wc-btn { flex: 1 1 0; min-width: 0; }
.wc-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); color: #d4e0ec; letter-spacing: .04em; }
.wc-chip .mx-ic { width: 14px; height: 14px; }
.wc-chip.gold { color: #ffe08a; border-color: rgba(255,211,77,0.35); }
.wc-chip.red { color: #ffb0a0; border-color: rgba(255,90,70,0.45); }
.wc-chip.green { color: #b9ffcf; border-color: rgba(120,255,160,0.4); }
.wc-sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.4); }
/* --- top bar --- */
.wc-top { position: absolute; left: 10px; right: calc(var(--side-w) + 10px); top: 10px; display: flex; align-items: center; gap: 10px; pointer-events: none; z-index: 3; }
.wc-top > * { pointer-events: auto; }
.wc-turn { display: flex; align-items: center; gap: 10px; padding: 6px 12px 6px 8px; min-width: 0; flex-shrink: 0; }
.wc-turn .emb { width: 40px; height: 30px; flex-shrink: 0; }
.wc-turn .emb svg { width: 100%; height: 100%; }
.wc-turn b { display: block; font-size: 17px; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; }
.wc-turn small { display: block; font-size: 10px; letter-spacing: .26em; color: #8a99aa; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
.wc-steps { display: flex; align-items: center; gap: 0; padding: 4px; }
.wc-step { display: flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 9px; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: #6f7f90; font-weight: 700; white-space: nowrap; }
.wc-step i { font-style: normal; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; background: rgba(255,255,255,0.07); font-family: var(--mono, monospace); letter-spacing: 0; }
.wc-step.on { color: #fff; background: rgba(var(--accent-rgb, 90,180,255),0.22); }
.wc-step.on i { background: rgb(var(--accent-rgb, 90,180,255)); color: #04101c; }
.wc-step.done { color: #9fb0c2; }
.wc-step.done i { background: rgba(120,255,160,0.25); color: #b9ffcf; }
.wc-stats { display: flex; gap: 6px; margin-left: auto; }
.wc-stat { display: flex; align-items: center; gap: 7px; padding: 5px 10px; min-width: 0; }
.wc-stat .mx-ic { width: 17px; height: 17px; color: rgb(var(--accent-rgb, 90,180,255)); flex-shrink: 0; }
.wc-stat small { display: block; font-size: 9px; letter-spacing: .22em; color: #8a99aa; text-transform: uppercase; white-space: nowrap; }
.wc-stat b { display: block; font-family: var(--mono, monospace); font-size: 15px; color: #eef4fa; white-space: nowrap; }
.wc-tools { display: flex; gap: 6px; }
.wc-tools .wc-btn { min-height: 40px; }
/* --- side panel --- */
.wc-side { position: absolute; right: 10px; top: 10px; bottom: 10px; width: calc(var(--side-w) - 10px); display: flex; flex-direction: column; min-height: 0; z-index: 3; }
.wc-side-h { padding: 14px 16px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.wc-side-b { flex: 1 1 auto; overflow-y: auto; padding: 10px 16px; min-height: 0; overscroll-behavior: contain; }
.wc-side-f { padding: 10px 16px 14px; border-top: 1px solid rgba(255,255,255,0.06); display: flex; flex-direction: column; gap: 8px; }
.wc-big { font-family: var(--mono, monospace); font-size: 44px; line-height: 1; color: #fff; text-shadow: 0 0 20px rgba(var(--accent-rgb, 90,180,255),0.5); }
.wc-lines { display: flex; flex-direction: column; gap: 3px; margin: 6px 0; }
.wc-line { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; color: #b8c8d8; padding: 2px 0; border-bottom: 1px dashed rgba(255,255,255,0.06); }
.wc-line b { font-family: var(--mono, monospace); color: #ffe08a; white-space: nowrap; }
.wc-ter { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 11px; background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.07); margin: 8px 0; min-width: 0; }
.wc-ter .tn { flex: 1; min-width: 0; }
.wc-ter b { display: block; font-size: 17px; letter-spacing: .06em; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wc-ter small { display: block; font-size: 11.5px; color: #9fb0c2; letter-spacing: .06em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wc-ter small.wc-start { white-space: normal; overflow: visible; line-height: 1.3; margin-top: 2px; }
.wc-ter .tr { font-family: var(--mono, monospace); font-size: 22px; color: #fff; min-width: 36px; text-align: right; }
.wc-ter img { width: 40px; height: 40px; object-fit: contain; flex-shrink: 0; }
.wc-vs { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 8px; align-items: center; margin: 6px 0; }
.wc-vs > div { padding: 8px 10px; border-radius: 10px; background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.07); min-width: 0; }
.wc-vs > div:last-child { text-align: right; }
.wc-vs b { display: block; font-size: 13.5px; letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wc-vs span { font-family: var(--mono, monospace); font-size: 22px; color: #fff; }
.wc-vs small { display: block; font-size: 11px; color: #9fb0c2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wc-vs i { font-style: normal; color: #ffd34d; width: 22px; height: 22px; display: block; }
.wc-vs i svg { width: 100%; height: 100%; }
.wc-stepper { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
.wc-stepper .wc-btn { width: 46px; min-height: 46px; padding: 0; font-size: 22px; letter-spacing: 0; }
.wc-stepper output { flex: 1; text-align: center; font-family: var(--mono, monospace); font-size: 30px; color: #fff; }
.wc-range { width: 100%; accent-color: rgb(var(--accent-rgb, 90,180,255)); height: 28px; }
.wc-odds { margin: 8px 0; padding: 12px; border-radius: 12px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); }
.wc-odds .pct { font-family: var(--mono, monospace); font-size: 40px; line-height: 1; }
.wc-odds .pct.good { color: #8dffb0; } .wc-odds .pct.mid { color: #ffe08a; } .wc-odds .pct.bad { color: #ff9a86; }
.wc-meter { height: 10px; border-radius: 6px; overflow: hidden; display: flex; background: rgba(255,255,255,0.06); margin: 6px 0 4px; }
.wc-meter i { display: block; height: 100%; }
.wc-legend { display: flex; justify-content: space-between; gap: 6px; font-size: 11px; color: #9fb0c2; flex-wrap: wrap; }
.wc-legend span { display: inline-flex; align-items: center; gap: 5px; }
.wc-gives { margin: 8px 0 0; padding: 10px 12px; border-radius: 11px; border: 1px solid rgba(255,211,77,0.3); background: linear-gradient(180deg, rgba(80,60,8,0.35), rgba(20,15,4,0.4)); }
.wc-gives b { display: block; font-size: 11px; letter-spacing: .24em; color: #ffd34d; text-transform: uppercase; margin-bottom: 5px; }
.wc-gives div { font-size: 12.5px; color: #f2e6c2; display: flex; gap: 7px; align-items: center; line-height: 1.5; }
.wc-gives div::before { content: '★'; color: #ffd34d; font-size: 10px; }
.wc-sugg { display: flex; flex-direction: column; gap: 5px; }
.wc-sugg button { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.25); color: inherit; font: inherit; font-size: 13px; cursor: pointer; text-align: left; min-height: 40px; }
.wc-sugg button:hover { border-color: rgba(var(--accent-rgb, 90,180,255),0.6); }
.wc-sugg button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wc-sugg button b { font-family: var(--mono, monospace); flex-shrink: 0; }
.wc-bars { display: inline-flex; gap: 2px; align-items: flex-end; vertical-align: middle; margin: 0 4px; }
.wc-bars i { width: 4px; border-radius: 1px; background: rgba(255,255,255,0.18); }
.wc-bars i:nth-child(1) { height: 6px; } .wc-bars i:nth-child(2) { height: 9px; } .wc-bars i:nth-child(3) { height: 12px; }
.wc-conts button .wc-bars { margin: 0 5px 0 0; }
.wc-sugg button.wc-hint { border-color: #ffd34d; box-shadow: 0 0 12px rgba(255,211,77,0.35); color: #ffe7a3; }
.wc-warn { padding: 8px 10px; border-radius: 9px; border: 1px solid rgba(255,90,70,0.45); background: rgba(80,10,5,0.35); color: #ffc0b4; font-size: 12.5px; margin: 6px 0; }
.wc-note { padding: 8px 10px; border-radius: 9px; border: 1px solid rgba(var(--accent-rgb, 90,180,255),0.35); background: rgba(var(--accent-rgb, 90,180,255),0.08); font-size: 12.5px; margin: 6px 0; color: #d4e6f8; }
/* --- prompt, tooltip, banner, toasts --- */
.wc-prompt { position: absolute; left: 50%; top: calc(var(--top-h) + 18px); transform: translateX(-50%); z-index: 2; padding: 7px 16px; border-radius: 18px; background: rgba(6,10,14,0.85);
  border: 1px solid rgba(var(--accent-rgb, 90,180,255),0.4); font-size: 13px; letter-spacing: .06em; pointer-events: none; width: max-content; max-width: min(560px, calc(100% - 30px)); text-align: center; }
.wc-tip { position: absolute; z-index: 4; pointer-events: none; padding: 6px 10px; border-radius: 8px; background: rgba(4,8,12,0.92); border: 1px solid rgba(255,255,255,0.14); font-size: 12.5px; white-space: nowrap; transform: translate(14px, -50%); }
.wc-tip b { letter-spacing: .08em; text-transform: uppercase; }
.wc-tip small { display: block; color: #9fb0c2; font-size: 11px; }
.wc-banner { position: absolute; left: calc((100% - var(--side-w)) / 2); top: 34%; transform: translate(-50%, -50%); z-index: 5; pointer-events: none; text-align: center; animation: wcBanner 1.6s ease-in-out forwards; }
.wc-banner small { display: block; font-size: 12px; letter-spacing: .4em; color: rgb(var(--accent-rgb, 90,180,255)); text-transform: uppercase; }
.wc-banner b { display: block; font-size: 40px; letter-spacing: .16em; color: #fff; text-shadow: 0 0 30px rgba(var(--accent-rgb, 90,180,255),0.7), 0 2px 8px #000; text-transform: uppercase; }
@keyframes wcBanner { 0% { opacity: 0; transform: translate(-50%, -40%); } 15%, 75% { opacity: 1; transform: translate(-50%, -50%); } 100% { opacity: 0; transform: translate(-50%, -58%); } }
.wc-play { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 5; display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 16px; }
.wc-play .who { display: flex; align-items: center; gap: 8px; font-size: 14px; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; max-width: 46vw; overflow: hidden; text-overflow: ellipsis; }
.wc-toasts { position: absolute; left: 12px; bottom: 12px; z-index: 6; display: flex; flex-direction: column; gap: 6px; pointer-events: none; max-width: min(420px, calc(100% - var(--side-w) - 30px)); }
.wc-toast { padding: 8px 12px; border-radius: 10px; background: rgba(6,10,14,0.9); border: 1px solid rgba(255,255,255,0.14); font-size: 13px; animation: wcToast 3.4s ease-in-out forwards; }
.wc-toast.good { border-color: rgba(120,255,160,0.45); color: #c9ffd9; } .wc-toast.bad { border-color: rgba(255,90,70,0.55); color: #ffc0b4; } .wc-toast.gold { border-color: rgba(255,211,77,0.5); color: #ffe7a3; }
@keyframes wcToast { 0% { opacity: 0; transform: translateY(8px); } 8%, 82% { opacity: 1; transform: none; } 100% { opacity: 0; } }
/* the rivals' turns: your panel and phases wait */
.wc-playing .wc-side, .wc-playing .wc-steps { opacity: .45; pointer-events: none; transition: opacity .2s; }
/* --- modals --- */
.wc-modal { position: fixed; inset: 0; z-index: 41; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); animation: wcIn .2s ease-out; font-family: var(--font, sans-serif); color: #dfe8f2; padding: 12px; }
.wc-dlg { width: min(720px, 100%); max-height: calc(100vh - 24px); overflow-y: auto; padding: 20px 22px; position: relative; overscroll-behavior: contain; }
.wc-dlg.narrow { width: min(500px, 100%); }
.wc-dlg.wide { width: min(980px, 100%); }
.wc-dlg .acts { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; margin-top: 16px; }
.wc-x { position: absolute; right: 12px; top: 12px; width: 40px; height: 40px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #9fb0c2; cursor: pointer; font-size: 20px; line-height: 1; }
.wc-x:hover { color: #fff; border-color: rgba(var(--accent-rgb, 90,180,255),0.6); }
.wc-tbl { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.wc-tbl th { text-align: left; font-size: 10px; letter-spacing: .2em; color: #8a99aa; font-weight: 600; padding: 4px 6px; text-transform: uppercase; white-space: nowrap; }
.wc-tbl td { padding: 8px 6px; border-top: 1px solid rgba(255,255,255,0.06); vertical-align: middle; }
.wc-tbl td.n { font-family: var(--mono, monospace); text-align: right; white-space: nowrap; }
.wc-pw { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wc-pw b { display: block; letter-spacing: .06em; }
.wc-pw small { display: block; color: #9fb0c2; font-size: 11.5px; }
.wc-pw.dead { opacity: .5; text-decoration: line-through; }
.wc-rivals { display: flex; flex-direction: column; gap: 8px; }
.wc-rival { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; padding: 10px 12px; border-radius: 12px; background: rgba(0,0,0,0.26); border: 1px solid rgba(255,255,255,0.07); border-left: 4px solid var(--pc, #888); }
.wc-rival .nums { display: flex; gap: 14px; font-family: var(--mono, monospace); font-size: 13px; color: #d4e0ec; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.wc-rival .nums span { display: inline-flex; gap: 5px; align-items: center; }
.wc-rival .nums small { font-family: var(--font, sans-serif); font-size: 9.5px; letter-spacing: .18em; color: #8a99aa; text-transform: uppercase; }
.wc-rival .rel { grid-column: 1 / -1; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: space-between; }
.wc-cards { display: flex; gap: 10px; flex-wrap: wrap; margin: 10px 0; }
.wc-card { width: 92px; height: 128px; border-radius: 11px; border: 1px solid rgba(255,255,255,0.18); background: linear-gradient(180deg, #1d2a3a, #0b1118); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; cursor: pointer; color: inherit; font: inherit; transition: transform .15s, border-color .15s, box-shadow .15s; padding: 6px; }
.wc-card svg { width: 46px; height: 46px; color: #ffe08a; }
.wc-card span { font-size: 11px; letter-spacing: .16em; text-transform: uppercase; text-align: center; }
.wc-card.on { border-color: #ffd34d; box-shadow: 0 0 18px rgba(255,211,77,0.45); transform: translateY(-6px); }
.wc-card.infantry { background: linear-gradient(180deg, #24331f, #0b1108); } .wc-card.armour { background: linear-gradient(180deg, #33281a, #110c06); } .wc-card.air { background: linear-gradient(180deg, #1c2a3d, #080e17); }
.wc-log { display: flex; flex-direction: column; gap: 4px; }
.wc-log h5 { margin: 10px 0 2px; font-size: 10.5px; letter-spacing: .3em; color: rgb(var(--accent-rgb, 90,180,255)); text-transform: uppercase; }
.wc-le { display: flex; gap: 8px; font-size: 13px; line-height: 1.35; color: #b8c8d8; align-items: flex-start; }
.wc-le .wc-sw { margin-top: 3px; }
.wc-le.good { color: #c9ffd9; } .wc-le.bad { color: #ffc0b4; } .wc-le.gold { color: #ffe7a3; }
/* --- dice --- */
.wc-dice { position: absolute; left: calc((100% - var(--side-w)) / 2); top: 50%; transform: translate(-50%, -50%); z-index: 8; padding: 16px 20px; display: flex; flex-direction: column; align-items: center; gap: 10px; cursor: pointer; min-width: 280px; }
.wc-dice .rows { display: grid; grid-template-columns: auto auto; gap: 10px 16px; align-items: center; }
.wc-dice .lbl { font-size: 11px; letter-spacing: .24em; text-transform: uppercase; color: #9fb0c2; text-align: right; }
.wc-dice .set { display: flex; gap: 8px; }
.wc-die { width: 46px; height: 46px; border-radius: 10px; position: relative; display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); padding: 7px; box-shadow: inset 0 -3px 0 rgba(0,0,0,0.3), 0 4px 10px rgba(0,0,0,0.5); }
.wc-die.att { background: linear-gradient(180deg, #ff6a50, #b8301e); }
.wc-die.def { background: linear-gradient(180deg, #f2f5f8, #b8c2cc); }
.wc-die i { width: 8px; height: 8px; border-radius: 50%; place-self: center; background: #fff; }
.wc-die.def i { background: #1a2430; }
.wc-die.roll { animation: wcRoll .5s cubic-bezier(.3,.7,.4,1); }
@keyframes wcRoll { 0% { transform: rotate(-200deg) scale(.5) translateY(-30px); opacity: 0; } 60% { transform: rotate(14deg) scale(1.08); opacity: 1; } 100% { transform: none; } }
.wc-die.lost { opacity: .35; filter: grayscale(.8); }
.wc-die.won::after { content: ''; position: absolute; inset: -4px; border-radius: 13px; border: 2px solid #8dffb0; box-shadow: 0 0 12px rgba(120,255,160,0.6); }
.wc-dice .res { font-size: 15px; letter-spacing: .1em; text-transform: uppercase; display: flex; gap: 14px; }
.wc-dice .res .a { color: #ffb0a0; } .wc-dice .res .d { color: #c9ffd9; }
.wc-dice .skip { font-size: 10.5px; letter-spacing: .24em; color: #7c8b9b; text-transform: uppercase; }
.wc-dice .big { font-size: 26px; letter-spacing: .2em; color: #8dffb0; text-shadow: 0 0 16px rgba(120,255,160,0.6); text-transform: uppercase; font-weight: 800; }
.wc-dice .big.bad { color: #ff9a86; text-shadow: 0 0 16px rgba(255,90,70,0.6); }
/* --- coach --- */
.wc-coach { position: absolute; left: 12px; bottom: 14px; z-index: 7; max-width: min(460px, calc(100% - var(--side-w) - 34px)); display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 12px;
  background: linear-gradient(180deg, rgba(30,40,20,0.95), rgba(12,16,8,0.96)); border: 1px solid rgba(255,211,77,0.5); box-shadow: 0 10px 30px rgba(0,0,0,0.6), 0 0 18px rgba(255,211,77,0.15); animation: wcIn .3s ease-out; }
.wc-coach .ic { width: 26px; height: 26px; color: #ffd34d; flex-shrink: 0; }
.wc-coach .ic svg { width: 100%; height: 100%; }
.wc-coach .k { font-size: 10.5px; letter-spacing: .26em; color: #ffd34d; text-transform: uppercase; font-weight: 700; }
.wc-coach .t { font-size: 14px; line-height: 1.4; color: #f4ecd2; margin-top: 2px; }
.wc-coach .wc-btn { min-height: 34px; margin-top: 8px; }
.wc-glow { box-shadow: 0 0 0 2px #ffd34d, 0 0 22px rgba(255,211,77,0.6) !important; animation: wcGlow 1.4s ease-in-out infinite; }
@keyframes wcGlow { 50% { box-shadow: 0 0 0 2px #ffd34d, 0 0 6px rgba(255,211,77,0.3) !important; } }
/* --- list view --- */
.wc-list { position: absolute; inset: 0; overflow-y: auto; padding: calc(var(--top-h) + 18px) 16px 16px; background: rgba(3,6,10,0.94); z-index: 2; }
.wc-list section { margin-bottom: 12px; }
.wc-list h3 { margin: 6px 0; font-size: 12px; letter-spacing: .26em; color: rgb(var(--accent-rgb, 90,180,255)); text-transform: uppercase; display: flex; gap: 8px; align-items: center; }
.wc-row { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 10px; min-height: 44px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); color: inherit; font: inherit; font-size: 14px; text-align: left; cursor: pointer; margin: 3px 0; }
.wc-row:hover { border-color: rgba(var(--accent-rgb, 90,180,255),0.5); }
.wc-row.sel { border-color: #fff; background: rgba(var(--accent-rgb, 90,180,255),0.18); }
.wc-row.target { border-color: rgba(255,236,170,0.6); }
.wc-row.dim { opacity: .55; }
.wc-row .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: .04em; }
.wc-row .ow { font-size: 12px; color: #9fb0c2; white-space: nowrap; max-width: 40%; overflow: hidden; text-overflow: ellipsis; }
.wc-row .tr { font-family: var(--mono, monospace); min-width: 34px; text-align: right; font-size: 16px; }
.wc-sr { position: absolute !important; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
/* --- setup --- */
.wc.wc-setup { --side-w: 420px; }
.wc-search { width: 100%; height: 42px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.35); color: #fff; font: inherit; font-size: 15px; padding: 0 12px; }
.wc-search:focus { outline: none; border-color: rgba(var(--accent-rgb, 90,180,255),0.7); }
.wc-conts { display: flex; gap: 5px; flex-wrap: wrap; margin: 8px 0; }
.wc-conts button { min-height: 32px; padding: 0 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.25); color: #9fb0c2; font: inherit; font-size: 11.5px; letter-spacing: .1em; cursor: pointer; text-transform: uppercase; }
.wc-conts button.on { color: #fff; border-color: rgb(var(--accent-rgb, 90,180,255)); background: rgba(var(--accent-rgb, 90,180,255),0.2); }
.wc-homes { display: flex; flex-direction: column; gap: 6px; }
.wc-home { display: block; width: 100%; text-align: left; padding: 10px 12px; border-radius: 11px; border: 1px solid rgba(255,255,255,0.09); background: rgba(0,0,0,0.25); color: inherit; font: inherit; cursor: pointer; min-height: 48px; }
.wc-home:hover { border-color: rgba(var(--accent-rgb, 90,180,255),0.55); }
.wc-home.on { border-color: rgb(var(--accent-rgb, 90,180,255)); background: linear-gradient(180deg, rgba(var(--accent-rgb, 90,180,255),0.2), rgba(0,0,0,0.3)); }
.wc-home .hd { display: flex; align-items: center; gap: 8px; }
.wc-home .hd b { flex: 1; font-size: 16px; letter-spacing: .08em; text-transform: uppercase; min-width: 0; overflow-wrap: anywhere; line-height: 1.15; }
.wc-home .hd small { font-size: 11px; color: #8a99aa; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; }
.wc-home .more { margin-top: 6px; font-size: 13px; color: #c2d0de; line-height: 1.45; }
.wc-home .more .wc-chip { margin: 4px 4px 0 0; }
.wc-weekly { display: flex; gap: 8px 12px; align-items: center; flex-wrap: wrap; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(255,211,77,0.4); background: linear-gradient(120deg, rgba(90,66,10,0.5), rgba(10,8,2,0.4) 70%); margin-bottom: 10px; }
.wc-weekly .wk { flex: 1 1 200px; min-width: 0; }
.wc-weekly .wc-btn { flex: 1 1 auto; }
.wc-weekly b { display: block; font-size: 15px; letter-spacing: .14em; color: #ffe7a3; text-transform: uppercase; }
.wc-weekly small { display: block; font-size: 12px; color: #d8caa0; }
.wc-facs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.wc-fac { position: relative; min-height: 84px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.12); cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 8px 12px; color: inherit; font: inherit; text-align: left; }
.wc-fac.allies { background: linear-gradient(135deg, rgba(61,123,224,0.35), rgba(8,12,18,0.95) 70%); }
.wc-fac.soviet { background: linear-gradient(135deg, rgba(210,58,44,0.38), rgba(8,12,18,0.95) 70%); }
.wc-fac.on { border-color: #fff; box-shadow: 0 0 0 1px #fff; }
.wc-fac .emb { width: 54px; height: 40px; flex-shrink: 0; }
.wc-fac .emb svg { width: 100%; height: 100%; }
.wc-fac > div { min-width: 0; }
.wc-fac b { font-size: 15px; letter-spacing: .1em; display: block; text-transform: uppercase; overflow-wrap: anywhere; }
.wc-fac span { font-size: 11.5px; color: #b8c8d8; line-height: 1.3; display: block; }
.wc-seg { display: flex; border-radius: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.14); flex-wrap: wrap; }
.wc-seg button { flex: 1 1 0; min-height: 40px; padding: 0 8px; border: 0; background: rgba(0,0,0,0.3); color: #9fb0c2; font: inherit; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; cursor: pointer; min-width: 0; }
.wc-seg button + button { border-left: 1px solid rgba(255,255,255,0.08); }
.wc-seg button.on { background: rgba(var(--accent-rgb, 90,180,255),0.32); color: #fff; }
.wc-seg button:disabled:not(.on), .wc-fac:disabled:not(.on) { opacity: .45; cursor: not-allowed; }
.wc-seg button:disabled, .wc-fac:disabled { cursor: default; }
.wc-toggle { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 6px 0; }
.wc-toggle input { width: 20px; height: 20px; margin: 2px 0 0; accent-color: rgb(var(--accent-rgb, 90,180,255)); flex-shrink: 0; }
.wc-seed { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.wc-seed input { width: 130px; height: 40px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.14); background: rgba(0,0,0,0.35); color: #fff; font-family: var(--mono, monospace); font-size: 15px; padding: 0 10px; }
.wc-recs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.wc-recs div { padding: 7px 9px; border-radius: 9px; background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.06); min-width: 0; }
.wc-recs small { display: block; font-size: 9px; letter-spacing: .14em; color: #8a99aa; text-transform: uppercase; line-height: 1.2; overflow-wrap: anywhere; }
.wc-recs b { font-family: var(--mono, monospace); font-size: 15px; }
/* --- endings --- */
.wc-end { text-align: center; }
.wc-end h1 { margin: 6px 0 4px; font-size: 44px; letter-spacing: .18em; line-height: 1.05; text-transform: uppercase; color: #ffe7a3; text-shadow: 0 0 34px rgba(255,200,80,0.55); }
.wc-end.lose h1 { color: #ff9a86; text-shadow: 0 0 30px rgba(255,80,60,0.5); }
.wc-end h3 { margin: 0 0 12px; font-size: 14px; letter-spacing: .24em; color: #b8c8d8; text-transform: uppercase; font-weight: 600; }
.wc-end .tot { font-family: var(--mono, monospace); font-size: 46px; color: #fff; }
.wc-end .wc-lines { text-align: left; max-width: 440px; margin: 10px auto; }
.wc-end-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px 22px; align-items: center; }
.wc-medals { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin: 8px 0; }
.wc-share-img { width: 100%; height: auto; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); display: block; }
/* --- responsive --- */
@media (max-width: 1440px) { .wc-stat small, .wc-turn small { display: none; } .wc-step:not(.on) span { display: none; } .wc-stat { padding: 5px 9px; } }
@media (max-width: 1100px) { .wc { --side-w: 316px; } .wc-step span { display: none; } .wc.wc-setup { --side-w: 360px; } }
@media (max-width: 900px) { .wc-turn .emb { display: none; } .wc-tools .wc-btn.icon { width: 38px; } .wc-top { gap: 6px; } }
@media (max-height: 700px) { .wc-setup .wc-intro { display: none; } }
@media (max-width: 860px) { .wc-stats { display: none; } .wc-turn small { max-width: 110px; } }
/* portrait phones and narrow windows: the panel becomes a bottom sheet */
@media (max-aspect-ratio: 4/5), (max-width: 620px) {
  .wc { --side-w: 0px; --sheet-h: 44vh; }
  .wc-stage { right: 0; bottom: var(--sheet-h); }
  .wc .wc-side { left: 0; right: 0; top: auto; bottom: 0; width: auto; height: var(--sheet-h); border-radius: 16px 16px 0 0; border-bottom: 0; }
  .wc.wc-setup { --side-w: 0px; --sheet-h: 56vh; }
  .wc.wc-tall { --sheet-h: 58vh; }
  .wc-side-f { gap: 6px; }
  .wc-minor .wc-btn { min-height: 36px; font-size: 11px; }
  .wc-top { right: 10px; flex-wrap: wrap; gap: 6px; }
  .wc-steps { order: 3; width: 100%; justify-content: center; }
  .wc-step { padding: 5px 8px; }
  .wc-step span { display: inline; }
  .wc-tools { margin-left: auto; }
  .wc-tools .wc-btn { min-height: 42px; }
  .wc-turn { padding: 4px 10px 4px 6px; }
  .wc-turn .emb { width: 30px; height: 24px; }
  .wc-prompt { top: auto; bottom: 10px; font-size: 12.5px; }
  .wc-banner, .wc-dice { left: 50%; }
  .wc-setup .wc-intro { display: none; }
  .wc-dice { top: calc((100% - var(--sheet-h)) / 2 + 30px); }
  .wc-banner { top: 30%; } .wc-banner b { font-size: 28px; }
  .wc-play { bottom: 12px; }
  .wc-coach { left: 8px; right: 8px; max-width: none; bottom: calc(var(--sheet-h) + 8px); }
  .wc-toasts { bottom: calc(var(--sheet-h) + 8px); max-width: calc(100% - 24px); }
  .wc-h1 { font-size: 21px; }
  .wc-end h1 { font-size: 30px; }
  .wc-side-h { padding: 10px 14px 6px; }
  .wc-side-b { padding: 8px 14px; }
  .wc-side-f { padding: 8px 14px 10px; }
  .wc-big { font-size: 34px; }
}
/* landscape phones: a slim top bar, a narrow side panel */
@media (max-height: 460px) and (min-aspect-ratio: 4/5) {
  .wc { --side-w: 300px; --top-h: 44px; }
  .wc.wc-setup { --side-w: 340px; }
  .wc-top { top: 6px; left: 6px; }
  .wc-turn small, .wc-stats { display: none; }
  .wc-step { padding: 4px 8px; }
  .wc-step span { display: none; }
  .wc-tools .wc-btn { min-height: 38px; }
  .wc-side { top: 6px; bottom: 6px; right: 6px; }
  .wc-side-h { padding: 8px 12px 4px; }
  .wc-side-b { padding: 6px 12px; }
  .wc-side-f { padding: 6px 12px 8px; gap: 6px; }
  .wc-h1 { font-size: 18px; }
  .wc-big { font-size: 30px; }
  .wc-btn.pri { min-height: 42px; }
  .wc-side-f .wc-btn { min-height: 38px; }
  .wc-minor .wc-btn { min-height: 34px; font-size: 11px; }
  .wc-prompt { top: auto; bottom: 10px; }
  .wc-coach { bottom: 8px; }
  .wc-dlg { padding: 14px 16px; }
  .wc-end h1 { font-size: 28px; }
  .wc-end-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .wc-end .tot { font-size: 34px; }
  .wc-end .acts { margin-top: 8px; }
}
@media (prefers-reduced-motion: reduce) { .wc, .wc-banner, .wc-toast, .wc-die.roll, .wc-coach, .wc-glow { animation: none !important; } }
body.reduce-motion .wc, body.reduce-motion .wc-banner, body.reduce-motion .wc-toast, body.reduce-motion .wc-die.roll, body.reduce-motion .wc-coach, body.reduce-motion .wc-glow { animation: none !important; }
html:not([lang='en']) .wc-btn { letter-spacing: .08em; }
html:not([lang='en']) .wc-step, html:not([lang='en']) .wc-h4, html:not([lang='en']) .wc-kick { letter-spacing: .14em; }
`;

export function injectCss() {
  if (document.getElementById('wc-style')) return;
  const st = document.createElement('style');
  st.id = 'wc-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}
