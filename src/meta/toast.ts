/**
 * Medal / promotion toasts (top-centre, queued) and the post-battle XP summary card.
 * Self-contained DOM with injected CSS; safe to call from anywhere (no-ops without a document).
 */
import { insigniaSvg, picto } from './art';
import { moneyShort, type ContractProgress } from './contracts';
import { fmtInt } from '../i18n/core';
import tMeta from '../i18n/en/meta';

export interface ToastInfo {
  title: string;
  desc: string;
  /** Medal or insignia markup (inline SVG). */
  icon: string;
  xp: number;
  kind?: 'medal' | 'rank' | 'contract' | 'unlock'; // contract complete / cosmetic unlocked
  /** e.g. "Silver" or "Legendary". */
  tier?: string;
  rarity?: 'common' | 'rare' | 'epic' | 'legendary';
}

export interface XpSummary {
  xp: number;
  lines: { label: string; xp: number }[];
  xpBefore: number;
  xpAfter: number;
  rankBefore: number;
  rankAfter: number;
  rankName: string;
  nextName: string | null;
  fracBefore: number;
  fracAfter: number;
  intoAfter: number;
  spanAfter: number;
  faction: string;
  medals: number;
  won: boolean;
  dailyScore?: number;
  // contracts, Commendations and unlocks (src/meta/contracts.ts, unlocks.ts)
  contracts?: ContractProgress[];
  /** Commendations earned in this battle / balance after it. */
  commendations?: number;
  commendationBalance?: number;
  /** Cosmetics this battle unlocked. */
  unlocks?: { id: string; name: string; slot: string }[];
  /** The unlock that was being chased when the battle began, if this battle earned it. */
  unlockedTeaser?: { id: string; name: string; slot: string } | null;
  /** The next unlock to chase ("2 more wins → Arctic White paint"), with progress before / after. */
  teaser?: { id: string; text: string; frac: number; before: number } | null;
}

