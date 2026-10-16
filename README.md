# Red Horizon

**A real-time strategy game for the browser that recreates the gameplay of the 1996 classic
*Command & Conquer: Red Alert* in modern real-time 3D.**

Allies against Soviets. Base building, ore harvesting, power grids and tech trees. Tesla Coils and
Mammoth Tanks, submarines and cruisers, spies and Chronospheres, paratroopers and nukes. It is
rebuilt from scratch in TypeScript and three.js, using the original game rules that EA released
under the GPL.

Every model, texture, sound effect and piece of music is generated in code: at runtime, or by
scripts in this repository for the optional HD models. So the game ships **zero copyrighted
assets**. It has 17 scripted missions, a roguelite campaign, an editor and modding. The game itself
is about 850 KB gzipped; the HD models (about 23 MB, loaded only for the factions in a match) are
optional. There is nothing to install and nothing to sign up for.

| | |
|---|---|
| ![Main menu](docs/menu.jpg) | ![Thunderstorm battle at dusk](docs/battle.jpg) |
| ![Allied base at golden hour](docs/base.jpg) | ![Winter night](docs/winter.jpg) |
| ![Snowfall](docs/snow.jpg) | ![Desert climate](docs/desert.jpg) |
| ![Soviet armour close-up](docs/closeup.jpg) | ![Nuclear strike](docs/nuke.jpg) |

## Contents

