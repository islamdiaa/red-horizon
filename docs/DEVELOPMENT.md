# Developing Red Horizon

## Setup

Requires [Node.js](https://nodejs.org/) 20.19+ (22 LTS recommended) and a browser with WebGL 2.

```bash
npm ci
npm run dev          # http://localhost:5173, hot reload
npm run build        # type-check + production build into dist/
npm run preview      # serve the production build
```

## Architecture

The game is a deterministic simulation and a renderer that only observes it.

- **Simulation** (`src/sim/`). A fixed 20 Hz, seeded simulation that never reads rendering state,
  wall-clock time or `Math.random()`. The same seed and command stream always produce the same
  game. Saves, replays (with periodic state hashes), rewinding, challenges and headless testing
  all rely on this.
- **Rendering** (`src/render/`). three.js on WebGL 2. It interpolates between ticks and turns
  entity state into models, effects, lights and sound.
- **Dependencies.** three.js is the only runtime dependency. The editor and the Conquest UI load
  as separate chunks.

```
src/
  core/       shared utilities (seeded RNG, math helpers)
  data/       game rules (from the original RULES.INI)
  sim/        simulation: world, map generation, pathfinding, combat, economy, production,
              naval, espionage, powers, superweapons, Commander rules, events, AI
  render/     renderer: terrain, water, weather, fog, models (procedural + HD), effects, destruction
  audio/      procedural sound effects, adaptive music, announcer, mixer
  ui/         HUD, build bar, minimap, input (mouse, touch, gamepad), menus, results, locker
  missions/   campaigns, Boot Camp, special operations, Daily Challenge
  maps/       curated maps, map codes, previews, custom maps
  editor/     map and mission editor
  mods/       mod format, validation and rule overrides
  modes/      challenges, King of the Hill, co-op, mutators, Quick Battle
  conquest/   the roguelite campaign
  replay/     recording, storage, playback and branching
  meta/       XP, ranks, medals, contracts, unlocks, rivals
  platform/   error boundary, WebGL and GPU detection, fullscreen, PWA, untrusted-input parsing
public/       manifest, service worker, icons, fonts, example mods, HD models
tests/        node:test suite, PWA verification, leak and profile audits
tools/        headless simulation, mission autopilots, self-play, screenshot tooling
tools/assets/ the HD model factory (Blender kit, model scripts, build runner)
docker/       nginx configuration
```

## Testing

```bash
npm run typecheck
npm test                                  # unit, integration, regression and AI-vs-AI soak tests
node --import tsx tools/savetest.ts       # save/load determinism (must print DETERMINISTIC ✓)
npm run verify:pwa                        # production build + manifest, service worker, offline
npm run audit:leaks                       # 5 matches in a browser: heap and GPU resources stay flat
npm run audit:profile                     # CPU profile of a 30 s battle
```

The suite covers:
- the Red Alert damage formula;
- pathfinding and map fairness;
- the economy, production and combat;
- the AI, Commander rules, events and mutators;
- contracts and unlocks;
- save and replay determinism;
- the hardened file importers;
- long AI-vs-AI soak games.

Other tools are listed in [`tools/README.md`](../tools/README.md), among them:
- headless AI-vs-AI matches;
- mission autopilots;
- mass self-play for balance;
- screenshot scripts.

The browser tools use Playwright (`npx playwright install chromium`).

## HD models

`public/models/` holds texture-baked GLB models built from Python scripts in
`tools/assets/models/` with a headless Blender. The generated files are committed, so you only
need Blender to change a model:

```bash
tools/assets/setup-blender.sh              # pinned Blender 4.5 LTS (sha256-checked)
node tools/assets/fetch-textures.mjs       # pinned CC0 texture inputs and decal font
node tools/assets/build.mjs weap.soviet    # build one model (or --all)
```

The kit:
- models the hard-surface parts;
- bakes ambient occlusion, edge wear, grime, decals and stencilled slogans into one atlas;
- exports a quantised GLB with WebP textures.

No WebAssembly decoders are needed, so the CSP stays strict. See
[`tools/assets/README.md`](../tools/assets/README.md) and
[`tools/assets/STYLE.md`](../tools/assets/STYLE.md).

## Deployment

The production build is static files in `dist/`.

- **Docker.** A multi-stage image: unprivileged nginx with caching rules and security headers.

  ```bash
  docker compose up -d --build              # http://localhost:8091
  ```

- **Vercel.** Import the repository. `vercel.json` sets the build and the same headers.
- **Other static hosts.** Build with `npm run build` and serve `dist/`. Copy the headers from
  [`docker/security-headers.conf`](../docker/security-headers.conf). Serve `/assets/*` as
  immutable, and `index.html` and `sw.js` with `no-cache`.

## Test URL parameters

Add these to the URL to jump straight into a situation:

| Parameter | Effect |
|---|---|
| `?autostart=1` | Start a skirmish immediately |
| `size=64` · `climate=winter\|desert` · `fog=0` | Map size, climate, fog of war off |
| `scenario=base\|battle` · `units=mcv\|light\|heavy` · `charge=1` | Prebuilt base or battle, starting units, superweapons charged |
| `tod=night` · `hour=0..24` · `cycle=1` · `wx=rain\|storm\|snow\|fog\|dust` | Time of day and weather |
| `cam=x,y,dist` · `ff=<seconds>` · `intro=0\|1` | Camera, fast-forward, intro cinematic |
| `q=low\|medium\|high` · `hd=0\|1` | Graphics preset, HD models |
| `rules=commander\|classic` · `doctrine=<id>` · `mut=<a,b>` · `events=0` · `dyn=1` | Skirmish rules, doctrine, mutators, events, dynamic difficulty |
| `ceasefire=<minutes>\|inf` | Build-up ceasefire |
| `selfplay=hard` | An AI plays your side |
| `mission=<id>` | A mission: `bootcamp`, `allied-01`, `soviet-04`, `wolfpack`, `survival`, `daily` … |
| `map=<id>` · `mapcode=<code>` | A curated map or a shared generated map |
| `replay=<id>\|latest` · `view=<n>\|obs` · `seek=<s>` · `take=<player>` | Watch a replay or take command |
| `koth=1&kothmin=N` · `challenge=<id>` | King of the Hill, a saved challenge |
| `conquest=assault\|capture\|hold\|defend\|naval\|boss\|ui` | A Conquest battle or the Conquest map |

Asset preview pages: `/preview-models.html`, `/preview-effects.html`, `/preview-audio.html`,
`/preview-weather.html`.