const CSS = `
.rhx-toasts { position: fixed; top: 5.6rem; left: 50%; transform: translateX(-50%); z-index: 9000; pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: .6rem;
  font-family: var(--font, 'Rajdhani', 'Segoe UI', sans-serif); }
.rhx-t { --c: 255, 207, 63; --c2: 255, 150, 40; position: relative; display: flex; align-items: center; gap: 1.05rem; width: 31rem; max-width: 92vw; padding: .7rem 1.25rem .8rem .85rem; border-radius: .95rem;
  background: radial-gradient(ellipse at 12% 50%, rgba(var(--c), .2), transparent 55%), linear-gradient(180deg, rgba(26, 24, 20, .95), rgba(8, 9, 10, .95));
  border: 1px solid rgba(var(--c), .5); overflow: hidden; color: #f4f1ea;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .65), 0 1.4rem 3rem rgba(0, 0, 0, .55), 0 0 2.6rem rgba(var(--c), .22), inset 0 1px 0 rgba(255, 255, 255, .14);
  animation: rhxIn .75s cubic-bezier(.2, 1.35, .3, 1) both; }
.rhx-t.common { --c: 222, 150, 92; --c2: 160, 90, 40; }
.rhx-t.rare { --c: 160, 205, 255; --c2: 90, 140, 230; }
.rhx-t.epic { --c: 255, 207, 63; --c2: 255, 140, 30; }
.rhx-t.legendary { --c: 190, 150, 255; --c2: 110, 210, 255; border-image: linear-gradient(100deg, #b48cff, #7fd3ff, #ffcf3f, #b48cff) 1; }
.rhx-t.rank { --c: 255, 120, 80; --c2: 255, 207, 63; width: 33rem; padding: .85rem 1.4rem .95rem 1rem;
  background: radial-gradient(ellipse at 14% 50%, rgba(255, 110, 60, .28), transparent 58%), linear-gradient(180deg, rgba(34, 18, 14, .96), rgba(10, 7, 6, .96)); }
.rhx-t.contract { --c: 110, 235, 170; --c2: 60, 190, 140; }
.rhx-t.unlock { --c: 120, 200, 255; --c2: 190, 150, 255; }
.rhx-t.contract .rhx-medal > svg, .rhx-t.unlock .rhx-medal > svg { width: 2.6rem; height: 2.6rem; color: rgb(var(--c)); }
.rhx-t.out { animation: rhxOut .45s ease-in forwards; }
@keyframes rhxIn { from { opacity: 0; transform: translateY(-1.8rem) scale(.86); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes rhxOut { to { opacity: 0; transform: translateY(-1.2rem) scale(.95); } }
.rhx-t::before { content: ''; position: absolute; top: -20%; bottom: -20%; width: 34%; left: -45%; pointer-events: none;
  background: linear-gradient(100deg, transparent, rgba(255, 246, 220, .05) 30%, rgba(255, 246, 220, .38) 50%, rgba(255, 246, 220, .05) 70%, transparent); transform: skewX(-20deg);
  animation: rhxShine 1.25s .5s cubic-bezier(.3, .1, .2, 1) both; }
.rhx-t::after { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(var(--c), .9), transparent); }
@keyframes rhxShine { to { left: 130%; } }
.rhx-medal { position: relative; width: 4.1rem; height: 5.1rem; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.rhx-medal > svg { position: relative; z-index: 1; width: 100%; height: 100%; filter: drop-shadow(0 .35rem .5rem rgba(0, 0, 0, .65)); animation: rhxPop .9s .08s cubic-bezier(.2, 1.7, .35, 1) both; }
.rhx-t.rank .rhx-medal { width: 4.4rem; height: 4.4rem; }
@keyframes rhxPop { 0% { transform: scale(.15) rotate(-30deg); opacity: 0; } 60% { opacity: 1; } 100% { transform: none; opacity: 1; } }
.rhx-rays { position: absolute; left: 50%; top: 60%; width: 9.5rem; height: 9.5rem; margin: -4.75rem 0 0 -4.75rem; border-radius: 50%; z-index: 0; opacity: .9;
  background: radial-gradient(circle, rgba(var(--c), .35), transparent 45%), repeating-conic-gradient(from 0deg, rgba(var(--c), .5) 0deg 6deg, transparent 6deg 20deg);
  -webkit-mask: radial-gradient(circle, #000 18%, transparent 68%); mask: radial-gradient(circle, #000 18%, transparent 68%); animation: rhxSpin 9s linear infinite, rhxFade .9s both; }
@keyframes rhxSpin { to { transform: rotate(360deg); } }
@keyframes rhxFade { from { opacity: 0; transform: scale(.4); } }
.rhx-sp { position: absolute; left: 50%; top: 58%; width: .32rem; height: .32rem; margin: -.16rem; border-radius: 50%; background: rgb(var(--c)); box-shadow: 0 0 .5rem rgb(var(--c)); z-index: 2; opacity: 0;
  animation: rhxSpark 1.1s calc(.25s + var(--d) * 1s) ease-out both; }
@keyframes rhxSpark { 0% { opacity: 1; transform: translate(0, 0) scale(1); } 100% { opacity: 0; transform: translate(calc(var(--x) * 1rem), calc(var(--y) * 1rem)) scale(.2); } }
.rhx-txt { flex: 1; min-width: 0; position: relative; z-index: 1; }
.rhx-k { display: flex; align-items: center; gap: .5rem; font-size: .68rem; font-weight: 700; letter-spacing: .34em; text-transform: uppercase; color: rgb(var(--c)); }
.rhx-k i { flex: 0 0 1.4rem; height: 1px; background: linear-gradient(90deg, rgb(var(--c)), transparent); }
.rhx-ti { font-size: 1.5rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; line-height: 1.08; margin-top: .12rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  background: linear-gradient(180deg, #ffffff, rgb(var(--c)) 130%); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 .7rem rgba(var(--c), .35)); }
.rhx-d { font-size: .9rem; color: #c9c1ae; margin-top: .14rem; line-height: 1.25; }
.rhx-xp { position: relative; z-index: 1; text-align: right; font-family: var(--mono, monospace); font-size: 1.3rem; color: #ffe27a; text-shadow: 0 0 .9rem rgba(255, 210, 80, .6); white-space: nowrap;
  animation: rhxXp .55s .65s cubic-bezier(.2, 1.6, .3, 1) both; }
.rhx-xp small { display: block; font-family: var(--font, sans-serif); font-size: .58rem; font-weight: 700; letter-spacing: .32em; color: rgba(var(--c), .8); }
@keyframes rhxXp { from { opacity: 0; transform: translateX(.8rem) scale(.7); } }
.rhx-life { position: absolute; left: 0; bottom: 0; height: 2px; width: 100%; transform-origin: left; background: linear-gradient(90deg, rgba(var(--c2), .9), rgb(var(--c))); box-shadow: 0 0 .5rem rgb(var(--c));
  animation: rhxLife var(--life) linear both; }
@keyframes rhxLife { from { transform: scaleX(1); } to { transform: scaleX(0); } }

.rhx-sum { position: fixed; right: 1.6rem; bottom: 1.6rem; z-index: 9001; width: 23rem; padding: 1rem 1.15rem 1.05rem; border-radius: 1rem; pointer-events: auto; cursor: pointer;
  font-family: var(--font, 'Rajdhani', 'Segoe UI', sans-serif); color: #e9f0f7; overflow: hidden;
  background: radial-gradient(ellipse at 100% 0%, rgba(255, 207, 63, .16), transparent 55%), linear-gradient(180deg, rgba(20, 28, 39, .95), rgba(8, 12, 18, .96));
  border: 1px solid rgba(255, 207, 63, .32); box-shadow: 0 1.4rem 3.2rem rgba(0, 0, 0, .6), 0 0 2rem rgba(255, 200, 60, .12), inset 0 1px 0 rgba(255, 255, 255, .1);
  animation: rhxSumIn .7s cubic-bezier(.2, 1.3, .3, 1) both; }
.rhx-sum.out { animation: rhxOut .45s ease-in forwards; }
@keyframes rhxSumIn { from { opacity: 0; transform: translateY(1.5rem) scale(.94); } }
.rhx-sum-h { display: flex; align-items: center; justify-content: space-between; font-size: .66rem; font-weight: 700; letter-spacing: .32em; text-transform: uppercase; color: #ffd34d; }
.rhx-sum-h span:last-child { color: #7d8c9d; letter-spacing: .2em; }
.rhx-sum-xp { font-family: var(--mono, monospace); font-size: 2.3rem; line-height: 1.05; margin: .25rem 0 .55rem; color: #fff; text-shadow: 0 0 1.2rem rgba(255, 210, 80, .45); }
.rhx-sum-xp small { font-size: .9rem; color: #ffd34d; margin-left: .3rem; }
.rhx-lines { display: flex; flex-direction: column; gap: .18rem; margin-bottom: .75rem; }
.rhx-line { display: flex; justify-content: space-between; font-size: .88rem; color: #b6c3d1; opacity: 0; animation: rhxLine .4s calc(.5s + var(--i) * .09s) ease-out both; }
.rhx-line b { font-family: var(--mono, monospace); font-weight: 400; color: #ffe27a; }
@keyframes rhxLine { from { opacity: 0; transform: translateX(-.6rem); } to { opacity: 1; transform: none; } }
.rhx-rank { display: flex; align-items: center; gap: .8rem; }
.rhx-rank > svg { width: 3rem; height: 3rem; flex-shrink: 0; filter: drop-shadow(0 .2rem .4rem rgba(0, 0, 0, .6)); }
.rhx-rk { flex: 1; min-width: 0; }
.rhx-rk-n { display: flex; justify-content: space-between; font-size: .95rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
.rhx-rk-n small { font-family: var(--mono, monospace); font-weight: 400; font-size: .75rem; letter-spacing: 0; color: #7d8c9d; }
.rhx-bar { position: relative; height: .48rem; margin-top: .35rem; border-radius: 1rem; background: rgba(255, 255, 255, .07); overflow: hidden; box-shadow: inset 0 1px 2px rgba(0, 0, 0, .6); }
.rhx-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 1rem; background: linear-gradient(90deg, #a8741a, #ffcf3f, #fff2c0); box-shadow: 0 0 .7rem rgba(255, 210, 80, .7);
  width: calc(var(--from) * 100%); transition: width 1.6s cubic-bezier(.3, .1, .2, 1); }
.rhx-bar i.go { width: calc(var(--to) * 100%); }
.rhx-promo { margin-top: .6rem; text-align: center; font-size: .78rem; font-weight: 700; letter-spacing: .34em; text-transform: uppercase; color: #ff8a5a; text-shadow: 0 0 .8rem rgba(255, 110, 60, .6);
  animation: rhxPulse 1.2s 1.8s ease-in-out 3 both; }
@keyframes rhxPulse { 50% { color: #ffd34d; } }
.rhx-ct { display: flex; flex-direction: column; gap: .3rem; margin: .7rem 0 .2rem; padding-top: .6rem; border-top: 1px solid rgba(255, 255, 255, .07); }
.rhx-ct-h { font-size: .6rem; font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: #6eebaa; display: flex; justify-content: space-between; }
.rhx-ct-h span:last-child { color: #ffd34d; letter-spacing: .1em; }
.rhx-ctr { display: grid; grid-template-columns: 1fr auto; gap: .1rem .6rem; font-size: .8rem; color: #b6c3d1; }
.rhx-ctr b { font-weight: 600; color: #e9f0f7; }
.rhx-ctr em { font-style: normal; font-family: var(--mono, monospace); font-size: .72rem; color: #7d8c9d; }
.rhx-ctr.done b, .rhx-ctr.done em { color: #8dffb0; }
.rhx-ctr i { grid-column: 1 / -1; height: .2rem; border-radius: 1rem; background: rgba(255, 255, 255, .07); position: relative; overflow: hidden; }
.rhx-ctr i u { position: absolute; inset: 0 auto 0 0; border-radius: 1rem; background: #6eebaa; box-shadow: 0 0 .4rem rgba(110, 235, 170, .7); }
.rhx-tz { margin-top: .55rem; font-size: .78rem; color: #b6c3d1; display: flex; align-items: center; gap: .45rem; }
.rhx-tz .mx-ic { color: #7fd3ff; flex-shrink: 0; }
.rhx-tz b { color: #fff; font-weight: 600; }
@media (prefers-reduced-motion: reduce) { .rhx-rays, .rhx-t::before { animation: none; display: none; } }
`;

