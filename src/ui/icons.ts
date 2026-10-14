/**
 * Inline SVG icon set, faction emblems and medals (emoji glyphs render inconsistently across
 * systems, so every pictogram in the UI comes from here).
 */
const svg = (body: string, extra = '') =>
  `<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;
const solid = (body: string, vb = '0 0 24 24') =>
  `<svg class="ic" viewBox="${vb}" width="1em" height="1em" fill="currentColor" stroke="none" aria-hidden="true">${body}</svg>`;

const f = (n: number) => n.toFixed(2);

/** Points of an n-pointed star (alternating outer / inner radius), first point straight up. */
function starPoints(cx: number, cy: number, R: number, r: number, n = 5): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const rr = i % 2 ? r : R;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pts;
}
export function starPath(cx: number, cy: number, R: number, r = R * 0.4): string {
  return 'M' + starPoints(cx, cy, R, r).map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
}
/** A star split into lit / shaded facets so it reads as a bevelled metal badge. */
export function bevelStar(cx: number, cy: number, R: number, r: number, light: string, dark: string): string {
  const pts = starPoints(cx, cy, R, r);
  let out = '';
  for (let i = 0; i < pts.length; i += 2) {
    const tip = pts[i], prev = pts[(i + pts.length - 1) % pts.length], next = pts[i + 1];
    out += `<path d="M${f(cx)} ${f(cy)}L${f(prev[0])} ${f(prev[1])}L${f(tip[0])} ${f(tip[1])}Z" fill="${light}"/>`;
    out += `<path d="M${f(cx)} ${f(cy)}L${f(tip[0])} ${f(tip[1])}L${f(next[0])} ${f(next[1])}Z" fill="${dark}"/>`;
  }
  return out;
}
function gearPath(cx: number, cy: number, ro: number, ri: number, teeth: number): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    const seq: [number, number][] = [[a - step * 0.5, ri], [a - step * 0.2, ri], [a - step * 0.14, ro], [a + step * 0.14, ro], [a + step * 0.2, ri]];
    for (const [ang, rad] of seq) pts.push(`${f(cx + Math.cos(ang) * rad)} ${f(cy + Math.sin(ang) * rad)}`);
  }
  return 'M' + pts.join('L') + 'Z';
}
function sectorPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}`;
  return `M${p(r1, a0)}A${r1} ${r1} 0 0 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
}
const deg = Math.PI / 180;
const trefoil = [90, 210, 330].map((c) => `<path d="${sectorPath(12, 12, 3.4, 10.5, (c - 30) * deg, (c + 30) * deg)}"/>`).join('') + '<circle cx="12" cy="12" r="2"/>';

const cloud = '<path d="M7 15a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17.2 6 4.5 4.5 0 0 1 17 15z"/>';

export const ICONS = {
  // sidebar categories
  building: svg('<path d="M3 21h18M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/><path d="M12 5V2M12 2h5"/>'),
  defense: svg('<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  infantry: svg('<circle cx="12" cy="6" r="3"/><path d="M8 4.5c1-2 7-2 8 0"/><path d="M6 21v-5a6 6 0 0 1 12 0v5"/><path d="M12 13v4"/>'),
  vehicle: svg('<rect x="2" y="13" width="20" height="6" rx="3"/><path d="M6 13v-3h9v3"/><path d="M15 11h7"/><circle cx="6" cy="16" r="1"/><circle cx="12" cy="16" r="1"/><circle cx="18" cy="16" r="1"/>'),
  aircraft: svg('<path d="M12 2c1 0 1.5 1.5 1.5 3v4l8 5v2l-8-2.5V18l2.5 2v1.5L12 20.5 8 21.5V20l2.5-2v-4.5L2.5 16v-2l8-5V5c0-1.5.5-3 1.5-3z"/>'),
  // base modes
  wrench: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
  sell: svg('<path d="M12 2v20"/><path d="M17 6.5c-1-1.5-3-2.5-5-2.5-3 0-5 1.5-5 4s2.5 3.3 5 4 5 1.5 5 4-2 4-5 4c-2.2 0-4.2-1-5.2-2.6"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  // general
  bolt: svg('<path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z"/>'),
  boltSolid: solid('<path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  bell: svg('<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21a2 2 0 0 0 4 0"/>'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><path d="M12 15v2"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  chevL: svg('<path d="M15 6l-6 6 6 6"/>'),
  chevR: svg('<path d="M9 6l6 6-6 6"/>'),
  arrowR: svg('<path d="M4 12h15M13 6l6 6-6 6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  keyboard: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  exit: svg('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M9 8l-4 4 4 4M5 12h11"/>'),
  restart: svg('<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>'),
  play: solid('<path d="M7 4.5l13 7.5-13 7.5z"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8 21h8M10 17h4"/>'),
  star: solid(`<path d="${starPath(12, 12.6, 10, 4.2)}"/>`),
  shield: svg('<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/>'),
  gauge: svg('<path d="M3.5 17a8.5 8.5 0 1 1 17 0"/><path d="M12 17l4.5-5"/><circle cx="12" cy="17" r="1.2"/>'),
  skull: svg('<path d="M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3z"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><path d="M10 20v-2M14 20v-2"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.2"/>'),
  warn: svg('<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.2"/>'),
  success: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>'),
  coin: svg('<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/><path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>'),
  radar: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/>'),
  ore: svg('<path d="M12 2.5l6 6.5-6 12.5L6 9z"/><path d="M6 9h12M9.5 9L12 21.5 14.5 9 12 2.5 9.5 9z"/>'),
  people: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14a5 5 0 0 1 5 5v1"/>'),
  ammo: svg('<path d="M9 21V9.5L10.5 4h3L15 9.5V21z"/><path d="M9 14h6"/>'),
  kills: svg('<circle cx="12" cy="12" r="8"/><path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8"/>'),
  range: svg('<circle cx="5" cy="12" r="1.6"/><path d="M9.5 7.5a6.5 6.5 0 0 1 0 9M13.5 4.5a11 11 0 0 1 0 15M18 2a15 15 0 0 1 0 20"/>'),
  chevrons: svg('<path d="M6 7l6 5 6-5M6 13l6 5 6-5"/>'),
  history: svg('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>'),
  // commands
  attackMove: svg('<circle cx="15" cy="9" r="5.5"/><path d="M15 1.5v3M15 13.5v3M7.5 9h3M19.5 9h3"/><path d="M3 21l7.5-7.5M10.5 13.5H5.5M10.5 13.5v5"/>'),
  stop: svg('<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>'),
  scatter: svg('<path d="M10 10L4 4M4 4v4.5M4 4h4.5M14 10l6-6M20 4h-4.5M20 4v4.5M10 14l-6 6M4 20v-4.5M4 20h4.5M14 14l6 6M20 20h-4.5M20 20v-4.5"/>'),
  deploy: svg('<path d="M12 3v11M7 9.5l5 5 5-5"/><path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15"/>'),
  unload: svg('<rect x="2.5" y="8" width="12" height="9" rx="2"/><circle cx="6" cy="19" r="1.6"/><circle cx="11" cy="19" r="1.6"/><path d="M16 12.5h6M19 9.5l3 3-3 3"/>'),
  home: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  groundFire: svg('<circle cx="12" cy="10" r="5.5"/><path d="M12 2v3M12 15v3M4 10h2.5M17.5 10H20"/><path d="M3 21.5h18"/>'),
  primary: svg('<path d="M5 21V3.5"/><path d="M5 4h12l-2.5 4.5L17 13H5"/>'),
  guard: svg('<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><circle cx="12" cy="11.5" r="2.5"/>'),
  // superweapons
  nuke: solid(trefoil),
  ironCurtain: svg('<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M13 6.5l-4 6.2h3.2L11 17.5l4-6.2h-3.2z" fill="currentColor" stroke="none"/>'),
  chrono: svg('<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3.2"/><ellipse cx="12" cy="12" rx="3.2" ry="8.5"/>'),
  // skirmish setup
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  dusk: svg('<path d="M3 18h18M6.5 18a5.5 5.5 0 0 1 11 0"/><path d="M12 5.5v3M4.5 10.5l2 1.5M19.5 10.5l-2 1.5M8 21.5h8"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  cycle: svg('<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9"/><path d="M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2"/>'),
  rain: svg(cloud + '<path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/>'),
  storm: svg(cloud + '<path d="M12.5 14.5L10.5 18h3l-2 3.5"/>'),
  snow: svg('<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9 3.5l3 2 3-2M9 20.5l3-2 3 2"/>'),
  fog: svg('<path d="M3 8h18M5 12h14M3 16h18M7 20h10"/>'),
  dust: svg('<path d="M3 8h10a3 3 0 1 0-3-3M3 12.5h15a3 3 0 1 1-3 3M3 17h7"/>'),
  auto: svg('<path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21M5.6 5.6l2.5 2.5M15.9 15.9l2.5 2.5M5.6 18.4l2.5-2.5M15.9 8.1l2.5-2.5"/><circle cx="12" cy="12" r="2.2"/>'),
  clear: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  tree: svg('<path d="M12 22v-5"/><path d="M12 2.5l6 8.5h-3l4 6H5l4-6H6z"/>'),
  mountain: svg('<path d="M2 20l7-12 4 6 3-4 6 10z"/><path d="M7.2 11l1.8 1.2 1.8-1.2"/>'),
  desert: svg('<circle cx="16.5" cy="7" r="3"/><path d="M2 18c3.5-3.2 6.5-3.2 10 0s6.5 2.4 10-.8"/><path d="M2 13.5c2.6-2 5-2 7.5-.3"/>'),
  map: svg('<path d="M3 6.5l6-3 6 3 6-3v14l-6 3-6-3-6 3z"/><path d="M9 3.5v14M15 6.5v14"/>'),
  water: svg('<path d="M2 9c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0M2 15c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0"/>'),
  dice: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r=".8" fill="currentColor"/><circle cx="15" cy="15" r=".8" fill="currentColor"/><circle cx="15" cy="9" r=".8" fill="currentColor"/><circle cx="9" cy="15" r=".8" fill="currentColor"/>'),
  cpu: svg('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5"/><rect x="9.5" y="9.5" width="5" height="5" rx=".5"/>'),
  volume: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>'),
  music: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
  monitor: svg('<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  mouse: svg('<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>'),
  bulb: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'),
  motion: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  flag: svg('<path d="M5 21V3.5"/><path d="M5 4h12l-2.5 4.5L17 13H5"/>'),
};

export type IconName = keyof typeof ICONS;

/** Rank chevrons (1 = veteran, 2 = elite). */
export function rankBadge(rank: number): string {
  if (rank <= 0) return '';
  const chev = (y: number) => `<path d="M3 ${y + 5}L12 ${y}l9 ${5}v3.4l-9-5-9 5z"/>`;
  const body = rank >= 2 ? chev(3) + chev(9.5) + `<path d="${starPath(12, 19.5, 3.6, 1.5)}"/>` : chev(7) + chev(13.5);
  return `<svg class="rank-svg r${rank}" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">${body}</svg>`;
}

