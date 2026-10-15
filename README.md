# Red Horizon

A modern, browser-based real-time strategy game that faithfully recreates the gameplay of
the 1996 classic *Command & Conquer: Red Alert* — Allies vs. Soviets, base building, ore
harvesting, power, tech trees, Tesla Coils, Mammoth Tanks, Chronospheres and nukes — rebuilt
from scratch for the web with real-time 3D graphics, post-processing, a GPU particle system,
procedural audio and an adaptive soundtrack.

Everything (models, textures, sound effects, music) is generated procedurally at runtime, so the
game ships **zero copyrighted assets** — the whole thing (14 scripted missions included) is ~550 KB gzipped.

| | |
|---|---|
| ![Main menu](docs/menu.jpg) | ![Thunderstorm battle at dusk](docs/battle.jpg) |
| ![Allied base, golden hour](docs/base.jpg) | ![Winter night](docs/winter.jpg) |
| ![Snowfall](docs/snow.jpg) | ![Desert climate](docs/desert.jpg) |
| ![Soviet armour close-up](docs/closeup.jpg) | ![Nuclear strike](docs/nuke.jpg) |

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/ (static files, host anywhere)
npm run preview    # serve the production build
```

Requires a WebGL2-capable browser (any current Chrome, Edge, Firefox or Safari). A discrete or
modern integrated GPU is recommended for the *High* graphics setting.

## Where the gameplay comes from

There was nothing to decompile: in 2025 EA released the original Red Alert source code under
GPL v3 ([electronicarts/CnC_Red_Alert](https://github.com/electronicarts/CnC_Red_Alert)). This
project is a clean-room TypeScript engine that uses that release as a reference:

- `src/data/rules.ts` — unit/structure/weapon/warhead stats from the original `RULES.INI`
  (field names and units match what `WEAPON.CPP`, `WARHEAD.CPP` and `TECHNO.CPP` read).
- `src/sim/combat.ts` — damage uses the original `Modify_Damage` formula from `COMBAT.CPP`
  (warhead-vs-armour multipliers, distance falloff, min/max damage).
- Tick rate, ROF, speed (MPH → leptons) and range conversions follow `DEFINES.H`.

Global pacing knobs (movement speed, build speed) live at the bottom of `rules.ts`.

### Legal note

The GPL release grants **no rights to EA trademarks** ("Command & Conquer", "Red Alert", …) and
forbids distributing modifications under those names, so this remake is called *Red Horizon*
(change it in `src/config.ts`). It contains no EA art, audio or video. If you redistribute it,
keep it under GPL v3 (it is derived from studying GPL code) and don't present it as an EA product.

## Features

- **Factions**: Allies and Soviets with their classic rosters — infantry (rifle, grenadier,
  rocket, flamethrower, engineer, medic, Tanya, attack dogs), vehicles (light/medium/heavy/
  Mammoth tanks, Ranger, APC, artillery, V2, ore truck, MCV), aircraft (Longbow, Hind, MiG, Yak)
  and ~25 structures including Tesla Coils, SAM sites and three superweapons.
- **Economy**: ore & gem fields that regrow, harvesters docking at refineries, silo storage,
  power grid (low power slows production and shuts down Tesla Coils / radar / superweapons).
- **Classic mechanics**: MCV deployment, adjacency building placement, sell/repair, primary
  factories, rally points, engineers capturing damaged buildings, Tanya's C4, crushing infantry,
  APC transport, service depot repairs, aircraft rearming on pads, fog of war & shroud, radar.
- **AI** with four difficulty levels: build orders, base layout, harvester management, staged
  attack waves, base defence, air strikes, superweapon use. Up to 3 AI opponents.
- **Visuals**: procedural terrain with splat shading, cloud shadows and bump detail; animated
  water with shore foam and sun glints; wind-swept forests and grass; glinting ore and glowing
  gem crystals; PBR models with team colours and emissive lights; GPU particles (fireballs,
  smoke plumes, debris, tesla lightning, flame streams, missile trails, a full mushroom-cloud
  nuke); shadows, bloom, colour grading, SMAA; day / dusk / night lighting with floodlit bases.
- **Audio**: synthesized weapons/explosions, adaptive procedural music that intensifies with
  combat, a speech-synthesized battlefield announcer and unit acknowledgements.
- **UI**: sidebar with build queues and live 3D-rendered portraits, radar minimap,
  context-sensitive cursors, control groups, multi-select panel, tooltips with stats.

### Atmosphere & "magic" (round 2)

- **Cinematic intro** per match: letterboxed operation briefing while the camera sweeps down from a
  satellite recon view onto your base (any key skips).
- **Real-time day/night cycle** (a day passes in ~18 minutes): the sun travels east to west, dawn,
  golden hour and moonlit nights; base floodlights and headlights switch on after dark.
- **Dynamic weather**: rain, thunderstorms with branching lightning and distance-delayed thunder,
  snowfall that settles on terrain, roofs, trees and rocks, drifting fog banks and desert
  sandstorms. Wet ground darkens and turns glossy. *Auto* weather follows the climate.
- **Climates**: temperate, winter (snowfields, snow-laden pines, cracked frozen lakes) and desert.
- **A world beyond the map**: forested foothills and snow-capped mountains with distance haze.
- **Rendering**: ambient occlusion (GTAO), tilt-shift miniature lens, holographic construction,
  tread marks, burning/smouldering wrecks, rubble, bird flocks by day and fireflies at night.
- **Living soundscape**: birdsong, crickets, wind, rain, water, forest ambience, off-screen battle
  rumble, environment reverb, and musical stingers for key moments.
- **Gameplay**: unit veterancy (Veteran / Elite with chevrons), focus-fire targeting, walls
  (sandbags, barbed wire, concrete — drag to build), superweapon target reticles, order/waypoint lines.
- **UI overhaul**: animated build cards with tilt and progress rings, toast notifications with an
  event log, control-group bar, rich selection panel, redesigned menus, loading tips and end screen.

### Campaigns, progression & production polish (round 3)

- **Two campaigns, 14 scripted missions.** The Allied campaign: *Grey Dawn*, *Last Train from Kassel*,
  *Kestrel's Nest*, *Through the Looking Glass*, *Dry Season*, *Midnight Launch*, *Dawnbreak*.
  The Soviet campaign: *First Snow*, *Bridgehead*, *Thunderhead*, *Iron Road*, *Stolen Fire*,
  *The Iron Curtain*, *Red Horizon*. Missions have briefings, primary and optional objectives,
  radio transmissions with character portraits, countdowns, reinforcements, scripted set pieces and
  tech restrictions. Each earns up to three stars: one for winning, one for beating par time, one for
  completing every optional objective. A debrief screen follows each mission.
- **Special operations.** Survival in three climates (*Last Stand*, *Frozen Front*, *Burning Sands*):
  escalating waves, armour columns, air raids, boss waves, supply drops and a score multiplier.
- **Daily Challenge.** One seeded battle per UTC day with 2–3 of 16 modifiers (Night Ops, Mother Lode,
  Glass Cannons, Tesla Doctrine, Radar Blackout…), a daily score, personal bests and a streak counter.
- **Commander profile.** XP for everything you do, 15 ranks per faction with insignia (Private to
  Field Marshal / Marshal of the Soviet Union), 40 medals including hidden ones, and lifetime stats.
- **Save & load.** The whole simulation is serialised and restores deterministically. Autosave runs
  every 2 minutes and when the tab closes, manual save is in the pause menu, and *Continue* is on the
  main menu.
- **Superweapon drama.** Your nuke launch is a cinematic that follows the missile. An incoming
  enemy nuke triggers a red alert with an impact countdown and a marked blast zone you can evacuate.
  Matches end on a slow-motion, letterboxed finale.
- **Production hardening.**
  - Installable PWA that plays offline (service worker, manifest, icons).
  - Updates are applied only between matches.
  - Crash boundary with an error report and a "return to menu" recovery.
  - WebGL 2 support check and recovery from a lost GPU context.
  - Graphics quality is picked automatically from the GPU on first launch.
  - Shaders compile on the loading screen instead of stalling the first battle.
  - Memory-leak fixes, so playing many matches in a row stays flat.
- **Fog of war "ghosts".** Enemy structures under fog show as you last saw them: new ones stay hidden and
  destroyed ones linger until you scout again. The radar works the same way.
- **Clearer feedback.**
  - "Cannot build here" now says why (terrain, blocked, too far from base, blocked exit, no yard).
  - The top bar shows the current mission objective.
  - Planted C4 shows a countdown.
  - New field-report hints for full ore storage and missing base defences.
  - A *Skip intro* setting.
- **Gameplay fixes from the test suite and a QA pass:**
  - **AI:** every AI opponent runs its periodic tasks (before, only the first one did), and AIs launch helicopter strikes.
  - **Units and pathing:**
    - Service depots actually repair.
    - Tanks crush infantry.
    - Helicopters fully rearm before taking off, and stay home on *Return to base*.
    - Units no longer give up on valid detours, and long detours work on 128×128 maps.
    - Harvesters queue at a busy refinery instead of jamming it.
  - **Tanya and engineers:**
    - Tanya's C4 detonates even if she dies.
    - Engineers repair damaged friendly buildings instead of being wasted.
  - **Superweapons:** no charge is wasted on empty or off-map targets.
  - **Building and economy:**
    - Walls can't creep a base across the map.
    - Dragging a wall line moves your units out of the way.
    - The "+$" income pop-up shows only what was really credited.
    - Losing a tech building only cancels what depended on it.
    - Prerequisites unlock when construction finishes.
    - Selling refunds a flat 50%, as in RA, so repairing first never pays.
  - **Combat:** the first-created side no longer wins exact ties.
  - **Maps:** 3-player maps are fair and 2-player maps exactly symmetric.
  - **Pacing:** AI attacks start later on every difficulty, and the first skirmish wave is capped, so new commanders get time to build.
- **Balance touches** for the worst outliers in cost-equal tests:
  - Flame Tower range 4 → 5.
  - Field Medic $800 → $500.
  - Attack Dog health 12 → 25, and faster.
  - Turret health 400 → 500.

## Controls

| Input | Action |
|---|---|
| Left click / drag | Select / box select (double-click or Ctrl+click: all of a type on screen) |
| Right click | Move · attack · harvest · enter (context sensitive) · set rally point (factory selected) |
| Shift + right click | Queue waypoints |
| Ctrl + right click | Force fire (ground or friendly) · Alt + right click: force move |
| A / S / X / G / D | Attack-move · Stop · Scatter · Fire at ground · Deploy / unload / return |
| Z / R / P | Sell · Repair · Primary factory |
| Ctrl+1–9 / 1–9 | Assign / recall control group (double-tap to jump) |
| H / Space | Jump to base · jump to last attack |
| Arrows, screen edge, middle- or right-drag | Scroll · mouse wheel: zoom |
| Q / , / . | Rotate camera · Backspace: reset to north |
| U | Photo mode (hide the interface) |
| Hold Alt | Show all health bars |
| Esc | Cancel / pause menu |
| Sidebar | Left click: build (Shift ×5) / place · right click: hold / cancel |

## Project layout

```
src/
  data/rules.ts        game data (from the original RULES.INI)
  sim/                 deterministic fixed-tick simulation (20 Hz)
    world.ts           entity management, commands, visibility, victory
    map.ts mapgen.ts   grid map and symmetric procedural map generator
    pathfinding.ts     A* with string-pulling
    unitlogic.ts       orders, movement, collisions, crushing, engineers…
    combat.ts          weapons, projectiles, RA damage model
    harvest.ts production.ts aircraft.ts superweapons.ts ai.ts
  render/              three.js renderer (interpolates between sim ticks)
    renderer.ts        scene, lights, post-processing chain
    terrain.ts water.ts vegetation.ts ore.ts fog.ts lightpools.ts
    entities.ts        sim entity -> 3D model sync, death/wreck/smoke visuals
    models/            procedural unit & structure models
    effects/           GPU particle & effects system
  audio/               procedural SFX, adaptive music, announcer
  ui/                  HUD, minimap, input, menus, campaign, profile, challenges
  missions/            campaign missions, special operations, daily challenge, progress
  meta/                XP, ranks, medals, daily challenge records, toasts
  platform/            error boundary, WebGL checks, GPU quality detection, PWA
  game.ts main.ts      game loop and bootstrap
