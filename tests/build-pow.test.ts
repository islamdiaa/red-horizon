// Portable maths in the production bundle (vite.config.ts keepMathPow, src/net/dmath.ts): the minifier rewrites a
// literal `Math.pow(a, b)` into `a ** b`, which always runs the engine's own pow, so in a multiplayer match or a ranked
// run Chrome, Firefox and Safari (and the leaderboard server, which runs the unminified source with the portable pow)
// could compute a generated map's ore or an AI's counter weights differently in the last bit. The plugin keeps those
// calls as calls; the simulation's own sources must not use `**` beyond squares (exact on every engine).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { rolldown } from 'rolldown';
import { keepMathPow } from '../vite.config';

const LOCKSTEP_DIRS = ['src/sim', 'src/maps', 'src/data', 'src/core', 'src/missions', 'src/modes', 'src/conquest', 'src/net', 'src/replay'];
// not in a tick: the reconnect back-off (client.ts) and random ids (author.ts, replay/format.ts)
const ALLOWED = new Set(['src/net/client.ts', 'src/modes/author.ts', 'src/replay/format.ts']);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('portable pow survives the production build', () => {
  test('the minifier would turn Math.pow into **; the plugin keeps the call, and the call reads Math.pow when it runs', async () => {
    const src = 'export const f = (a, b) => Math.pow(a, b) + Math.pow(1 - a, 0.6) + Math.pow(2, b * 0.3);';
    const minify = async (code: string) => {
      const b = await rolldown({ input: 'in.js', plugins: [{ name: 'mem', resolveId: (id) => (id === 'in.js' ? id : null), load: (id) => (id === 'in.js' ? code : null) }] });
      return (await b.generate({ minify: true, format: 'es' })).output[0].code;
    };
    const plain = await minify(src);
    assert.ok(/\*\*/.test(plain) && !/Math\.pow/.test(plain), `without the plugin the minifier emits ** (${plain.trim()})`);
    const t = keepMathPow().transform as (code: string, id: string) => { code: string } | null;
    const kept = await minify(t(src, '/repo/src/sim/mapgen.ts')!.code);
    assert.ok(!/\*\*/.test(kept) && (kept.match(/Math\.pow/g) ?? []).length === 3, `with it the calls stay (${kept.trim()})`);
    // and they go through whatever Math.pow is when they run (the portable swap)
    const body = kept.replace(/export\s*\{[^}]*\};?/, '').trim();
    const orig = Math.pow;
    try {
      (Math as { pow: (a: number, b: number) => number }).pow = () => 7;
      const fn = new Function(`${body}; return ${/const (\w+)=/.exec(body)![1]};`)() as (a: number, b: number) => number;
      assert.equal(fn(0.5, 2), 21, 'every call used the swapped Math.pow');
    } finally {
      Math.pow = orig;
    }
    assert.equal(t('const x = Math.pow(1, 2);', '/repo/node_modules/three/build/three.module.js'), null, 'only the game\'s own sources');
    assert.equal(t('const x = Math.pow(1, 2);', '/repo/src/render/effects/fire.ts'), null, 'not the drawing code (it keeps the fast native pow)');
  });

  test('the simulation\'s sources use ** only for squares (exact on every engine; any other exponent bypasses dmath)', () => {
    const bad: string[] = [];
    for (const dir of LOCKSTEP_DIRS) {
      for (const f of files(dir)) {
        if (ALLOWED.has(f.replace(/\\/g, '/'))) continue;
        readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').replace(/\/\*.*$/, '');
          if (/^\s*\*/.test(code)) return; // (a JSDoc line)
          for (const m of code.matchAll(/\*\*\s*([^\s*=/])/g)) if (!/^2(?![\d.])/.test(code.slice(m.index! + 2).trimStart())) bad.push(`${f}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    assert.deepEqual(bad, [], 'no other exponents in the lockstep code');
  });
});
