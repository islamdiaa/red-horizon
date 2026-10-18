/**
 * Commander economy in the HUD (src/ui/economy.ts): the economy readout next to the credits and the structure
 * controls in the selection panel (upgrades, research lab, garrison, ore). Tech tier names, upgrade and research
 * names come from the game data (dt() tables techTier, upgrade, research).
 */
import { strings } from '../core';

export default strings('economy', {
  // a tech tier, abbreviated ("T2")
  tierShort: 'T{n}',
  // credits in thousands: {n} is already formatted ("12.5"), the $ is the game's credit sign
  kmoney: '${n}k',
  readout: {
    tierAria: 'Tech tier',
    tier: 'Tier',
    // after the income figure: per minute
    perMin: '/min',
  },
  news: {
    tier: 'Tier {n} reached: {name}. New structures and upgrades available',
    // {level} is a roman numeral (I, II)
    research: 'Research complete: {name} {level}',
    upgrade: 'Upgrade installed',
  },
  tip: {
    title: 'Economy',
    tier: 'Tech tier [b]T{n} {name}[/b]',
    tierUpgrade: 'upgrade it at your Construction Yard',
    income: 'Ore income [b]{money}[/b] per minute (last minute)',
    ore: 'Ore near your docks [b]{money}[/b] · about {loads, plural, one {[b]#[/b] truck load} other {[b]#[/b] truck loads}} in {cells, plural, one {# cell} other {# cells}}',
    runningOut: 'running out: expand',
    trucks: 'Ore Trucks [b]{n}[/b]',
    idle: '{n} idle',
    // {balance} is "surplus N" or "short N"
    power: 'Power [b]{out}[/b] / drain [b]{use}[/b] ({balance})',
    surplus: 'surplus {n}',
    short: 'short {n}',
    // a mouse action in the tooltip's key list
    click: 'Click',
    clickResearch: 'research tree',
  },
  sel: {
    upgrades: 'Upgrades',
    upgradeAria: 'Upgrade: {name}',
    researchTree: 'Research tree',
    researchTreeTip: 'Open the research tree: global upgrades for your whole army, two levels each (Level II needs Tier 3).',
    // an upgrade that can't start: "{name}: {reason}"
    cannot: '{name}: {reason}',
  },
  up: {
    installed: 'Installed',
    installing: 'Installing: [b]{pct}[/b] · right-click or click to cancel (refunds {money})',
    // {need} is "Need $X more"
    poor: '{need} (paid while it installs)',
    needMore: 'Need {money} more',
    ready: 'Click to install (paid while it installs)',
    doctrineOff: '(doctrine: 25% off)',
    seconds: '{s} s',
    tier: 'Tier {n}',
    unique: 'one per commander',
  },
  info: {
    research: 'Research',
    // {level} is a roman numeral (I, II)
    researching: '{name} {level} · {pct}',
    idle: 'Idle: open the tree',
    garrison: 'Garrison',
    evacuate: 'D to evacuate',
    garrisonHint: 'Right-click with infantry',
    oreNearby: 'Ore nearby',
    ore: '{money} · {loads, plural, one {# load} other {# loads}}',
    active: 'Active',
    offline: 'Offline: low power',
  },
  // the effect line of a structure that is always on
  passive: {
    ore: 'Ore +25%',
    logistics: 'Units -10%, repairs',
  },
  reason: {
    tier: 'Requires Tier {n}',
    // {list} is one or more structure names
    prereq: 'Requires {list}',
    after: 'Requires Tier 2 first',
    missing: 'Missing a required structure',
    unique: 'One per commander: already on another structure',
    busy: 'This structure is busy with another project',
    owned: 'Installed',
    inactive: 'Structure not ready',
    unavailable: 'Not available',
  },
});
