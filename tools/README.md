# Developer tools

These are headless harnesses, QA suites, screenshot drivers and the HD model factory. None of them
ship with the game.

- **TypeScript tools** run with `node --import tsx`.
- **Browser tools** (`*.mjs`) drive headless Chromium through Playwright
  (`npx playwright install chromium`) and need a running dev server.
- **Missing system libraries.** If Chromium lacks some on your machine, extract them into
  `tools/nsslibs/`. That folder is ignored by git, and the browser tools add `tools/nsslibs/lib` to
  `LD_LIBRARY_PATH`.

## Dev servers

| Tool | What it does | Command |
|---|---|---|
| `vite.config.ts` | Hot-reloading dev server on :5173 | `npm run dev` |
| `restart-test-server.sh` | Stable server on :5181 for screenshots and browser checks (`vite.test.config.ts`: no HMR, no file watching, so rerun it after edits) | `tools/restart-test-server.sh` |
| `qa/vite.qa.config.ts` | Stable server on :5192 for the `tools/qa/*.mjs` suites (or point them elsewhere with `QA_BASE=<url>`) | `npx vite --config tools/qa/vite.qa.config.ts` |

## Headless simulation

| Tool | What it does | Command |
|---|---|---|
| `simtest.ts` | AI-vs-AI match smoke test | `node --import tsx tools/simtest.ts [seed] [minutes] [size] [players]` |
| `savetest.ts` | Save/load determinism (must print `DETERMINISTIC ✓`) | `node --import tsx tools/savetest.ts [seed] [ceasefire minutes \| inf]` |
| `campaigntest.ts` | Campaign missions played by the autopilots in `campaign-pilots*.ts` | `node --import tsx tools/campaigntest.ts <missionId\|allies\|soviet\|all> [minutes=40] [pilot=auto\|idle\|generic] [-v]` |
| `campaign-losetest.ts` | Lose conditions: kills a mission-critical entity and expects a clear failure | `node --import tsx tools/campaign-losetest.ts` |
| `campaign-map.ts` | ASCII preview of a mission map or a generated map | `node --import tsx tools/campaign-map.ts <missionId\|seed> [size players water trees ore climate]` |
| `missiontest.ts` | One mission, with an AI autopilot on the human side | `node --import tsx tools/missiontest.ts <missionId> [minutes]` |
| `conquesttest.ts` | Conquest battles with the autopilots in `conquest-harness.ts` | `node --import tsx tools/conquesttest.ts [kind\|all] [seed=7] [faction=allies] [minutes=25] [-v]` |
| `metatest.ts` | Progression: medals, XP and ranks, persistence and migration | `node --import tsx tools/metatest.ts` |

## Self-play (`tools/selfplay`)

