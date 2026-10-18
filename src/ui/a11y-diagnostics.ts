/**
 * "Copy diagnostics": a plain-text report for bug reports, copied to the clipboard. Nothing is sent anywhere.
 *
 * Holds: game and simulation versions, browser and OS (user agent), GPU, screen, the settings that matter,
 * the running battle's quality / HD-model / terrain status (registered by the game), recent errors (the
 * platform/errors.ts ring) and recent console warnings. Never the callsign or the profile name: they are
 * left out and also redacted from any message that happens to contain them. Page URLs are reduced to paths.
 *
 * Light module (the menu loads it): no renderer imports. The battle registers its status with
 * registerDiagnostics() so the report can include it.
 */
import { GAME_TITLE, VERSION } from '../config';
import { SIM_VERSION } from '../sim/version';
import { copyText, recentErrors, reportGpu, setDiagnosticsBuilder, type ErrorRecord } from '../platform/errors';
import { currentLang, languagePref } from '../i18n/core';

/** The report's headings: the report is for developers, so it stays in English whatever the interface language. */
const DIAG_TEXT = {
  title: 'diagnostics',
  errors: 'Recent errors (newest first)',
  warnings: 'Recent warnings (newest first)',
  none: '(none)',
} as const;

type Value = string | number | boolean | null | undefined;
export type DiagnosticsSource = () => Record<string, Value>;

const sources = new Map<string, DiagnosticsSource>();

/** Add a named block of status lines (e.g. the running battle); dispose() removes it. */
export function registerDiagnostics(name: string, fn: DiagnosticsSource): { dispose(): void } {
  sources.set(name, fn);
  return { dispose: () => { if (sources.get(name) === fn) sources.delete(name); } };
}

// ---------------------------------------------------------------------------
// Console warnings (a small ring, folded repeats; nothing leaves the page)
// ---------------------------------------------------------------------------

interface WarnRecord { time: number; text: string; count: number }
const warnRing: WarnRecord[] = [];
const WARN_CAP = 20;
let warnHooked = false;

function stringify(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  try { return JSON.stringify(a)?.slice(0, 200) ?? String(a); } catch { return String(a); }
}

/** Record a warning for the report (also used for console.warn once hooked). */
export function recordWarning(...args: unknown[]) {
  const text = args.map(stringify).join(' ').replace(/\s+/g, ' ').slice(0, 300);
  if (!text) return;
  const head = warnRing[warnRing.length - 1];
  if (head && head.text === text) { head.count++; return; }
  warnRing.push({ time: Date.now(), text, count: 1 });
  while (warnRing.length > WARN_CAP) warnRing.shift();
}

function hookWarnings() {
  if (warnHooked || typeof console === 'undefined') return;
  warnHooked = true;
  const orig = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    try { recordWarning(...args); } catch { /* never break logging */ }
    orig(...args);
  };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export interface DiagnosticsInfo {
  version: string;
  simVersion: number;
  build: string;
  time: string;
  userAgent: string;
  platform: string;
  language: string;
  gpu: string;
  webgl: string;
  screen: string;
  device: string;
  display: string;
  settings: Record<string, Value>;
  blocks: [string, Record<string, Value>][];
  errors: Pick<ErrorRecord, 'time' | 'kind' | 'name' | 'message' | 'stack' | 'source' | 'count'>[];
  warnings: WarnRecord[];
}

