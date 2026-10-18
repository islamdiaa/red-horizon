/**
 * Battle controls (src/ui/input.ts, touch.ts, gamepad.ts): the messages orders and modes give, structure placement
 * problems, the touch toolbar, the order ring (touch long-press, gamepad) and the gamepad button help. Stance and
 * formation names are the HUD's (hud.stance, hud.formation); unit and structure names come from the game data.
 */
import { strings } from '../core';

export default strings('controls', {
  msg: {
    noIdleHarvesters: 'No idle harvesters',
    noIdleUnits: 'No idle units',
    formationNeedTwo: 'Select two or more ground units for a formation',
    // control groups: {n} units in the group now
    groupAdded: 'Added to group {g} ({n})',
    groupAssigned: 'Group {g} assigned',
    plan: 'Plan {name}: click to queue it (Shift-click: several). The yard builds and places it when affordable.',
    chronoSelect: 'Select a vehicle to chronoshift first',
    planInvalid: 'Cannot plan here: open ground next to your base or another planned structure',
    // {n}: its place in the build plan
    planned: '{name} planned (#{n})',
    patrolling: '{n, plural, one {Patrolling # waypoint} other {Patrolling # waypoints}}',
    guarding: 'Guarding the {name}',
    guardInvalid: "Guard: click one of your (or an ally's) units or structures",
    chronoInvalid: 'Cannot chronoshift there: explored open ground only',
    noChrono: 'No Chrono Tank ready',
    rallyUnit: 'Rally: new units join the {name}',
    chronoMode: 'Chronoshift: click a spot you have explored',
    chronoRecharging: 'Chrono Tank recharging ({n} s)',
    patrolMode: 'Patrol: click the far end of the route (Shift-click: add waypoints)',
    guardMode: 'Guard: click a unit to escort or a structure to defend',
    follow: 'Camera following the selection (F or scroll to release)',
    released: 'Camera released',
  },
  // why a structure can't go where the player clicked
  place: {
    noYard: 'You need a Construction Yard to build structures',
    water: 'Cannot build here: shipyards and sub pens go on open water next to your base',
    terrain: 'Cannot build here: needs clear, dry ground',
    occupied: 'Cannot build here: something is in the way',
    exit: 'Cannot build here: it would block a factory exit or refinery dock',
    wallDistance: 'Too far from your base: walls must stay close to your structures',
    distance: 'Too far from your base: build next to your other structures',
  },
  // the touch toolbar
  touch: {
    // toggles: drag to box-select / taps add to the selection
    box: 'Box',
    add: 'Add',
    attack: 'Attack',
    // force fire
    force: 'Force',
    guard: 'Guard',
    patrol: 'Patrol',
    stop: 'Stop',
    // all combat units
    all: 'All',
    selectFirst: 'Select units first',
    boxOn: 'Drag to box select (two fingers pan)',
    boxOff: 'Drag to pan (hold, then drag to box select)',
    addOn: 'Taps add to the selection (and act as Shift)',
    addOff: 'Taps select',
  },
  // the order ring (touch long-press, gamepad)
  radial: {
    orders: 'Orders',
    attackMove: 'Attack-move',
    guardThis: 'Guard this',
    patrolHere: 'Patrol here',
    forceFire: 'Force fire',
    fireHere: 'Fire here',
    stop: 'Stop',
    scatter: 'Scatter',
    unload: 'Unload',
    deploy: 'Deploy',
    stance: 'Stance',
    formation: 'Formation',
    sell: 'Sell',
    stopRepair: 'Stop repair',
    repair: 'Repair',
    evacuate: 'Evacuate',
    // the primary factory
    primary: 'Primary',
    rallyHere: 'Rally here',
    joinUnit: 'Join this unit',
    allUnits: 'All units',
    idleUnit: 'Idle unit',
    army: 'Army',
    base: 'Base',
    lastAttack: 'Last attack',
    // gamepad: modes that need a second click
    guardMode: 'Guard…',
    patrolRoute: 'Patrol route…',
  },
  // stance names in the order ring (short)
  stance: {
    aggressive: 'Aggressive',
    guard: 'Guard',
    hold: 'Hold',
    passive: 'Hold fire',
  },
  gamepad: {
    noGroups: 'No control groups yet: Ctrl + 1–9 assigns one',
    group: 'Group {g}',
    // the on-screen button help
    select: 'Select',
    command: 'Command',
    deploy: 'Deploy',
    cancel: 'Cancel',
    // ☰ (the View button): the order ring
    orders: 'Orders (View)',
    idle: 'Idle',
    groups: 'Groups',
    sidebar: 'Sidebar',
  },
});
