/**
 * Global leaderboards screen (from the Challenges hub): the verified per-day tops of the Daily Challenge, the
 * Survival fronts and the built-in challenges, with the player's own entry highlighted and a "submit your last
 * run" offer for a finished run that was not sent yet. Names come from other players: escaped everywhere.
 */
import { esc, el } from './dom';
import { picto } from '../meta/art';
import { ICONS } from './icons';
import { listBoards, type BoardInfo } from '../net/boards';
import { boardTitle, callsign, fetchTop, pendingRun, setCallsign, submitAndMark, type TopResponse } from '../net/leaderboard';
import { serverStatus } from '../net/endpoint';
import { fmtDate, fmtInt } from '../i18n/core';
import tChallenges from '../i18n/en/challenges';
import tCommon from '../i18n/en/common';

const CSS = `
.lbd { position: fixed; inset: 0; z-index: 25; display: flex; align-items: center; justify-content: center; background: radial-gradient(ellipse at center, rgba(2,5,9,.55), rgba(0,0,0,.88)); backdrop-filter: blur(3px); animation: screenIn .4s var(--ease) both; }
.lbd.leaving { animation: screenOut .3s var(--ease) both; }
.lbd-panel { width: min(64rem, calc(100vw - 2rem)); height: min(44rem, calc(100vh - 2rem)); border-radius: 1rem; padding: 1.3rem 1.5rem; display: grid; grid-template-columns: 17rem 1fr; grid-template-rows: auto 1fr auto; gap: 1rem 1.2rem; }
.lbd-head { grid-column: 1 / -1; display: flex; align-items: center; gap: .9rem; }
.lbd-head h2 { margin: 0; font-size: 1.55rem; letter-spacing: .24em; text-transform: uppercase; color: #fff; line-height: 1; }
.lbd-head small { display: block; font-size: max(.66rem, 8.5px); font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: var(--accent); margin-bottom: .3rem; }
.lbd-head .sp { flex: 1; } .lbd-head .note { font-size: .8rem; color: var(--muted); max-width: 22rem; text-align: right; line-height: 1.35; }
.lbd-tabs { display: flex; flex-direction: column; gap: .3rem; overflow-y: auto; }
.lbd-tab { display: flex; align-items: center; gap: .55rem; padding: .55rem .7rem; border-radius: .6rem; border: 1px solid transparent; background: none; cursor: pointer; color: var(--text-2); font: 600 .92rem var(--font); letter-spacing: .06em; text-align: left; }
.lbd-tab:hover { background: rgba(255,255,255,.04); color: #fff; } .lbd-tab.on { border-color: rgba(var(--accent-rgb), .6); background: rgba(var(--accent-rgb), .12); color: #fff; }
.lbd-tab .ic { font-size: 1.1rem; color: var(--accent); flex-shrink: 0; }
.lbd-tab em { margin-left: auto; font-style: normal; font-size: .62rem; letter-spacing: .14em; text-transform: uppercase; color: var(--gold); }
.lbd-main { display: flex; flex-direction: column; gap: .6rem; min-height: 0; }
.lbd-bar { display: flex; align-items: center; gap: .6rem; } .lbd-bar h3 { margin: 0; font-size: 1.15rem; letter-spacing: .14em; text-transform: uppercase; flex: 1; }
.lbd select { height: 2.2rem; border-radius: .5rem; border: 1px solid var(--line-2); background: #0b1118; color: var(--text); font: 600 .85rem var(--font); padding: 0 .45rem; }
.lbd-list { flex: 1; overflow-y: auto; border-radius: .7rem; border: 1px solid var(--line); background: rgba(0,0,0,.25); }
.lbd-row { display: grid; grid-template-columns: 3.2rem 1fr 7rem 5rem 5.5rem; align-items: center; gap: .5rem; padding: .5rem .9rem; border-bottom: 1px solid var(--line); font-size: .95rem; }
.lbd-row.h { position: sticky; top: 0; background: #0a1017; font-size: .65rem; letter-spacing: .22em; text-transform: uppercase; color: var(--muted); }
.lbd-row .rk { font-family: var(--mono); color: var(--text-2); } .lbd-row.top1 .rk { color: var(--gold); } .lbd-row.top2 .rk { color: #d8dee6; } .lbd-row.top3 .rk { color: #e0a26a; }
.lbd-row .nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.lbd-row .sc { font-family: var(--mono); text-align: right; color: #fff; } .lbd-row .tm, .lbd-row .rs { text-align: right; color: var(--muted); font-size: .85rem; }
.lbd-row .rs.won { color: var(--ok); }
.lbd-row.you { background: rgba(var(--accent-rgb), .12); box-shadow: inset 3px 0 0 var(--accent); }
.lbd-empty { padding: 2.5rem 1rem; text-align: center; color: var(--muted); line-height: 1.5; }
.lbd-run { display: flex; align-items: center; gap: .6rem; padding: .6rem .8rem; border-radius: .7rem; border: 1px solid rgba(var(--gold-rgb), .45); background: rgba(var(--gold-rgb), .08); font-size: .9rem; }
.lbd-run input { height: 2.2rem; border-radius: .5rem; border: 1px solid var(--line-2); background: rgba(0,0,0,.35); color: var(--text); font: 600 .9rem var(--font); padding: 0 .5rem; width: 11rem; user-select: text; }
.lbd-run .btn { height: 2.2rem; } .lbd-run .msg { flex: 1; color: var(--muted); } .lbd-run .msg.ok { color: var(--ok); } .lbd-run .msg.bad { color: #ffb3a8; }
.lbd-foot { grid-column: 1 / -1; display: flex; align-items: center; gap: .7rem; } .lbd-foot .why { flex: 1; text-align: right; color: var(--muted); font-size: .8rem; }
`;

