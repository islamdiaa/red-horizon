// Real-GPU correctness sweep: scans every half/float render target after each pass for non-finite and
// out-of-range values, checks gl errors, shader warnings, black / white frames and flicker of a paused scene.
//   node tools/gpu-rig/sweep.mjs <base-url> <env|fx|models|ctxloss> [presets=low,medium,high] [outDir=/out]
// env:     preset x climate x time of day x weather x zoom
// fx:      superweapons, Tesla, fire, smoke, haze, explosions, destruction, photo mode, the nuke cinematic
// models:  every unit and structure type on screen, HD on and off
// ctxloss: WEBGL_lose_context mid-match, then restore: the match must come back rendering
// MASK=1 hides EXT_color_buffer_float and OES_texture_float_linear (mobile-like). One JSON line per check.
import { launchGpu } from './lib.mjs';
import { runSweep } from '../xb/sweep-core.mjs';

const [base = 'http://127.0.0.1:5291/', mode = 'env', presetArg = 'low,medium,high', out = '/out'] = process.argv.slice(2);
const browser = await launchGpu();
await runSweep({ browser, base, mode, presets: presetArg.split(','), out });
await browser.close();