let uid = 0;
/** Allied emblem: eagle wings around a star roundel. */
export function alliedEmblem(): string {
  const id = `ae${++uid}`;
  let feathers = '';
  for (let k = 5; k >= 0; k--) {
    const a = (198 - k * 11) * deg;
    const L = 60 - k * 6.5, w = 5.8 - k * 0.25;
    const bx = 66, by = 44 + k * 3.2;
    const tx = bx + Math.cos(a) * L, ty = by - Math.sin(a) * L;
    const mx = (bx + tx) / 2, my = (by + ty) / 2;
    const px = -Math.sin(a) * w, py = -Math.cos(a) * w;
    feathers += `<path d="M${f(bx)} ${f(by)}Q${f(mx + px)} ${f(my + py)} ${f(tx)} ${f(ty)}Q${f(mx - px)} ${f(my - py)} ${f(bx)} ${f(by)}Z" fill="url(#${id}w)" stroke="rgba(10,25,60,.55)" stroke-width=".8"/>`;
  }
  return `<svg class="emblem-svg" viewBox="0 0 160 100" aria-hidden="true">
    <defs>
      <linearGradient id="${id}w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f8ff"/><stop offset=".55" stop-color="#9fc4ff"/><stop offset="1" stop-color="#3d7be0"/></linearGradient>
      <radialGradient id="${id}r" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#4d8ff0"/><stop offset="1" stop-color="#0c2a62"/></radialGradient>
    </defs>
    <g>${feathers}</g>
    <g transform="translate(160 0) scale(-1 1)">${feathers}</g>
    <circle cx="80" cy="50" r="26" fill="#0a1c40" stroke="#e8f0ff" stroke-width="3"/>
    <circle cx="80" cy="50" r="20" fill="url(#${id}r)" stroke="rgba(255,255,255,.35)" stroke-width="1"/>
    ${bevelStar(80, 51, 16.5, 6.6, '#ffffff', '#c9d8f2')}
  </svg>`;
}

