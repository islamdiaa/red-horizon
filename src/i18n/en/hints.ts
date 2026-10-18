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
    refinery: 'An [b]Ore Refinery[/b] comes with an Ore Truck — your source of income.',
    barracks: 'Train infantry at the [b]Barracks[/b]. Right-click the ground to move, right-click enemies to attack.',
    factory: 'A [b]War Factory[/b] unlocks tanks. Right-click the map with a factory selected to set a rally point.',
    radar: 'A [b]Radar Dome[/b] powers the minimap. Keep an eye on your power bar — low power slows everything.',
    keys: 'Tip: [kbd]{mod:assign}[/kbd]+[kbd]1-9[/kbd] assigns control groups, [kbd]{key:attackMove}[/kbd] attack-moves, [kbd]{key:lastAttack}[/kbd] jumps to the last attack.',
  },
  alerts: {
    storage: '[b]Ore storage is full.[/b] Refined ore beyond your capacity is lost — build an [b]Ore Silo[/b] or spend your credits.',
    defences: 'Enemy attack waves usually arrive within a few minutes. Cover your refinery with a [b]Pillbox[/b], [b]Turret[/b] or [b]Flame Tower[/b].',
    tier2: 'Your Construction Yard can climb to [b]Tier 2[/b]: select it and pick the upgrade. It opens the Research Lab, the Tech Centre, the Ore Purifier and more.',
    research: 'Your [b]Research Lab[/b] is idle: select it and open the [b]research tree[/b]. Research upgrades your whole army.',
  },
});
