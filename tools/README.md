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
| `optimize.ts` | Hill-climbing of the AI's tuning parameters | `node --import tsx tools/selfplay/optimize.ts [--iters 20] [--games 96] [--vs best\|legacy]` |
| `inspect.ts` | Watches one match in the terminal (economy, army, AI decisions) | `node --import tsx tools/selfplay/inspect.ts [seed] [map] [p0] [p1] [minutes]` |
| `campaign-compare.ts` | Campaign autopilots against the current AI and the legacy AI | `node --import tsx tools/selfplay/campaign-compare.ts [jitters=4] [missions] [minutes=40]` |

The other files are support code:
- `lib.ts` is the harness core;
- `pool.ts`, `worker.ts` and `worker-boot.mjs` are the worker pool;
- `legacy/` is a frozen copy of an earlier AI, used as a fixed benchmark opponent.

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
| `ui.mjs` | UI checks with real mouse and keyboard input | `node tools/qa/ui.mjs` |
| `ui_end.mjs` | End screen, quit, new game, restart and defeat | `node tools/qa/ui_end.mjs` |
| `ui_sidebar.mjs` | Sidebar card states | `node tools/qa/ui_sidebar.mjs` |
| `ui_super.mjs` | Superweapon targeting UI | `node tools/qa/ui_super.mjs [allies\|soviet]` |
| `npe.mjs` | New-player experience: the first minutes from the main menu | `node tools/qa/npe.mjs` |
| `soak_qa.mjs` | Long rendered session: errors, heap and leaks | `node tools/qa/soak_qa.mjs [simMinutes=35] [query]` |
| `juice_bench.mjs` | Big-battle cost: draw calls, particles, lights, voices, CPU time (`0\|1` = game-feel layer off or on) | `node tools/qa/juice_bench.mjs <high\|medium\|low> <0\|1> [frames=90] [shot.png]` |
| `juice_shots.mjs` | Game-feel screenshot scenes | `node tools/qa/juice_shots.mjs <scene\|all> <outDir> [juice=1] [q=high]` |

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

## Elsewhere

The browser audits in `tests/perf/` and the scripts in `tests/tools/` run through npm:
- `npm run audit:leaks`;
- `npm run audit:profile`;
- `npm run verify:pwa`;
- `npm run icons`.
