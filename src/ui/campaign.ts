import { campaignMissions } from '../missions';
import { isUnlocked, loadProgress } from '../missions/progress';
import type { MissionDef } from '../sim/mission';
import { formatTime } from '../core/util';

const CSS = `
.cmp { position: fixed; inset: 0; z-index: 22; display: flex; align-items: stretch; justify-content: center; padding: 5vh 4vw; gap: 2vw;
  background: radial-gradient(ellipse at 30% 40%, rgba(0,0,0,0.25), rgba(0,0,0,0.82) 75%); font-family: var(--font, sans-serif); color: #dfe8f2; animation: cmpIn .4s ease-out; }
@keyframes cmpIn { from { opacity: 0; } to { opacity: 1; } }
.cmp-col { display: flex; flex-direction: column; gap: 12px; }
.cmp-left { width: min(520px, 40vw); }
.cmp-right { flex: 1; max-width: 760px; }
.cmp-panel { background: linear-gradient(180deg, rgba(20,28,38,0.92), rgba(8,11,16,0.94)); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.55); }
.cmp h2 { margin: 0; font-size: 13px; letter-spacing: .3em; color: rgb(var(--accent-rgb, 90,180,255)); }
.cmp h1 { margin: 2px 0 0; font-size: 30px; letter-spacing: .14em; }
.cmp-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.cmp-tab { height: 40px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.03); color: #9fb0c2; cursor: pointer; font: inherit; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; }
.cmp-tab.on { color: #fff; background: rgba(var(--accent-rgb, 90,180,255),0.22); border-color: rgba(var(--accent-rgb, 90,180,255),0.7); box-shadow: inset 0 -2px 0 rgb(var(--accent-rgb, 90,180,255)); }
.cmp-list { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: 58vh; padding-right: 4px; }
.cmp-m { position: relative; display: flex; gap: 14px; align-items: center; padding: 12px 14px; border-radius: 12px; cursor: pointer; border: 1px solid rgba(255,255,255,0.07); background: rgba(255,255,255,0.025); transition: all .15s; }
.cmp-m:hover:not(.locked) { border-color: rgba(var(--accent-rgb, 90,180,255),0.6); background: rgba(var(--accent-rgb, 90,180,255),0.08); transform: translateX(3px); }
.cmp-m.sel { border-color: rgb(var(--accent-rgb, 90,180,255)); background: rgba(var(--accent-rgb, 90,180,255),0.14); box-shadow: 0 0 22px rgba(var(--accent-rgb, 90,180,255),0.25); }
.cmp-m.locked { opacity: .45; cursor: not-allowed; }
.cmp-num { width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.15); flex-shrink: 0; }
.cmp-m.done .cmp-num { border-color: #58ff8a; color: #8dffb0; }
.cmp-mt { flex: 1; }
.cmp-mt b { display: block; font-size: 17px; letter-spacing: .06em; }
.cmp-mt span { font-size: 12px; color: #8a99aa; letter-spacing: .1em; }
.cmp-stars { display: flex; gap: 3px; }
.cmp-stars i { width: 14px; height: 14px; clip-path: polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%); background: rgba(255,255,255,0.12); }
.cmp-stars i.on { background: #ffd34d; filter: drop-shadow(0 0 4px rgba(255,211,77,0.7)); }
.cmp-brief .meta { display: flex; gap: 18px; font-family: var(--mono, monospace); font-size: 12px; letter-spacing: .14em; color: #9fb0c2; margin: 8px 0 14px; flex-wrap: wrap; }
.cmp-brief p { font-size: 16px; line-height: 1.6; color: #d4e0ec; margin: 0 0 12px; }
.cmp-brief .tips { margin-top: 12px; padding: 12px 14px; border-radius: 10px; background: rgba(var(--accent-rgb, 90,180,255),0.08); border: 1px solid rgba(var(--accent-rgb, 90,180,255),0.25); }
.cmp-brief .tips div { font-size: 13px; color: #b8c8d8; margin: 4px 0; }
.cmp-brief .tips div::before { content: '▸ '; color: rgb(var(--accent-rgb, 90,180,255)); }
.cmp-go { margin-top: 16px; display: flex; gap: 10px; }
.cmp-btn { height: 50px; flex: 1; border-radius: 12px; border: 0; cursor: pointer; font: inherit; font-weight: 800; letter-spacing: .3em; text-transform: uppercase; font-size: 17px; color: #fff;
  background: linear-gradient(180deg, rgba(var(--accent-rgb, 90,180,255),0.95), rgba(var(--accent-rgb, 90,180,255),0.55)); box-shadow: 0 0 28px rgba(var(--accent-rgb, 90,180,255),0.4); }
.cmp-btn.sec { flex: 0 0 160px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); box-shadow: none; font-size: 13px; }
.cmp-btn:hover { filter: brightness(1.15); }
.cmp-record { font-size: 12px; color: #8dffb0; letter-spacing: .1em; margin-top: 4px; }
.cmp-empty { color: #8a99aa; font-size: 14px; padding: 20px; text-align: center; }
`;

type Tab = 'allies' | 'soviet' | 'special';
const LOCK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