- [Highlights](#highlights)
- [Getting started](#getting-started)
- [Deploying](#deploying)
- [Game modes](#game-modes)
- [Features](#features)
- [Controls](#controls)
- [Faithful to Red Alert](#faithful-to-red-alert)
- [Maps, missions and mods](#maps-missions-and-mods)
- [Architecture](#architecture)
- [Development](#development)
- [Security and privacy](#security-and-privacy)
- [Contributing](#contributing)
- [License and legal](#license-and-legal)

## Highlights

- **The Red Alert gameplay you remember.** The rules come from the original `RULES.INI`, and
  damage uses the original formula. The full roster is here: 43 unit types and 38 structures,
  including the expansion-pack units.
- **A world that looks like 2026.** Dynamic lights, GPU particles and volumetric fog. Water with
  reflections and a rolling ocean swell. A day and night cycle with weather: storms, snow that
  settles, sandstorms. Buildings crumble under rigid-body physics.
- **Lots to play.**
  - Two 7-mission campaigns and Boot Camp.
  - Naval and survival operations.
  - Conquest, a roguelite campaign across Europe.
  - A Daily Challenge, King of the Hill and co-op survival.
  - Branching replays you can take command of.
- **An AI that plays fair.** It sees only what its units see, scouts and counters your army.
  There are 11 commander personalities, and persistent rivals that remember how you play.
- **HD models.** Texture-baked models for every structure and ground vehicle, with weathered
  steel, slogan boards, banners and lit windows. They are built by a scripted Blender asset factory
  and stream in per faction; the lightweight procedural models stay as the fallback and the
  distant level of detail.
- **Make your own.** A map and mission editor working in the real 3D renderer, plus JSON rule
  mods.
- **Plays anywhere.** Mouse and keyboard, touch, or gamepad. It installs as an offline-capable
  app.

## Getting started

You need [Node.js](https://nodejs.org/) 20.19 or newer (22 LTS recommended) and a browser with
WebGL 2 (any current Chrome, Edge, Firefox or Safari).

```bash
git clone https://github.com/islamdiaa/red-horizon.git
cd red-horizon
npm ci
npm run dev        # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check, then production build into `dist/` (static files) |
| `npm run preview` | Serve the production build locally |
| `npm test` | The full test suite |

Graphics quality is chosen automatically from your GPU on first launch, and you can change it in
the settings. *Model detail* switches between the HD models (the default on High and Medium) and
the lightweight procedural ones (the default on Low). A discrete or recent integrated GPU is recommended for *High*.

## Deploying

The production build is a folder of static files. Host `dist/` anywhere that serves static files.

### Docker

The repository includes a multi-stage `Dockerfile` that builds the game and serves it with an
unprivileged nginx, including caching rules and security headers.

```bash
docker compose up -d --build     # http://localhost:8091
```

To run it without Compose:

```bash
docker build -t red-horizon .
docker run -d --name red-horizon -p 8091:8080 --read-only --tmpfs /tmp red-horizon
```

### Vercel, Netlify, GitHub Pages, S3…

Use build command `npm run build` and output directory `dist`. On Vercel, import the repository
and it is detected as a Vite project. The included `vercel.json` adds the same security headers and
cache rules as the nginx configuration.

For other hosts, apply the headers from [`docker/nginx.conf`](docker/nginx.conf) yourself. The ones
that matter:
- serve `/assets/*` as immutable;
- serve `index.html` and `sw.js` with `no-cache`, so that updates reach players.

## Game modes

| Mode | |
|---|---|
| **Skirmish** | Up to 3 AI opponents on four difficulties, on generated or hand-made maps. Climates: temperate, winter and desert, with land or sea terrain. Optional King of the Hill. |
| **Campaigns** | 7 Allied and 7 Soviet missions, each with a briefing, primary and optional objectives, radio transmissions and scripted set pieces. Each mission awards up to three stars. |
| **Boot Camp** | An interactive tutorial in nine drills. |
| **Special operations** | *Wolfpack* (submarines against an Arctic convoy) and *Iron Coast* (escort a cruiser). Survival in three climates, alone or with one or two AI teammates. |
| **Conquest** | A seeded roguelite campaign across a map of Europe. Every territory is a real battle of one of six types: assault, capture, hold, defence, naval blockade or the boss battle for the capital. Your veterans, research, perks and doctrines carry over between battles. |
| **Daily Challenge** | One seeded battle per day for everyone, with modifiers such as *Night Ops* or *Tesla Doctrine*. Includes a score and a streak counter. |
| **Challenges** | Turn any moment of a replay into a "can you win from here?" challenge file and share it. |
| **Replays** | Every skirmish is recorded. Watch it from any player's view at 1–8× speed. You can rewind, take command of any side at any moment and play on: each takeover becomes a branch on the replay's timeline. |

Progression runs across all modes: XP, 15 ranks per faction, 52 medals (some hidden) and lifetime
statistics. The game autosaves, and you can save manually at any time.

## Features

<details open>
<summary><b>Armies and mechanics</b></summary>

- **Factions.** Allies and Soviets with their classic rosters:
  - infantry, from riflemen to Tanya, spies, thieves and attack dogs;
  - tanks, artillery, V2 rockets and minelayers;
  - aircraft: Longbow, Hind, MiG, Yak and Chinook;
  - a full navy: gunboat, destroyer, cruiser, transport, submarine and missile submarine;
  - the expansion units: Tesla Tank, M.A.D. Tank, Chrono Tank, Demolition Truck, Shock Trooper,
    Mechanic and Phase Transport.
- **Economy.**
  - Ore and gem fields regrow, and harvesters queue at refineries.
  - Silos store credits.
  - The power grid matters: on low power, production slows and defences go dark.
- **Classic mechanics.**
  - MCV deployment, adjacency placement, selling and repairing, primary factories and rally
    points.
  - Engineers capture buildings and rebuild bridges. Tanya plants C4, and tanks crush infantry.
  - Transports carry troops, and aircraft rearm on pads.
  - Fog of war and shroud, with "ghosts" of enemy buildings as you last saw them.
- **Espionage and support powers.**
  - Spy infiltration grants intel. Gap generators re-shroud your base, and radar jammers blind the
    enemy.
  - Camouflaged pillboxes and decoy buildings.
  - GPS satellite, sonar pulse, spy plane, paratroopers and parabombs.
  - Iron Curtain, Chronosphere and nuclear missile, each with a cinematic.
- **Command and control.**
  - Formations (line, box, wedge), patrol, escort and guard.
  - Stances: aggressive, guard, hold position and hold fire.
  - Queued waypoints, and build plans that the construction yard places in order.
  - Units spread their focus fire and pull back from enemies they out-range.
  - Camera bookmarks, and veterancy with chevrons.

</details>

<details>
<summary><b>AI</b></summary>

- The AI plays under the same fog of war as you do. It scouts, remembers what it has seen and
  builds to counter your army.
- It raids harvesters, flanks and feints, falls back to regroup and repairs damaged vehicles.
- It expands to new ore fields and times its superweapons with its assaults.
- There are 11 commander personalities, such as Armour Rusher, Tesla Turtle, Naval Raider,
  Saboteur and Tycoon. Each changes the build order, army and timing.
- **Rivals.** Persistent nemesis commanders who remember your record against them and how you play.
  They bring a counter-plan, taunt you over the radio and get promoted when they win.
- The AI and the balance are tuned with mass headless self-play (`tools/selfplay/`).

</details>

<details>
<summary><b>Graphics</b></summary>

- **Rendering.** WebGL 2 through three.js: physically based materials with team colours, shadows
  fitted to the view, ambient occlusion, bloom, colour grading and SMAA.
- **Lights and particles.** Many dynamic lights from muzzle flashes, explosions and fires. A GPU
  particle system for fireballs, smoke, tesla lightning, flame streams and a full mushroom cloud.
- **Water.** Refraction, screen-space reflections, caustics, shore foam, beach waves and a rolling
  ocean swell that ships ride.
- **Day and weather.** A real-time day and night cycle, with floodlit bases and headlights after
  dark. Rain, thunderstorms, snow that settles on everything, fog banks and sandstorms.
- **Destruction.** Buildings crack, burn and collapse into rubble under rigid-body physics.
  Vehicles shed their turrets, and infantry ragdoll. Craters persist, and tread ruts form in snow
  and sand.
- **Cinematics.** Mission intros, the nuke-cam, slow-motion finales, depth of field and motion
  blur, and a photo mode.
- **Performance.**
  - Instanced, level-of-detail forests and merged post-processing passes.
  - Shaders compile on the loading screen, so battles never stutter.
  - A large battle at High quality takes about 130 draw calls.

</details>

<details>
<summary><b>Audio</b></summary>

- Every weapon, explosion and vehicle sound is synthesised in real time with the Web Audio API.
- The procedural soundtrack follows the intensity of the battle.
- A speech-synthesised battlefield announcer, and unit acknowledgements.
- A living soundscape: birdsong, wind, rain, distant battle rumble and environment reverb.

</details>

<details>
<summary><b>Platform</b></summary>

- **Installable.** An offline-capable PWA, with updates applied only between matches.
- **Input.** Full touch controls with a radial order menu, and full gamepad play in battles and in
  the menus.
- **Fullscreen.** Battles start fullscreen, and edge scrolling works on every screen edge.
- **Resilience.**
  - A crash boundary with an error report and recovery to the menu.
  - Recovery from a lost GPU context.
  - A WebGL 2 capability check before the game starts.

</details>

## Controls

| Input | Action |
|---|---|
| Left click / drag | Select / box select (double-click or Ctrl+click: all of a type on screen; Shift adds; Ctrl+drag removes) |
| Right click | Context command: move, attack, harvest, enter, or escort a friendly unit. With a factory selected, sets the rally point |
| Shift + right click | Queue waypoints |
| Ctrl + right click · Alt + right click | Force fire · force move |
| A · S · X · G · D | Attack-move · stop · scatter · fire at ground · deploy / unload / special ability |
| F1–F4 | Stance: aggressive · guard · hold position · hold fire |
| P · C · L | Patrol · guard / escort · cycle formation (with a factory selected, P makes it the primary factory) |
| M | Lay mines with the selected minelayers |
| E · W · Ctrl+A | All combat units · all of the selected type(s) on screen · everything on screen |
| I · Shift+I | Next idle unit · next idle harvester |
| Z · R | Sell · repair |
| Ctrl+1–9 · Shift+1–9 · 1–9 | Assign · add to · recall a control group (double-tap to centre on it) |
| F6–F9 · Ctrl+F6–F9 | Jump to · save a camera bookmark |
| H · Space | Jump to base · jump to last attack |
| Arrows, screen edge, middle/right drag · wheel | Scroll · zoom |
| Q · , · . · Backspace | Rotate camera · reset to north |
| F · U · hold Alt | Follow the selection · photo mode · show all health bars |
| Alt+Enter · Esc | Fullscreen on/off · cancel or pause menu |
| Sidebar | Left click: build (Shift: ×5) or place · right click: hold / cancel · Shift+place: plan several structures |
| Touch | Tap: select or command · drag: pan · hold then drag: box select · hold: order menu · pinch: zoom · twist: rotate |
| Gamepad | Left stick: cursor · right stick: camera · A: select · X: command · B: cancel · Y: deploy · View: order menu · Start: pause |
| Replays | Space: pause · `[` `]`: speed · V: switch view · Home: restart |

## Faithful to Red Alert

There was nothing to decompile. In 2025 EA released the original Red Alert source code under the
GPL v3 ([electronicarts/CnC_Red_Alert](https://github.com/electronicarts/CnC_Red_Alert)). Red
Horizon is a clean-room TypeScript engine that uses that release as its rules reference:

- [`src/data/rules.ts`](src/data/rules.ts): unit, structure, weapon and warhead statistics from the
  original `RULES.INI`. Field names and units match what `WEAPON.CPP`, `WARHEAD.CPP` and
  `TECHNO.CPP` read.
- [`src/sim/combat.ts`](src/sim/combat.ts): damage uses the original `Modify_Damage` formula from
  `COMBAT.CPP` (warhead-against-armour multipliers, distance falloff, minimum and maximum damage).
- Tick rate, rate of fire, speed (MPH to leptons) and range conversions follow `DEFINES.H`.

Global pacing settings (movement and build speed) live at the bottom of `rules.ts`. A few values
deliberately differ from the original. Each change fixes an outlier found in cost-equal simulation
tests:

| Change | Original | Red Horizon |
|---|---|---|
| Flame Tower range | 4 | 5 |
| Field Medic cost | $800 | $500 |
| Attack Dog health | 12 | 25, and slightly faster |
| Turret health | 400 | 500 |
| Mammoth Tank cost | $1700 | $1900 |

## Maps, missions and mods

- **Curated maps.** Nine hand-designed, symmetric maps for 2–4 players, among them *Bridgewater*,
  *Archipelago*, *Inland Sea*, *Frozen Lakes* and *Red Canyon*. Generated maps have shareable map
  codes that reproduce them exactly.
- **Editor.** Open it from the main menu.
  - Paint terrain, height, forests, ore, gems, bridges and start positions, with symmetry helpers
    and undo/redo, in 2D or in the live 3D view.
  - It checks fairness and reachability, and runs a playtest in one click.
  - The mission layer adds pre-placed forces, objectives and triggers.
  - Maps and missions export as `.rhmap.json`. Custom maps appear in the skirmish map picker, and
    custom missions under *Campaign → Special*.
- **Mods.** A mod is a `.rhmod.json` file that overrides unit, weapon and warhead values or clones
  them into new variants.
  - Mods are validated with clear error messages and enabled from the *Mods* screen.
  - Saves and replays record the active mods, so they always play back identically.
  - Two examples are included in [`public/mods/`](public/mods/): *Tank Rush* and *Glass Cannon*.

## Architecture

The game is split into a deterministic simulation and a renderer that only observes it:

- **Simulation** (`src/sim/`): a fixed 20 Hz, seeded, fully deterministic simulation that never
  reads rendering state, wall-clock time or `Math.random()`. Determinism is what makes saves,
  replays, rewinding, challenges and headless testing possible: the same seed and command
  stream always produce the same game, which the replays verify with periodic state hashes.
- **Rendering** (`src/render/`): three.js on WebGL 2. It interpolates between simulation ticks and
  turns entity state into procedural models, effects, lights and sound.
- **No runtime dependencies** besides three.js. Code is split so that three.js, the editor and the
  Conquest UI load as separate chunks.

```
src/
  data/         game rules (from the original RULES.INI)
  sim/          deterministic simulation: world, map generation, pathfinding, combat, economy,
                production, aircraft, naval, espionage, support powers, superweapons, AI, orders
  render/       three.js renderer: terrain, water, weather, fog of war, models, effects, destruction
  audio/        procedural sound effects, adaptive music, announcer
  ui/           HUD, sidebar, minimap, input (mouse, touch, gamepad), menus and screens
  missions/     campaigns, Boot Camp, special operations, Daily Challenge
  maps/         curated maps, map codes, previews, custom maps
  editor/       map and mission editor
  mods/         mod format, validation and rule overrides
  modes/        challenges, King of the Hill, co-op
  replay/       recording, storage (IndexedDB), playback and branching
  meta/         XP, ranks, medals, rivals
  platform/     error boundary, WebGL checks, GPU quality detection, fullscreen, PWA
  game.ts       game loop
  main.ts       bootstrap
public/         web app manifest, service worker, icons, example mods, fonts, HD models (models/)
tests/          node:test suite, PWA verification, memory-leak and CPU profile audits
tools/          headless simulation, mission autopilots, self-play and screenshot tooling
tools/assets/   the HD model factory: Blender kit, model scripts, build runner
docker/         nginx configuration for the container image
```

## Development

```bash
npm test                  # unit, integration, regression and AI-vs-AI soak tests (node:test)
npm run typecheck
npm run verify:pwa        # production build + manifest, service worker and offline checks
npm run audit:leaks       # plays 5 matches in a browser and compares heap and GPU resources
npm run audit:profile     # CPU profile of a 30 s battle, resolved to source lines
```

The test suite covers:
- the Red Alert damage formula, pathfinding and map-generation fairness;
- the economy, production, placement, power and combat;
- special abilities, the AI, and save and replay determinism;
- security hardening of the file importers;
- six 15-minute AI-vs-AI soak games with invariant checks.

Headless tools (no browser needed):

```bash
node --import tsx tools/simtest.ts <seed> <minutes> <mapSize> <players>   # AI-vs-AI match
node --import tsx tools/savetest.ts                                        # save/load determinism
node --import tsx tools/campaigntest.ts <mission-id|allies|soviet|all>     # missions with autopilots
node --import tsx tools/conquesttest.ts all                                # every Conquest battle type
node --import tsx tools/selfplay/run.ts --mode faction --games 40          # mass AI-vs-AI self-play
node --import tsx tools/selfplay/balance.ts                                # cost-equal unit duels
```

### HD models (the asset factory)

The HD models in `public/models/` are built from Python scripts in `tools/assets/models/` with a
headless Blender. You only need this to change or add a model: the generated `.glb` files are
committed, so the game builds without Blender.

```bash
tools/assets/setup-blender.sh            # pinned Blender 4.5 LTS into ~/.cache (sha256-checked)
node tools/assets/fetch-textures.mjs     # pinned CC0 texture inputs and the decal font (hash-checked)
node tools/assets/build.mjs weap.soviet  # build one model (or --all); updates public/models/manifest.json
```

- **How a model is made:** the kit (`tools/assets/kit/`) models hard-surface parts. It then bakes
  ambient occlusion, edge wear, grime, decals and stencilled slogans into a compact texture atlas,
  and exports a quantised GLB with WebP textures.
- **No WebAssembly decoders:** the format needs none, so the Content-Security-Policy stays strict.
- **Docs:** [`tools/assets/README.md`](tools/assets/README.md) is the full guide, and
  [`tools/assets/STYLE.md`](tools/assets/STYLE.md) is the art direction.

The browser tooling (`tools/*.mjs`, `tests/perf/`) uses Playwright with the Chromium it
downloads (`npx playwright install chromium`).

<details>
<summary><b>URL parameters for testing</b></summary>

These parameters jump straight into a situation, which is handy for development and screenshots:

| Parameter | Effect |
|---|---|
| `?autostart=1` | Skip the menus and start a skirmish |
| `size=64`, `climate=winter\|desert`, `fog=0` | Map size, climate, fog of war off |
| `scenario=base\|battle`, `units=mcv\|light\|heavy`, `charge=1` | Prebuilt base or battle, starting units, superweapons charged |
| `tod=night`, `hour=0..24`, `cycle=1`, `wx=rain\|storm\|snow\|fog\|dust` | Time of day, day cycle, weather |
| `cam=x,y,dist`, `ff=<seconds>`, `intro=0\|1` | Camera position, fast-forward, intro cinematic |
| `selfplay=hard` | An AI plays your side |
| `mission=<id>` | A mission, e.g. `bootcamp`, `allied-01`, `soviet-04`, `wolfpack`, `survival`, `daily` |
| `mission=survival&allies=hard,normal` | Co-op survival with AI teammates |
| `map=<id>`, `mapcode=<code>` | A curated map, a shared generated map |
| `replay=<id>\|latest`, `view=<n>\|obs`, `seek=<s>`, `take=<player>` | Watch a replay, take command at a moment |
| `koth=1&kothmin=N`, `challenge=<id>` | King of the Hill, a saved challenge |
| `conquest=assault\|capture\|hold\|defend\|naval\|boss\|ui` | A Conquest battle type or the Conquest map |

The asset preview pages are `/preview-models.html`, `/preview-effects.html`, `/preview-audio.html`
and `/preview-weather.html`.

</details>

## Security and privacy

- **No server, no accounts, no tracking.** The game is a static site that makes no requests to
  third-party hosts: no analytics, no ads, no cookies, no external fonts or scripts.
- **Local data only.** Settings, saves, replays, maps, mods and profile data stay in your browser
  (localStorage and IndexedDB).
- **Untrusted files.** Imported maps, missions, mods, challenges, replays and saves are treated as
  untrusted:
  - they are schema-validated with size limits;
  - they are protected against prototype pollution;
  - they are never interpreted as HTML;
  - no code is ever evaluated from data.
- **Security headers.** The shipped nginx and Vercel configurations send a strict
  Content-Security-Policy: same-origin only, no inline or `eval`'d script, and no framing. They
  also send `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and
  `Cross-Origin-Opener-Policy`.
- **Hardened container.** The Docker image serves the game with nginx as a non-root user, and the
  Compose file runs it with a read-only filesystem, no Linux capabilities and no privilege
  escalation.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Contributing

Issues and pull requests are welcome. Before you open a pull request:

```bash
npm run typecheck && npm test && node --import tsx tools/savetest.ts
```

Guidelines:
- **Keep the simulation deterministic.** Use the world's seeded random number generator, never
  `Math.random()`, `Date` or rendering state in `src/sim/`. The save test must report
  `DETERMINISTIC ✓`.
- **Stay faithful to Red Alert.** Gameplay changes should match the original game, or come with
  simulation evidence when they deliberately deviate.
- **No copyrighted assets.** Everything is generated in code. Please don't add EA art, audio,
  names or trademarks.
- **Add a test** for bug fixes and new mechanics in `tests/`.

## License and legal

Red Horizon is free software under the [GNU General Public License v3.0 or later](LICENSE.md).
It is derived from studying EA's GPL v3 release of the Red Alert source code, so redistributions
must stay under the GPL.

*Command & Conquer* and *Red Alert* are trademarks of Electronic Arts Inc. This project is **not
affiliated with or endorsed by Electronic Arts**. The GPL release grants no rights to EA
trademarks, which is why the game has its own name; you can change it in
[`src/config.ts`](src/config.ts). The game contains no EA art, audio, video or other assets.

The bundled fonts, [Rajdhani](https://fonts.google.com/specimen/Rajdhani) and
[Share Tech Mono](https://fonts.google.com/specimen/Share+Tech+Mono), are licensed under the
[SIL Open Font License 1.1](public/fonts/OFL.txt). Two inputs are used only when building the HD
models and are not distributed:
- the CC0 textures from [Poly Haven](https://polyhaven.com/), baked into the model textures;
- the [Russo One](https://fonts.google.com/specimen/Russo+One) font (OFL), used for the Cyrillic
  slogans.

### Acknowledgements

- Westwood Studios, for the original game.
- Electronic Arts, for releasing its source code under the GPL.
- [three.js](https://threejs.org/), the only runtime dependency.
- [Blender](https://www.blender.org/), which builds the HD models, and [Poly Haven](https://polyhaven.com/), for its CC0 textures.
