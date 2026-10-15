/** Loading screen: rotating gameplay tips and a percentage readout mirroring the bar set by main.ts. */

export const TIPS = [
  'Ore regrows over time — gem fields are worth twice as much as ore.',
  'Low power slows production and shuts down radar, Tesla Coils and superweapons.',
  'Press <kbd>Ctrl</kbd> + <kbd>1–9</kbd> to assign a control group; double-tap the number to jump to it.',
  'Hold <kbd>Shift</kbd> while right-clicking to queue waypoints.',
  '<kbd>A</kbd> attack-move makes units engage anything they meet on the way.',
  'Engineers can capture enemy structures once they are badly damaged.',
  'Units earn veterancy from kills: veterans hit harder, elites also repair themselves.',
  '<kbd>Shift</kbd>-click a unit in the sidebar to queue five at once. Right-click to hold or cancel.',
  'Ore Silos store surplus income — a lone refinery fills up quickly.',
  'A Service Depot repairs damaged vehicles parked on its pad.',
  'Artillery and V2 rockets outrange base defences but are fragile up close.',
  'Tanks crush infantry — keep your riflemen out of the treads.',
  'Press <kbd>Space</kbd> to jump to the last attack and <kbd>H</kbd> to return home.',
  'Hold <kbd>Alt</kbd> to show the health bar of every unit on screen.',
  'Aircraft return to a pad to rearm once their ammunition is spent.',
  'A Radar Dome brings the minimap online and unlocks advanced technology.',
  'Selling a structure refunds half its cost — useful when the base is lost.',
];

export function initLoadingScreen() {
  const root = document.getElementById('loading');
  if (!root || root.dataset.tips) return;
  root.dataset.tips = '1';
  const tip = root.querySelector('.ld-tip-t') as HTMLElement | null;
  const pct = root.querySelector('.ld-pct') as HTMLElement | null;
  const bar = root.querySelector('.bar div') as HTMLElement | null;
  let i = Math.floor(Math.random() * TIPS.length);
  /** `animate` is off when the screen appears: game construction blocks the main thread right after,
   *  so a fade-in started then would leave the tip invisible for the whole load. */
  const next = (animate = true) => {
    if (!tip) return;
    i = (i + 1) % TIPS.length;
    tip.classList.remove('in');
    if (animate) void tip.offsetWidth;
    tip.innerHTML = TIPS[i];
    if (animate) tip.classList.add('in');
  };
  next(false);
  const visible = () => root.style.display !== 'none' && root.style.opacity !== '0';
  setInterval(() => { if (visible()) next(); }, 4500);
  let wasVisible = visible();
  new MutationObserver(() => {
    const v = visible();
    if (v && !wasVisible) next(false);
    wasVisible = v;
  }).observe(root, { attributes: true, attributeFilter: ['style'] });
  if (bar && pct) {
    const sync = () => { pct.textContent = bar.style.width ? `${parseInt(bar.style.width, 10)}%` : ''; };
    sync();
    new MutationObserver(sync).observe(bar, { attributes: true, attributeFilter: ['style'] });
  }
}