public/                web app manifest, service worker, icons
tests/                 node:test suite, PWA verification, leak & profile audits
tools/                 headless simulation / mission tests & screenshot tooling
```

## Development tools

```bash
npm test                 # 210 unit / integration / soak / regression tests (node:test, ~15 s)
npm run typecheck
npm run verify:pwa       # production build + manifest, service worker and offline checks
npm run audit:leaks      # play 5 matches in a browser and compare heap / GPU resources
npm run audit:profile    # CPU profile of a 30 s battle, resolved to source lines
node --import tsx tools/simtest.ts <seed> <minutes> <mapSize> <players>   # headless AI-vs-AI
node --import tsx tools/missiontest.ts <mission-id> <minutes>              # headless mission run with an autopilot
node --import tsx tools/savetest.ts                                          # save/load determinism
node --import tsx tools/metatest.ts                                          # progression & medals
```

The test suite covers the RA damage formula, pathfinding, map generation fairness, economy,
production, placement, power, combat, special abilities, the AI, save determinism, platform
helpers, and six 15-minute AI-vs-AI soak games with invariant checks.

Testing URL parameters: `?autostart=1&scenario=battle&charge=1&fog=0&tod=night&size=64`
(`scenario=base|battle`, `ff=<seconds>` fast-forward, `cam=x,y,dist`, `units=mcv|light|heavy`,
`hour=0..24`, `cycle=1`, `wx=rain|storm|snow|fog|dust`, `climate=winter|desert`, `intro=1`,
`selfplay=hard` lets an AI play your side, `mission=<id>` starts a mission, e.g. `allied-01`, `survival`, `daily`).
Asset preview pages: `/preview-models.html`, `/preview-effects.html`, `/preview-audio.html`,
`/preview-weather.html`.