let sfx: ((kind: 'medal' | 'rank' | 'xp') => void) | null = null;
/** Optional sound hook, called when each toast appears. */
export function setToastSound(fn: ((kind: 'medal' | 'rank' | 'xp') => void) | null) {
  sfx = fn;
}

function ensureCss() {
  if (typeof document === 'undefined' || document.getElementById('rhx-style')) return;
  const st = document.createElement('style');
  st.id = 'rhx-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}
const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const queue: ToastInfo[] = [];
let showing = false;

/** Animated medal toast (top-centre). Toasts queue and play one after another. */
export function showAchievementToast(a: ToastInfo) {
  if (typeof document === 'undefined') return;
  ensureCss();
  queue.push(a);
  if (!showing) next();
}

function next() {
  const a = queue.shift();
  if (!a) { showing = false; return; }
  showing = true;
  let host = document.querySelector('.rhx-toasts') as HTMLElement | null;
  if (!host) {
    host = document.createElement('div');
    host.className = 'rhx-toasts';
    document.body.appendChild(host);
  }
  // in battle, centre over the play area (left of the sidebar) so the game's own toasts stay clear
  const sb = document.getElementById('sidebar');
  host.style.left = sb && sb.offsetWidth ? `${(window.innerWidth - sb.offsetWidth) / 2}px` : '50%';
  const rank = a.kind === 'rank';
  const life = queue.length > 2 ? 2600 : rank ? 5200 : 4300;
  const el = document.createElement('div');
  el.className = `rhx-t ${rank ? 'rank' : a.kind === 'contract' || a.kind === 'unlock' ? a.kind : a.rarity ?? 'epic'}`;
  el.style.setProperty('--life', `${life}ms`);
  let sparks = '';
  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * Math.PI * 2 + 0.3;
    const r = 2.2 + (i % 3) * 0.9;
    sparks += `<i class="rhx-sp" style="--x:${(Math.cos(ang) * r).toFixed(2)};--y:${(Math.sin(ang) * r).toFixed(2)};--d:${((i % 4) * 0.07).toFixed(2)}"></i>`;
  }
  const tier = a.tier ? { tier: a.tier } : undefined;
  const kicker = rank ? tMeta('toast.promotion') : a.kind === 'contract' ? tMeta(tier ? 'toast.contractTier' : 'toast.contract', tier)
    : a.kind === 'unlock' ? tMeta(tier ? 'toast.unlockedTier' : 'toast.unlocked', tier) : tMeta(tier ? 'toast.medalTier' : 'toast.medal', tier);
  el.innerHTML = `<div class="rhx-medal"><div class="rhx-rays"></div>${sparks}${a.icon}</div>
    <div class="rhx-txt"><div class="rhx-k"><i></i><span>${escHtml(kicker)}</span></div><div class="rhx-ti">${escHtml(a.title)}</div><div class="rhx-d">${escHtml(a.desc)}</div></div>
    ${a.xp > 0 ? `<div class="rhx-xp">+${fmtInt(a.xp)}<small>${tMeta.html('xpUnit')}</small></div>` : ''}
    <div class="rhx-life"></div>`;
  host.appendChild(el);
  try { sfx?.(rank ? 'rank' : 'medal'); } catch { /* audio not ready */ }
  window.setTimeout(() => {
    el.classList.add('out');
    window.setTimeout(() => { el.remove(); next(); }, 380);
  }, life);
}

