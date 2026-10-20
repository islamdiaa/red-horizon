# Playing Red Horizon

## Game modes

| Mode | |
|---|---|
| **Skirmish** | Up to 3 AI opponents on five difficulties (*Recruit*, for your first battles, then Easy, Normal, Hard and Brutal), on generated or hand-made maps (temperate, winter or desert; land or sea). Options: King of the Hill, and a build-up ceasefire of 5–30 minutes or unlimited, during which the AI builds up and only defends. |
| **Quick Battle** | One click from the main menu into a tuned random match at your level (see [Quick Battle](#quick-battle)). |
| **Campaigns** | 7 Allied and 7 Soviet missions with briefings, primary and optional objectives, radio transmissions and up to three stars each. |
| **Boot Camp** | An interactive tutorial in nine drills. |
| **Special operations** | *Wolfpack*, *Iron Coast*, and Survival in three climates, alone or with AI teammates. |
| **Conquest** | A seeded roguelite campaign across Europe. Every territory is a real battle; veterans, research, perks and doctrines carry over between battles. |
| **Daily Challenge** | One seeded battle per day, with modifiers, a score and a streak. |
| **Challenges** | Turn any moment of a replay into a "can you win from here?" challenge file. |
| **Replays** | Every skirmish is recorded. Watch at 1–8× speed from any player's view, or take command of any side at any moment and play on as a new branch. |

## Skirmish rules: Commander or Classic

**Classic** is pure Red Alert. **Commander**, the default, adds:

- **Economy and tech evolution.** See [ECONOMY.md](ECONOMY.md) for the full guide.
  - The Construction Yard grows from tier 1 to 3.
  - Visible building upgrades: refinery processor, turbines, assembly line, armour shop,
    training ground, reinforced defences, satellite uplink.
  - Research at the Research Lab.
  - New structures: Mining Outpost, Ore Purifier or Smelter, Logistics Centre, garrisonable
    Bunker, Fortress Gate.
- **Doctrines.** Pick one before the match, for example *Armoured Fist*, *Human Wave*,
  *Blitzkrieg* or *Fortress Europe*. Each has two bonuses and one drawback, and more unlock as
  your rank rises.
- **Command points and powers.** Points come from combat and objectives, with a comeback bonus
  when you're behind. Spend them in a three-tier tree:
  - Recon Sweep, Field Repair, Emergency Funds;
  - Rally Cry, Elite Training, Artillery Barrage;
  - Reinforcements, Sabotage, and a faction ultimate: Tesla Storm or Aegis Shield.

  The AI uses them too.
- **Battlefield events** every few minutes: supply convoys to escort or ambush, airdrops, downed
  pilots, mercenaries and ore surges.
- **Neutral tech structures.** Oil derricks, field hospitals, radar outposts and communication
  arrays, captured with engineers.
- **Mutators.** 24 of them, such as *Golden Ore*, *Tank Rush*, *Lightning War* and *Night Ops*,
  or let *Surprise me* pick.
- **Dynamic difficulty** keeps matches close. It is on by default when every AI is Recruit or Easy:
  there it only eases off when you are struggling and never pushes harder. From Normal up it works
  both ways. Once you flip the switch, your choice is kept.

## Quick Battle

- **Your level.** You start on Recruit. You move up one level once you have at least 3 wins at your
  current level and win at least 60% of your games there. If you have already done that on a higher
  level in regular skirmishes (say Hard), you go straight to the level above it.
- **Recruit and Easy** roll exactly one mutator, always a newcomer-safe one: a weather or night
  mutator, *Supply Drops*, *Veteran Corps*, *Heavy Metal* or *Big Guns*. Dynamic difficulty is on.
  From Normal up, Quick Battle rolls one or two mutators from its wider pool.
- **Rivals** never play above your level in Quick Battle, and at most one level above it in
  skirmish, so a Recruit-level commander meets at most an Easy rival.

## Progression

- **Ranks and medals.** XP, 15 ranks per faction, 52 medals (some hidden) and lifetime
  statistics.
- **Contracts.** 3 daily and 3 weekly goals that pay XP and Commendations. You get one free
  reroll a day, and missing a day costs nothing.
- **The Locker.** Cosmetics earned by playing: paint schemes, portraits, titles, banners, HUD
  themes, announcer voices and victory fanfares. Nothing is for sale, and nothing affects
  gameplay.
- **Results screen.** After every match it shows XP and contract progress, battle charts (army
  value, income, kills), your MVP unit, the highlights, the next unlock, and *Play again*
  (Enter) or *Rematch*. After a skirmish defeat or a close win, an *Economy* block compares your
  harvest and peak army with the strongest enemy's, with one suggestion (for example, build a
  second Ore Refinery, or put up defences before the first attack).
- **Field manual hints** (*Settings › Gameplay*) coach you during a skirmish. They tell you when an
  enemy earns far more than you, when you still have one Ore Refinery at 6:00, when your factories
  stand idle with money in the bank, when your power has been low for a while, and when the first
  enemy attack is coming and you have no defences. Each shows at most once a match, and never more
  than one a minute.

## Armies and mechanics

- **Factions.** The classic Allied and Soviet rosters:
  - infantry, from riflemen to Tanya, spies, thieves and attack dogs;
  - tanks, artillery and V2s;
  - aircraft;
  - a full navy;
  - the expansion units: Tesla Tank, M.A.D. Tank, Chrono Tank, Demolition Truck, Shock Trooper,
    Mechanic and Phase Transport.
- **Economy and power.**
  - Ore and gem fields regrow, and harvesters queue at refineries.
  - Silos store credits.
  - On low power, production slows and defences go dark.
- **Classic mechanics.**
  - MCV deployment and adjacency placement; selling and repairing.
  - Engineers capture buildings and rebuild bridges, and Tanya plants C4.
  - Tanks crush infantry, transports carry troops, and aircraft rearm on pads.
  - Fog of war shows "ghosts" of enemy buildings as you last saw them.
- **Espionage and superweapons.**
  - Spies, gap generators, radar jammers, camouflaged pillboxes and decoys.
  - Support powers: GPS, sonar pulse, spy plane, paratroopers and parabombs.
  - The Iron Curtain, the Chronosphere and the nuclear missile.
- **Command tools.**
  - Formations, patrol, escort and guard; stances; queued waypoints.
  - Build plans, which the construction yard places in order.
  - Looping production, auto-groups, an army overview and one-key repair runs.
- **AI.**
  - It plays under the same fog of war as you, scouts and counters your army.
  - It raids, flanks and expands.
  - 11 commander personalities, and persistent rivals that remember how you play.

## Controls

| Input | Action |
|---|---|
| Left click / drag | Select or box-select. Double-click or Ctrl+click: all of a type on screen. Shift adds; Ctrl+drag removes |
| Right click | Context command: move, attack, harvest, enter, escort. On a factory: set the rally point |
| Shift + right click | Queue waypoints |
| Ctrl / Alt + right click | Force fire / force move |
| A · S · X · G · D | Attack-move · stop · scatter · fire at ground · deploy / unload / ability |
| F1–F4 | Stance: aggressive · guard · hold position · hold fire |
| P · C · L | Patrol (on a factory: make it primary) · guard / escort · cycle formation |
| M | Lay mines |
| E · W · Ctrl+A | All combat units · selected types on screen · everything on screen |
| Shift+E · Shift+R | Select damaged units · send them for repair |
| I · Shift+I | Next idle unit · next idle harvester |
| Z · R | Sell · repair |
| Ctrl / Shift / plain 1–9 | Assign · add to · recall a control group (double-tap to centre on it) |
| Ctrl+Alt+1–9 | New units from the selected factory join that group |
| `` ` `` | Army overview |
| T, then 1–9 | Commander powers |
| Alt+click a build card | Loop production (right click stops it) |
| `[` · `]` | Game speed: ×1, ×2, ×3, ×5 |
| F6–F9 · Ctrl+F6–F9 | Jump to · save a camera bookmark |
| H · Space | Jump to base · jump to last attack |
| Arrows, screen edge, middle drag · wheel | Scroll · zoom |
| Q · , · . · Backspace | Rotate the camera · reset to north |
| F · U · hold Alt | Follow the selection · photo mode · show all health bars |
| Alt+Enter · Esc | Fullscreen · cancel or pause |
| Touch | Tap: select or command · drag: pan · hold: order menu · pinch: zoom · twist: rotate |
| Gamepad | Left stick: cursor · right stick: camera · A: select · X: command · B: cancel · Y: deploy · Start: pause |

All controls are also listed in-game under **Controls**, which always shows your active keys.

**Rebinding.** Every battle hotkey can be rebound in *Settings › Accessibility › Key bindings*, or under
*Controls › Customise keys*:
- two keys per action, with conflict warnings and a reset to defaults;
- the control-group modifiers (assign: Ctrl, add: Shift) can be changed too;
- fixed keys: Esc, 1–9, Tab and B (build bar), and Alt+Enter.

## Accessibility

- **Team colours:** *Default*, *Colour-blind friendly* (Okabe-Ito colours, safe for the common types of
  colour blindness), or *You vs enemies* (you blue, every enemy orange). This applies to the battlefield,
  minimap and HUD.
- **Health bars:** tick marks at 50% and 25%, so the colour isn't the only cue.
- **Interface size:** 80–150%.
- **Subtitles:** on by default, for announcer lines, with four sizes. Mission and rival radio is also
  read out to screen readers.
- **Menus:** keyboard focus rings and a logical tab order in every menu and dialog. Tab stays inside the screen
  or dialog that is open.
- **Any screen:** the menus fit phones and tablets in portrait or landscape, from 390 px wide to ultrawide.
  On a phone, menu controls are at least 44 px tall.
- **Performance overlay:** the FPS and renderer stats chip is off by default (*Settings › Graphics*).
- **Reduce motion:** calmer animations, and no camera shake or slow motion.
- **Copy diagnostics** (in Settings and on the crash screen): a plain-text report to paste into a bug
  report. It contains no personal data and is never sent anywhere.
- **Language:** English, Russian, German, Spanish, Brazilian Portuguese, French or Simplified Chinese, in
  *Settings › Gameplay › Language*. *Auto* follows the browser. Change it from the main menu (it is locked
  during a battle). Campaign mission briefings, objectives and radio, and the map editor, are still in
  English.

## Maps, editor and mods

- **Maps.**
  - Nine hand-designed symmetric maps for 2–4 players.
  - Generated maps have shareable map codes.
- **Editor.** Open it from the main menu.
  - Paint terrain, height, forests, ore, bridges and start positions in 2D or live 3D, with
    symmetry helpers and undo.
  - Fairness and reachability checks, and one-click playtests.
  - A mission layer for forces, objectives and triggers.
  - Exports `.rhmap.json`.
- **Mods.** A `.rhmod.json` file overrides or clones unit, weapon and warhead values.
  - Mods are validated on import.
  - Saves and replays record them.
  - Examples are in [`public/mods/`](../public/mods/).

## Sharing

- **Share links.** **Copy link** in the editor, the scenario challenge list and the Replays list.
  - The map, challenge or short replay travels inside the link, after the `#`. Browsers never send that
    part to a server, and nothing is uploaded.
  - Whoever opens the link sees what it holds and chooses to import or play it.
  - Content too big for a link (long replays, large challenge snapshots) downloads as a file instead.
- **Highlight clips.** **Clip** next to a highlight on the results screen, or the camera button in the
  replay player.
  - The moment replays through a cinematic camera and is recorded with its sound: about 18 seconds of WebM
    video (MP4 in Safari).
  - Download it, or share it from a phone.
- **Trailer.** Open the game with `?trailer=1` for an ~85-second cut of a staged battle, which can be
  recorded too.

## Faithful to Red Alert

In 2025 EA released the original source code under the GPL
([electronicarts/CnC_Red_Alert](https://github.com/electronicarts/CnC_Red_Alert)). Red Horizon is
a clean-room engine that uses it as its rules reference:
- unit, weapon and warhead values come from `RULES.INI` ([`src/data/rules.ts`](../src/data/rules.ts));
- damage uses the original `Modify_Damage` formula ([`src/sim/combat.ts`](../src/sim/combat.ts));
- timing, speed and range conversions follow `DEFINES.H`.

A few values deliberately differ from the original. Each fixes an outlier found in cost-equal
simulation tests:

| Change | Original | Red Horizon |
|---|---|---|
| Flame Tower range | 4 | 5 |
| Field Medic cost | $800 | $500 |
| Attack Dog health | 12 | 25, slightly faster |
| Turret health | 400 | 500 |
| Mammoth Tank cost | $1700 | $1900 |
