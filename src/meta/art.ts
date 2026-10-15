/**
 * Inline SVG art for the progression layer: medal pictograms, achievement medals and rank insignia.
 * Everything is generated (no emoji, no bitmaps) and safe to inject as innerHTML.
 */

let uid = 0;
const f = (n: number) => n.toFixed(2);

function starPts(cx: number, cy: number, R: number, r: number, n = 5): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const rr = i % 2 ? r : R;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pts;
}
export function star(cx: number, cy: number, R: number, r = R * 0.42): string {
  return 'M' + starPts(cx, cy, R, r).map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
}
/** Bevelled (two-tone) star. */
function bevel(cx: number, cy: number, R: number, r: number, light: string, dark: string): string {
  const pts = starPts(cx, cy, R, r);
  let out = '';
  for (let i = 0; i < pts.length; i += 2) {
    const tip = pts[i], prev = pts[(i + pts.length - 1) % pts.length], next = pts[i + 1];
    out += `<path d="M${f(cx)} ${f(cy)}L${f(prev[0])} ${f(prev[1])}L${f(tip[0])} ${f(tip[1])}Z" fill="${light}"/>`;
    out += `<path d="M${f(cx)} ${f(cy)}L${f(tip[0])} ${f(tip[1])}L${f(next[0])} ${f(next[1])}Z" fill="${dark}"/>`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pictograms: 24x24, drawn with stroke="currentColor" (fill marked explicitly where solid)
// ---------------------------------------------------------------------------
const S = 'fill="currentColor" stroke="none"';
export const PICTO: Record<string, string> = {
  crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.6" ' + S + '/>',
  skull: '<path d="M5 11a7 7 0 1 1 14 0c0 2.4-1 3.6-2 4.3V18H7v-2.7C6 14.6 5 13.4 5 11z"/><circle cx="9.3" cy="11" r="1.7" ' + S + '/><circle cx="14.7" cy="11" r="1.7" ' + S + '/><path d="M10 18v3M14 18v3M12 14.5l-.9 1.5h1.8z"/>',
  tank: '<rect x="3" y="13" width="18" height="5" rx="2.5"/><path d="M7 13v-3h7l2 3"/><path d="M11 10.5h9"/><circle cx="7" cy="15.5" r=".9" ' + S + '/><circle cx="12" cy="15.5" r=".9" ' + S + '/><circle cx="17" cy="15.5" r=".9" ' + S + '/>',
  mammoth: '<rect x="2.5" y="14" width="19" height="5" rx="2.5"/><path d="M6 14v-3.5h8l2 3.5"/><path d="M11 9.6h10M11 12h10"/><path d="M5 10.5V8h3v2.5"/>',
  building: '<path d="M4 21V9l5-3v15M9 21V4h8v17M4 21h16"/><path d="M12 8h2M12 11h2M12 14h2"/><path d="M19 4l2-2M20 7h2M18 1.5v1.5" />',
  plane: '<path d="M12 2c1 0 1.6 1.4 1.6 3v4.4l7.4 4.2v2l-7.4-2.2v4.3l2.4 2v1.6L12 20.4l-4 .9v-1.6l2.4-2v-4.3L3 15.6v-2l7.4-4.2V5c0-1.6.6-3 1.6-3z"/>',
  tread: '<rect x="3" y="6" width="18" height="12" rx="6"/><path d="M7 6v12M11 6v12M15 6v12M19 7.5v9"/>',
  pistol: '<path d="M3 8h16l1.5 2.5H10l-1 2H7l-1.5 6.5H2.5L4 12 3 8z"/><path d="M10 10.5c0 2 .8 3 2.5 3"/><path d="M15 8V6.5"/>',
  chevrons: '<path d="M5 13l7-4 7 4M5 18l7-4 7 4"/><path d="' + star(12, 5, 3.2, 1.3) + '" ' + S + '/>',
  bolt: '<path d="M13 2L4.5 13.5H11L10 22l9-12h-6.5L13 2z"/>',
  capture: '<path d="M4 21V11l6-4 6 4v10H4z"/><path d="M8 21v-5h4v5"/><path d="M16 11V2.5l5 2-5 2"/>',
  nuke: '<circle cx="12" cy="12" r="9.5"/><path d="M12 12l-4.8-8.2A9.5 9.5 0 0 1 16.8 3.8z" ' + S + '/><path d="M12 12l9.5 0a9.5 9.5 0 0 1-4.8 8.2z" ' + S + '/><path d="M12 12l-4.8 8.2A9.5 9.5 0 0 1 2.5 12z" ' + S + '/><circle cx="12" cy="12" r="2.2" fill="#000" stroke="none" opacity=".55"/>',
  chrono: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3.5 2"/><path d="M3 5.5A10.5 10.5 0 0 1 9 2.4M21 18.5A10.5 10.5 0 0 1 15 21.6"/><path d="M9 2.4L7.6 5M15 21.6l1.4-2.6"/>',
  curtain: '<path d="M12 2.5l8 3v6.2c0 4.6-3.4 8.3-8 9.8-4.6-1.5-8-5.2-8-9.8V5.5z"/><path d="M8 9c1.3 1 2.7 1 4 0s2.7-1 4 0M8 13c1.3 1 2.7 1 4 0s2.7-1 4 0"/>',
  trophy: '<path d="M7 3h10v5a5 5 0 0 1-10 0V3z"/><path d="M7 5H3.5c0 3 1.5 4.5 3.8 4.6M17 5h3.5c0 3-1.5 4.5-3.8 4.6"/><path d="M12 13v4M8 21h8M9.5 17h5v4h-5z"/>',
  ironwill: '<path d="M12 2.5l8 3v6.2c0 4.6-3.4 8.3-8 9.8-4.6-1.5-8-5.2-8-9.8V5.5z"/><path d="' + star(12, 11.5, 5, 2) + '" ' + S + '/>',
  untouchable: '<path d="M12 2.5l8 3v6.2c0 4.6-3.4 8.3-8 9.8-4.6-1.5-8-5.2-8-9.8V5.5z"/><path d="M8 12l3 3 5-6"/>',
  stopwatch: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M10 2.5h4M12 2.5V6M18.5 6.5l1.5-1.5"/>',
  odds: '<circle cx="12" cy="7" r="2.6"/><circle cx="5" cy="9.5" r="2.2"/><circle cx="19" cy="9.5" r="2.2"/><path d="M7.5 20v-3a4.5 4.5 0 0 1 9 0v3M1.5 20v-2.2a3.5 3.5 0 0 1 5-3.2M22.5 20v-2.2a3.5 3.5 0 0 0-5-3.2"/>',
  flames: '<path d="M12 22c-4 0-7-2.6-7-6.5 0-3.4 2.4-5.2 3.6-8.1.6 1.8 1.6 2.8 2.6 3.2C11 7 12.8 4 15.6 2c-.4 3.2.9 5.4 2.2 7.3 1 1.5 1.2 3 1.2 4.6 0 4.6-3 8.1-7 8.1z"/><path d="M12 22c-1.8 0-3-1.2-3-3 0-2 1.5-3 2.2-4.6.9 1.6 3.8 2.3 3.8 4.8 0 1.6-1.3 2.8-3 2.8z"/>',
  storm: '<path d="M7 15a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17.2 6 4.5 4.5 0 0 1 17 15"/><path d="M13 12l-3 5h3l-2 5"/>',
  globe: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.6 3.8 6 3.8 9.5S14.6 18.9 12 21.5c-2.6-2.6-3.8-6-3.8-9.5S9.4 5.1 12 2.5z"/>',
  helmet: '<path d="M3 16a9 9 0 0 1 18 0"/><path d="M1.5 16h21v2.5h-21z"/><path d="M8 9.5c1.2-.9 2.5-1.3 4-1.3"/><path d="M12 7v-2"/>',
  laurel: '<path d="M12 20c-5 0-8.5-4-8.5-9.5M12 20c5 0 8.5-4 8.5-9.5"/><path d="M4.5 15c-1.6 0-2.6-1-3-2.4 1.6-.3 2.7.3 3 2.4zM6.5 18c-1.4.7-2.8.4-3.6-.6 1.3-.8 2.6-.6 3.6.6zM3.8 11.5c-1.4-.6-2-1.9-1.8-3.2 1.5.4 2.2 1.5 1.8 3.2zM19.5 15c1.6 0 2.6-1 3-2.4-1.6-.3-2.7.3-3 2.4zM17.5 18c1.4.7 2.8.4 3.6-.6-1.3-.8-2.6-.6-3.6.6zM20.2 11.5c1.4-.6 2-1.9 1.8-3.2-1.5.4-2.2 1.5-1.8 3.2z" ' + S + '/><path d="' + star(12, 9, 4.5, 1.9) + '" ' + S + '/>',
  wall: '<path d="M2 6h20v13H2z"/><path d="M2 10.3h20M2 14.6h20M7 6v4.3M14 6v4.3M10.5 10.3v4.3M17.5 10.3v4.3M7 14.6V19M14 14.6V19"/>',
  ore: '<path d="M12 2.5l6 6-6 13-6-13z"/><path d="M6 8.5h12M9 8.5l3 13 3-13M9 8.5l3-6 3 6"/>',
  crate: '<path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/><path d="M7.5 5.2l9 4.6"/>',
  liberty: '<path d="M5 21V3.5"/><path d="M5 4h14v9H5"/><path d="' + star(12, 8.5, 3.2, 1.3) + '" ' + S + '/>',
  motherland: '<path d="' + star(12, 12.5, 10, 4.1) + '"/><path d="' + star(12, 12.5, 4.6, 1.9) + '" ' + S + '/>',
  stars3: '<path d="' + star(12, 7, 5, 2) + '"/><path d="' + star(5.5, 16.5, 4.4, 1.8) + '"/><path d="' + star(18.5, 16.5, 4.4, 1.8) + '"/>',
  tower: '<path d="M5 21V8h14v13M3 21h18"/><path d="M5 8V4h2.5v2h3V4h3v2h3V4H19v4"/><path d="M10 21v-5a2 2 0 0 1 4 0v5"/>',
  sword: '<path d="M14.5 3H21v6.5L10 20.5 3.5 14z"/><path d="M6.5 11l6.5 6.5M3 21l3-3M17.5 6.5l-6 6"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M8.5 15l2.5 2.5 4.5-4.5"/>',
  streak: '<path d="M12 22c-4 0-7-2.6-7-6.5 0-3.4 2.4-5.2 3.6-8.1.6 1.8 1.6 2.8 2.6 3.2C11 7 12.8 4 15.6 2c-.4 3.2.9 5.4 2.2 7.3 1 1.5 1.2 3 1.2 4.6 0 4.6-3 8.1-7 8.1z"/>',
  phoenix: '<path d="M12 21c-1.2-3-1.2-5.5 0-8 1.2 2.5 1.2 5 0 8z" ' + S + '/><path d="M12 13C9 10 5 10 2 12c2-4 6-6 10-3 4-3 8-1 10 3-3-2-7-2-10 1z"/><path d="M12 9V5.5M10.5 4.5L12 3l1.5 1.5"/>',
  paw: '<ellipse cx="12" cy="15.5" rx="4.5" ry="4" ' + S + '/><ellipse cx="6" cy="10" rx="1.9" ry="2.4" ' + S + '/><ellipse cx="18" cy="10" rx="1.9" ry="2.4" ' + S + '/><ellipse cx="9.3" cy="6" rx="1.9" ry="2.4" ' + S + '/><ellipse cx="14.7" cy="6" rx="1.9" ry="2.4" ' + S + '/>',
  fire: '<path d="M12 22c-4 0-7-2.6-7-6.5 0-3.4 2.4-5.2 3.6-8.1.6 1.8 1.6 2.8 2.6 3.2C11 7 12.8 4 15.6 2c-.4 3.2.9 5.4 2.2 7.3 1 1.5 1.2 3 1.2 4.6 0 4.6-3 8.1-7 8.1z"/><path d="M8 18h8"/>',
  lightning: '<circle cx="12" cy="12" r="9.5"/><path d="M13 5l-5 8h4l-1 6 5-8h-4z" ' + S + '/>',
  wings: '<path d="M12 9.5c-3-3-7.5-3.5-10.5-2.5 1 2.5 3.5 3.6 5 3.8-1.6.4-2.8 1.5-3.5 3 2.4.6 5.4-.2 9-2.8 3.6 2.6 6.6 3.4 9 2.8-.7-1.5-1.9-2.6-3.5-3 1.5-.2 4-1.3 5-3.8-3-1-7.5-.5-10.5 2.5z"/><circle cx="12" cy="12.5" r="2.4" ' + S + '/><path d="M12 15v5"/>',
  mushroom: '<path d="M5 11c0-4 3-7 7-7s7 3 7 7c0 1.7-1.5 2.5-3 2.5H8c-1.5 0-3-.8-3-2.5z"/><path d="M10 13.5v5.5h4v-5.5"/><path d="M5 21h14"/>',
  coin: '<ellipse cx="12" cy="6.5" rx="7.5" ry="3"/><path d="M4.5 6.5v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5M4.5 11.5v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5"/>',
  medal: '<circle cx="12" cy="15" r="6"/><path d="M8.5 10L5 2.5h4.5L12 8l2.5-5.5H19L15.5 10"/><path d="' + star(12, 15.2, 3.2, 1.3) + '" ' + S + '/>',
  question: '<circle cx="12" cy="12" r="9.5"/><path d="M9.2 9.3a2.9 2.9 0 0 1 5.6 1c0 2-2.8 2.4-2.8 4.2"/><circle cx="12" cy="17.6" r="1.1" ' + S + '/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  // challenge-screen glyphs
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5"/>',
  dust: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>',
  glass: '<path d="M7 3h10l-1 8a4 4 0 0 1-8 0z"/><path d="M12 15v5M8.5 21h7M9 6l2.5 3.5L10 11"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  radarOff: '<path d="M12 12L19 5"/><path d="M19.8 9A8.5 8.5 0 1 1 15 3.6"/><path d="M15.8 11.4A4 4 0 1 1 12.6 8"/><path d="M3 21L21 3"/>',
  shield: '<path d="M12 2.5l8 3v6.2c0 4.6-3.4 8.3-8 9.8-4.6-1.5-8-5.2-8-9.8V5.5z"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" ' + S + '/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  flag: '<path d="M5 21V3.5"/><path d="M5 4h12l-2.5 4.5L17 13H5"/>',
  wave: '<path d="M2 15c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3M2 9.5c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/>',
  tree: '<path d="M12 2l6 8h-3l4 6H5l4-6H6z"/><path d="M12 16v6"/>',
  chart: '<path d="M3 21h18M6 17V10M11 17V5M16 17v-5M21 17V8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  anchor: '<circle cx="12" cy="5" r="2.2"/><path d="M12 7.2V21M7 11h10M4.5 14.5c0 3.8 3.4 6.5 7.5 6.5s7.5-2.7 7.5-6.5"/><path d="M4.5 14.5l-1.8 1.6M19.5 14.5l1.8 1.6"/>',
  periscope: '<path d="M9 21V8h4V4h6v4M9 13h-3v3"/><path d="M2 21c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/>',
  spy: '<path d="M5 10.5h14M7 10.5l1.2-5h7.6l1.2 5"/><circle cx="8.8" cy="15" r="2.6"/><circle cx="15.2" cy="15" r="2.6"/><path d="M11.4 15h1.2M4 21c1.5-2 4-3 8-3s6.5 1 8 3"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9.5v5M18 9.5v5"/>',
  parachute: '<path d="M3 11a9 7 0 0 1 18 0z"/><path d="M3 11l9 7 9-7M9 11l3 7 3-7"/><circle cx="12" cy="20" r="1.6"/>',
  bridge: '<path d="M2 9h20M4 9v8M20 9v8"/><path d="M4 17c2.5-5 13.5-5 16 0"/><path d="M8 9v3.5M12 9v2.2M16 9v3.5"/><path d="M2 20h20"/>',
  mine: '<ellipse cx="12" cy="15" rx="8" ry="3.5"/><path d="M4 15v1.5c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5V15"/><path d="M12 11.5V7M9.5 7h5M7.5 9.5l1.5 2M16.5 9.5l-1.5 2"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  play: '<path d="M7 4.5v15l12-7.5z" ' + S + '/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
};

/** A pictogram as a standalone inline SVG (1em, currentColor). */
export function picto(name: string, cls = 'mx-ic'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PICTO[name] ?? PICTO.medal}</svg>`;
}

// ---------------------------------------------------------------------------
// Medals
// ---------------------------------------------------------------------------
export type Metal = 'bronze' | 'silver' | 'gold' | 'platinum';
const METAL: Record<Metal, [string, string, string, string]> = {
  // light, mid, dark, glow
  bronze: ['#ffe2c6', '#d08a4e', '#6e3c18', 'rgba(255,150,80,.55)'],
  silver: ['#ffffff', '#c9d3de', '#5e6b78', 'rgba(200,225,255,.55)'],
  gold: ['#fff6cf', '#ffcf3f', '#8f5c0f', 'rgba(255,205,70,.65)'],
  platinum: ['#ffffff', '#b8e4ff', '#4b5fa8', 'rgba(150,200,255,.8)'],
};
export const RIBBON: Record<string, [string, string]> = {
  combat: ['#b3241b', '#f2f2f2'],
  career: ['#244f9e', '#f2f2f2'],
  economy: ['#1f7a45', '#ffd34d'],
  campaign: ['#2a3f78', '#c7302a'],
  challenge: ['#5a2a8e', '#ffcf3f'],
  secret: ['#141414', '#c9a24a'],
};

/**
 * A medal as SVG (viewBox 64x84): ribbon, medallion in the given metal and the category pictogram.
 * `locked` renders a dull iron blank with a lock; `hidden` replaces the pictogram with a question mark.
 */
export function medalSvg(opts: { metal: Metal; picto: string; category: string; locked?: boolean; hidden?: boolean; size?: number }): string {
  const id = `mx${++uid}`;
  const [lt, mid, dk] = opts.locked ? ['#5b636c', '#3a4048', '#1d2126'] : METAL[opts.metal];
  const [r1, r2] = opts.locked ? ['#2a2f36', '#3c434c'] : RIBBON[opts.category] ?? RIBBON.combat;
  const pic = opts.hidden ? PICTO.question : PICTO[opts.picto] ?? PICTO.medal;
  const sunburst = !opts.locked && (opts.metal === 'gold' || opts.metal === 'platinum');
  let rays = '';
  if (sunburst) {
    const n = opts.metal === 'platinum' ? 16 : 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const a1 = a - 0.11, a2 = a + 0.11;
      rays += `M32 ${f(54)}L${f(32 + Math.cos(a1) * 29)} ${f(54 + Math.sin(a1) * 29)}L${f(32 + Math.cos(a2) * 29)} ${f(54 + Math.sin(a2) * 29)}Z`;
    }
  }
  const size = opts.size ? ` width="${opts.size}" height="${(opts.size * 84) / 64}"` : '';
  return `<svg class="mx-medal${opts.locked ? ' locked' : ''}" viewBox="0 0 64 84"${size} aria-hidden="true">
  <defs>
    <linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lt}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${dk}"/></linearGradient>
    <linearGradient id="${id}i" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${lt}"/><stop offset=".55" stop-color="${mid}"/><stop offset="1" stop-color="${dk}"/></linearGradient>
    <linearGradient id="${id}r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${r1}"/><stop offset=".3" stop-color="${r1}"/><stop offset=".3" stop-color="${r2}"/><stop offset=".42" stop-color="${r2}"/><stop offset=".42" stop-color="${r1}"/><stop offset=".58" stop-color="${r1}"/><stop offset=".58" stop-color="${r2}"/><stop offset=".7" stop-color="${r2}"/><stop offset=".7" stop-color="${r1}"/></linearGradient>
    <radialGradient id="${id}g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${mid}" stop-opacity=".55"/><stop offset="1" stop-color="${mid}" stop-opacity="0"/></radialGradient>
  </defs>
  <path d="M14 0h36l-7 30H21z" fill="url(#${id}r)"/>
  <path d="M14 0h36l-7 30H21z" fill="#000" opacity=".22"/>
  <path d="M14 0h4l7 30h-4zM46 0h4l-7 30h-4z" fill="#fff" opacity=".1"/>
  ${sunburst ? `<circle cx="32" cy="54" r="30" fill="url(#${id}g)"/><path d="${rays}" fill="${mid}" opacity=".55"/>` : ''}
  <rect x="22" y="26" width="20" height="7" rx="2" fill="url(#${id}m)" stroke="${dk}" stroke-width=".8"/>
  <circle cx="32" cy="54" r="22" fill="url(#${id}m)" stroke="${dk}" stroke-width="1.4"/>
  <circle cx="32" cy="54" r="17.5" fill="url(#${id}i)" stroke="${lt}" stroke-opacity=".55" stroke-width=".8"/>
  <circle cx="32" cy="54" r="19.6" fill="none" stroke="${lt}" stroke-opacity=".5" stroke-width=".7" stroke-dasharray="1.4 2.2"/>
  <g transform="translate(19.4 41.4) scale(1.05)" fill="none" stroke="${dk}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" color="${dk}" opacity=".9">${pic}</g>
  <g transform="translate(19 41) scale(1.05)" fill="none" stroke="${opts.locked ? '#8a939c' : lt}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" color="${opts.locked ? '#8a939c' : lt}">${pic}</g>
  ${opts.locked ? `<g transform="translate(40 62) scale(.62)"><circle cx="12" cy="12" r="12" fill="#14181d" stroke="#5b636c"/><g fill="none" stroke="#aab3bc" stroke-width="2" stroke-linecap="round">${PICTO.lock}</g></g>` : ''}
</svg>`;
}

// ---------------------------------------------------------------------------
// Rank insignia (viewBox 64x64): a shoulder-board shield with chevrons, bars, stars and laurels
// ---------------------------------------------------------------------------
export type InsigniaFaction = 'allies' | 'soviet';

function chevron(y: number, w = 22, h = 8, t = 5.2): string {
  return `M${32 - w} ${y + h}L32 ${y}L${32 + w} ${y + h}L${32 + w} ${y + h + t}L32 ${y + t}L${32 - w} ${y + h + t}Z`;
}
function laurel(cx: number, cy: number, r: number, from: number, to: number, side: 1 | -1, leaf: string, stem: string): string {
  // leaves along an arc on one side (angles in degrees, 90 = bottom)
  let out = '';
  const steps = Math.max(3, Math.round((to - from) / 17));
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    const x = cx + side * Math.cos(a) * r, y = cy + Math.sin(a) * r;
    pts.push(`${f(x)} ${f(y)}`);
    if (i === steps) continue;
    const rot = (Math.atan2(Math.sin(a), side * Math.cos(a)) * 180) / Math.PI + (side > 0 ? 90 : -90);
    out += `<ellipse cx="${f(x + side * Math.cos(a) * 2.2)}" cy="${f(y + Math.sin(a) * 2.2)}" rx="1.9" ry="4.4" transform="rotate(${f(rot + side * 35)} ${f(x + side * Math.cos(a) * 2.2)} ${f(y + Math.sin(a) * 2.2)})" fill="${leaf}"/>`;
    out += `<ellipse cx="${f(x - side * Math.cos(a) * 1.6)}" cy="${f(y - Math.sin(a) * 1.6)}" rx="1.6" ry="3.8" transform="rotate(${f(rot - side * 35)} ${f(x - side * Math.cos(a) * 1.6)} ${f(y - Math.sin(a) * 1.6)})" fill="${leaf}" opacity=".85"/>`;
  }
  return `<path d="M${pts.join('L')}" fill="none" stroke="${stem}" stroke-width="1.2"/>` + out;
}

/** Rank insignia for rank index 0..14. */
export function insigniaSvg(rank: number, faction: InsigniaFaction = 'allies', size?: number): string {
  const id = `ri${++uid}`;
  const sov = faction === 'soviet';
  const tierGroup = rank >= 14 ? 'marshal' : rank >= 10 ? 'general' : rank >= 7 ? 'field' : rank >= 4 ? 'officer' : 'enlisted';
  const gold: [string, string, string] = ['#fff4c8', '#ffcc3a', '#9a6510'];
  const silver: [string, string, string] = ['#ffffff', '#cfd8e2', '#66727e'];
  const rimMetal = tierGroup === 'enlisted' ? silver : tierGroup === 'officer' && rank > 4 ? silver : gold;
  const plate = sov ? ['#7a1810', '#3a0805', '#1c0302'] : ['#1f3d73', '#0f2148', '#060f24'];
  const sym = tierGroup === 'enlisted' ? (sov ? gold : silver) : tierGroup === 'officer' ? (rank === 4 ? gold : silver) : gold;
  const shape = 'M8 5.5Q8 3.5 10 3.5H54Q56 3.5 56 5.5V36C56 49.5 45 57 32 61.5C19 57 8 49.5 8 36Z';
  let body = '';
  const fillSym = `url(#${id}s)`;
  switch (tierGroup) {
    case 'enlisted': {
      if (rank === 0) body = `<rect x="17" y="27" width="30" height="6" rx="2" fill="${fillSym}" stroke="${sym[2]}" stroke-width=".8"/>`;
      else {
        const n = rank, gap = 10.5;
        const y0 = 30 - ((n - 1) * gap) / 2 - 6;
        for (let k = 0; k < n; k++) body += `<path d="${chevron(y0 + k * gap)}" fill="${fillSym}" stroke="${sym[2]}" stroke-width=".8" stroke-linejoin="round"/>`;
      }
      break;
    }
    case 'officer': {
      const n = rank === 6 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const y = n === 1 ? 25 : 18 + k * 15;
        body += `<rect x="16" y="${y}" width="32" height="10" rx="1.6" fill="${fillSym}" stroke="${sym[2]}" stroke-width=".9"/><rect x="18" y="${y + 1.6}" width="28" height="2" rx="1" fill="#fff" opacity=".45"/>`;
      }
      break;
    }
    case 'field': {
      body += `<rect x="17.6" y="5" width="3.4" height="47" fill="${rimMetal[1]}" opacity=".9"/><rect x="43" y="5" width="3.4" height="47" fill="${rimMetal[1]}" opacity=".9"/>`;
      const n = rank - 6;
      const ys = n === 1 ? [28] : n === 2 ? [19.5, 37.5] : [14.5, 29, 43.5];
      const r = n === 3 ? 7.6 : 9.2;
      for (const y of ys) body += bevel(32, y, r, r * 0.41, sym[0], sym[2]);
      break;
    }
    case 'general': {
      body += laurel(32, 34, 20, 20, 120, 1, '#d8a93a', '#a8741a') + laurel(32, 34, 20, 20, 120, -1, '#d8a93a', '#a8741a');
      const n = rank - 9;
      const pos: [number, number, number][] =
        n === 1 ? [[32, 27, 11]] : n === 2 ? [[23, 27, 8.4], [41, 27, 8.4]] : n === 3 ? [[32, 19.5, 7.6], [22.5, 33, 7.6], [41.5, 33, 7.6]] : [[32, 15.5, 6.8], [21.5, 27, 6.8], [42.5, 27, 6.8], [32, 38.5, 6.8]];
      for (const [x, y, r] of pos) body += bevel(x, y, r, r * 0.41, sym[0], sym[2]);
      break;
    }
    case 'marshal': {
      body += laurel(32, 31, 21, -55, 125, 1, '#e6b84a', '#a8741a') + laurel(32, 31, 21, -55, 125, -1, '#e6b84a', '#a8741a');
      body += `<path d="M18 47L46 19M18 19L46 47" stroke="#2a1606" stroke-width="4.6" stroke-linecap="round"/><path d="M18 47L46 19M18 19L46 47" stroke="url(#${id}s)" stroke-width="3" stroke-linecap="round"/>`;
      body += bevel(32, 32, 13.5, 5.6, '#ffffff', '#d9a520');
      body += `<path d="${star(32, 32, 13.5, 5.6)}" fill="none" stroke="#fff6cf" stroke-width=".8" stroke-linejoin="round"/>`;
      body += `<circle cx="32" cy="32" r="2.2" fill="#fff" opacity=".9"/>`;
      break;
    }
  }
  const sz = size ? ` width="${size}" height="${size}"` : '';
  const glow = tierGroup === 'marshal' || tierGroup === 'general';
  return `<svg class="rk-ins rk-${tierGroup}" viewBox="0 0 64 64"${sz} aria-hidden="true">
  <defs>
    <linearGradient id="${id}p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${plate[0]}"/><stop offset=".55" stop-color="${plate[1]}"/><stop offset="1" stop-color="${plate[2]}"/></linearGradient>
    <linearGradient id="${id}r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${rimMetal[0]}"/><stop offset=".5" stop-color="${rimMetal[1]}"/><stop offset="1" stop-color="${rimMetal[2]}"/></linearGradient>
    <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sym[0]}"/><stop offset=".5" stop-color="${sym[1]}"/><stop offset="1" stop-color="${sym[2]}"/></linearGradient>
    <linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  ${glow ? `<path d="${shape}" fill="none" stroke="${gold[1]}" stroke-width="5" opacity=".28"/>` : ''}
  <path d="${shape}" fill="url(#${id}p)" stroke="url(#${id}r)" stroke-width="2.6" stroke-linejoin="round"/>
  <path d="M11.5 7H52.5V35.5C52.5 47.5 43 54 32 58C21 54 11.5 47.5 11.5 35.5Z" fill="none" stroke="${rimMetal[1]}" stroke-opacity=".35" stroke-width=".8"/>
  ${body}
  <path d="${shape}" fill="url(#${id}h)"/>
</svg>`;
}
