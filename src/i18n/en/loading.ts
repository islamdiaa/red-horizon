/**
 * The loading screen (src/ui/loading.ts, the static text in index.html, and the stage labels main.ts shows).
 * Tips may name a rebindable key: {key:<action>} and {mod:assign} are filled in with the player's bindings.
 */
import { strings } from '../core';

const tips = {
  ore: 'Ore regrows over time — gem fields are worth twice as much as ore.',
  power: 'Low power slows production and shuts down radar, Tesla Coils and superweapons.',
  groups: 'Press [kbd]{mod:assign}[/kbd] + [kbd]1–9[/kbd] to assign a control group; double-tap the number to jump to it.',
  waypoints: 'Hold [kbd]Shift[/kbd] while right-clicking to queue waypoints.',
  attackMove: '[kbd]{key:attackMove}[/kbd] attack-move makes units engage anything they meet on the way.',
  engineers: 'Engineers can capture enemy structures once they are badly damaged.',
  veterancy: 'Units earn veterancy from kills: veterans hit harder, elites also repair themselves.',
  queue: '[kbd]Shift[/kbd]-click a unit in the sidebar to queue five at once. Right-click to hold or cancel.',
  silos: 'Ore Silos store surplus income — a lone refinery fills up quickly.',
  depot: 'A Service Depot repairs damaged vehicles parked on its pad.',
  artillery: 'Artillery and V2 rockets outrange base defences but are fragile up close.',
  crush: 'Tanks crush infantry — keep your riflemen out of the treads.',
  jump: 'Press [kbd]{key:lastAttack}[/kbd] to jump to the last attack and [kbd]{key:home}[/kbd] to return home.',
  healthBars: 'Hold [kbd]Alt[/kbd] to show the health bar of every unit on screen.',
  aircraft: 'Aircraft return to a pad to rearm once their ammunition is spent.',
  radar: 'A Radar Dome brings the minimap online and unlocks advanced technology.',
  sell: 'Selling a structure refunds half its cost — useful when the base is lost.',
};

export default strings('loading', {
  // the heading over the rotating tip
  tipHead: 'Field tip',
  /** Stage labels under the progress bar (shown in capitals). */
  stage: {
    loading: 'Loading',
    initialising: 'Initialising',
    engine: 'Loading the battle engine',
    hdModels: 'Loading HD models',
  },
  tips,
});

/** The tips, in display order (keys only: the text is looked up when shown). */
export const TIP_KEYS = Object.keys(tips) as (keyof typeof tips)[];
