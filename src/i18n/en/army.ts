/**
 * Big-army command tools (src/ui/army.ts): the army chip and overview panel, repeat production (loops),
 * auto-groups, the idle watch and repair runs. Unit and structure names come from the game data.
 */
import { strings } from '../core';

export default strings('army', {
  // unit categories (section headings, summary chips)
  kind: {
    infantry: 'Infantry',
    vehicle: 'Vehicles',
    aircraft: 'Aircraft',
    naval: 'Ships',
  },
  // short names on the loop chips of the production strip
  short: {
    e1: 'Rifle',
    e2: 'Grenadier',
    e3: 'Rocket',
    e4: 'Flamer',
    e6: 'Engineer',
    e7: 'Tanya',
    medi: 'Medic',
    '1tnk': 'Light',
    '2tnk': 'Medium',
    '3tnk': 'Heavy',
    '4tnk': 'Mammoth',
  },
  title: 'Army',
  overview: 'Army overview',
  nextIdle: 'Next idle unit',
  // mouse actions in the tooltips' key lists
  click: 'Click',
  doubleClick: 'Double-click',
  chip: {
    worth: '{n, plural, one {[b]#[/b] unit} other {[b]#[/b] units}} worth [b]{money}[/b]',
    infantry: 'Infantry [b]{n}[/b]',
    vehicles: 'vehicles [b]{n}[/b]',
    aircraft: 'aircraft [b]{n}[/b]',
    ships: 'ships [b]{n}[/b]',
    structures: 'Structures [b]{n}[/b]',
    keyOverview: 'army overview',
    keyCombat: 'select every combat unit',
    idleTitle: 'Idle units',
    idle: '{n, plural, one {[b]#[/b] unit without orders.} other {[b]#[/b] units without orders.}}',
    noIdle: 'Every unit has orders.',
    keyNextIdle: 'next idle unit',
    keyIdleHarvester: 'idle harvester',
    // a key combination: "Shift + I"
    combo: '{mod} + {key}',
  },
  panel: {
    total: '{n, plural, one {[b]#[/b] unit} other {[b]#[/b] units}} · [b]{money}[/b]',
    veterans: 'Veterans',
    veteransTip: 'Veteran and elite units (promoted by kills).',
    empty: 'No units yet. Train some at a Barracks or War Factory.',
  },
  // the production strip: one line per factory kind
  fac: {
    idle: 'Idle',
    ready: 'Ready',
    // production paused
    onHold: 'On hold',
    loopWaiting: 'Loop · awaiting funds',
    loopTip: 'Loop: {name}',
    loopTipBody: 'Keeps building while you can pay for it.',
    keyStopLoop: 'stop the loop',
    // {idle} is "Idle for N s"
    idleFor: '{idle} while you have {money}.',
    idleSecs: 'Idle for {s} s',
    producing: 'Producing.',
    readyTip: 'Ready to build.',
    group: 'New units join group [b]{g}[/b].',
    keyOpenTab: 'open its build tab',
  },
  row: {
    onField: '[b]{n}[/b] on the field',
    damaged: '{n} damaged',
    idle: '{n} idle',
    ranks: '{vet} veteran · {elite} elite',
    keySelect: 'select all',
    keyAdd: 'add',
    keyJump: 'select and jump',
    keyIdle: 'only the idle ones',
  },
  foot: {
    all: 'All',
    allTip: 'All combat units',
    // a key list entry: the key is this action's hotkey
    hotkey: 'hotkey',
    idle: 'Idle {n}',
    idleTip: 'Idle units',
    idleTipBody: 'Select every unit without orders.',
    keyCycle: 'cycle one by one',
    damaged: 'Damaged {n}',
    damagedTip: 'Damaged units',
    damagedTipBody: 'Select every damaged combat unit.',
    repair: 'Repair',
    repairN: 'Repair {n}',
    repairTip: 'Send for repairs',
    repairTipBody: 'Selected damaged vehicles queue at the nearest Service Depot (repaired ones drive back); ships moor at a naval yard.',
  },
  // badges drawn by CSS on the build cards and tabs (short)
  badge: {
    loop: 'Loop',
    // a loop waiting for money ($ = credits)
    loopWait: 'Loop $',
    idle: 'idle',
  },
  msg: {
    loopOff: 'Loop off: {name}',
    loopOn: 'Loop on: {name}',
    loopOnWaiting: 'Loop on: {name} (waiting for funds)',
    loopStopped: 'Loop stopped: {name} (no factory or tech for it)',
    autoGroupOff: 'Auto-group off: {names}',
    autoGroup: 'New units from {names} join group {g}',
    autoGroupNotPrimary: 'New units from {names} join group {g} (units leave the primary factory: P makes this one primary)',
    noDamaged: 'No damaged units',
    noIdle: 'No idle units',
    noCombat: 'No combat units',
    noIdleOfType: 'No idle units of that type',
    noOfType: 'No units of that type',
    damagedSelected: '{n, plural, one {# damaged unit selected} other {# damaged units selected}} · Shift+R: send for repairs',
    factoryIdle: '{name} idle · {money} to spend (Alt-click a card to loop it)',
    // the same on touch screens (no Alt key: the card's loop button)
    factoryIdleTouch: '{name} idle · {money} to spend (tap a card\'s loop button to keep it building)',
    harvesterIdle: '{name} idle · Shift+I finds it',
    noHarvester: '{n, plural, one {A refinery has no harvester: build an Ore Truck} other {# refineries without a harvester: build Ore Trucks}}',
    noRepairable: 'No damaged vehicles or ships selected',
    needDepot: 'Build a Service Depot to repair vehicles',
    needYard: 'Ships repair alongside a Shipyard or Sub Pen',
    sent: '{n, plural, one {# unit heading for repairs} other {# units heading for repairs}}',
    repaired: 'Repairs complete: {n, plural, one {# vehicle back in action} other {# vehicles back in action}}',
  },
});
