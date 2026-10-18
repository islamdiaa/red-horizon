/**
 * Conquest battles (src/conquest/battle.ts): battle kinds, battlefields, objectives, radio, timers and end reasons.
 * The battle runs inside the simulation (lockstep, saved), so it emits this English; the HUD translates it where it
 * shows it (trSource) and the Conquest screens through src/ui/conquest.ts. {territory} and {commander} are names;
 * {building} is a structure name, {time} a clock (2:15), {names} a list of veteran call signs.
 */
import { sourceStrings, strings } from '../core';

export const BATTLE = sourceStrings('conquest.battle', {
  // battle types: name and one-line goal
  kind: {
    assault: { name: 'Assault', desc: 'Destroy every enemy structure.' },
    capture: { name: 'Capture', desc: 'Capture the enemy command post with an engineer.' },
    hold: { name: 'Seize & Hold', desc: 'Take the objective zone and hold it.' },
    defend: { name: 'Defence', desc: 'Hold out until the relief column arrives.' },
    naval: { name: 'Naval Blockade', desc: 'Destroy the enemy naval yard and sink the fleet.' },
    boss: { name: 'Capital Assault', desc: 'Destroy the enemy capital\'s command centres.' },
  },
  // the battlefield type (also shown in lower case inside the war diary)
  map: {
    capital: 'Capital outskirts',
    archipelago: 'Archipelago',
    frozenCoast: 'Frozen coast',
    coastalWaters: 'Coastal waters',
    farmland: 'Open farmland',
    forest: 'Dense forest',
    canyon: 'Red Canyon',
    pass: 'Mountain pass',
    frozenLakes: 'Frozen Lakes',
    lakes: 'Lake country',
    bridgewater: 'Bridgewater crossing',
    river: 'River valley',
    coastline: 'Coastline',
    industrial: 'Industrial district',
    steppe: 'Open steppe',
    islands: 'Island chain',
    default: 'Battlefield',
  },
  // radio speakers
  speaker: {
    allied: 'Allied Command',
    soviet: 'Soviet High Command',
    intel: 'Intelligence',
  },
  // the human player's name in conquest battles
  player: 'Commander',
  // the commander of a neutral territory's militia
  neutralForce: '{territory} Defence Force',
  title: 'Battle of {territory}',
  objective: {
    destroy: 'Destroy every enemy structure in {territory}',
    capture: 'Capture the {building} (damage it, then send in an Engineer)',
    holdout: 'Hold {territory} until the relief column arrives',
    hq: 'Keep your Construction Yard standing',
    counter: 'Destroy the enemy staging base',
    yards: 'Destroy the enemy naval yard',
    fleet: 'Sink the enemy fleet',
    command: 'Destroy the command centres of {territory}',
    sw: 'Destroy the {building} before it fires',
    veterans: 'Bring every core veteran home',
    swift: 'Win within {time}',
  },
  // the structure to capture when the base has no lab or radar
  commandPost: 'command post',
  // "Seize & Hold" battles: the zone depends on the terrain (objective, opening radio line, zone taken)
  zone: {
    bridgehead: {
      objective: 'Seize the bridgehead and hold it for {time}',
      intro: 'Seize the bridgehead at {territory} and hold it for {time}. Keep enemy troops out of the zone.',
      held: 'We hold the bridgehead. Keep it clear for {time}.',
    },
    railJunction: {
      objective: 'Seize the rail junction and hold it for {time}',
      intro: 'Seize the rail junction at {territory} and hold it for {time}. Keep enemy troops out of the zone.',
      held: 'We hold the rail junction. Keep it clear for {time}.',
    },
    harbour: {
      objective: 'Seize the harbour and hold it for {time}',
      intro: 'Seize the harbour at {territory} and hold it for {time}. Keep enemy troops out of the zone.',
      held: 'We hold the harbour. Keep it clear for {time}.',
    },
    pass: {
      objective: 'Seize the pass and hold it for {time}',
      intro: 'Seize the pass at {territory} and hold it for {time}. Keep enemy troops out of the zone.',
      held: 'We hold the pass. Keep it clear for {time}.',
    },
    crossroads: {
      objective: 'Seize the crossroads and hold it for {time}',
      intro: 'Seize the crossroads at {territory} and hold it for {time}. Keep enemy troops out of the zone.',
      held: 'We hold the crossroads. Keep it clear for {time}.',
    },
    causeway: {
      objective: 'Seize the causeway and hold it for {time}',
      intro: 'Seize the causeway at {territory} and hold it for {time}. Keep enemy troops out of the zone.',
      held: 'We hold the causeway. Keep it clear for {time}.',
    },
    supplyDepot: {
      objective: 'Seize the supply depot and hold it for {time}',
      intro: 'Seize the supply depot at {territory} and hold it for {time}. Keep enemy troops out of the zone.',
      held: 'We hold the supply depot. Keep it clear for {time}.',
    },
    beachhead: {
      objective: 'Seize the beachhead and hold it for {time}',
      intro: 'Seize the beachhead at {territory} and hold it for {time}. Keep enemy troops out of the zone.',
      held: 'We hold the beachhead. Keep it clear for {time}.',
    },
  },
  // objective progress (next to the objective). shipsLeft must stay before left.
  progress: {
    shipsLeft: '{n} ships left',
    left: '{n} left',
    done: 'done',
  },
  // countdown label of the defence battles
  timer: 'Relief column',
  // why the battle was lost
  lose: {
    hq: 'The Construction Yard was destroyed',
    target: 'The {building} was destroyed',
  },
  radio: {
    // opening line by battle type ("local" = a neutral militia)
    assaultLocal: '{territory}: the local garrison has dug in. Establish a base and wipe it out.',
    assaultAllied: '{territory}: the Allied garrison has dug in. Establish a base and wipe it out.',
    assaultSoviet: '{territory}: the Soviet garrison has dug in. Establish a base and wipe it out.',
    capture: 'Their command post in {territory} holds the codes for the whole front. Take it intact: damage it, then send in an Engineer.',
    defend: '{commander} is throwing everything at {territory}! Hold the line until the relief column arrives.',
    naval: 'The enemy fleet blockades the coast at {territory}. Sink it and destroy their naval yard.',
    boss: 'This is it, Commander: {territory}. Destroy their command centres and the war is won.',
    // up to four call signs, then how many more (coreMore must stay before core)
    coreMore: 'Your core army is deployed: {names} and {n} more.',
    core: 'Your core army is deployed: {names}.',
    // {personality} and {desc}: the enemy commander's style (Conquest data)
    enemy: 'Enemy commander: {commander}, "{personality}". {desc}',
    partisans: 'Partisans are in position on the enemy flank. They will fight with you.',
    superweapon: 'Confirmed: a {building} in the enemy base. Destroy it before it is charged.',
    eliteDrop: 'Elite paratroopers inbound to your position.',
    drop: 'Paratroopers inbound to your position.',
    vetLost: 'We have lost a core veteran.',
    swDestroyed: 'The superweapon is destroyed. The threat is over.',
    captured: 'Command post captured. The front is ours.',
    damaged: 'The command post is badly damaged. Send in an Engineer now, before it collapses!',
    contested: 'The zone is contested!',
    relief: 'The relief column has reached {territory}. Outstanding work, Commander.',
    waves: 'Wave after wave, Commander. How long can you last?',
  },
  // the enemy commander's first taunt, by personality
  taunt: {
    steamroller: 'My tanks will roll over your little army like it is not even there.',
    siege: 'Dig in all you like. My guns have your range.',
    air: 'Look up, Commander. That is where the end will come from.',
    fortress: 'You will break your teeth on my walls.',
    blitz: 'Too slow, Commander. Far too slow.',
    naval: 'Every shore is my front line.',
    horde: 'For every soldier you kill, ten more will come.',
    raider: 'You will never see us coming.',
  },
});

/**
 * Battle English too generic to be matched everywhere text is shown ("Destroy the {building}" would swallow other
 * missions' objectives): registered for translators, translated only by the Conquest screens (src/ui/conquest.ts).
 */
export const BATTLE_LOCAL = {
  // optional objective of the capital battle: {building} is the superweapon
  superweapon: 'Destroy the {building}',
  // the third army of a capital battle
  guard: '{territory} Guard',
};
strings('conquest.battle.local', BATTLE_LOCAL);
