/**
 * The variety systems: the skirmish "Rules" tab, the mutator picker and the Quick Battle card (src/ui/variety.ts),
 * and the in-match strip and battlefield event radio cards (src/ui/variety-hud.ts). Mutator names and descriptions
 * come from the game data (dt() table mutator).
 *
 * EVENT_NEWS: the battlefield news the simulation writes in English (src/sim/events.ts, src/sim/neutral.ts: titles
 * and texts of VarietyState.news). The sim must not depend on the language, so these are copied here exactly
 * ({name} = the variable parts) and translated where they are shown (trSource). Keep them in sync with the sim.
 */
import { sourceStrings, strings } from '../core';

export default strings('variety', {
  tab: {
    battlefield: 'Battlefield',
    rules: 'Rules',
  },
  // the Rules tab's summary: "Commander · 2 mutators · dynamic"
  summary: {
    mutators: '{n, plural, one {# mutator} other {# mutators}}',
    dynamic: 'dynamic',
  },
  rules: {
    field: 'Rules',
    tip: 'Commander: doctrines, commander powers, battlefield events and neutral tech structures. Classic: pure Red Alert rules.',
    doctrine: 'Doctrine',
    commanderOnly: 'Commander rules only',
    doctrinesArrive: 'Doctrines arrive with Commander rules',
    events: 'Battlefield events',
    eventsTip: 'Every few minutes something happens: supply convoys, airdrops, downed pilots, storms, mercenaries, ore surges. Commander rules only.',
    dynamic: 'Dynamic difficulty',
    dynamicTip: 'The AI economy and aggression flex within a band to keep the match close (shown in the HUD). Against Recruit and Easy it only eases off when you are struggling and never pushes harder; from Normal up it works both ways. On by default when every opponent is Recruit or Easy.',
  },
  mutators: {
    title: 'Mutators',
    active: '{n} active',
    // no mutator chosen
    off: 'off',
    none: 'None: pick from {n} battle conditions, or let fate decide.',
    // a chosen mutator's tooltip: its description, then the hint
    chipTip: '{desc} (click to remove)',
    choose: 'Choose',
    surprise: 'Surprise me',
    surpriseTip: 'Two or three compatible mutators at random',
    clear: 'Clear',
    done: 'Done',
    kicker: 'Battle conditions',
    // tag on a card: a modifier of the daily challenge
    daily: 'Daily',
    count: '{n} active · conflicting ones replace each other',
    hint: 'Pick any. Two weathers, two ore values or two production speeds replace each other.',
    onlyWinter: 'Winter battlefields only',
    onlyDesert: 'Desert battlefields only',
    onlyTemperate: 'Temperate battlefields only',
    onlySoviet: 'Soviet commanders only',
    onlyAllied: 'Allied commanders only',
    unavailable: 'Not available here',
  },
  quick: {
    kicker: 'Quick Battle',
    title: 'Rolled for you',
    battlefield: 'Battlefield',
    opponent: 'Opponent',
    rules: 'Rules',
    mutators: 'Mutators',
    rulesValue: 'Commander · battlefield events',
    rival: 'Rival',
    aiCommander: 'AI commander',
    climate: { temperate: 'Temperate', winter: 'Winter', desert: 'Desert' },
    time: { day: 'Day', dusk: 'Dusk', night: 'Night' },
  },
  hud: {
    commanderTip: 'Commander rules: doctrines, commander powers, battlefield events and neutral tech structures (capture them with an Engineer).',
    commanderTipNoEvents: 'Commander rules: doctrines, commander powers and neutral tech structures (capture them with an Engineer).',
    // a mutator pill's tooltip
    mutatorTip: '{name}: {desc}',
    // dynamic difficulty pill: {state} is "AI +12%" or "even"
    dynamic: 'Dynamic · {state}',
    // {pct} carries its sign: "+12", "-6"
    dynamicAi: 'AI {pct}%',
    dynamicEven: 'even',
    dynamicTipUp: "Dynamic difficulty is on: the AI's income, build speed and aggression flex (up to ±24%) to keep the match close. You are ahead: the AI is pushing harder.",
    dynamicTipDown: "Dynamic difficulty is on: the AI's income, build speed and aggression flex (up to ±24%) to keep the match close. The AI is easing off.",
    dynamicTipEven: "Dynamic difficulty is on: the AI's income, build speed and aggression flex (up to ±24%) to keep the match close. The match is even.",
    // live battlefield events in the strip
    event: {
      convoy: 'Convoy',
      airdrop: 'Airdrop',
      pilot: 'Pilot down',
      storm: 'Storm',
      mercs: 'Mercenaries',
      surge: 'Ore surge',
    },
    // an event that has been announced but hasn't started
    inbound: '{label} · inbound',
    // another commander's reward, as a message: news title and text
    message: '{title}: {text}',
    kicker: {
      site: 'Tech structure',
      dyn: 'Dynamic difficulty',
      reward: 'Reward',
      event: 'Battlefield event',
    },
    dismiss: 'Dismiss',
    hire: 'Hire · {price}',
    noCredits: 'Not enough credits',
    hired: 'Squad inbound',
  },
});

