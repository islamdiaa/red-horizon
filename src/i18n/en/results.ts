/** Post-match results screen (src/ui/results.ts): service record, contracts, medals, battle report, buttons. */
import { strings } from '../core';

export default strings('results', {
  head: {
    // big title, shown in capitals letter by letter
    victory: 'VICTORY',
    defeat: 'DEFEAT',
    accomplished: 'Mission accomplished',
    failed: 'Mission failed',
    opponents: '{n, plural, one {# opponent} other {# opponents}}',
    grade: 'Grade {grade} · {score}',
    gradeTip: '{title} · score {score}',
    copyCode: 'Copy the map code',
  },
  record: {
    title: 'Service record',
    // {key}: the Enter key
    skip: '{key} · skip',
    nextRank: 'Next: {rank}',
    highestRank: 'Highest rank',
    unranked: 'Unranked battle',
    // the top rank: no progress bar target
    max: 'MAX',
    promoted: 'Promoted',
    promotedTo: 'Promoted · {rank}',
  },
  contracts: {
    title: 'Contracts',
    commendations: '{n, plural, one {# Commendation} other {# Commendations}}',
    complete: 'Complete',
    xpGain: '+{n} XP',
    none: "No contract progress this time. Today's orders are on the main menu.",
    notCounted: 'This battle does not count towards contracts.',
  },
  medals: {
    title: 'Medals earned',
  },
  unlock: {
    unlocked: 'Unlocked',
    next: 'Next unlock',
    locker: 'Locker',
    allEarned: 'Every cosmetic earned. Impressive.',
  },
  report: {
    title: 'Battle report',
    every: 'every {n} s',
    tooShort: 'The battle was too short for a report.',
    armyValue: 'Army value',
    income: 'Income',
    // unit after the income value ("$1,200/min")
    perMinute: '/min',
    kills: 'Kills',
    you: '{name} (you)',
    // legend marker next to your name
    youTag: 'you',
    chartAria: '{title} over time. {values}',
    chartValue: '{name}: {value}',
  },
  board: {
    commander: 'Commander',
    built: 'Built',
    lost: 'Lost',
    kills: 'Kills',
    structuresLost: 'Structures lost',
    harvested: 'Harvested',
    eliminated: '{faction} · eliminated',
    victor: '{faction} · victor',
  },
  mvp: {
    tag: 'MVP',
    rookie: 'Rookie',
    veteran: 'Veteran',
    elite: 'Elite',
    fell: '{rank} · fell in battle',
    kills: 'kills',
    none: 'No kills on record',
    noneSub: 'Next time, take the fight to them',
  },
  // economy comparison with the strongest enemy, and one suggestion (src/ui/coach.ts economyAdvice)
  econ: {
    title: 'Economy',
    // {you} / {foe}: money harvested over the match; {ratio}: how many times more the enemy harvested ("2.6")
    harvestBehind: 'You harvested [b]{you}[/b]; the enemy [b]{foe}[/b] ({ratio}×).',
    harvest: 'You harvested [b]{you}[/b]; the enemy [b]{foe}[/b].',
    // the highest army value each side fielded at any moment
    army: 'Peak army: you [b]{you}[/b], the enemy [b]{foe}[/b].',
    tip: {
      income: 'The enemy out-earned you. Build a second Ore Refinery early and keep two Ore Trucks working for each refinery.',
      // {shift}: the key name
      army: 'Your income kept up but your army did not: keep every factory busy and spend your money ([kbd]{shift}[/kbd]-click a unit to queue five).',
      defendAllies: 'You fell early. Before the first attack arrives, put a Pillbox or a Turret next to your Ore Refinery.',
      defendSoviet: 'You fell early. Before the first attack arrives, put a Flame Tower or a Tesla Coil next to your Ore Refinery.',
      close: 'A close fight. Keep your army together and attack-move into battle instead of sending units in a few at a time.',
      won: 'Your economy held up and your army got the job done. Well fought, Commander.',
    },
  },
  highlights: {
    title: 'Highlights',
    quiet: 'A quiet battle.',
    clip: 'Clip',
    clipTip: 'Record a highlight clip of this moment (video)',
  },
  buttons: {
    playAgain: 'Play again',
    playAgainTip: 'Same settings, a fresh battlefield',
    rematch: 'Rematch',
    rematchTip: 'The same battlefield and seed',
    replay: 'Watch replay',
    keepWatching: 'Keep watching',
  },
});
