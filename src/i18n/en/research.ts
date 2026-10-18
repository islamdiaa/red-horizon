/** The research tree (src/ui/research.ts). Research names, blurbs and level effects come from the game data. */
import { strings } from '../core';

export default strings('research', {
  aria: 'Research tree',
  close: 'Close research',
  kicker: 'Commander economy',
  title: 'Research',
  foot: 'Click a level to research it at an idle lab · click a running project to cancel it (refunded) · Level II needs Tier {n}',
  // the research line's category
  branch: {
    armour: 'Armour',
    firepower: 'Firepower',
    production: 'Production',
    economy: 'Economy',
    support: 'Support',
  },
  // after the category: the line is available to both factions
  shared: 'shared',
  synergyTip: 'Fits your doctrine: 25% off',
  synergy: 'Doctrine −25%',
  // a research line and a level (roman numeral): "Composite Armour II"
  node: '{name} {level}',
  labs: '{n, plural, one {[b]#[/b] lab} other {[b]#[/b] labs}} · [b]{idle}[/b] idle',
  noLab: 'No Research Lab',
  // a tech tier, abbreviated ("T2")
  tierShort: 'T{n}',
  next: 'Next: [b]{name}[/b] at the Construction Yard · {cost}',
  topTier: 'Top tier reached',
  msg: {
    needsLevel: '{name} {level} needs level {prev} first',
    labsBusy: 'Every Research Lab is busy',
    buildLab: 'Build a Research Lab first (Tier 2)',
    tier: 'Level II research needs Tier {n}',
    researching: 'Already being researched',
    unavailable: 'Not available',
  },
  why: {
    needsLevel: 'Needs level {level} first',
    tier: 'Requires Tier {n}',
    researching: 'Being researched',
    buildLab: 'Build a Research Lab',
    labsBusy: 'All labs busy',
  },
  state: {
    done: 'Researched',
    cancel: 'click to cancel',
    // cost and research time, short ("12s")
    secsShort: '{s}s',
    secs: '{s} s',
  },
});
