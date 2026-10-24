/**
 * World Conquest's strategic layer (src/conquest/world): the war diary and the rivals' playback (event.*, one
 * template per WorldEvent kind), reinforcement and score lines, endings, ceasefire answers, why an action is not
 * allowed, wonder effects, medals, the rival regimes (fictional 1950s regimes, never real states) and their
 * personalities, and the difficulty levels. The run stores keys and parameters, never English; the screens fill
 * these templates. Names (territories, zones, powers, commanders) arrive as parameters and stand on their own:
 * after a colon, in parentheses, or around an arrow.
 * {power}, {other}, {by}: power names · {from}, {territory}: territory names · {zone}: a zone · {n}: a count.
 * Each event template's parameters are the event's own fields ({territory} = `to`, {other} = `with`).
 */
import { strings } from '../core';

export default strings('world', {
  event: {
    turn: 'Turn {turn}: {power}',
    reinforce: '{power}: +{n} troops ({territory})',
    trade: '{power}: cards traded for {n} troops',
    attack: '{power} attacks: {from} → {territory} (losses {attLoss} / {defLoss})',
    conquer: '{power} conquers: {from} → {territory} ({n, plural, one {# troop moves in} other {# troops move in}})',
    fortify: '{power} fortifies: {from} → {territory} ({n, plural, one {# troop} other {# troops}})',
    card: '{power}: a new card ({card})',
    eliminated: 'Eliminated: {power} (by {by}, {cards, plural, one {# card} other {# cards}} taken)',
    zone: '{power} holds a whole zone: {zone}',
    ceasefire: 'Ceasefire: {power} and {other}, {turns, plural, one {# turn} other {# turns}}',
    refused: 'Ceasefire refused: {power}',
    break: 'Ceasefire broken: {power} betrayed {other}',
    offer: 'Ceasefire offered: {power} ({turns, plural, one {# turn} other {# turns}})',
    defence: 'Under attack: {from} → {territory} ({n, plural, one {# troop} other {# troops}}). Fight it yourself, or let the dice decide?',
    battle: '{won, select, yes {Battle won} other {Battle lost}}: {from} → {territory} (losses {attLoss} / {defLoss})',
    medal: 'Medal earned: {medal}',
    won: 'Victory: {ending}',
    lost: 'Defeat: {ending}',
  },
  // reinforcements at the start of a turn
  reinforce: {
    territories: 'Territories held (one for every three, at least 3)',
    zone: 'Whole zone: {zone}',
    capitals: 'Capitals held',
    wonders: 'Wonders',
    cards: 'Cards traded',
    brutal: 'Brutal rival bonus',
  },
  card: {
    infantry: 'Infantry',
    armour: 'Armour',
    air: 'Air',
  },
  score: {
    territories: 'Territories held',
    zones: 'Zones held',
    conquests: 'Conquests',
    battles: 'Battles fought',
    capitals: 'Capitals taken',
    wonders: 'Wonders held',
    eliminated: 'Rivals eliminated',
    victory: 'Victory',
    speed: 'Speed bonus',
  },
  ending: {
    world: 'every rival power has fallen. The world is yours.',
    capitals: 'every rival capital is in your hands.',
    armistice: 'the exhausted powers sue for peace.',
    wiped: 'your last territory has fallen.',
    capital: 'your capital has fallen (Ironman).',
    abandoned: 'the campaign was abandoned.',
  },
  share: {
    ruledWorld: 'Ruled the world from {home} in {turns, plural, one {# turn} other {# turns}}',
    ruledRegion: 'Conquered the region from {home} in {turns, plural, one {# turn} other {# turns}}',
    fellAt: 'Fought from {home} for {turns, plural, one {# turn} other {# turns}}',
  },
  // a ceasefire proposal's answer (or why it cannot be proposed)
  ceasefire: {
    accepted: 'Accepted.',
    refused: 'Refused.',
    already: 'A ceasefire is already in force.',
    distrust: 'Nobody trusts you after your betrayal.',
    cooldown: 'They will not hear another proposal so soon.',
    unknown: 'Not possible.',
  },
  // why an attack or a fortify move is not allowed
  block: {
    over: 'The campaign is over.',
    turn: 'It is not your turn.',
    busy: 'Finish the battle first.',
    phase: 'Not in this phase.',
    place: 'Place your troops first.',
    unknown: 'Unknown territory.',
    notYours: 'Not your territory.',
    own: 'You already hold it.',
    troops: 'Needs at least two troops.',
    notAdjacent: 'Not adjacent.',
    port: 'This sea lane needs a port at one end.',
    ceasefire: 'A ceasefire is in force with its owner.',
    used: 'No fortify moves left this turn.',
    notConnected: 'Not connected through your territories.',
    firstTurn: 'In the first turn, every power expands into neutral land: no attacks on other powers yet.',
  },
  wonder: {
    troops: '+{n, plural, one {# troop} other {# troops}} each turn',
    income: '+{n}% war chest from your battles',
    card: 'A free card every {n} turns',
    defence: 'Defenders in its zone: +{n} on the best die',
    attack: 'Attacks from its zone: +{n} on the best die',
    fortify: '+{n, plural, one {# fortify move} other {# fortify moves}} each turn',
    navy: '{n, plural, one {# sea lane} other {# sea lanes}} a turn without a port',
    intel: 'See the rivals’ planned attacks',
    diplomacy: 'Rivals {n}% more willing to sign ceasefires',
  },
  medal: {
    continent: 'Master of a continent: {name}',
    wonder: 'Wonder held: {name}',
    homeland: 'Victory from {name}',
    victory: 'Victory: {size} on {difficulty}',
    ironman: 'Ironman victory: {size}',
    diceOnly: 'Won by the dice alone',
    weekly: 'Weekly World: {name}',
  },
  size: {
    world: 'World',
    blitz: 'Blitz',
  },
  regime: {
    player: 'Your Command',
    neutral: 'Neutral',
    ironDirectorate: 'The Iron Directorate',
    crimsonUnion: 'The Crimson Union',
    northernCompact: 'The Northern Compact',
    coastalFederation: 'The Coastal Federation',
    steelRepublic: 'The Steel Republic',
    dawnCoalition: 'The Dawn Coalition',
    southernJunta: 'The Southern Junta',
    azureConcord: 'The Azure Concord',
    granitePact: 'The Granite Pact',
    emberCommonwealth: 'The Ember Commonwealth',
    frontierLeague: 'The Frontier League',
    thunderHegemony: 'The Thunder Hegemony',
  },
  personality: {
    holder: { name: 'Continent-holder', desc: 'Takes whole zones and walls their borders.' },
    aggressor: { name: 'Aggressor', desc: 'One great army, thrown at whoever is near.' },
    turtle: { name: 'Turtle', desc: 'Guards every border; strikes only at long odds.' },
    opportunist: { name: 'Opportunist', desc: 'Hits the weak, hunts the dying for their cards.' },
    naval: { name: 'Naval power', desc: 'Rules the coasts and the sea lanes.' },
  },
  difficulty: {
    recruit: { name: 'Recruit', desc: 'Rivals play carelessly and rarely turn on you.' },
    easy: { name: 'Easy', desc: 'Rivals make mistakes and seldom gang up on you.' },
    normal: { name: 'Normal', desc: 'Rivals play the board well, with no advantages.' },
    hard: { name: 'Hard', desc: 'Sharp rivals who turn on a runaway leader. Fog of war available.' },
    brutal: { name: 'Brutal', desc: 'Sharp rivals with an extra troop each turn. Fog of war available.' },
  },
});
