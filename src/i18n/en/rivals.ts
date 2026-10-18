/**
 * Rivals (persistent enemy commanders): the board, the skirmish-setup chip and the in-match rival radio
 * (src/ui/rivals.ts), and the English the rival logic stores (src/meta/rivals.ts). Rival personal names (first and
 * last names) are proper names and stay as they are; ranks, nicknames, titles, traits and radio lines translate.
 */
import { liveStrings, sourceStrings, strings } from '../core';

/**
 * English that src/meta/rivals.ts stores in rh.rivals and in the skirmish setup (replays, saves) or matches on:
 * it stays English there and is translated where it is shown (meta/rivals.ts rivalText / trSource).
 */
export const RIVAL_SRC = sourceStrings('rivals.src', {
  /** Rival ranks (low to high). */
  rank: {
    lieutenant: 'Lieutenant',
    captain: 'Captain',
    major: 'Major',
    colonel: 'Colonel',
    general: 'General',
    marshal: 'Marshal',
    fieldMarshal: 'Field Marshal',
  },
  /** Nicknames, by AI personality ("Dmitri 'the Anvil' Volkov"). */
  nick: {
    balanced: { professor: 'the Professor', chessmaster: 'the Chessmaster', owl: 'Old Owl' },
    rusher: { hammer: 'the Hammer', blitz: 'Blitz', gauntlet: 'Iron Gauntlet' },
    turtle: { wall: 'the Wall', tortoise: 'the Tortoise', rod: 'Lightning Rod' },
    admiral: { seaWolf: 'Sea Wolf', admiral: 'the Admiral', riptide: 'Riptide' },
    airmarshal: { skyfall: 'Skyfall', hawk: 'the Hawk', thunderbird: 'Thunderbird' },
    saboteur: { ghost: 'the Ghost', whisper: 'Whisper', locksmith: 'the Locksmith' },
    siege: { longArm: 'the Long Arm', bertha: 'Big Bertha', mason: 'the Mason' },
    guerrilla: { fox: 'the Fox', shadow: 'Shadow', wasp: 'the Wasp' },
    ironfist: { anvil: 'the Anvil', steelRain: 'Steel Rain', bulldozer: 'the Bulldozer' },
    horde: { tide: 'the Tide', manyHands: 'Many Hands', swarm: 'the Swarm' },
    tycoon: { baron: 'the Baron', goldfinger: 'Goldfinger', banker: 'the Banker' },
  },
  /** Titles a rival earns. */
  title: {
    returned: 'the Returned',
    unbroken: 'the Unbroken',
    steppe: 'Victor of the Steppe',
    relentless: 'the Relentless',
    ironWilled: 'the Iron-Willed',
    hero: 'Hero of the Front',
    unstoppable: 'the Unstoppable',
    swift: 'the Swift',
    lightning: 'Lightning',
  },
  /** Traits a rival picks up. */
  trait: {
    scarred: 'Scarred',
    undying: 'Undying',
    confident: 'Confident',
    methodical: 'Methodical',
    greedy: 'Greedy',
    bloodthirsty: 'Bloodthirsty',
    fortifier: 'Fortifier',
    raider: 'Raider',
    humbled: 'Humbled',
  },
  /** The counter-plan a rival brings, from the file it keeps on you. */
  plan: {
    noFile: 'Has no file on you yet: plays its own game.',
    armour: 'Expects your armour: rocket teams and anti-tank guns.',
    infantry: 'Knows you love infantry: flamers, grenades and machine guns.',
    air: 'Has seen your air force: anti-aircraft everywhere.',
    naval: 'Ready for your fleet: its own navy is waiting.',
    rush: 'Braced for your early rush: defences first.',
    turtle: 'Counts on you turtling: artillery and an early push.',
    superweapons: 'Means to end it before your superweapons charge.',
    dogs: 'Dogs on the perimeter for your spies.',
    balanced: 'Has studied your balanced style: plays the long game.',
  },
  /** What happened to a rival after a battle (its history). */
  note: {
    promoted: 'Promoted to {rank}',
    held: 'Held the line',
    killed: 'Killed in action',
    retreated: 'Retreated in disgrace',
    demoted: 'Demoted to {rank}',
  },
  /** The pre-battle radio line ({player} = your commander name, {last} = the rival's surname). */
  intro: {
    revenge: 'You left me for dead, {player}. You should have made sure.',
    wreckage: 'They pulled me from the wreckage. I have been waiting for this.',
    firstMeet: '{rank} {last}. They say you are good, {player}. We shall see.',
    famous: 'So you are the famous {player}. I expected someone taller.',
    professional: '{last} here. Let us keep this professional, {player}.',
    backForMore: 'Back for more? Last time it took me {n} minutes.',
    // {wins} to {losses}: the rival's record against you; {next} = {wins} + 1
    record: '{wins} to {losses}, {player}. Shall we make it {next}?',
    wall: 'I kept your last defeat on my wall, {player}.',
    lucky: 'You got lucky last time, {player}. Luck runs out.',
    defeats: '{losses} defeats. I remember every one of them.',
    rebuilt: 'I have rebuilt, retrained and rethought. Have you?',
    // {units}: one of rivals.src.units (plural)
    favourite: 'Your {units} will not save you this time.',
    rush: 'Rush me again, I dare you. My guns are already waiting.',
    turtle: 'Dig in as deep as you like. I brought shovels.',
    air: 'Your pilots will find my skies crowded.',
  },
  /** Your favourite units, as a rival names them (plural, inside intro.favourite). */
  units: {
    e1: 'riflemen', e2: 'grenadiers', e3: 'rocket teams', e4: 'flamethrowers', e7: 'Tanya', dog: 'dogs', medi: 'medics', spy: 'spies', jeep: 'Rangers',
    '1tnk': 'light tanks', '2tnk': 'Medium Tanks', '3tnk': 'Heavy Tanks', '4tnk': 'Mammoths', arty: 'artillery', v2rl: 'V2 rockets', apc: 'APCs',
    heli: 'Longbows', hind: 'Hinds', mig: 'MiGs', yak: 'Yaks', dd: 'destroyers', ca: 'cruisers', pt: 'gunboats', ss: 'submarines', mnly: 'minelayers',
    ttnk: 'Tesla Tanks', ctnk: 'Chrono Tanks', shok: 'Shock Troopers', qtnk: 'M.A.D. Tanks', dtrk: 'demolition trucks', msub: 'missile subs', stnk: 'Phase Transports',
  },
});