function ensureCss() {
  if (document.getElementById('lbd-style')) return;
  const s = document.createElement('style');
  s.id = 'lbd-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const ICON: Record<BoardInfo['kind'], string> = { daily: 'calendar', survival: 'tower', challenge: 'target' };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** A UTC day key (YYYY-MM-DD) as a date. */
const dayLabel = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? fmtDate(new Date(d + 'T12:00:00Z'), { dateStyle: 'medium', timeZone: 'UTC' }) : d);

/** Open the leaderboards (optionally on one board). Returns a close function. */
export function showLeaderboard(opts: { play(k: 'click' | 'hover' | 'tab'): void; board?: string; onClose?(): void }): () => void {
  ensureCss();
  const boards = listBoards();
  let cur = boards.find((b) => b.id === opts.board) ?? boards[0];
  let day: string | undefined;
  let data: TopResponse | null = null;
  let online: boolean | null = null;
  const root = el('div', 'lbd');
  const panel = el('div', 'lbd-panel panel');
  root.appendChild(panel);
  document.body.appendChild(root);

  const render = () => {
    const run = pendingRun(cur.id);
    panel.innerHTML = `
      <div class="lbd-head"><span class="mp-ic">${picto('trophy', 'ic')}</span><div><small>${tChallenges.html('boards.kicker')}</small><h2>${tChallenges.html('boards.title')}</h2></div><i class="sp"></i>
        <span class="note">${tChallenges.html('boards.note')}</span></div>
      <div class="lbd-tabs">${boards.map((b) => `<button class="lbd-tab${b.id === cur.id ? ' on' : ''}" data-b="${esc(b.id)}">${picto(ICON[b.kind], 'ic')}<span>${esc(boardTitle(b))}</span>${pendingRun(b.id) ? `<em>${tChallenges.html('boards.yourRun')}</em>` : ''}</button>`).join('')}</div>
      <div class="lbd-main">
        <div class="lbd-bar"><h3>${esc(boardTitle(cur))}</h3>${data && data.days.length ? `<select data-day>${[...new Set([data.today, ...data.days])].map((d) => `<option value="${esc(d)}"${d === data!.day ? ' selected' : ''}>${d === data!.today ? tChallenges.html('boards.today') : esc(dayLabel(d))}</option>`).join('')}</select>` : ''}</div>
        ${run ? `<div class="lbd-run">${picto('medal', 'ic')}<span>${tChallenges.html('boards.lastRun', { score: fmtInt(run.rec.result!.score) })}</span><input type="text" maxlength="20" value="${esc(callsign())}" spellcheck="false"><button class="btn" data-a="submit">${tChallenges.html('boards.submit')}</button><span class="msg"></span></div>` : ''}
        <div class="lbd-list">${list()}</div>
      </div>
      <div class="lbd-foot"><button class="btn" data-a="back">${picto('back', 'ic')}<span>${tCommon.html('back')}</span><kbd>${tCommon.html('keys.esc')}</kbd></button><span class="why">${tChallenges.html('boards.why')}</span></div>`;
    panel.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => (b.onclick = () => { opts.play('tab'); cur = boards.find((x) => x.id === b.dataset.b)!; day = undefined; data = null; render(); void load(); }));
    const sel = panel.querySelector('[data-day]') as HTMLSelectElement | null;
    if (sel) sel.onchange = () => { day = sel.value; void load(); };
    (panel.querySelector('[data-a="back"]') as HTMLElement).onclick = () => { opts.play('click'); close(); opts.onClose?.(); };
    const sb = panel.querySelector('[data-a="submit"]') as HTMLButtonElement | null;
    if (sb && run) {
      const input = panel.querySelector('.lbd-run input') as HTMLInputElement;
      input.onkeydown = (e) => e.stopPropagation();
      sb.onclick = async () => {
        opts.play('click');
        sb.disabled = true;
        setCallsign(input.value);
        const msg = panel.querySelector('.lbd-run .msg') as HTMLElement;
        msg.textContent = tChallenges('boards.verifying');
        const r = await submitAndMark(run, input.value);
        msg.className = `msg ${r.ok ? 'ok' : 'bad'}`;
        msg.textContent = r.ok ? (r.rank ? tChallenges('boards.verifiedRank', { rank: String(r.rank) }) : tChallenges('boards.verified')) : r.error;
        if (r.ok) { day = r.day; await load(); } else sb.disabled = false;
      };
    }
  };

  const list = (): string => {
    if (online === false) return `<div class="lbd-empty">${ICONS.warn}<br>${tChallenges.html('boards.offline')}<br><small>${tChallenges.html('boards.offlineSub')}</small></div>`;
    if (!data) return `<div class="lbd-empty">${tCommon.html('loading')}</div>`;
    if (!data.entries.length) return `<div class="lbd-empty">${tChallenges.html(data.day === data.today ? 'boards.emptyToday' : 'boards.emptyDay')}<br>${tChallenges.html('boards.emptySub')}</div>`;
    return `<div class="lbd-row h"><span>${tChallenges.html('boards.rank')}</span><span>${tChallenges.html('boards.commander')}</span><span style="text-align:right">${tChallenges.html('boards.score')}</span><span style="text-align:right">${tChallenges.html('boards.time')}</span><span style="text-align:right">${tChallenges.html('boards.result')}</span></div>` +
      data.entries.map((e) => `<div class="lbd-row${e.rank <= 3 ? ` top${e.rank}` : ''}${e.you ? ' you' : ''}"><span class="rk">#${e.rank}</span><span class="nm">${e.you ? tChallenges.html('boards.you', { name: e.name }) : esc(e.name)}</span><span class="sc">${fmtInt(e.score)}</span><span class="tm">${mmss(e.seconds)}</span><span class="rs${e.won ? ' won' : ''}">${tCommon.html(e.won ? 'victory' : 'defeat')}</span></div>`).join('');
  };

  const load = async () => {
    const want = cur.id, wantDay = day;
    const r = await fetchTop(cur.kind, cur.id, wantDay);
    if (want !== cur.id || wantDay !== day || !root.isConnected) return;
    if (!r) { const st = await serverStatus(); online = st.ok && !!st.lb; if (!online) { render(); return; } }
    online = true;
    data = r;
    render();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !root.isConnected) return;
    e.preventDefault();
    e.stopPropagation();
    close();
    opts.onClose?.();
  };
  document.addEventListener('keydown', onKey, true);
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    root.classList.add('leaving');
    setTimeout(() => root.remove(), 280);
  };
  render();
  void load();
  return close;
}
