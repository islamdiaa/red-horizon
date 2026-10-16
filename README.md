# Red Horizon

A modern, browser-based real-time strategy game that faithfully recreates the gameplay of
the 1996 classic *Command & Conquer: Red Alert* — Allies vs. Soviets, base building, ore
harvesting, power, tech trees, Tesla Coils, Mammoth Tanks, naval warfare, spies, Chronospheres and nukes — rebuilt
from scratch for the web with real-time 3D graphics, post-processing, a GPU particle system,
procedural audio and an adaptive soundtrack.

Everything (models, textures, sound effects, music) is generated procedurally at runtime, so the
game ships **zero copyrighted assets**. The whole game, 17 scripted missions included, is about 650 KB gzipped: the game
itself is about 425 KB, and three.js about 200 KB in a separately cached chunk.

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

### Red Alert complete: navy, espionage, support powers, maps and replays (round 4)

- **Naval warfare.**
  - Shipyard and Sub Pen (built on water).
  - Gunboat, Destroyer (missiles that also hit aircraft, depth charges, sonar) and Cruiser (8-inch guns that out-range everything on shore).
  - Transport (LST): carries five tanks or infantry and lands them on a beach.
  - Submarine: invisible while submerged, surfaces to fire torpedoes, and is found by sonar or a spy's sonar pulse.
  - Ships have their own water pathfinding and fight under RA's targeting rules: torpedoes only hit ships, depth charges hunt submarines.
  - The *Sea* terrain option generates a central sea with a bay at every base. The AI builds and fights a fleet when the map calls for one.
- **The rest of the RA roster.**
  - Spy: disguised as an enemy rifleman. Infiltrating structures gives intel (credits, power, radar picture, production) or a sonar pulse; only dogs see through the disguise.
  - Thief: steals half of the enemy's credits.
  - Minelayer with anti-tank and anti-personnel mines.
  - Gap Generator (tower and mobile) that re-shrouds your base.
  - Mobile Radar Jammer, Chinook transport helicopter, camouflaged pillbox and decoy structures.
- **Support powers.** GPS satellite, sonar pulse, spy plane, paratroopers and parabombs. The planes fly in from the map edge, so anti-aircraft defences can shoot them down.
- **Bridges.** Destructible and repairable bridges over rivers: explosives drop them, engineers rebuild them.
- **Unit stances.** Aggressive, guard, hold position and hold fire (F1–F4).
- **Curated maps and map codes.**
  - Nine hand-designed, symmetric maps: river crossings, archipelagos, an inland sea for four players, a canyon and frozen lakes.
  - A map picker with previews.
  - Shareable map codes that reproduce any generated map.
- **Replays.**
  - Every skirmish is recorded as its command stream plus periodic state hashes.
  - Watch it back with pause, 1–8× speed, seeking, any player's view or an observer view, and live sync checking. Export and import replay files.
- **Boot Camp.** An interactive tutorial in nine drills, from moving a squad to leading an assault, with beacons on the ground and the radar.
- **Naval special operations.**
  - *Wolfpack*: Soviet submarines against an Arctic convoy.
  - *Iron Coast*: escort an Allied cruiser to shell a coastal fortress through submarine packs and MiG raids.
- **New medals and sound.**
  - Medals: Admiral of the Fleet, Silent Service, Spymaster, Grand Larceny, Airborne, Minefield and a hidden one.
  - Sound: 12 new synthesised effects (torpedoes, sonar, bomber flybys, bridge collapses and more), 18 new announcer lines, and naval and spy voices.
- **Faster engine.**
  - A battle at High quality needs 128 draw calls instead of 293, and 367k triangles instead of 826k.
  - Shaders all compile during loading, so nothing stutters mid-battle.
  - In the CPU profile, main-thread time per frame drops from about 49 ms to about 11 ms.
  - Forests are instanced and culled, with simpler versions at a distance.
  - The shadow camera is fitted to the view, and the post-processing chain is merged into fewer passes.