/** Campaign / special-ops mission select with briefings. */
export function showCampaign(opts: { onDeploy: (missionId: string) => void; onBack: () => void; play: (k: 'click' | 'tab') => void }): () => void {
  if (!document.getElementById('cmp-style')) {
    const st = document.createElement('style');
    st.id = 'cmp-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.className = 'cmp';
  document.body.appendChild(root);
  let tab: Tab = (localStorage.getItem('rh.campaign.tab') as Tab) || 'allies';
  let selected: MissionDef | null = null;

  const render = () => {
    localStorage.setItem('rh.campaign.tab', tab);
    document.body.classList.toggle('faction-soviet', tab === 'soviet');
    const missions = campaignMissions(tab);
    const order = missions.map((m) => m.id);
    const prog = loadProgress();
    if (!selected || selected.campaign !== tab) {
      selected = missions.find((m) => isUnlocked(m.id, order) && !prog[m.id]?.completed) ?? missions[0] ?? null;
    }
    const titles: Record<Tab, string> = { allies: 'Allied Campaign', soviet: 'Soviet Campaign', special: 'Special Operations' };
    root.innerHTML = `
      <div class="cmp-col cmp-left">
        <div class="cmp-panel"><h2>CAMPAIGN</h2><h1>${titles[tab].toUpperCase()}</h1></div>
        <div class="cmp-tabs">${(['allies', 'soviet', 'special'] as Tab[]).map((t) => `<button class="cmp-tab ${t === tab ? 'on' : ''}" data-tab="${t}">${t === 'allies' ? 'Allies' : t === 'soviet' ? 'Soviets' : 'Special'}</button>`).join('')}</div>
        <div class="cmp-panel cmp-list">${missions.length ? missions.map((m) => {
          const unlocked = isUnlocked(m.id, order);
          const r = prog[m.id];
          const stars = r?.stars ?? 0;
          return `<div class="cmp-m ${unlocked ? '' : 'locked'} ${r?.completed ? 'done' : ''} ${selected?.id === m.id ? 'sel' : ''}" data-id="${m.id}">
            <div class="cmp-num">${unlocked ? m.index : LOCK}</div>
            <div class="cmp-mt"><b>${m.title}</b><span>${m.location.toUpperCase()}</span></div>
            ${m.scored ? `<div class="cmp-record">${r?.bestScore ? 'BEST ' + r.bestScore.toLocaleString('en-US') : ''}</div>` : `<div class="cmp-stars">${[0, 1, 2].map((k) => `<i class="${k < stars ? 'on' : ''}"></i>`).join('')}</div>`}
          </div>`;
        }).join('') : '<div class="cmp-empty">No missions yet.</div>'}</div>
        <button class="cmp-btn sec" data-act="back" style="flex:0 0 auto;height:42px">Back</button>
      </div>
      <div class="cmp-col cmp-right">${selected ? briefing(selected, prog[selected.id]) : ''}</div>`;
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab as Tab; selected = null; opts.play('tab'); render(); });
    root.querySelectorAll<HTMLElement>('.cmp-m').forEach((el) => el.onclick = () => {
      if (el.classList.contains('locked')) return;
      selected = missions.find((m) => m.id === el.dataset.id) ?? null;
      opts.play('click');
      render();
    });
    (root.querySelector('[data-act="back"]') as HTMLElement).onclick = () => { opts.play('click'); close(); opts.onBack(); };
    const go = root.querySelector('[data-act="deploy"]') as HTMLElement | null;
    if (go && selected) { const id = selected.id; go.onclick = () => { opts.play('click'); close(); opts.onDeploy(id); }; }
    // typewriter on the briefing paragraphs
    const ps = Array.from(root.querySelectorAll<HTMLElement>('.cmp-brief p'));
    const texts = ps.map((p) => p.textContent ?? '');
    ps.forEach((p) => (p.textContent = ''));
    let pi = 0, ci = 0;
    const step = () => {
      if (!root.isConnected || pi >= ps.length) return;
      ci += 3;
      ps[pi].textContent = texts[pi].slice(0, ci);
      if (ci >= texts[pi].length) { pi++; ci = 0; }
      requestAnimationFrame(step);
    };
    step();
  };

  const briefing = (m: MissionDef, r?: { completed: boolean; stars: number; bestTime?: number; bestScore?: number }) => `
    <div class="cmp-panel cmp-brief">
      <h2>${m.scored ? 'SPECIAL OPERATION' : 'MISSION ' + m.index} · BRIEFING</h2>
      <h1>OPERATION ${m.codename}</h1>
      <div class="meta"><span>◉ ${m.location.toUpperCase()}</span>${m.date ? `<span>◷ ${m.date.toUpperCase()}</span>` : ''}${m.parTime ? `<span>★ PAR ${formatTime(m.parTime)}</span>` : ''}</div>
      ${m.briefing.map((p) => `<p>${p}</p>`).join('')}
      ${m.tips?.length ? `<div class="tips">${m.tips.map((t) => `<div>${t}</div>`).join('')}</div>` : ''}
      ${r?.completed ? `<div class="cmp-record">COMPLETED · ${'★'.repeat(r.stars)}${r.bestTime ? ' · BEST ' + formatTime(r.bestTime) : ''}</div>` : r?.bestScore ? `<div class="cmp-record">BEST SCORE ${r.bestScore.toLocaleString('en-US')}</div>` : ''}
      <div class="cmp-go"><button class="cmp-btn" data-act="deploy">Deploy</button></div>
    </div>`;

  const close = () => root.remove();
  render();
  return close;
}
