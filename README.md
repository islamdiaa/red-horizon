# Red Horizon

A modern, browser-based real-time strategy game that faithfully recreates the gameplay of
the 1996 classic *Command & Conquer: Red Alert* — Allies vs. Soviets, base building, ore
harvesting, power, tech trees, Tesla Coils, Mammoth Tanks, Chronospheres and nukes — rebuilt
from scratch for the web with real-time 3D graphics, post-processing, a GPU particle system,
procedural audio and an adaptive soundtrack.

Everything (models, textures, sound effects, music) is generated procedurally at runtime, so the
game ships **zero copyrighted assets** — the whole thing is ~340 KB gzipped.

| | |
|---|---|
| ![Allied base](docs/base.png) | ![Battle at dusk](docs/battle.png) |
| ![Night](docs/night.png) | ![Main menu](docs/menu.png) |
| ![Soviet armour close-up](docs/closeup.png) | ![Nuclear strike](docs/nuke.png) |

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
  ui/                  HUD, minimap, input, menus
  game.ts main.ts      game loop and bootstrap
tools/                 headless simulation tests & screenshot tooling
```

## Development tools

```bash
node --import tsx tools/simtest.ts <seed> <minutes> <mapSize> <players>   # headless AI-vs-AI
DIFF=brutal,easy node --import tsx tools/simtest.ts 777 30 96 2
```

Testing URL parameters: `?autostart=1&scenario=battle&charge=1&fog=0&tod=night&size=64`
(`scenario=base|battle`, `ff=<seconds>` fast-forward, `cam=x,y,dist`, `units=mcv|light|heavy`).
Asset preview pages: `/preview-models.html`, `/preview-effects.html`, `/preview-audio.html`.