- **New graphics.**
  - Water with refraction, screen-space reflections, caustics, sun and moon glitter, shore foam, waves on the beach and ripples.
  - Terrain relief detail, light shafts at dawn and dusk, low mist in valleys, and colour grading per climate.

### Smarter AI, Conquest, editor, new modes and destruction (round 5)

- **An AI that plays fair and smart.** The AI no longer sees through the fog. It scouts with a fast unit, remembers
  what it has seen, and builds to counter the army it has spotted. It raids harvesters and outlying refineries, flanks
  and feints on Hard and Brutal, falls back to regroup, and sends damaged vehicles for repair. It expands to new ore
  fields and times superweapons with its assaults.
- **11 commander personalities** (Armour Rusher, Tesla Turtle, Naval Raider, Air Marshal, Saboteur, Siege Master,
  Guerrilla, Iron Fist, Human Wave, Tycoon and the Balanced Professor) shape each AI's build order, army and timing.
- **Rivals.** Pick "Rival" as an opponent to face a persistent nemesis commander.
  - Each rival remembers your record against them and how you play, and brings a counter-plan.
  - They taunt you over the radio, are promoted when they win, and can die and come back scarred.
- **Self-play tuning.** Headless AI-vs-AI batches tune the AI and the balance in `tools/selfplay/`: faction balance,
  a difficulty ladder, a personality round-robin, cost-equal duels and an optimizer. The Mammoth Tank now costs
  $1900, up from $1700.
