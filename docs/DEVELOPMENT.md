# Developing Red Horizon

## Setup

Requires [Node.js](https://nodejs.org/) 20.19+ (22 LTS recommended) and a browser with WebGL 2.

```bash
npm ci
npm run dev          # http://localhost:5173, hot reload
npm run build        # type-check + production build into dist/
npm run preview      # serve the production build
npm run build:itch   # relative-base build (runs from any folder), zipped for itch.io into release/
npm run desktop      # the Electron wrapper (desktop/, its own dependencies)
```

Every runtime asset URL goes through `assetUrl()` in `src/platform/paths.ts`, so builds work from the site root,
a sub-path (`RH_BASE=/sub/`) or a relative folder. See [DISTRIBUTION.md](DISTRIBUTION.md).

## Architecture

The game is a deterministic simulation and a renderer that only observes it.

- **Simulation** (`src/sim/`). A fixed 20 Hz, seeded simulation that never reads rendering state,
  wall-clock time or `Math.random()`. The same seed and command stream always produce the same
  game. Saves, replays (with periodic state hashes), rewinding, challenges and headless testing
  all rely on this.
- **Rendering** (`src/render/`). three.js on WebGL 2. It interpolates between ticks and turns
  entity state into models, effects, lights and sound.
- **Dependencies.** three.js is the only runtime dependency, in its own chunk.
- **Loading.** The first menu frame needs only the menu, the simulation and the audio (about 330 KB of
  gzipped script). Everything 3D (three.js, the renderer, the models, the HUD and the menu's backdrop battle)
  is the engine chunk, `src/engine.ts`, which `main.ts` requests at boot, so it downloads while the menu is
  already up. Screens most sessions never open load on demand: results, profile, Locker, challenges,
  campaign, Conquest, editor, replay viewer, research tree, lobby, clips, trailer and the share dialogs.
  `tests/perf.test.ts` fails if `main.ts` reaches three.js or the battle code statically.
- **Data.** HD models and terrain textures load when a match needs them. The quiet background prefetch for
  offline play (`src/platform/prefetch.ts`) skips Data Saver, slow (2g/3g) and metered connections;
  Settings › Graphics has an explicit "Download HD content for offline play" (`src/platform/offline.ts`).
  The service worker keeps those content-hashed files in a cache that survives updates (`public/sw.js`).

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
  i18n/       interface languages: the English catalogue (en/), the translations (locales/), formatting
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
node --import tsx tools/qa/fuzz.ts --count 40   # command fuzzer: invariants, save / load, replay and portable maths stay in sync
npm run verify:pwa                        # production build + manifest, service worker, offline
npm run audit:leaks                       # 5 matches in a browser: heap and GPU resources stay flat
npm run audit:profile                     # CPU profile of a 30 s battle
npm run audit:stress                      # 300 units: frame-time spikes, GC and allocation sites (q, frames, units)
npm run audit:presets -- <url,url2>       # per preset: draw calls, triangles, CPU / GPU-synced frame time, load and compile time
npm run audit:startup -- <url,url2>       # time to menu and backdrop, script bytes before the menu, on 4G / 3G
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

## Translations

The interface is translated into Russian, German, Spanish, Brazilian Portuguese, French and Simplified Chinese
(`src/i18n`, no dependencies). English is the source and the fallback for any missing key.

- **English** lives in namespace modules, `src/i18n/en/<ns>.ts`, that register themselves when first imported, so
  each chunk carries the English it uses. `strings('hud', {...})` returns a typed translator:
  `tHud('build.needMore', { money })`, or `tHud.html(...)` for HTML. Messages are ICU-lite: `{name}`,
  `{n, plural, one {# unit} other {# units}}`, `{x, select, ...}`.
- **Other languages** are one flat JSON file each, `src/i18n/locales/<lang>.json`, lazy-loaded: only the active
  language downloads. The setting is Settings › Gameplay › Language (Auto follows the browser), stored in
  `localStorage` (`rh.lang`).
- **Game data** (unit, structure, power, doctrine, research, achievement... names) keeps its English in the data
  modules; the interface reads it through `dt()` and the helpers in `src/i18n/names.ts`.
  `tools/i18n/data-sources.ts` lists those tables for the translators.
- **Text made by the simulation or mission scripts** stays English at the source: it is lockstep-networked, saved
  and hashed. `sourceStrings()` registers that English, and the display calls `trSource(text)`. The campaign,
  special-operations and naval missions' text is collected from the scripts by `tools/i18n/mission-text.ts` into
  `src/i18n/en/missions.ts` (generated: re-run the tool after changing mission text; the test lists what is missing).
  Built-in player names (the AI commanders, the default "Commander") are shown through `playerName()`
  (`src/i18n/en/players.ts`); a name a player chose is shown as it is.
- **The map editor** (`src/editor`) keeps ids in the files it saves (tools, symmetries, objective and trigger kinds);
  the labels come from `src/i18n/en/editor.ts`. The defaults it fills into a new mission (player names, briefing,
  objective texts) are written in the author's language; custom missions emit English in the simulation
  (`src/i18n/en/editor-mission.ts`) like the built-in ones.
- **Safety.** Translations are plain text, inserted with `textContent`, `esc()` or the `.html()` variants. The
  `.html()` variants escape everything and allow only the `[b] [i] [em] [strong] [kbd] [small] [br]` markers.
- **Rules.** Never translate at module scope; look strings up when rendering.
- **Format numbers, money and dates** with `fmtInt`, `fmtMoney`, `fmtDate` and `fmtRelative` (Intl).
- **Fonts.** Latin uses Rajdhani. Cyrillic uses a 7.6 KB subset of Tektur. Chinese uses the system font, with a
  subset of Noto Sans SC as the fallback. Both fallbacks are rebuilt with `tools/fonts` (see `tools/README.md`).
- **Keyboard shortcuts** match the key's label (`KeyboardEvent.key`: Z is Z on QWERTZ and AZERTY), falling back to its
  position on non-Latin layouts (`src/ui/keymap.ts`); show key names with `common.keys.*` (German "Strg").
- **Tests.** `tests/i18n.test.ts` checks that:
  - every key exists in every language;
  - placeholders and markup match the English, and no translation contains raw HTML;
  - every character is covered by the fonts;
  - the setting persists;
  - no new hard-coded player-facing string appears in the UI files (`src/ui`, `src/editor` and a few more).

  `tests/editor-i18n.test.ts` covers the editor in another language and `tests/i18n-missions.test.ts` the mission text.

To add a string, put it in the namespace module and translate it in each `locales/<lang>.json` (append it next to
related keys, or batch-insert with `node --import tsx tools/i18n/catalog.ts insert <lang> <batch.json>`, which changes
nothing else in the file). `node --import tsx tools/i18n/catalog.ts missing <lang>` lists what a language still lacks.
`tools/i18n/sweep.mjs` walks the running game in one language and lists the English still on screen and text that does
not fit its box; `tools/i18n/mission-coverage.ts` plays every mission headlessly and checks the text it shows.

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
| `terrain=classic` · `nature=classic` | Procedural ground shading, procedural trees and rocks (A/B) |
| `fxdc=0` · `juice=0` | Effects director's cut off (heat haze, lens rain, soft and fire-lit smoke) · game-feel layer off, for A/B comparisons |
| `rules=commander\|classic` · `doctrine=<id>` · `mut=<a,b>` · `events=0` · `dyn=1` | Skirmish rules, doctrine, mutators, events, dynamic difficulty |
| `ceasefire=<minutes>\|inf` | Build-up ceasefire |
| `selfplay=hard` | An AI plays your side |
| `mission=<id>` | A mission: `bootcamp`, `allied-01`, `soviet-04`, `wolfpack`, `survival`, `daily` … |
| `map=<id>` · `mapcode=<code>` | A curated map or a shared generated map |
| `replay=<id>\|latest` · `view=<n>\|obs` · `seek=<s>` · `take=<player>` | Watch a replay or take command |
| `koth=1&kothmin=N` · `challenge=<id>` | King of the Hill, a saved challenge |
| `conquest=assault\|capture\|hold\|defend\|naval\|boss\|ui` | A Conquest battle or the Conquest map |
| `trailer=1` · `tod=` · `climate=` · `autorecord=1` | The ~85 s trailer cut with title cards, recorded to WebM |
| `attract=0` · `tod=` · `climate=` (menu) | The old free-running menu battle · a fixed backdrop sky and climate |
| `#share=1.…` | Open a share link (map, challenge or replay); asks before importing |

Asset preview pages: `/preview-models.html`, `/preview-effects.html`, `/preview-audio.html`,
`/preview-weather.html`, `/preview-infantry.html` (HD infantry clips: `?type=e1&fac=soviet&clips=rifle.`).