/**
 * Post-battle XP card (bottom-right): breakdown, animated rank bar, promotion banner, contract progress and the
 * next unlock. Click to dismiss. Skipped when the full results screen (src/ui/results.ts) already shows it all.
 */
export function showXpSummary(s: XpSummary, ms = 11000) {
  if (typeof document === 'undefined') return;
  if (document.querySelector('.rr-results')) return; // the results screen has it
  ensureCss();
  document.querySelector('.rhx-sum')?.remove();
  const el = document.createElement('div');
  el.className = 'rhx-sum';
  const promoted = s.rankAfter > s.rankBefore;
  const lines = s.lines.filter((l) => l.xp > 0).slice(0, 7);
  el.innerHTML = `<div class="rhx-sum-h"><span>${tMeta.html('card.serviceRecord')}</span><span>${tMeta.html(s.won ? 'card.victory' : 'card.debrief')}</span></div>
    <div class="rhx-sum-xp">+${fmtInt(s.xp)}<small>${tMeta.html('xpUnit')}</small></div>
    <div class="rhx-lines">${lines.map((l, i) => `<div class="rhx-line" style="--i:${i}"><span>${escHtml(l.label)}</span><b>+${fmtInt(l.xp)}</b></div>`).join('')}</div>
    <div class="rhx-rank">${insigniaSvg(s.rankAfter, s.faction === 'soviet' ? 'soviet' : 'allies')}
      <div class="rhx-rk"><div class="rhx-rk-n"><span>${escHtml(s.rankName)}</span><small>${s.nextName ? `${fmtInt(Math.floor(s.intoAfter))} / ${fmtInt(s.spanAfter)}` : tMeta.html('card.max')}</small></div>
      <div class="rhx-bar"><i style="--from:${promoted ? 0 : s.fracBefore.toFixed(4)};--to:${s.fracAfter.toFixed(4)}"></i></div></div></div>
    ${promoted ? `<div class="rhx-promo">${picto('chevrons')} ${tMeta.html('card.promotedTo', { rank: s.rankName })}</div>` : ''}${contractsHtml(s)}`;
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.querySelector('.rhx-bar i')?.classList.add('go')));
  try { sfx?.('xp'); } catch { /* ignore */ }
  const close = () => { el.classList.add('out'); window.setTimeout(() => el.remove(), 420); };
  el.onclick = close;
  window.setTimeout(close, ms + (s.contracts?.length ? 3000 : 0));
}

