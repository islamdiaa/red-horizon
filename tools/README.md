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
| `campaigntest.ts` | Campaign missions played by the autopilots in `campaign-pilots*.ts` (`LEVEL=hard`, `JITTER=n` for another run, `DEATHS=1` with `-v` names who killed each of your units) | `node --import tsx tools/campaigntest.ts <missionId\|allies\|soviet\|all> [minutes=40] [pilot=auto\|idle\|generic\|newcomer\|casual] [-v]` |
| `campaign-losetest.ts` | Lose conditions: kills a mission-critical entity and expects a clear failure | `node --import tsx tools/campaign-losetest.ts` |
| `campaign-levels.ts` | Every mission at every campaign difficulty, played by the newcomer / casual stand-ins (`campaign-players.ts`; the newcomer reads the in-game Field Manual alerts and follows them, `FM=0` plays the earlier stand-in that never did) and the expert autopilots; wins per pilot. `--missions daily --days 2026-10-01:30` plays that many daily challenges instead; `--missions coop` the co-op survival variants. `WORKERS=n` caps the threads | `node --import tsx tools/campaign-levels.ts [--missions all\|allies\|soviet\|special\|ids] [--levels recruit,...] [--pilots newcomer,casual,expert] [--seeds 8] [--out runs.json]` |
| `campaign-conquest.ts` | Conquest battles of each kind per run difficulty, by the stand-ins and the strike-force autopilot (`--strength n` puts every garrison but the capital at that strength; `CQLOG=1` prints the stand-ins' Field Manual reads) | `node --import tsx tools/campaign-conquest.ts [--difficulties easy,normal,hard] [--pilots newcomer,casual,auto] [--battles naval,boss] [--strength 3] [--seeds 4] [--out file.json]` |
| `campaign-koth.ts` / `campaign-challenges.ts` | King of the Hill against each AI level, and the built-in challenges, by the stand-ins | `node --import tsx tools/campaign-koth.ts [--levels ...] [--seeds 8]` / `node --import tsx tools/campaign-challenges.ts [--seeds 6]` |
| `campaign-map.ts` | ASCII preview of a mission map or a generated map | `node --import tsx tools/campaign-map.ts <missionId\|seed> [size players water trees ore climate]` |
| `missiontest.ts` | One mission, with an AI autopilot on the human side | `node --import tsx tools/missiontest.ts <missionId> [minutes]` |
| `conquesttest.ts` | Conquest battles with the autopilots in `conquest-harness.ts` | `node --import tsx tools/conquesttest.ts [kind\|all] [seed=7] [faction=allies] [minutes=25] [-v]` |
| `metatest.ts` | Progression: medals, XP and ranks, persistence and migration | `node --import tsx tools/metatest.ts` |
| `world/strat-bench.ts` | World Conquest strategy: pilots (greedy, zone-focused, cautious, dice-only) against the rivals per size and difficulty, with 95% Wilson intervals, turns, eliminations, snowball and stall measures (`rates`), homeland fairness (`fair`), how each rival personality fares (`powers`). RTS battles come from a model of the battle pilots' measured win rates (`world/strat-lib.ts`). `WORKERS` caps the threads | `WORKERS=4 node --import tsx tools/world/strat-bench.ts rates [--n 100] [--sizes blitz,world] [--diffs recruit,easy,normal,hard,brutal] [--pilots zone,greedy,cautious,dice] [--skill newcomer\|casual\|auto] [--out f.json]` · `... fair [--n 12] [--size blitz] [--diff normal]` · `... powers [--n 100] [--size world]` |
| `world/strat-quick.ts` | The same pilots, serially, for a quick look | `node --import tsx tools/world/strat-quick.ts [--n 40]` |
| `world/geo-land.ts` | Rebuilds World Conquest's land outline (`src/conquest/world/data/land110.ts`) from pinned, sha256-checked Natural Earth 1:110m land and lakes downloads (development time only; the command to fetch them is in the file header) | `node --import tsx tools/world/geo-land.ts <ne_110m_land.geojson> <ne_110m_lakes.geojson>` |
| `world/geo-map.ts` | World Conquest map preview as a PNG: a run's territories as the rules cut them, sites, label anchors, borders and sea lanes | `node --import tsx tools/world/geo-map.ts <out.png> [full\|world:<seed>\|blitz:<seed>:<homeland>] [x0 y0 x1 y1 scale]` |
| `world/maps-check.ts` | World Conquest region battlefields (`src/sim/mapgen-region.ts`): generate every sample look, or every world region with `--geo`, for each battle kind and check fairness (ground and sea routes, ore, room at the starts, the landmark on the start screen, naval ponds, civilian buildings dropped for closing off ground); `--ascii` prints a map | `node --import tsx tools/world/maps-check.ts [--geo] [--seeds 2] [--strength 3] [--quiet] [--only <region>] [--ascii --kind attack --seed 0]` |
| `world/qa-fuzz.ts` | World Conquest random-policy fuzz: every homeland x size x difficulty played by a seeded random (to sensible) policy over `legalActions()` (place, trade, roll, blitz, a made-up RTS result, move in, fortify, ceasefires, defence choices), with invariants after every action (owners, troops >= 1, troop and card ledgers, alive powers, links, no NaN), softlock and turn-cap checks. Results go to `screenshots/world-qa/` unless `--out` | `WORKERS=6 node --import tsx tools/world/qa-fuzz.ts [--runs 2000] [--seed0 1] [--sizes world,blitz] [--diffs all] [--homes all] [--fight 0.08]` |
| `world/qa-determinism.ts` | World runs replay identically from seed and choices, and identically through `saveWorldRun`/`loadWorldRun` at every turn and every few actions (run JSON hashed every turn) | `node --import tsx tools/world/qa-determinism.ts [--cases 60] [--seed0 1]` |
| `world/qa-dice.ts` | Risk dice by exact enumeration (the per-roll table, blitz odds): the reference `tests/world-qa-dice.test.ts` checks the game's dice against | `node --import tsx tools/world/qa-dice.ts` |
| `world/qa-battlefields.ts` | Every world region x battle kind: generation time, ground paths between starts (with and without bridges), sea routes for naval battles, reachable ore, ground closed off by the landmark or by civilian buildings, the landmark under shroud or off the starting screen (RTSCamera at `map.startFocus`, four window shapes) | `node --import tsx tools/world/qa-battlefields.ts [--regions all\|id,id] [--kinds attack,...] [--seeds 2]` (`--selftest`: the checks on skirmish maps) |
| `world/qa-battles.ts` | World RTS battles played headless by the battle pilots (newcomer, casual, auto) per climate, difficulty and battle kind, set up through `startBattle`, with 95% Wilson intervals (`--only landmarks`, `--kind naval`, `--troops 6v4`) | `WORKERS=5 node --import tsx tools/world/qa-battles.ts [--per-climate 6] [--seeds 2] [--diffs recruit,easy,normal,hard] [--pilots newcomer,casual,auto]` |
| `world/qa-battlesave.ts` | Save / load of a world battle in progress (tools/qa/modesave.ts runScenario, plus the civilian buildings' looks and the landmarks through a load) | `node --import tsx tools/world/qa-battlesave.ts [--regions 12] [--quick]` |
| `world/qa-balance.ts` | The balance tables from the strategic pilots (`world/strat-lib.ts`): win rates per size x difficulty x pilot with Wilson intervals, turns to win, zone-focused vs greedy on the same seeds (sign test), homeland fairness per size and level, wipe-outs by turn 5, how each rival personality fares | `WORKERS=6 node --import tsx tools/world/qa-balance.ts [--n 200] [--nworld 80] [--fair 24] [--fairsets blitz:normal,world:normal,blitz:hard]` |
| `world/qa-bundle.mjs` | The mode's bundle budget: the initial bundle (entry, modulepreloads, CSS) and the net lazy growth against a baseline build, gzipped | `node tools/world/qa-bundle.mjs <dist> [<baseline dist>]` |
| `world/qa-globe-perf.mjs`, `world/qa-battle-perf.mjs` | gpu-rig scripts (run them as `$RIG tools/world/...`, tools/gpu-rig/README.md): the globe's frame rate per preset and screen (vsync and free-running, GPU time per frame), and region battles against skirmish maps of the same size (150-unit battle, centre and start views) | `$RIG tools/world/qa-globe-perf.mjs <url> [presets] [states]` · `$RIG tools/world/qa-battle-perf.mjs <url> [presets] [units] [views]` |
| `world/maps-pilots.ts` | Does a region battlefield change who wins? The old Conquest battle specs (strength 3) played by the newcomer / casual stand-ins on the old generator's map and on a world region battlefield of each climate, with 95% Wilson intervals (`WORKERS` caps the threads, default 4) | `node --import tsx tools/world/maps-pilots.ts [--seeds 6] [--kinds assault,capture,hold] [--maps old,temperate,winter,desert,tropical] [--cells easy:newcomer,easy:casual,normal:casual] [--out f.json]` |

## Self-play (`tools/selfplay`)

| Tool | What it does | Command |
|---|---|---|
| `run.ts` | Mass AI-vs-AI self-play with a statistical report (options in its header); `--probe ai` adds why the timed-out games did not finish (the leader searching, attacking or holding) | `node --import tsx tools/selfplay/run.ts --mode faction --games 40 [--probe ai]` |
| `balance.ts` | Cost-equal unit duels (`--emit` regenerates `src/sim/ai-matchups.ts`) | `node --import tsx tools/selfplay/balance.ts [--budget 3000] [--seeds 2] [--emit]` |
| `doctrine.ts` | Commander-rules balance: doctrines and commander powers | `node --import tsx tools/selfplay/doctrine.ts [--seeds 6] [--only mirror,cross,powers,comeback]` |
| `economy.ts` | Commander economy sanity: what each personality builds, researches and upgrades, the economy on vs off, greed vs aggression | `node --import tsx tools/selfplay/economy.ts [--games 12] [--minutes 40] [--only usage,ablation,greed,pace]` |
| `difficulty.ts` | Difficulty curve: each AI level against a passive player (first wave, contact, first loss, wipe-out) with and without build-up time, against a new-player stand-in, and economy vs rush under the mutators | `node --import tsx tools/selfplay/difficulty.ts [--games 8] [--size 96] [--only passive,ceasefire,novice,mutators] [--rules classic,commander]` |
| `standins.ts` | Each AI level against human stand-ins (a scripted novice and casual player, and an experienced one: the frozen version-2 Normal AI with a human's economy), per ruleset and map size, with 95% intervals | `node --import tsx tools/selfplay/standins.ts [--games 12] [--diff recruit,easy,normal,hard,brutal] [--vs novice,casual,experienced] [--rules classic,commander] [--size 64,96] [--personality all] [--dynamic 1]` |
| `optimize.ts` | Hill-climbing of the AI's tuning parameters | `node --import tsx tools/selfplay/optimize.ts [--iters 20] [--games 96] [--vs best\|legacy]` |
| `inspect.ts` | Watches one match in the terminal (economy, army, AI decisions) | `node --import tsx tools/selfplay/inspect.ts [seed] [map] [p0] [p1] [minutes]` |
| `levels.ts` | Each AI level where players meet it: Quick Battle rolls (maps, mutators, personalities, rivals, dynamic difficulty) and the skirmish menu's defaults, against the stand-ins (newcomer, novice, casual, experienced), with 95% intervals, how long the human's wins take and whether the AI looks alive; `--probe ai` adds a diagnosis (waves and how they ended, armies against the AI's estimate, Ore Trucks lost, spending) and how the games end (what is left of a beaten AI) | `node --import tsx tools/selfplay/levels.ts [--games 60] [--cond qb,custom] [--rules commander,classic] [--pairs targets\|all] [--patch JSON] [--tune k=v] [--probe ai]` |
| `teams.ts` | Team play and navies: a stand-in with an AI teammate in a 2v2 (help at the base, joined pushes, idle time, ore), free-for-alls (whom the AIs' waves go for), AI-vs-AI navies on sea maps; `--enemy normal` puts the teammate under test against enemies of another level | `node --import tsx tools/selfplay/teams.ts [--mode 2v2,ffa,naval] [--games 16] [--map archipelago] [--enemy normal]` |
| `endgame.ts` | Endgames: an AI of each level against the casual stand-in, who is crushed at `--at` minutes down to `--keep` units hiding in the far corners; how long the AI takes to find and finish them | `node --import tsx tools/selfplay/endgame.ts [--games 16] [--diff ...] [--rules classic,commander] [--at 15] [--keep 2]` |
| `trace.ts` | One skirmish set up exactly as the game does (a Quick Battle roll or the `?autostart` setup) with snapshots of both sides: spending, units, structures, caps | `node --import tsx tools/selfplay/trace.ts [--qb 77 \| --autostart 77] [--diff recruit] [--vs newcomer\|ai:normal] [--at 3,7,15]` |
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
| `fuzz.ts` | Command fuzzer: random legal commands from the whole command vocabulary (surrender included) into random skirmishes (sizes up to 192, 2-4 players, teams, both rulesets, mutators, King of the Hill, sea and curated maps), world invariants every 10 ticks (also tech counts against the finished structures and the entity map), and per case a save / load at a random tick, a replay of the command log and (some cases) portable maths, which must all hash the same. One seed reproduces a case; `FUZZ_ALL=1` also commands the AI players' units | `node --import tsx tools/qa/fuzz.ts [--from 1] [--count 20] [--minutes 5] [--size 0] [-v]` |
| `bigarmy.ts` | Long 4-player match with build-up time: units, simulation ms per tick (p50 / p95 / max), AI thinking time and save cost per interval; `--mem` lists collections that keep growing, `--hash` prints state hashes to compare two builds | `node --import tsx tools/qa/bigarmy.ts [--size 128] [--diff brutal] [--minutes 60] [--ceasefire 30] [--credits 10000] [--seed 7]` |
| `stuck.ts` | Stuck detection in AI-vs-AI matches: movers without progress for 20 s, idle harvesters with ore left, an AI with money that builds nothing for 3 minutes, aircraft that never rearm, transports that never unload | `node --import tsx tools/qa/stuck.ts [--size 128] [--players 4] [--diff hard] [--minutes 45] [--water 0.4]` |
| `crowd.ts` | A big army ordered across a bridge and back (or across open ground with `--flat`): arrival time and units without progress | `node --import tsx tools/qa/crowd.ts [--units 300] [--seed 4] [--flat]` |
| `saveprof.ts` | Save cost on a big world: serialise, JSON, load, and the largest parts | `node --import tsx tools/qa/saveprof.ts [minutes=28] [size=128]` |
| `waves.ts` | Attack waves across a Quick Battle map (the roll for `--seed`, or the `?autostart` setup): a spawned army attack-moving at the enemy yard, or (`--bot`) a stand-in's economy sending newcomer-style waves (`--once`: each wave ordered once; `--direct`: a click on a seen structure, i.e. an attack order). Reports stalled unit-seconds by cause, units idle mid-map, formations held back, and deaths by killer and place | `node --import tsx tools/qa/waves.ts [--seed 77] [--autostart] [--diff recruit] [--bot --once --human newcomer\|casual --every 75 --wave 5] [--direct] [-v]` |
| `behave.ts` | Unit behaviour scenarios with numbers: entering structures from awkward spots, chokes and a bridge (30 / 60 units, human and AI, move and attack-move), Ore Trucks, a crowded rally point, aircraft rearming, an APC run, the service depot queue, an MCV on a blocked spot, unreachable orders, a fleet and a landing craft, return fire and threat priorities | `node --import tsx tools/qa/behave.ts [river\|enter\|choke\|harvest\|rally\|support\|naval\|guard\|all] [-v]` |
| `modesave.ts` | Save / load and replay determinism in every mode: skirmish (Classic and Commander, 1v1 to 4 players, teams, an AI ally, sea), multiplayer rosters with surrender (AI takeover and concede), King of the Hill, every built-in challenge, co-op, every campaign and special mission at every level, every Conquest battle kind (the capital and sea battles also at Easy), endgames (the AI hunting a hidden last unit, a beaten AI's last stand and surrender, alone and as a team), a multiplayer match played on offline after the relay went away, and replay branches. Each scenario saves mid-match, loads the way the game resumes, and checks the hashes and the whole saved state against the uninterrupted game; skirmish-based modes also replay their command log | `WORKERS=4 node --import tsx tools/qa/modesave.ts [--quick] [--only <regex>] [-v]` |
| `longrun.ts` | Whole AI matches (2-4 players, every level, both rulesets, teams, sea and curated maps) with the fuzzer's invariants, units holding a move / attack / enter order for 3 minutes without progress, Ore Trucks idle for 3 minutes with work to do, tick times against the 50 ms budget, and whether the match ends | `WORKERS=4 node --import tsx tools/qa/longrun.ts [--minutes 60] [--seeds 1] [--from 1] [--only <regex>] [-v]` |
| `pathprof.ts` | Path-search profile of a long AI match: searches per tick, nodes per search, blocked goals, queue length, tick times | `node --import tsx tools/qa/pathprof.ts [--size 128] [--players 4] [--diff brutal] [--minutes 40]` |
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
with per-pass GPU timings, A/B frame cost and pixel comparisons of two builds (`perfab.mjs`, `lookab.mjs`) and a load-time profile
(`loadprof.mjs`). See [`gpu-rig/README.md`](gpu-rig/README.md). World Conquest region battlefields on the rig:
`world/maps-shots.mjs <url> [preset] [out] [region:kind:seed,...]` (a contact sheet of the start view and an overview
per case) and `world/maps-perf.mjs <url> [presets] [regions] [rounds]` (frame and GPU time and draw calls, the same
battle on the old map and on the region's; both open battles with `?autostart=1&conquest=<kind>&region=<id>`).
World Conquest landmark and civilian building models: `world/arch-sheet.mjs <dev-url> <landmarks|civ|all> [presets]
[out] [only]` (day and night contact sheets of every landmark and civilian style at the default zoom, in the real renderer;
it imports the models by path, so it needs a Vite dev server) and `node --import tsx tools/world/arch-stats.ts` (headless:
triangles and build time of every landmark and style at both details).
[`xb/`](xb/README.md) runs the same checks in
Firefox and WebKit on the GPU, and in the test VMs (Windows Direct3D, a low-end Linux laptop): look comparisons, input,
soak, memory per Play again (`memcycle.mjs`), low-end CPU, PWA and high-DPI checks.

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
| `matrix.mjs` | The play matrix: the skill profiles play every mode at every level (Quick Battle, Classic 1 vs 1, 2 vs 2 with an AI ally, campaign mission 1 per side and level, co-op survival (the casual player, and a newcomer's first co-op), Conquest, King of the Hill, a challenge, plus the replays, editor and abuse journeys), one game at a time. Per run: result, match length, first contact, money left idle, low power, the enemy at 7:00, the Field Manual hints shown, toasts and friction (clicks that did nothing, failed placements, softlocks). Writes `results.jsonl` (appended per cell) and `table.md`; `--lock` runs each cell in its own process under `flock` after `memguard.sh 6000` | `node tools/e2e/matrix.mjs [cell-pattern,...] [--serve <dist> \| --url <url>] [--lock /tmp/rh-lab/heavy.lock] [--profiles newcomer,casual] [--label before] [--out <dir>] [--list]` |
| `matrix-compare.mjs` | Before/after table of two matrix runs | `node tools/e2e/matrix-compare.mjs <before/results.jsonl> <after/results.jsonl> [out.md]` |
| `profiles.mjs` | The scripted players the matrix uses: *newcomer* (reads the Field Manual and does what it says, otherwise naive: infantry waves as soon as it has a group, no defences, no truck care), *casual* (a sensible base, two defences, tanks, attack-moves at a dozen units) and *experienced* (first-launch's winning play). Deterministic, not tuned to the AI | (imported by `matrix.mjs` and the journeys) |
| `hudshot.mjs` | HUD layout check: starts a skirmish, resizes the window through the given sizes and reports the layout on show (Classic falls back to Modern where its sidebar doesn't fit), the share of the window left to the battlefield, panels off screen or overlapping, with screenshots | `node tools/e2e/hudshot.mjs <url> <outDir> [390x844,800x600,...] [--touch] [--classic] [--lang de]` |
| `coach-sim.ts` | Which Field Manual alerts the human stand-ins get, and when, in headless matches against the AI (or campaign missions); `--respond none,coached,bank,close` also plays each seed with a stand-in that follows the money and close-out alerts, and reports wins, timeouts and the share of the time with $1,000+ in the bank | `node --import tsx tools/e2e/coach-sim.ts [--games 4] [--diff recruit,easy] [--vs newcomer] [--rules commander,classic] [--respond none,coached]` |

Journeys (`tools/e2e/journeys/`): `first-launch` (fresh profile, Quick Battle on Recruit won through the UI, results,
Play again), `bootcamp` (a fresh profile plays all nine Boot Camp drills the way the radio and the objectives say:
per drill its game time, whether what it points at is on screen, friction; then the debrief and the menu without "Start
here"), `skirmish-setup`, `skirmish-ally` (2 vs 2 with an AI ally from the skirmish panel), `campaign` (Boot Camp drills, mission 1 of each side, a special operation lost and
retried, the first Conquest battle), `saves`, `replays`, `editor`, `challenges` (daily, files, share links), `settings`,
`pwa-update` (needs `--serve <A> --serve-b <B>,<C>`), `abuse` (rapid clicks, Esc spam, focus loss, resizing), `menus`
(every main-menu screen and its tabs, the skirmish panel, the pause menu and the results screen: text that is clipped,
off screen or still a catalogue key, as friction), `keyboard` (menus, Settings, the Campaign, a Quick Battle and the
pause menu with the keyboard only: focus rings, focus traps), `touch-mission` (with `--touch --mobile --size 844x390`:
Allied mission 1 by touch, its panels in landscape and portrait, the Field Manual's x, the radial menu held on open
map, the debrief in both shapes with the XP strip and medal toasts off its title, stars and buttons) and `motion` (reduced
motion in the menus, a battle and the results; the three team palettes). `--lang <code>` and `--classic` start the
fresh profile in that language or with the Classic layout. The matrix's `mission:<id>:newcomer` cells play every
campaign mission and special operation once at Easy, from a profile that won the missions before it.

World Conquest journeys: `world` (the menu entry, the homeland picker by tap and keyboard, options, the challenge link
on the clipboard, reinforce, one roll and a blitz with the move-in, cards, rivals and a ceasefire offer, the war diary,
fortify, the rivals' playback, an RTS battle fought from the odds panel and the report, the list view by keyboard, the
share card as a PNG download, save and resume from the menu, the challenge link in a fresh profile; `E2E_WORLD_BATTLE=
play` lets the newcomer profile fight the battle, `win` forces it), `world-landmark` (a landmark battle opens with the
landmark uncovered on screen, the fly-over played and skipped), `world-defeat` (a lost battle's report and the way
back), `world-newcomer` (a fresh profile per `--locale` starts at home and the coach's first target is a land battle),
`world-guard` (the `?world=` test screens need `?debug=1` and never record or replace the saved run) and
`world-memory` (eight visits and three battles: heap after GC, WebGL context warnings). The matrix's `world:<level>:
<profile>` cells play a few world turns and one battle through the UI (tools/e2e/world-play.mjs).

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
| `i18n/catalog.ts insert` | Like `merge`, but edits the file line by line: new keys go in at their sorted place, changed values are replaced on their line, nothing else moves (safe while other people append to the same file) | `node --import tsx tools/i18n/catalog.ts insert <lang> <batch.json>...` |
| `i18n/sweep.mjs` | Walks the real interface in one language (main menu screens and their tabs, a match: HUD, selection, pause menu, results; the map editor with every tool and mission form) and lists the English still on screen (`english.txt`), text that does not fit its box (`clipped.txt`) and a screenshot per screen. Needs a running game (dev server or `tools/e2e/serve.mjs`) and a headless Chromium (heavy lock) | `node --import tsx tools/i18n/sweep.mjs --url http://127.0.0.1:5173/ --lang de [--only menu,game,editor] [--out dir]` |
| `i18n/mission-text.ts` | Collects the text the mission scripts show (briefings, tips, debriefs, objectives, radio lines, timers, scores, defeat reasons, names) into `src/i18n/en/missions.ts` (source English, keys kept for unchanged text); `check` lists script text nothing registers (the test runs it) | `node --import tsx tools/i18n/mission-text.ts [check\|list]` |
| `i18n/gen-shots.mjs` | Opens the screens that show generated names (a mid-campaign Conquest map, its army and battle preview, the Rivals board) in one language, screenshots them and lists the Latin-script words left on screen. Needs a running dev server and a headless Chromium (heavy lock) | `node --import tsx tools/i18n/gen-shots.mjs --url http://127.0.0.1:5316/ --lang ru [--out dir]` |
| `i18n/scan.ts` | Static sweep of all of `src` for English-looking literals (capitalised phrases, sentences, HTML text, title / aria attributes) that no catalogue registers; skips developer text (console, errors, GLSL). `--baseline` shows only what is new since an earlier `--json` (scan an old checkout with `--root`) | `node --import tsx tools/i18n/scan.ts [--root dir] [--json out.json] [--baseline old.json]` |
| `i18n/catalog.ts check` | Placeholder, plural, markup and raw-HTML problems in the translations | `node --import tsx tools/i18n/catalog.ts check [lang]` |
| `i18n/catalog.ts prune` | Drops keys English no longer has | `node --import tsx tools/i18n/catalog.ts prune <lang>` |
| `fonts/fetch.mjs` | Downloads the pinned OFL sources of the interface fallback fonts (`fonts/fonts.json`, google/fonts at a fixed commit, sha256-checked) into `~/.cache/red-horizon/fonts/` | `node tools/fonts/fetch.mjs` |
| `fonts/subset.py` | Builds `public/fonts/tektur-cyrillic.woff2` (Cyrillic) and `noto-sans-sc-subset.woff2` (the characters `zh-CN.json` uses). Re-run it after changing the Chinese catalogue (`cjk` rebuilds only the Chinese subset; the output is reproducible). Needs fontTools + brotli. | `~/.cache/rh-fonts/venv/bin/python tools/fonts/subset.py [tektur\|cjk]` |

`subset.py` needs a Python with `fonttools==4.60.1 brotli==1.1.0`, for example
`python3 -m venv ~/.cache/rh-fonts/venv && ~/.cache/rh-fonts/venv/bin/pip install fonttools==4.60.1 brotli==1.1.0`.
Where that Python has no `ssl` module (pip cannot reach PyPI), download the two wheels with curl (PyPI's JSON API lists
their URLs: `https://pypi.org/pypi/fonttools/4.60.1/json`) and install them with `pip install --no-index <wheels>`.

## Elsewhere

The browser audits in `tests/perf/` and the scripts in `tests/tools/` run through npm:
- `npm run audit:leaks` (every system on; `--classic` for plain rules);
- `npm run audit:profile`;
- `npm run audit:stress` (a 300-unit battle: spikes, GC, allocation sites);
- `node tests/perf/speed.mjs [q] [seconds] [units] [speed]` (the game speed a big battle really reaches at x5 with the real frame loop, main-thread costs only);
- `npm run audit:presets` and `npm run audit:startup` (point them at one or two builds: before / after);
- `npm run verify:pwa`;
- `npm run icons`.
