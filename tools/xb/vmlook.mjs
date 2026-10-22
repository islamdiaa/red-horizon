// The look scenes (tools/xb/look-core.mjs) in a test VM, e.g. Chrome and Edge on Direct3D 11 / WARP and Firefox on
// Windows, for comparison with the Linux GPU reference (tools/xb/compare.mjs):
//   tools/lab/lab.sh run win11 tools/xb/vmlook.mjs <browser> [scenes] [KEY=value...]
// Writes look-<browser><TAG>.json, look-<scene>-<browser>.png and xb-look-<browser>.jsonl to OUT_DIR.
import fs from 'node:fs';
import { launch, OUT, GAME_URL } from './vmlib.mjs';
import { runLook } from './look-core.mjs';

const [name = 'chrome', only = null] = process.argv.slice(2);
const label = name + (process.env.TAG ?? '');
const browser = await launch(name);
let problems = 0;
const emit = (o, bad) => {
  if (bad) problems++;
  const line = JSON.stringify({ browser: label, version: browser.version(), ...o });
  fs.appendFileSync(`${OUT}/xb-look-${label}.jsonl`, line + '\n');
  console.log((bad ? 'BAD ' : 'ok  ') + line.slice(0, bad ? 1500 : 300));
};
const res = await runLook({ browser, base: GAME_URL, label, out: OUT, emit, only });
fs.writeFileSync(`${OUT}/look-${label}.json`, JSON.stringify(res));
await browser.close();
process.exitCode = problems ? 3 : 0;