/** Contracts that moved this battle, Commendations, and the next unlock (XP card). */
function contractsHtml(s: XpSummary): string {
  const list = (s.contracts ?? []).filter((c) => c.after > c.before || c.justDone).slice(0, 3);
  let out = '';
  if (list.length || s.commendations) {
    out += `<div class="rhx-ct"><div class="rhx-ct-h"><span>${tMeta.html('card.contracts')}</span><span>${s.commendations ? tMeta.html('card.commendations', { n: s.commendations }) : ''}</span></div>`;
    for (const c of list) {
      const f = (v: number) => (c.money ? moneyShort(Math.round(v / 1000) * 1000) : String(Math.floor(v)));
      out += `<div class="rhx-ctr${c.done ? ' done' : ''}"><b>${escHtml(c.title)}</b><em>${c.done ? tMeta.html('card.complete') : `${escHtml(f(c.after))} / ${escHtml(f(c.target))}`}</em><i><u style="width:${((c.after / Math.max(1, c.target)) * 100).toFixed(1)}%"></u></i></div>`;
    }
    out += '</div>';
  }
  if (s.unlocks?.length) out += `<div class="rhx-tz">${picto('lock')}<span>${tMeta.html('card.unlocked', { items: `${s.unlocks.slice(0, 2).map((u) => u.name).join(', ')}${s.unlocks.length > 2 ? ` +${s.unlocks.length - 2}` : ''}` })}</span></div>`;
  else if (s.teaser) out += `<div class="rhx-tz">${picto('lock')}<span>${tMeta.html('card.next', { text: s.teaser.text })}</span></div>`;
  return out;
}