const pad = (s: string) => (s + ':').padEnd(14);
const kv = (o: Record<string, Value>) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${typeof v === 'boolean' ? (v ? 'on' : 'off') : v}`).join(', ');

/** Replace every occurrence of the given names (callsign, profile name) and the page origin. */
export function redact(text: string, names: readonly string[], origin = ''): string {
  let out = origin ? text.split(origin).join('') : text;
  for (const n of names) {
    const name = n.trim();
    if (name.length < 2 || /^commander$/i.test(name)) continue; // the default name identifies nobody
    out = out.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<name>');
  }
  return out;
}

/** Plain-text report (pure: tests feed it fixed data). */
export function formatDiagnostics(d: DiagnosticsInfo, names: readonly string[] = [], origin = ''): string {
  const head = `${GAME_TITLE} ${DIAG_TEXT.title}`;
  const L: string[] = [head, '='.repeat(head.length)];
  L.push(`${pad('Version')}${d.version} (simulation ${d.simVersion}, ${d.build})`);
  L.push(`${pad('Time')}${d.time}`);
  L.push(`${pad('Browser')}${d.userAgent}`);
  L.push(`${pad('Platform')}${d.platform}${d.language ? `, ${d.language}` : ''}`);
  L.push(`${pad('GPU')}${d.gpu}`);
  L.push(`${pad('WebGL')}${d.webgl}`);
  L.push(`${pad('Screen')}${d.screen}`);
  L.push(`${pad('Device')}${d.device}`);
  L.push(`${pad('Display')}${d.display}`);
  L.push(`${pad('Settings')}${kv(d.settings)}`);
  for (const [name, o] of d.blocks) L.push(`${pad(name)}${kv(o)}`);
  L.push('', DIAG_TEXT.errors, '-'.repeat(DIAG_TEXT.errors.length));
  if (!d.errors.length) L.push(DIAG_TEXT.none);
  for (const r of d.errors.slice(0, 10)) {
    L.push(`[${new Date(r.time).toISOString().slice(11, 19)}] ${r.kind}${r.count > 1 ? ` x${r.count}` : ''}  ${r.name}: ${r.message}`);
    if (r.source) L.push(`    at ${r.source}`);
    for (const l of r.stack.split('\n').filter((x) => x.trim() && !x.includes(r.message)).slice(0, 6)) L.push(`    ${l.trim()}`);
  }
  L.push('', DIAG_TEXT.warnings, '-'.repeat(DIAG_TEXT.warnings.length));
  if (!d.warnings.length) L.push(DIAG_TEXT.none);
  for (const w of [...d.warnings].reverse().slice(0, 10)) L.push(`[${new Date(w.time).toISOString().slice(11, 19)}]${w.count > 1 ? ` x${w.count}` : ''} ${w.text}`);
  return redact(L.join('\n'), names, origin);
}

/** The settings worth knowing for a bug (no names, no keys beyond a count). */
function settingsSummary(): Record<string, Value> {
  let s: Record<string, unknown> = {};
  try { s = JSON.parse(localStorage.getItem('rh.settings') ?? '{}') as Record<string, unknown>; } catch { /* private mode */ }
  const keys = s.keys && typeof s.keys === 'object' ? Object.keys(s.keys as object).length : 0;
  return {
    quality: String(s.quality ?? 'high'),
    models: s.modelDetail ? String(s.modelDetail) : 'auto',
    layout: s.hudLayout === 'classic' ? 'classic' : 'modern',
    uiScale: `${Math.round((typeof s.uiScale === 'number' ? s.uiScale : 1) * 100)}%`,
    colours: String(s.teamPalette ?? 'default'),
    subtitles: s.subtitles !== false ? String(s.subtitleSize ?? 'medium') : 'off',
    reduceMotion: !!s.reduceMotion,
    edgeScroll: s.edgeScroll !== false,
    fullscreen: s.fullscreen !== false,
    reboundKeys: keys,
    language: `${currentLang()}${languagePref() === 'auto' ? ' (auto)' : ''}`,
  };
}

/** Names that must never appear in a report: the multiplayer callsign and the profile name. */
function privateNames(): string[] {
  const out: string[] = [];
  try {
    const cs = localStorage.getItem('rh.net.name');
    if (cs) out.push(cs);
    const prof = JSON.parse(localStorage.getItem('rh.profile') ?? 'null') as { name?: unknown } | null;
    if (prof && typeof prof.name === 'string') out.push(prof.name);
  } catch { /* none */ }
  return out;
}

/** Gather the live page state. */
export function collectDiagnostics(): DiagnosticsInfo {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string; mobile?: boolean } };
  const gpu = reportGpu();
  const mm = (q: string) => (typeof matchMedia === 'function' ? matchMedia(q).matches : false);
  const blocks: [string, Record<string, Value>][] = [];
  for (const [name, fn] of sources) {
    try { blocks.push([name, fn()]); } catch (e) { blocks.push([name, { error: e instanceof Error ? e.message : String(e) }]); }
  }
  let sw = 'unsupported';
  try { if ('serviceWorker' in nav) sw = nav.serviceWorker.controller ? 'active' : 'not controlling'; } catch { /* */ }
  return {
    version: VERSION,
    simVersion: SIM_VERSION,
    build: import.meta.env?.DEV ? 'dev' : 'production',
    time: new Date().toISOString(),
    userAgent: nav.userAgent ?? '?',
    platform: nav.userAgentData?.platform || nav.platform || '?',
    language: nav.language ?? '',
    gpu: `${gpu.renderer || '?'}${gpu.vendor && gpu.vendor !== '?' ? ` (vendor: ${gpu.vendor})` : ''}`,
    webgl: `${gpu.webgl2 ? 'WebGL2' : 'no WebGL2'}, max texture ${gpu.maxTextureSize}`,
    screen: typeof screen !== 'undefined'
      ? `${screen.width}x${screen.height} @${typeof devicePixelRatio === 'number' ? Math.round(devicePixelRatio * 100) / 100 : 1}x, window ${innerWidth}x${innerHeight}`
      : '?',
    device: `${nav.hardwareConcurrency ?? '?'} threads, ${nav.deviceMemory ?? '?'} GB, touch points ${nav.maxTouchPoints ?? 0}, pointer ${mm('(pointer: coarse)') ? 'coarse' : 'fine'}`,
    display: [
      mm('(display-mode: standalone)') ? 'installed app (PWA)' : 'browser tab',
      typeof window !== 'undefined' && window.top !== window ? 'embedded (iframe)' : '',
      typeof location !== 'undefined' ? location.protocol.replace(':', '') : '',
      nav.onLine === false ? 'offline' : 'online',
      `service worker ${sw}`,
      typeof document !== 'undefined' && document.fullscreenElement ? 'fullscreen' : '',
    ].filter(Boolean).join(', '),
    settings: settingsSummary(),
    blocks,
    errors: recentErrors(),
    warnings: [...warnRing],
  };
}

/** The report as text, private names and the page origin removed. */
export function buildDiagnostics(): string {
  return formatDiagnostics(collectDiagnostics(), privateNames(), typeof location !== 'undefined' ? location.origin : '');
}

/** Copy the report; true when it reached the clipboard (otherwise it is printed to the console). */
export async function copyDiagnostics(): Promise<boolean> {
  const text = buildDiagnostics();
  const ok = await copyText(text);
  if (!ok) console.info(text);
  return ok;
}

if (typeof window !== 'undefined') {
  hookWarnings();
  setDiagnosticsBuilder(buildDiagnostics);
}