/** Soviet emblem: a red star on a cog wheel (generic, no political symbols). */
export function sovietEmblem(): string {
  const id = `se${++uid}`;
  return `<svg class="emblem-svg" viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <radialGradient id="${id}g" cx=".4" cy=".35" r=".85"><stop offset="0" stop-color="#7a2219"/><stop offset="1" stop-color="#2a0806"/></radialGradient>
      <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd7a0"/><stop offset="1" stop-color="#b8862e"/></linearGradient>
    </defs>
    <path d="${gearPath(50, 50, 47, 40, 14)}" fill="url(#${id}g)" stroke="url(#${id}s)" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="50" cy="50" r="33" fill="#160504" stroke="rgba(255,190,120,.55)" stroke-width="1.4"/>
    ${bevelStar(50, 52, 29, 11.5, '#ff6a50', '#b3160c')}
    <path d="${starPath(50, 52, 29, 11.5)}" fill="none" stroke="#ffcf8a" stroke-width="1" stroke-linejoin="round" opacity=".8"/>
  </svg>`;
}

export function factionEmblem(faction: string): string {
  return faction === 'soviet' ? sovietEmblem() : alliedEmblem();
}

export type MedalTier = 's' | 'a' | 'b' | 'c' | 'd' | 'e';
const MEDAL_METAL: Record<MedalTier, [string, string, string, string]> = {
  // light, mid, dark, ribbon
  s: ['#fff6cf', '#ffd34d', '#a8741a', '#c4202a'],
  a: ['#fff1c2', '#e8b84a', '#8a5f16', '#2a5bd0'],
  b: ['#ffffff', '#c9d2dc', '#6c7884', '#2a5bd0'],
  c: ['#ffe0c4', '#d08a4e', '#7a4520', '#3f8a4a'],
  d: ['#e8eef4', '#9aa6b2', '#4a545e', '#5a6470'],
  e: ['#c8ccd0', '#7c8288', '#33383d', '#4a2a2a'],
};
/** A campaign medal: ribbon + bevelled star medallion. */
export function medalSvg(tier: MedalTier): string {
  const id = `md${++uid}`;
  const [lt, mid, dk, rib] = MEDAL_METAL[tier];
  const stars = tier === 's' ? 3 : tier === 'a' ? 2 : tier === 'b' ? 1 : 0;
  let pips = '';
  for (let i = 0; i < stars; i++) pips += `<path d="${starPath(60 + (i - (stars - 1) / 2) * 13, 16, 5, 2.1)}" fill="${lt}"/>`;
  return `<svg class="medal-svg" viewBox="0 0 120 170" aria-hidden="true">
    <defs>
      <linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lt}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${dk}"/></linearGradient>
      <linearGradient id="${id}r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${rib}"/><stop offset=".22" stop-color="${rib}"/><stop offset=".22" stop-color="#f2f2f2"/><stop offset=".34" stop-color="#f2f2f2"/><stop offset=".34" stop-color="${rib}"/><stop offset=".66" stop-color="${rib}"/><stop offset=".66" stop-color="#f2f2f2"/><stop offset=".78" stop-color="#f2f2f2"/><stop offset=".78" stop-color="${rib}"/></linearGradient>
    </defs>
    <path d="M28 0h64l-8 78H36z" fill="url(#${id}r)"/>
    <path d="M28 0h64l-8 78H36z" fill="rgba(0,0,0,.18)" style="mix-blend-mode:multiply"/>
    ${pips}
    <rect x="40" y="70" width="40" height="12" rx="3" fill="url(#${id}m)" stroke="${dk}" stroke-width="1"/>
    <circle cx="60" cy="118" r="40" fill="url(#${id}m)" stroke="${dk}" stroke-width="2"/>
    <circle cx="60" cy="118" r="32" fill="none" stroke="${lt}" stroke-opacity=".7" stroke-width="1.5" stroke-dasharray="2 3"/>
    ${bevelStar(60, 120, 26, 10.5, lt, dk)}
  </svg>`;
}
