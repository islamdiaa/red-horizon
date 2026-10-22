// The real-GPU correctness sweep (tools/gpu-rig/sweep.mjs) in a test VM, for any browser there, e.g. Chrome and Edge on
// Direct3D 11 (WARP in a VM without a GPU) through ANGLE's HLSL translation, or Firefox on Windows:
//   tools/lab/lab.sh run win11 tools/xb/vmsweep.mjs <browser> <env|fx|ctxloss|models> [presets=low,medium,high] [KEY=value...]
// browser: chromium, chrome, msedge, firefox, moz-firefox, webkit (tools/xb/vmlib.mjs). KEY=value: CHROME_ARGS, MASK,
// HD, CLIMATES, WX, SHOTS, W, H, TAG, RULES (a copy of src/data/rules.ts, for the models mode).
import fs from 'node:fs';
import { launch, GAME_URL, OUT } from './vmlib.mjs';
import { runSweep } from './sweep-core.mjs';

const [name = 'chrome', mode = 'env', presetArg = 'low,medium,high'] = process.argv.slice(2);
const browser = await launch(name);
process.env.TAG = `-${name}${process.env.TAG ?? ''}`;
const rulesSrc = process.env.RULES ? fs.readFileSync(process.env.RULES, 'utf8') : null;
const problems = await runSweep({ browser, base: GAME_URL, mode, presets: presetArg.split(','), out: OUT, rulesSrc });
await browser.close();
process.exitCode = problems ? 3 : 0;