| Tool | What it does | Command |
|---|---|---|
| `run.ts` | Mass AI-vs-AI self-play with a statistical report (options in its header) | `node --import tsx tools/selfplay/run.ts --mode faction --games 40` |
| `balance.ts` | Cost-equal unit duels (`--emit` regenerates `src/sim/ai-matchups.ts`) | `node --import tsx tools/selfplay/balance.ts [--budget 3000] [--seeds 2] [--emit]` |
| `doctrine.ts` | Commander-rules balance: doctrines and commander powers | `node --import tsx tools/selfplay/doctrine.ts [--seeds 6] [--only mirror,cross,powers,comeback]` |
| `economy.ts` | Commander economy sanity: what each personality builds, researches and upgrades, the economy on vs off, greed vs aggression | `node --import tsx tools/selfplay/economy.ts [--games 12] [--minutes 40] [--only usage,ablation,greed,pace]` |
| `difficulty.ts` | Difficulty curve: each AI level against a passive player (first wave, contact, first loss, wipe-out) with and without build-up time, against a new-player stand-in, and economy vs rush under the mutators | `node --import tsx tools/selfplay/difficulty.ts [--games 8] [--size 96] [--only passive,ceasefire,novice,mutators] [--rules classic,commander]` |
| `standins.ts` | Each AI level against human stand-ins (a scripted novice and casual player, and an experienced one: the frozen version-2 Normal AI with a human's economy), per ruleset and map size, with 95% intervals | `node --import tsx tools/selfplay/standins.ts [--games 12] [--diff recruit,easy,normal,hard,brutal] [--vs novice,casual,experienced] [--rules classic,commander] [--size 64,96] [--personality all] [--dynamic 1]` |
| `optimize.ts` | Hill-climbing of the AI's tuning parameters | `node --import tsx tools/selfplay/optimize.ts [--iters 20] [--games 96] [--vs best\|legacy]` |
| `inspect.ts` | Watches one match in the terminal (economy, army, AI decisions) | `node --import tsx tools/selfplay/inspect.ts [seed] [map] [p0] [p1] [minutes]` |
| `campaign-compare.ts` | Campaign autopilots against the current AI and the legacy AI | `node --import tsx tools/selfplay/campaign-compare.ts [jitters=4] [missions] [minutes=40]` |

The other files are support code:
- `lib.ts` is the harness core;
- `pool.ts`, `worker.ts` and `worker-boot.mjs` are the worker pool;
- `legacy/` is a frozen copy of an earlier AI, used as a fixed benchmark opponent;
- `frozen/` is a frozen copy of the version-2 skirmish AI (the experienced stand-in), and `standin.ts` holds the scripted
  novice and casual players. Both are yardsticks: don't tune them to the AI.

## QA suites (`tools/qa`)

The headless suites share `lib.ts`. The browser suites share `browser.mjs` and expect the :5192
server, or `QA_BASE`.

| Tool | What it does | Command |
|---|---|---|
| `economy.ts` | Economy and building | `node --import tsx tools/qa/economy.ts` |
| `units.ts` | Unit movement, orders and abilities | `node --import tsx tools/qa/units.ts` |
| `fog.ts` | Fog of war and visibility | `node --import tsx tools/qa/fog.ts` |
| `superweapons.ts` | Superweapons | `node --import tsx tools/qa/superweapons.ts` |
| `misc.ts` | Miscellaneous simulation checks | `node --import tsx tools/qa/misc.ts` |
| `balance.ts` | Equal-cost group duels | `node --import tsx tools/qa/balance.ts [budget=3000]` |
| `balance2.ts` | Aircraft, support units and early-game pacing | `node --import tsx tools/qa/balance2.ts` |
| `aigames.ts` | A batch of AI-vs-AI games with anomaly detection | `node --import tsx tools/qa/aigames.ts [maxMinutes=60] [filter]` |
| `vs_passive.ts` | How fast each AI difficulty beats a passive human | `node --import tsx tools/qa/vs_passive.ts` |
| `pathing_maps.ts` | Long move orders on generated maps | `node --import tsx tools/qa/pathing_maps.ts [trials]` |
| `juice_cpu.ts` | CPU cost of the effect recipes, with and without the game-feel layers | `node --import tsx tools/qa/juice_cpu.ts` |
| `fuzz.ts` | Command fuzzer: random legal commands from the whole command vocabulary into random skirmishes (sizes up to 192, 2-4 players, both rulesets, mutators, King of the Hill, sea and curated maps), world invariants every 10 ticks, and per case a save / load at a random tick, a replay of the command log and (some cases) portable maths, which must all hash the same. One seed reproduces a case; `FUZZ_ALL=1` also commands the AI players' units | `node --import tsx tools/qa/fuzz.ts [--from 1] [--count 20] [--minutes 5] [--size 0] [-v]` |
| `bigarmy.ts` | Long 4-player match with build-up time: units, simulation ms per tick (p50 / p95 / max), AI thinking time and save cost per interval; `--mem` lists collections that keep growing, `--hash` prints state hashes to compare two builds | `node --import tsx tools/qa/bigarmy.ts [--size 128] [--diff brutal] [--minutes 60] [--ceasefire 30] [--credits 10000] [--seed 7]` |
| `stuck.ts` | Stuck detection in AI-vs-AI matches: movers without progress for 20 s, idle harvesters with ore left, an AI with money that builds nothing for 3 minutes, aircraft that never rearm, transports that never unload | `node --import tsx tools/qa/stuck.ts [--size 128] [--players 4] [--diff hard] [--minutes 45] [--water 0.4]` |
| `crowd.ts` | A big army ordered across a bridge and back (or across open ground with `--flat`): arrival time and units without progress | `node --import tsx tools/qa/crowd.ts [--units 300] [--seed 4] [--flat]` |
| `saveprof.ts` | Save cost on a big world: serialise, JSON, load, and the largest parts | `node --import tsx tools/qa/saveprof.ts [minutes=28] [size=128]` |
| `ui.mjs` | UI checks with real mouse and keyboard input | `node tools/qa/ui.mjs` |
| `ui_end.mjs` | End screen, quit, new game, restart and defeat | `node tools/qa/ui_end.mjs` |
| `ui_sidebar.mjs` | Sidebar card states | `node tools/qa/ui_sidebar.mjs` |
| `ui_super.mjs` | Superweapon targeting UI | `node tools/qa/ui_super.mjs [allies\|soviet]` |
| `npe.mjs` | New-player experience: the first minutes from the main menu | `node tools/qa/npe.mjs` |
| `soak_qa.mjs` | Long rendered session: errors, heap and leaks | `node tools/qa/soak_qa.mjs [simMinutes=35] [query]` |
| `juice_bench.mjs` | Big-battle cost: draw calls, particles, lights, voices, CPU time (`0\|1` = game-feel layer off or on) | `node tools/qa/juice_bench.mjs <high\|medium\|low> <0\|1> [frames=90] [shot.png]` |
| `juice_shots.mjs` | Game-feel screenshot scenes | `node tools/qa/juice_shots.mjs <scene\|all> <outDir> [juice=1] [q=high]` |
| `fxdc_shots.mjs` | Effects director's cut scenes: heat haze over a burning base, lit smoke at night, lens rain in a storm intro and photo mode, a scarred battlefield (`diag` exaggerates the haze) | `node tools/qa/fxdc_shots.mjs <scene\|all> <outDir> [q=high] [extra query]` |
| `fxdc_bench.mjs` | 150-unit battle inside a burning base: frame times, draw calls per pass, haze sources (`0\|1` = director's cut off or on) | `node tools/qa/fxdc_bench.mjs <high\|medium\|low> <0\|1> [frames=60] [shot.png]` |

## Screenshots and browser checks

These take the URL or port of a running dev server.

| Tool | What it does | Command |
|---|---|---|
| `shot.mjs` | Screenshot of a page, plus its console errors | `node tools/shot.mjs <url> <out.png> [waitMs=4000] [width] [height] [evalJs]` |
| `focus-shot.mjs` | Screenshot after aiming the camera at something in the running game | `node tools/focus-shot.mjs <url> <out.png> "<js on g returning [x, y, dist]>" [waitMs] [prepJs]` |
| `script-shot.mjs` | Scripted steps (wait, click, eval, key, goto) and screenshots | `node tools/script-shot.mjs [--scale n] [--size WxH] <url> --wait 3000 --shot out.png` |
| `edit-shot.mjs` | Editor and mods screens | `node tools/edit-shot.mjs <editor\|mods\|picker\|playtest\|campaign> [port]` |
| `campaign-shot.mjs` | Campaign select and debrief screens | `node tools/campaign-shot.mjs <baseUrl> <outPrefix> [tab] [w] [h]` |
| `conq-shot.mjs` | Conquest UI | `node tools/conq-shot.mjs <url> <out.png> [waitMs=7000] [w] [h] [action ...]` |
| `mission-flow.mjs` | A mission's start, win or lose, and debrief | `node tools/mission-flow.mjs <baseUrl> <missionId> <outPrefix> [win\|lose]` |

On a real GPU (Linux with an Intel or AMD GPU and Docker), `tools/gpu-rig/` runs the browser checks that SwiftShader can't do: NaN and
half-float overflow in every HDR render target, WebGL errors, context loss and restore, missing mobile extensions, and FPS per preset
with per-pass GPU timings. See [`gpu-rig/README.md`](gpu-rig/README.md). [`xb/`](xb/README.md) runs the same checks in
Firefox and WebKit on the GPU, and in the test VMs (Windows Direct3D, a low-end Linux laptop): look comparisons, input,
soak, low-end CPU, PWA and high-DPI checks.

On Android, [`mobile/`](mobile/README.md) runs the game in Chrome in a KVM emulator and plays it by touch: phone and
tablet layouts in both orientations, gestures, the build bar, backgrounding and WebGL context loss, rotation, the
on-screen keyboard and the installed app (`node tools/mobile/run.mjs`).

## End-to-end bot (`tools/e2e`)

A Playwright bot that plays through the real interface: it clicks, drags, types and presses keys like a player, and
reads `window.__game` (exposed by `?debug=1`) only to check results and to aim. To keep software-GPU runs short it
fast-forwards the simulation between actions (time passes, nothing is ordered); `--realtime` waits for the game clock
instead. Every journey fails on console errors and Content-Security-Policy violations.

| Tool | What it does | Command |
|---|---|---|
| `run.mjs` | Runs journeys against a URL (or serves a build), writes `report.json`, `summary.txt` and screenshots | `node tools/e2e/run.mjs [journey,...] [--url <url>] [--serve <dist>] [--browser chromium\|firefox\|webkit] [--cdp <url>] [--slow 2] [--realtime] [--size 1280x720] [--out <dir>]` |
| `serve.mjs` | Serves a production build with the shipped security headers, cache rules and SPA fallback | `node tools/e2e/serve.mjs <dist> [port=5302] [host=127.0.0.1]` |
| `builds.mjs` | Builds A, B and C (each differs only in its build id, like successive deploys) for the PWA update journey | `node tools/e2e/builds.mjs <outA> <outB> <outC>` |

Journeys (`tools/e2e/journeys/`): `first-launch` (fresh profile, Quick Battle on Recruit won through the UI, results,
Play again), `skirmish-setup`, `campaign` (Boot Camp drills, mission 1 of each side, a special operation lost and
retried, the first Conquest battle), `saves`, `replays`, `editor`, `challenges` (daily, files, share links), `settings`,
`pwa-update` (needs `--serve <A> --serve-b <B>,<C>`) and `abuse` (rapid clicks, Esc spam, focus loss, resizing).

- **Other browsers and machines.** Point `--url` at any reachable server. `E2E_CHANNEL=chrome|msedge` picks a branded
  browser and `E2E_CHROME_ARGS` replaces the default SwiftShader flags (for example `--use-angle=d3d11-warp`, or empty
  for the real GPU).
- **Android.** Forward Chrome's DevTools socket (`adb forward tcp:9222 localabstract:chrome_devtools_remote`) and pass
  `--cdp http://127.0.0.1:9222`; add `--touch --mobile` for touch input.

## HD model factory (`tools/assets`)

The full guide is [`assets/README.md`](assets/README.md), and the art direction is
[`assets/STYLE.md`](assets/STYLE.md).

| Tool | What it does | Command |
|---|---|---|
| `setup-blender.sh` | Installs the pinned Blender 4.5 LTS (sha256-checked) | `tools/assets/setup-blender.sh [--check]` |
| `fetch-textures.mjs` | Downloads the pinned CC0 texture inputs and the decal font | `node tools/assets/fetch-textures.mjs` |
| `build.mjs` | Builds models into `public/models/` and updates `manifest.json` | `node tools/assets/build.mjs <key...> \| --all \| --list` |
| `rig.ts` | Dumps a procedural model's rig, so an HD model can match it | `node --import tsx tools/assets/rig.ts <id> [faction] [--json]` |
| `view.mjs` | In-game screenshot and stats of HD models | `node tools/assets/view.mjs --port <port> --scene A [--focus <id>] [--hd 0] --out a.png` |
| `hdcheck.mjs` | Damage stages, construction hologram and collapse of a structure | `node tools/assets/hdcheck.mjs [port] [outDir] [hd=1] [type=powr]` |
| `hdlazy.mjs` | Lazy HD loading: swaps during construction and production | `node tools/assets/hdlazy.mjs [port] [outDir] [q=high]` |
| `restart-view-server.sh` | (Re)starts a stable server for HD checks; needs a `tools/vite.<name>.config.ts` with that port | `tools/assets/restart-view-server.sh [port=5231]` |
| `memguard.sh` | Waits until enough memory is free before a heavy job | `tools/assets/memguard.sh [MB=3072]` |

## Release, sharing and video (`tools/release`)

Distribution is covered in [docs/DISTRIBUTION.md](../docs/DISTRIBUTION.md). The browser tools run headless
Chromium (SwiftShader), so run `tools/assets/memguard.sh` first.

| Tool | What it does | Command |
|---|---|---|
| `build-itch.mjs` | Relative-base build into `dist-itch/`, checked against itch.io's rules and zipped into `release/` | `npm run build:itch` |
| `verify-subpath.mjs` | Serves a build from a sub-folder; checks the match, fonts, HD models, service-worker scope and that no request leaves the folder | `node tools/release/verify-subpath.mjs [dir=dist-itch] [prefix=/games/red-horizon/] [out.png]` |
| `og-card.mjs` | Composes the link-preview images (`public/og/`) from a game frame | `node tools/release/og-card.mjs <frame.png> [outDir]` |
| `keyart.mjs` | A HUD-free key-art frame from an attract-mode shot, subject on the right third | `node tools/release/keyart.mjs <url> <outPrefix> [shot=tesla] [dist=16]` |
| `shot-tour.mjs` | Screenshots every shot of the attract-mode program | `node tools/release/shot-tour.mjs <url> <outPrefix> [simSpeed=3]` |
| `frames.mjs` | Timed frames of any page, with the director's current shot | `node tools/release/frames.mjs <url> <outPrefix> [count] [everyMs]` |
| `share-shots.mjs` | The share flow: Copy link in the editor, opening the link, a hostile link | `node tools/release/share-shots.mjs <baseUrl> <outPrefix>` |
| `clip-test.mjs` | Records a highlight clip from a replay and saves the video and frames | `node tools/release/clip-test.mjs <baseUrl> <outPrefix> [ff=150]` |
| `trailer-test.mjs` | Records the `?trailer=1` cut and saves the video and frames | `node tools/release/trailer-test.mjs <baseUrl> <outPrefix>` |
| `backdrop-stats.mjs` | Draw calls and triangles of the menu backdrop, directed vs `?attract=0` | `node tools/release/backdrop-stats.mjs <baseUrl> [q=low]` |

## Translations and fonts (`tools/i18n`, `tools/fonts`)

| Tool | What it does | Command |
|---|---|---|
| `i18n/catalog.ts sync` | Collects the game data's English (`i18n/data-sources.ts`) into `src/i18n/source/data.en.json`. The test fails until it is re-run after a data text changes. | `node --import tsx tools/i18n/catalog.ts sync` |
| `i18n/catalog.ts coverage` | Keys translated per language | `node --import tsx tools/i18n/catalog.ts coverage` |
| `i18n/catalog.ts missing` | The English a language still lacks, as flat JSON (optionally filtered by a key regex) | `node --import tsx tools/i18n/catalog.ts missing <lang> [out.json] [keyRegex]` |
| `i18n/catalog.ts merge` | Merges translated batch files into `src/i18n/locales/<lang>.json` (sorted, known keys only) | `node --import tsx tools/i18n/catalog.ts merge <lang> <batch.json>...` |
| `i18n/catalog.ts check` | Placeholder, plural, markup and raw-HTML problems in the translations | `node --import tsx tools/i18n/catalog.ts check [lang]` |
| `i18n/catalog.ts prune` | Drops keys English no longer has | `node --import tsx tools/i18n/catalog.ts prune <lang>` |
| `fonts/fetch.mjs` | Downloads the pinned OFL sources of the interface fallback fonts (`fonts/fonts.json`, google/fonts at a fixed commit, sha256-checked) into `~/.cache/red-horizon/fonts/` | `node tools/fonts/fetch.mjs` |
| `fonts/subset.py` | Builds `public/fonts/tektur-cyrillic.woff2` (Cyrillic) and `noto-sans-sc-subset.woff2` (the characters `zh-CN.json` uses). Re-run it after changing the Chinese catalogue. Needs fontTools + brotli. | `~/.cache/rh-fonts/venv/bin/python tools/fonts/subset.py` |

`subset.py` needs a Python with `fonttools==4.60.1 brotli==1.1.0`, for example
`python3 -m venv ~/.cache/rh-fonts/venv && ~/.cache/rh-fonts/venv/bin/pip install fonttools==4.60.1 brotli==1.1.0`.

## Elsewhere

The browser audits in `tests/perf/` and the scripts in `tests/tools/` run through npm:
- `npm run audit:leaks` (every system on; `--classic` for plain rules);
- `npm run audit:profile`;
- `npm run audit:stress` (a 300-unit battle: spikes, GC, allocation sites);
- `node tests/perf/speed.mjs [q] [seconds] [units] [speed]` (the game speed a big battle really reaches at x5 with the real frame loop, main-thread costs only);
- `npm run audit:presets` and `npm run audit:startup` (point them at one or two builds: before / after);
- `npm run verify:pwa`;
- `npm run icons`.
