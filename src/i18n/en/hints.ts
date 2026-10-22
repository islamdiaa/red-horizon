/**
 * Field manual hints for new players (src/ui/hints.ts): the tutorial steps and situational alerts.
 * {key:<action>} and {mod:assign} are filled in with the player's key bindings.
 */
import { strings } from '../core';

export default strings('hints', {
  // heading of a tutorial step (followed by its number, "3/7")
  manual: 'Field manual',
  // heading of a situational warning
  report: 'Field report',
  steps: {
    deploy: 'Select your [b]MCV[/b] and press [kbd]{key:deploy}[/kbd] (or click it again) to deploy a Construction Yard.',
    power: 'Build a [b]Power Plant[/b] from the sidebar, then click the map to place it next to your base.',
    // the same step with the Modern HUD (the default), which has a build bar at the bottom instead of a sidebar
    powerBar: 'Build a [b]Power Plant[/b] from the build bar, then click the map to place it next to your base.',
    refinery: 'An [b]Ore Refinery[/b] comes with an Ore Truck — your source of income.',
    barracks: 'Train infantry at the [b]Barracks[/b]. Right-click the ground to move, right-click enemies to attack.',
    factory: 'A [b]War Factory[/b] unlocks tanks. Right-click the map with a factory selected to set a rally point.',
    radar: 'A [b]Radar Dome[/b] powers the minimap. Keep an eye on your power bar — low power slows everything.',
    keys: 'Tip: [kbd]{mod:assign}[/kbd]+[kbd]1-9[/kbd] assigns control groups, [kbd]{key:attackMove}[/kbd] attack-moves, [kbd]{key:lastAttack}[/kbd] jumps to the last attack.',
  },
  // the same steps for touch screens (tap, press and hold, the build bar)
  touch: {
    deploy: 'Tap your [b]MCV[/b], then press and hold on it and pick [b]Deploy[/b] to set up a Construction Yard.',
    power: 'Build a [b]Power Plant[/b] from the build bar, then tap the map to place it next to your base.',
    barracks: 'Train infantry at the [b]Barracks[/b]. With units selected, tap the ground to move and tap enemies to attack.',
    factory: 'A [b]War Factory[/b] unlocks tanks. Select it, then press and hold on the map and pick [b]Rally here[/b] to set a rally point.',
    keys: 'Tip: press and hold on the map for more orders (stop, scatter, stance, formation). Drag with two fingers to pan, pinch to zoom.',
    idle: 'Your factories are idle while you have money in the bank: keep units queued (tap a unit card several times).',
    attackMove: 'Units on a plain move order walk past the enemy without fighting. Press and hold on the map and pick [b]Attack-move[/b]: they fight everything on the way.',
    together: 'Your attacks are beaten one small group at a time. Gather a bigger army at home, infantry and tanks together, then attack with everyone at once.',
    repair: 'A structure is badly damaged. Tap the [b]Repair[/b] wrench, then tap the structure to fix it.',
  },
  alerts: {
    storage: '[b]Ore storage is full.[/b] Refined ore beyond your capacity is lost — build an [b]Ore Silo[/b] or spend your credits.',
    defences: 'Enemy attack waves usually arrive within a few minutes. Cover your refinery with a [b]Pillbox[/b], [b]Turret[/b] or [b]Flame Tower[/b].',
    tier2: 'Your Construction Yard can climb to [b]Tier 2[/b]: select it and pick the upgrade. It opens the Research Lab, the Tech Centre, the Ore Purifier and more.',
    research: 'Your [b]Research Lab[/b] is idle: select it and open the [b]research tree[/b]. Research upgrades your whole army.',
    // coaching (skirmish): an enemy's ore income is far above the player's
    income: '[b]The enemy is earning far more than you.[/b] Build another [b]Ore Refinery[/b] and more [b]Ore Trucks[/b].',
    // coaching: still one refinery around the 6-minute mark
    refinery: 'Most commanders have [b]two Ore Refineries[/b] by now: each one with two Ore Trucks roughly doubles your income.',
    // coaching: factories idle with money in the bank; {shift} and {alt} are key names
    idle: 'Your factories are idle while you have money in the bank: keep units queued ([kbd]{shift}[/kbd]-click a unit to queue five, [kbd]{alt}[/kbd]-click to keep building it).',
    // coaching: low power for a while
    power: '[b]Low power[/b] slows production and shuts down defences. Build a [b]Power Plant[/b].',
    // coaching: the first enemy wave is coming and the player has no defensive structure (Allied / Soviet wording)
    attackAllies: '[b]An enemy attack is on its way[/b] and you have no defences: build a [b]Pillbox[/b] or [b]Turret[/b] near your base.',
    attackSoviet: '[b]An enemy attack is on its way[/b] and you have no defences: build a [b]Flame Tower[/b] or [b]Tesla Coil[/b] near your base.',
    // coaching: the player's last Ore Truck is gone (with and without a War Factory to build a new one)
    noTrucks: '[b]You have no Ore Trucks left[/b]: no trucks, no income. Build a new one at the [b]War Factory[/b].',
    noTrucksFactory: '[b]You have no Ore Trucks left[/b]: no trucks, no income. Build a [b]War Factory[/b] (Ore Trucks are built there) or another [b]Ore Refinery[/b] (it comes with one).',
    // coaching: the player's infantry keeps dying next to an enemy defence; {name} is the defence (Flame Tower, Pillbox...)
    infantryDefence: 'Your infantry keeps dying to enemy defences ([b]{name}[/b]). Attack defences with [b]tanks[/b] and keep the soldiers behind them.',
    infantryDefenceFactory: 'Your infantry keeps dying to enemy defences ([b]{name}[/b]). Build a [b]War Factory[/b] and attack defences with [b]tanks[/b].',
    // coaching: units died on a plain move order (they don't shoot back on the way)
    attackMove: 'Units on a plain move order walk past the enemy without fighting. Press [kbd]{key:attackMove}[/kbd] and click the ground: an [b]attack-move[/b] fights everything on the way.',
    // coaching: many units lost away from home for few kills
    together: 'Your attacks are beaten one small group at a time. Gather a bigger army at home, select it all ([kbd]{key:selectCombat}[/kbd] picks every combat unit, [kbd]{mod:assign}[/kbd]+[kbd]1[/kbd] makes it group 1), then attack-move with everyone at once.',
    // coaching: a structure under half health for a while
    repair: 'A structure is badly damaged. Press [kbd]{key:repair}[/kbd] (or the [b]Repair[/b] wrench) and click the structure to fix it.',
  },
});