/** Battlefield news as the simulation writes it (titles and texts; see the header). */
export const EVENT_NEWS = sourceStrings('variety.news', {
  convoy: {
    warnTitle: 'Supply convoy inbound',
    warn: 'A neutral supply convoy will cross the battlefield in 20 seconds. Escort it (right-click a truck) and get paid for every truck delivered, or force-fire it (Ctrl + right-click) to seize its cargo.',
    startTitle: 'Convoy on the move',
    start: 'The supply convoy has entered the battlefield.',
    unescortedTitle: 'Truck delivered',
    unescorted: 'A supply truck made it across unescorted: nobody is paid.',
    endTitle: 'Convoy gone',
    endOne: 'The convoy is over: {delivered} truck delivered, {destroyed} destroyed.',
    endMany: 'The convoy is over: {delivered} trucks delivered, {destroyed} destroyed.',
  },
  airdrop: {
    warnTitle: 'Supply airdrop',
    warn: 'Cargo planes will drop crates on the marked zone in 20 seconds. First come, first served.',
    startTitle: 'Crates on the ground',
    start: 'The airdrop has landed: grab the crates.',
  },
  pilot: {
    warnTitle: 'Pilot down',
    warn: "A pilot ejected over no man's land. The first infantry (or engineer) to reach him wins a reward, and he joins up.",
    lostTitle: 'Pilot lost',
    shot: '{name} shot the downed pilot.',
    lost: 'The downed pilot did not make it.',
    evacuatedTitle: 'Pilot evacuated',
    evacuated: 'Nobody reached the downed pilot: he was picked up by his own side.',
  },
  storm: {
    title: 'Storm front',
    warn: 'A storm front reaches the battlefield in 20 seconds: every aircraft will be grounded for a minute.',
    start: 'The storm has arrived: all aircraft are grounded.',
    endTitle: 'Skies clearing',
    end: 'The storm has passed: aircraft may fly again.',
  },
  mercs: {
    offerTitle: 'Mercenaries for hire',
    // {offer} is one of the squads below, {price} the credits ("$1,500")
    offer: 'A mercenary company offers {offer} for ${price}. The offer stands for 60 seconds.',
    withdrawnTitle: 'Offer withdrawn',
    withdrawn: 'The mercenaries have moved on.',
    hiredTitle: 'Mercenaries hired',
    hired: '{name} hired the mercenaries ({offer}).',
    // the squads on offer (inserted into the sentences above)
    squad: {
      medium: 'two Medium Tanks and three riflemen',
      rangers: 'three Rangers and two rocket soldiers',
      heavy: 'two Heavy Tanks',
      v2: 'a V2 battery and four grenadiers',
      mammoth: 'a Mammoth Tank',
    },
  },
  surge: {
    title: 'Ore surge',
    warn: 'Seismic readings: the marked ore field is about to surge. It will be the richest ground on the map.',
    start: 'The ore field has surged: fresh ore and gems for whoever holds it.',
  },
  // (the forms with command points first: the shorter ones would match them too)
  reward: {
    title: 'Reward',
    pilotPoints: '{name} rescued the downed pilot: +${credits} and {points} command points.',
    escortPoints: '{name} escorted a supply truck through: +${credits} and {points} command point.',
    seizePoints: "{name} seized a convoy truck's cargo: +${credits} and {points} command point.",
    pilot: '{name} rescued the downed pilot: +${credits}.',
    escort: '{name} escorted a supply truck through: +${credits}.',
    seize: "{name} seized a convoy truck's cargo: +${credits}.",
  },
  dyn: {
    title: 'Dynamic difficulty',
    // {pct} carries its sign: "+12", "-6"
    up: 'You are pulling ahead: the enemy pushes harder (economy {pct}%).',
    down: 'The enemy eases off (economy {pct}%).',
  },
  // neutral tech structures (src/sim/neutral.ts)
  site: {
    introTitle: 'Neutral tech structures',
    intro: 'Oil derricks, field hospitals, radar outposts and communications arrays stand on the map. Send an Engineer to one to capture it (any engineer can take it back).',
    capturedTitle: 'Tech structure captured',
    seizedTitle: 'Tech structure seized',
    // {structure} is the structure's name; {from} the commander who held it
    seized: '{name} took the {structure} from {from}.',
    captured: '{name} took the {structure}.',
  },
});

/** Text the Quick Battle roll writes into the setup (src/modes/quickbattle.ts rollQuickBattle, QuickInfo.map). */
export const QUICK_SOURCE = sourceStrings('variety.quickSource', {
  // a generated map and its size in cells
  generated: 'Generated {w}×{h}',
});