/** In-match radio lines by event (variants rotate); {player} = your name, {rival} = the rival's surname. */
export const TAUNT_TEXT = liveStrings('rivals.taunt', {
  contact: ['There you are. Nice base. It would be a shame if something happened to it.', 'Found you, {player}.', 'My scouts have your measure.'],
  attack: ['Here they come. Try to look surprised.', 'Advance! Let us see what you are made of.', 'My columns are rolling, {player}.'],
  flank: ['Watch your flank, {player}.', 'One fist in front, one behind you.'],
  harass: ['Your harvesters look lonely.', 'Just a little visit to your ore fields.'],
  nuke: ['Fire. Let them see the sun rise twice today.', 'Launch confirmed. You may want to step outside.'],
  ironcurtain: ['Iron Curtain engaged. Shoot all you like.'],
  firstBlood: ['A scratch. Is that all?', 'You found my door. Now try to get through it.'],
  losing: ['This is not over!', 'Fall back and regroup... I said regroup!', 'You will pay for every one of those buildings.'],
  winning: ['Your lines are breaking, {player}.', 'Surrender now and I will be generous.', 'Was that your best? Truly?'],
  fallback: ['Pull back! Regroup at the rally point.', 'A tactical withdrawal. Nothing more.'],
  expand: ['More ore, more tanks. Simple arithmetic.'],
  won: ['Victory. Remember this day, {player}.', 'Another one for the wall.', 'Well fought. Not well enough.'],
  lost: ['This... this is not the end of {rival}.', 'Well played, {player}. I will not forget it.', 'Tell them I fought to the last.'],
});

export default strings('rivals', {
  /** A rival's full name: first and last names stay as they are. */
  name: {
    full: "{rank} {first} '{nick}' {last}",
    plain: "{first} '{nick}' {last}",
    fullNoNick: '{rank} {first} {last}',
    plainNoNick: '{first} {last}',
    /** Radio call sign: "Col. Volkov". */
    callSign: '{rank} {last}',
  },
  /** Short ranks for call signs. */
  short: {
    lieutenant: 'Lt.',
    captain: 'Capt.',
    major: 'Maj.',
    colonel: 'Col.',
    general: 'Gen.',
    marshal: 'Marshal',
    fieldMarshal: 'F.M.',
  },
  board: {
    kicker: 'Persistent enemy commanders',
    title: 'Rivals',
    back: 'Back · Esc',
    soviet: 'Soviet',
    allied: 'Allied',
    nemesis: 'Nemesis',
    killed: 'Killed in action',
    selected: 'Selected',
    challenge: 'Challenge',
    // record against you: "vs you 3–1"
    vsYou: 'vs you',
    ai: 'AI',
    /** The rival's AI difficulty (lower case on the card). */
    difficulty: { easy: 'easy', normal: 'normal', hard: 'hard', brutal: 'brutal' },
    returned: 'returned',
    returnedTimes: '{n}×',
    // history square: rival won (W) or lost (L)
    win: 'W',
    loss: 'L',
    historyTip: '{note} · {min} min',
    fileOn: 'Their file on {player}',
    bar: {
      infantry: 'Infantry',
      armour: 'Armour',
      artillery: 'Artillery',
      air: 'Air',
      naval: 'Naval',
      defences: 'Defences',
    },
    firstStrike: 'First strike at about [b]{min} min[/b].',
    favourite: 'Favourite: [b]{unit}[/b].',
    superweapons: 'Uses superweapons.',
    studied: 'Studied over {n, plural, one {# battle} other {# battles}}.',
    noFile: 'No battles on file yet. Every skirmish you fight, they watch: how you build, how early you strike, what you love to field.',
    howTo: 'Pick [b]Rival[/b] as an opponent\'s difficulty in the skirmish setup to face one. Win and they fall back, lose and they climb the ranks; the beaten may return, scarred and vengeful.',
  },
  chip: {
    choose: 'Choose your rival',
    none: 'No rival',
  },
  radio: {
    battleControl: 'Battle control',
    killed: '{name} is confirmed killed in action.',
    promoted: '{name} has been promoted to {rank}.',
    promotedTitle: '{name} has been promoted to {rank}, now called "{title}".',
    demoted: '{name} has been demoted to {rank}.',
    held: '{name} holds the line.',
    risen: 'A new rival rises: {name}.',
    /** Screen reader announcement of a radio line. */
    announce: '{who}: {text}',
  },
});