- **Expansion-pack units.**
  - Soviet: Tesla Tank, M.A.D. Tank (seismic pulses wreck vehicles and buildings), Demolition Truck,
    Shock Trooper and Missile Submarine.
  - Allied: Chrono Tank (chronoshifts itself), Mechanic and Phase Transport (cloaks while it isn't firing).
- **Conquest.** A roguelite campaign across a strategic map of Europe, generated from a seed:
  - Attack territories, defend against declared counterattacks, and fight a real battle generated for each one:
    assault, capture, hold, defence, naval blockade, and a boss battle for the enemy capital.
  - Veterans carry over between battles. A war chest, research (18 projects), 25 perks, doctrines and random events
    shape each run.
  - Renown and titles carry over between runs.
- **Map and mission editor.**
  - Paint terrain, height, forests, ore and gems, bridges and start positions, with symmetry helpers, in 2D or in
    the real 3D renderer, with undo/redo.
  - Fairness and reachability checks, and playtesting with one click.
  - A mission layer with pre-placed forces, objectives and triggers.
  - Custom maps appear in the skirmish picker, and custom missions under Campaign → Special.
- **Mods.** JSON overrides of units, weapons and warheads, validated with clear errors, with clones for new variants.
  Saves and replays record the active mods. Two example mods are included: Tank Rush and Glass Cannon.
- **Rewind and take command.** In any replay, pause and take command of any side to play on from that exact moment
  as a branching timeline. Branches show as a tree in the Replays screen.
- **Challenges.** Turn any replay moment into a "Can you win from here?" challenge file.
  - Goals: win, survive, destroy, protect or hold.
  - Scores, stars and personal bests.
  - The game also suggests dramatic moments from your matches as challenges.
- **King of the Hill** as a skirmish mode, and **co-op Survival** with one or two AI teammates.
- **Command and control.**
  - Formations: auto, line, box and wedge.
  - Patrol (P), and escort or guard (C, or right-click a friendly unit).
  - Rally new units to a unit.
  - Build plans: Shift-place several structures and the yard builds them in order.
  - Units spread their focus fire and pull back from enemies they out-range.
  - Camera bookmarks (F6–F9).
- **Touch and gamepad.** Full tablet controls with a radial order menu, and full gamepad play in battle and in the
  menus.
- **Destruction and physics.**
  - Buildings crack, burn and then collapse into pieces under rigid-body physics before settling into rubble.
  - Vehicles shed their turret and debris, aircraft crash, and infantry ragdoll differently for each death type.
  - Craters persist, tread ruts form in snow and sand, and damage stages show while a building is still alive.
  - Models gain more close-up detail, lighter versions at a distance, and livelier infantry and building
    animations.
- **Next-generation effects on WebGL2:**
  - dynamic lights from muzzle flashes, explosions and fires;
  - GPU-simulated particles;
  - volumetric fog and cloud shadows;
  - rolling ocean swell;
  - depth of field and motion blur in cinematics.

## Controls

| Input | Action |
|---|---|
| Left click / drag | Select / box select (double-click or Ctrl+click: all of a type on screen, Shift adds; double-click a structure: all of that structure; Shift+drag adds, Ctrl+drag removes) |
| E · W · Ctrl+A | All combat units on the map · all of the selected type(s) on screen · all own units on screen |
| I · Shift+I | Select and centre the next idle unit · the next idle harvester |
| Right click | Move · attack · harvest · enter (context sensitive) · on a friendly unit: escort it · factory selected: set rally point, or on a unit: new units join it |
| Shift + right click | Queue waypoints |
| Ctrl + right click | Force fire (ground or friendly) · Alt + right click: force move |
| A / S / X / G / D | Attack-move · Stop · Scatter · Fire at ground · Deploy / unload / return |
| F1 / F2 / F3 / F4 | Stance of the selected units: aggressive · guard · hold position · hold fire |
| P | Patrol: click the far end of the route (Shift-click adds waypoints); with a factory selected: primary factory |
| C | Guard: click a unit to escort (follow and defend) or a structure to defend |
| L | Formation of the selected group: auto · line · box · wedge (Shift+L: back; also in the selection panel) |
| D | Chrono Tank: click where to chronoshift · M.A.D. tank: deploy · demolition truck: detonate |
| M | Lay mines with the selected minelayers (or Ctrl + right click the spot) · engineers: right click a destroyed bridge to rebuild it |
| Z / R / P | Sell · Repair · Primary factory |
| Ctrl+1–9 / Shift+1–9 / 1–9 | Assign / add the selection to / recall a control group (double-tap: centre on it) |
| F6–F9 · Ctrl or Shift+F6–F9 | Jump to / save a camera bookmark |
| H / Space | Jump to base · jump to last attack |
| F | Camera follows the selection (scroll to release) |
| Arrows, screen edge, middle- or right-drag | Scroll · mouse wheel: zoom |
| Q / , / . | Rotate camera · Backspace: reset to north |
| U | Photo mode (hide the interface) |
| Alt+Enter | Fullscreen on / off (battles start fullscreen by default; hold Esc to leave) |
| Hold Alt | Show all health bars |
| Esc | Cancel / pause menu |
| Sidebar | Left click: build (Shift ×5) / place · right click: hold / cancel · power bar: click to fire / aim |
| Build plan | Shift+click when placing: place, then plan more of the same · click a structure while the yard is busy (or Shift+click it): plan it. Planned structures show as numbered ghosts; the yard builds and places them in order as soon as each is affordable |
| Touch (tablets) | Tap: select / command · double tap: all of a type · drag: pan · hold then drag: box select · hold: order menu · two fingers: pan, pinch zoom, twist rotate · toolbar: Box, Add, Attack, Force, Guard, Patrol, Stop, All · hold a sidebar card: hold / cancel |
| Gamepad | Left stick: cursor · right stick: camera · LT/RT: zoom · A: select (hold: box) · X: command · B: cancel · Y: deploy · View: order menu · LB/RB: idle unit / next group (held: Shift / Ctrl) · D-pad: sidebar (A build, X cancel, LB/RB tabs) · L3: all on screen · R3: base · Start: pause; menus: D-pad / stick, A, B |
| Replays | Space: pause / play · [ / ]: slower / faster (1×–8×) · V: next player view / observer · Home: restart |

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
    naval.ts ai-naval.ts infiltration.ts mines.ts stealth.ts powers.ts bridges.ts stance.ts   (round-4 content)
    orders.ts formation.ts   formations, patrol, escort/guard, rally to a unit, build plans, focus fire, kiting
  render/              three.js renderer (interpolates between sim ticks)
    renderer.ts        scene, lights, post-processing chain
    terrain.ts water.ts vegetation.ts ore.ts fog.ts lightpools.ts
    entities.ts        sim entity -> 3D model sync, death/wreck/smoke visuals
    models/            procedural unit & structure models
    effects/           GPU particle & effects system
  audio/               procedural SFX, adaptive music, announcer
  ui/                  HUD, minimap, input (+ touch.ts, gamepad.ts, orderui.ts), menus, campaign, profile, challenges
  missions/            campaign missions, Boot Camp, naval & special operations, daily challenge, progress
  maps/                curated skirmish maps (symmetric feature format), previews, map codes
  replay/              match recording, storage (IndexedDB) and playback
  meta/                XP, ranks, medals, daily challenge records, toasts
  platform/            error boundary, WebGL checks, GPU quality detection, PWA
  game.ts main.ts      game loop and bootstrap
public/                web app manifest, service worker, icons
tests/                 node:test suite, PWA verification, leak & profile audits
tools/                 headless simulation / mission tests & screenshot tooling
```

## Development tools

```bash
npm test                 # 504 unit / integration / soak / regression tests (node:test)
npm run typecheck
npm run verify:pwa       # production build + manifest, service worker and offline checks
npm run audit:leaks      # play 5 matches in a browser and compare heap / GPU resources
npm run audit:profile    # CPU profile of a 30 s battle, resolved to source lines
node --import tsx tools/simtest.ts <seed> <minutes> <mapSize> <players>   # headless AI-vs-AI
node --import tsx tools/campaigntest.ts <mission-id|allies|soviet|all> [minutes]   # headless mission runs with autopilots
node tools/focus-shot.mjs <url> <out.png> "<js returning [x, y, dist]>"           # browser screenshot aimed at something in the game
node --import tsx tools/savetest.ts                                          # save/load determinism
node --import tsx tools/conquesttest.ts all [seed] [faction]                 # every Conquest battle type with autopilots
node --import tsx tools/selfplay/run.ts --mode faction --games 40           # mass AI-vs-AI self-play (modes: faction, legacy, personalities, gauntlet, diff)
node --import tsx tools/selfplay/balance.ts                                  # cost-equal unit duels (regenerates the AI matchup table with --emit)
node --import tsx tools/metatest.ts                                          # progression & medals
```

The test suite covers the RA damage formula, pathfinding, map generation fairness, economy,
production, placement, power, combat, special abilities, the AI, save determinism, platform
helpers, and six 15-minute AI-vs-AI soak games with invariant checks.

Testing URL parameters: `?autostart=1&scenario=battle&charge=1&fog=0&tod=night&size=64`
(`scenario=base|battle`, `ff=<seconds>` fast-forward, `cam=x,y,dist`, `units=mcv|light|heavy`,
`hour=0..24`, `cycle=1`, `wx=rain|storm|snow|fog|dust`, `climate=winter|desert`, `intro=1`,
`selfplay=hard` lets an AI play your side, `mission=<id>` starts a mission, e.g. `bootcamp`, `allied-01`, `wolfpack`, `survival`, `daily`,
`map=<id>` a curated map, `mapcode=<code>` a shared generated map, `replay=<id>|latest[&view=<n>|obs]` a replay
(`&seek=<s>&take=<player>` takes command there), `koth=1&kothmin=N` King of the Hill, `challenge=<id>` a challenge,
`mission=survival&allies=hard,normal` co-op survival, `conquest=assault|capture|hold|defend|naval|boss` a Conquest battle,
`conquest=ui` the Conquest map).
Asset preview pages: `/preview-models.html`, `/preview-effects.html`, `/preview-audio.html`,
`/preview-weather.html`.
