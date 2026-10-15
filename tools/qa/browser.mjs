// Shared Playwright helpers for QA browser tests (server: tools/qa/vite.qa.config.ts on :5192).
import { chromium } from 'playwright';

export const BASE = process.env.QA_BASE ?? 'http://localhost:5192/';
const ROOT = new URL('../..', import.meta.url).pathname;

export async function launch({ width = 1600, height = 900 } = {}) {
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    env: { ...process.env, LD_LIBRARY_PATH: ROOT + 'tools/nsslibs/lib' },
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  const warnings = [];
  page.on('pageerror', (e) => { errors.push(`[pageerror] ${e.message} ${(e.stack ?? '').split('\n').slice(1, 4).join(' | ')}`); });
  page.on('console', (m) => {
    const t = m.text().slice(0, 400);
    if (m.type() === 'error') errors.push(`[console.error] ${t}`);
    else if (m.type() === 'warning') warnings.push(`[console.warn] ${t}`);
  });
  return { browser, page, errors, warnings };
}

export async function shot(page, name) {
  const path = `${ROOT}screenshots/qa-${name}.png`;
  await page.screenshot({ path });
  console.log(`  screenshot: screenshots/qa-${name}.png`);
  return path;
}

export async function waitGame(page, timeout = 120000) {
  await page.waitForFunction(() => window.__game && window.__game.hud, null, { timeout });
}

/** Project a map point (x, y) to screen pixels. */
export async function toScreen(page, x, y, lift = 0) {
  return page.evaluate(([x, y, lift]) => {
    const g = window.__game;
    const cam = g.gfx.cam.camera;
    const v = cam.position.clone();
    v.set(x, g.world.map.heightAt(x, y) + lift, y).project(cam);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, onScreen: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1 };
  }, [x, y, lift]);
}

export async function state(page) {
  return page.evaluate(() => {
    const g = window.__game, w = g.world, me = g.local;
    return {
      t: +w.time.toFixed(1),
      credits: me.credits,
      power: `${me.powerOut}/${me.powerUse}`,
      blds: w.buildings.filter((b) => b.owner === me && b.alive).map((b) => b.bt.id + (b.buildAnim < 1 ? '*' : '')),
      units: w.units.filter((u) => u.owner === me && u.alive).map((u) => u.ut.id),
      sel: [...g.selection].map((id) => w.getEntity(id)?.type.id),
      sq: JSON.stringify({ items: me.queues.structure.items.map((i) => [i.type, +i.progress.toFixed(2)]), ready: me.queues.structure.ready }),
      mode: g.input?.mode,
      paused: g.paused,
    };
  });
}

/** Run simulation-time forward quickly via the game's fastForward hook (no rendering). */
export async function ff(page, seconds) {
  await page.evaluate((s) => window.__game.fastForward(s), seconds);
}

export async function waitSim(page, simSeconds, timeout = 300000) {
  const t0 = await page.evaluate(() => window.__game.world.time);
  await page.waitForFunction((t) => window.__game.world.time >= t, t0 + simSeconds, { timeout, polling: 250 });
}

export async function toasts(page) {
  return page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim().replace(/\s+/g, ' ')));
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export function report(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
  return ok;
}
