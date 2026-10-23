/**
 * The battle HUD: top bar, build bar / sidebar tabs and cards with their tooltips, superweapons, the selection
 * panel (chips, status bars, orders, stances, formations, auto-groups), control groups, spy intel, objectives,
 * the build-up countdown, King of the Hill, and the battle's messages and floating labels (src/ui/hud.ts, tech.ts,
 * orderui.ts, koth-hud.ts, game.ts). Unit and structure names come from the game data (typeName / typeDesc).
 */
import { strings } from '../core';

// (game.ts takes both from here with its one interface-strings import)
export { trSource } from '../core';

export default strings('hud', {
  // after a key in a tooltip's key list: what the key does
  hotkey: 'hotkey',
  fps: '[b]{n}[/b] FPS',
  mouse: {
    click: 'Click',
    dblclick: 'Double-click',
    // left / right mouse button, as a key cap
    lmb: 'LMB',
    rmb: 'RMB',
  },
  credits: 'Credits',
  mode: {
    repair: 'Repair mode',
    repairDesc: 'Click damaged structures to repair them. Costs credits.',
    sell: 'Sell mode',
    sellDesc: 'Click a structure to sell it for a partial refund.',
    // what the key does: switch the mode on / off
    toggle: 'Toggle',
  },
  power: {
    label: 'Power',
    low: 'Low power',
    tight: 'Near capacity',
    title: 'Power grid',
    lowAlert: 'Low power!',
    lowDesc: 'Production is slowed; radar, Tesla Coils and superweapons are offline. Build more power plants.',
    surplus: 'Surplus [b]{n}[/b].',
    output: 'Output [b]{out}[/b] · drain [b]{use}[/b]',
  },
  radar: {
    offline: 'Radar offline',
    build: 'Build a Radar Dome',
  },
  clock: 'Mission time',
  speed: {
    normal: 'Normal speed',
    fast: 'Fast speed',
    faster: 'Faster speed',
    maximum: 'Maximum speed',
    // a game speed without its own name ({label} is English)
    other: '{label} speed',
    // after "×2" in the speed button's tooltip
    game: 'game speed',
    aria: 'Game speed {n}x',
    changed: 'Game speed ×{n}',
  },
  fullscreen: {
    leave: 'Leave fullscreen',
    leaveDesc: 'Hold [kbd]Esc[/kbd] or press [kbd]Alt[/kbd]+[kbd]Enter[/kbd].',
    enterDesc: 'Edge scrolling works best fullscreen. [kbd]Alt[/kbd]+[kbd]Enter[/kbd]',
  },
  settingsDesc: 'Graphics, audio, controls and the interface layout (the game pauses).',
  // build tabs (Classic sidebar and Modern build bar)
  tab: {
    building: 'Structures',
    // Classic sidebar spelling
    defense: 'Defenses',
    // Modern build bar spelling
    defences: 'Defences',
    infantry: 'Infantry',
    vehicle: 'Vehicles',
    aircraft: 'Aircraft',
    naval: 'Naval',
    // tech and support structures (radar, depot, tech centres, superweapons)
    support: 'Support',
    readyToPlace: 'Ready to place',
    producing: 'Producing: [b]{name}[/b] {pct}%',
    // production paused
    onHold: 'On hold: [b]{name}[/b] {pct}%',
    queued: '{n} queued',
    available: '{n} available',
    nothing: 'Nothing available yet',
    looping: 'Looping: [b]{names}[/b]',
    factoryIdle: 'Factory idle for {n} s',
    next: 'next tab',
  },
  // the status line above the build cards
  cat: {
    place: 'Place {name}',
    yardBusy: 'Yard busy',
    awaitingFunds: 'Awaiting funds',
    building: 'Building {pct}%',
    training: 'Training {pct}%',
    factoryIdle: 'Factory idle {n}s',
    loopAwaiting: 'Loop · awaiting funds',
    requires: 'Requires {req}',
  },
  grid: {
    requiresTech: 'Requires tech',
    empty: 'Nothing to build here yet',
  },
  // build card states
  state: {
    ready: 'Ready',
    // production paused
    onHold: 'On hold',
    noFunds: 'No funds',
    queued: 'Queued',
    offline: 'Offline',
  },
  card: {
    loopAria: 'Loop {name}',
    // a tech tier, abbreviated ("T2")
    tier: 'T{n}',
    // structures queued in the build plan
    planned: 'Planned {n}',
  },
  // short names on the build cards (by type id)
  short: {
    apwr: 'Adv. Power',
    mcv: 'MCV',
    atek: 'Tech Center',
    stek: 'Tech Center',
    v2rl: 'V2 Launcher',
    fact: 'Const. Yard',
    proc: 'Refinery',
  },
  // build card tooltip
  tip: {
    requires: 'Requires [b]{list}[/b]',
    moreTech: 'more technology',
    buildTime: '{s}s build',
    needMore: 'Need {money} more',
    lowPower: 'Low power: slower',
    looping: 'Looping: keeps training while you can pay',
    queue: 'Queue {n}/{max}',
    buildPlace: 'Build / place',
    train: 'Train',
    loop: 'Loop',
    stopLoop: 'Stop loop',
    // right click: pause production (hold) or cancel it
    holdCancel: 'Hold / cancel',
    hotkey: 'Hotkey',
  },
  // what a type is, under its name in the tooltip
  kind: {
    building: 'Structure',
    defense: 'Defense',
    infantry: 'Infantry',
    vehicle: 'Vehicle',
    aircraft: 'Aircraft',
    naval: 'Naval',
  },
  // tooltip stat lines
  stat: {
    durability: 'Durability',
    // hit points, then the armour class
    durabilityValue: '{hp} · {armor}',
    power: 'Power',
    firepower: 'Firepower',
    range: 'Range',
    storage: 'Storage',
    speed: 'Speed',
    capacity: 'Capacity',
    cells: '{n} cells',
    cellsPerSec: '{n} cells/s',
    infantry: '{n} infantry',
  },
  armor: {
    none: 'None',
    wood: 'Wood',
    light: 'Light',
    heavy: 'Heavy',
    concrete: 'Concrete',
  },
  // the armour class in lower case, after the hit points
  armorLc: {
    none: 'none',
    wood: 'wood',
    light: 'light',
    heavy: 'heavy',
    concrete: 'concrete',
  },
  req: {
    tier: 'Tier {n} (Construction Yard upgrade)',
  },
  // veterancy
  rank: {
    rookie: 'Rookie',
    veteran: 'Veteran',
    elite: 'Elite',
  },
  msg: {
    requires: '{name} requires {list}',
    alreadyBuilding: 'Already building',
    queueFull: 'Queue full ({n}): Alt-click a card to loop it instead',
    // the same on touch screens (the card's loop button)
    queueFullTouch: 'Queue full ({n}): tap the card\'s loop button to keep it building instead',
    gpsAuto: 'The GPS satellite launches by itself when it is ready',
    notReady: '{name} not ready',
    activated: '{name} activated',
    defeated: 'You have been defeated',
    eliminated: '{name} has been eliminated',
  },
  // superweapons and support powers
  super: {
    nuke: { name: 'A-Bomb', desc: 'Launch a nuclear missile at any target on the map.' },
    ironcurtain: { name: 'Iron Curtain', desc: 'Make a group of your units invulnerable for a short time.' },
    chrono: { name: 'Chronoshift', desc: 'Teleport one of your vehicles anywhere on the battlefield.' },
    gps: { name: 'GPS Satellite', desc: 'Launch a satellite that permanently reveals the entire map. One use.' },
    sonar: { name: 'Sonar Pulse', desc: 'Reveal every enemy submarine on the map for a short time.' },
    spyplane: { name: 'Spy Plane', desc: 'A reconnaissance plane photographs the area around the target.' },
    paratroopers: { name: 'Paratroopers', desc: 'A Badger drops a squad of riflemen at the target.' },
    parabombs: { name: 'Parabombs', desc: 'Badger bombers carpet-bomb the target area.' },
  },
  superTip: {
    // {how} is one of the how* texts below
    ready: 'Ready — {how}.',
    halted: 'Charging halted: low power.',
    charging: 'Charging: {pct}%.',
    howGps: 'launching',
    howNone: 'click to activate',
    howUnit: 'select a vehicle, click, then choose the destination',
    howPoint: 'click, then choose a target',
  },
  stances: {
    label: 'Stance',
    set: 'Stance: {name}',
  },
  stance: {
    aggressive: { title: 'Aggressive', desc: 'Engage anything in sight and chase it down.' },
    guard: { title: 'Guard', desc: 'Engage nearby enemies, then return to position (default).' },
    hold: { title: 'Hold position', desc: 'Fire at enemies in range but never move to chase.' },
    passive: { title: 'Hold fire', desc: 'Never open fire on its own (stealthy scouts, spies).' },
  },
  formations: {
    label: 'Formation',
    pace: 'The group moves at the pace of its slowest unit.',
    cycle: 'cycle formations',
    set: 'Formation: {name}',
  },
  // short: the label of the touch / gamepad order ring
  formation: {
    none: { title: 'Auto formation', short: 'Auto', desc: 'Keep your relative positions on the move; a spread-out group gathers into a box (armour in front, artillery at the back).' },
    line: { title: 'Line', short: 'Line', desc: 'A broad battle line facing the direction of travel: every gun can fire forward.' },
    box: { title: 'Box', short: 'Box', desc: 'A compact block: armour in the front rows, rocket infantry and artillery protected in the middle and back.' },
    wedge: { title: 'Wedge', short: 'Wedge', desc: 'An arrowhead led by the toughest unit: punches through and covers both flanks.' },
  },
  intel: {
    title: 'Spy intel',
    empty: 'Infiltrate enemy structures with spies.',
    radarShared: 'Radar shared',
    credits: 'Credits [b]{money}[/b]',
    power: 'Power [b]{out}[/b] / drain [b]{use}[/b]',
    lowPower: 'low power',
    radar: 'Radar view shared on your minimap',
    producing: 'Producing: [b]{names}[/b]',
  },
  // factories: new units join a control group
  ag: {
    label: 'Auto-group',
    none: 'No auto-group',
    title: 'Auto-group {g}',
    noneDesc: 'New units only go to the rally point.',
    desc: 'New units from this factory join control group [b]{g}[/b].',
    withFactory: 'with the factory selected',
    offAria: 'Auto-group off',
  },
  // selection panel chips
  chip: {
    armour: 'Armour',
    armourDesc: 'Armour class [b]{armor}[/b] — determines how much damage each warhead deals.',
    // weapon range, abbreviated ("R5.5")
    range: 'R{r}',
    weapon: 'Weapon: {name}',
    damage: 'Damage [b]{dmg}[/b] · range [b]{range}[/b] cells',
    damageBurst: 'Damage [b]{dmg}[/b] ×{burst} · range [b]{range}[/b] cells',
    antiAir: 'anti-air',
    airOnly: 'air only',
    // cells per second, abbreviated
    cps: 'c/s',
    speed: 'Speed',
    speedDesc: 'Cells per second.',
    power: 'Power',
    powerPos: 'Produces power (less when damaged).',
    powerNeg: 'Consumes power.',
    // ore storage capacity, under the amount
    store: 'store',
    storage: 'Ore storage',
    kills: 'kills',
    killsTip: 'Confirmed kills',
  },
  // status tag next to the selected unit's name
  tag: {
    invulnerable: 'Invulnerable',
    submerged: 'Submerged',
    parachuting: 'Parachuting',
    quaking: 'Quaking',
    arming: 'Arming',
    armed: 'Armed',
    repairing: 'Repairing',
    // the primary factory
    primary: 'Primary',
  },
  harvest: {
    seek: 'Searching for ore',
    toOre: 'Moving to ore field',
    harvesting: 'Harvesting',
    toRefinery: 'Returning to refinery',
    waitDock: 'Waiting to dock',
    unloading: 'Unloading',
    idle: 'Idle',
  },
  // status bars of the selection panel
  xbar: {
    cargo: 'Cargo',
    chronoshift: 'Chronoshift',
    recharging: 'Recharging {n} s',
    // {key}: the deploy key
    readyKey: 'Ready · {key}',
    arming: 'Arming…',
    seismic: 'Seismic charge',
    deployKey: '{key} to deploy',
    mobile: 'Mobile',
    charge: 'Charge',
    drivingIn: 'Armed: driving in',
    armHint: 'Attack to arm · {key} detonates',
    safe: 'Safe',
    passengers: 'Passengers',
    unloadKey: '{key} to unload',
    ammo: 'Ammo',
    rearm: 'Rearm at pad',
    elite: 'Elite',
    maxRank: 'Max rank',
    experience: 'Experience',
    producing: 'Producing',
    loop: 'Loop: [b]{names}[/b]',
    idleFor: 'Idle {n} s',
    idle: 'Idle',
    construction: 'Construction',
    itemReady: '{name} ready',
    silo: 'Silo',
  },
  // multiple selection
  multi: {
    // after the count of selected units
    units: '{n, plural, one {unit} other {units}}',
    structures: '{n, plural, one {structure} other {structures}}',
    // a mix of units and structures, after the count
    selected: 'selected',
    types: '{n, plural, one {# type} other {# types}}',
    damagedTitle: 'Damaged',
    damagedDesc: 'Keep only the damaged units selected.',
    sendRepairs: 'send them for repairs',
    nSelected: '{n} selected',
    selectOnly: 'select only these',
    deselect: 'deselect',
    damaged: '{n} damaged',
  },
  // order buttons of the selection panel
  cmd: {
    attackMove: { title: 'Attack-move', desc: 'Move to a location, engaging any enemies met on the way.' },
    stop: { title: 'Stop', desc: 'Cancel all current orders.' },
    scatter: { title: 'Scatter', desc: 'Spread out to avoid splash damage.' },
    deploy: { title: 'Deploy', desc: 'Deploy into a Construction Yard.' },
    unload: { title: 'Unload', desc: 'Unload all passengers.' },
    returnBase: { title: 'Return to base', desc: 'Fly back to a pad to rearm.' },
    chronoshift: { title: 'Chronoshift', desc: 'Click any explored open ground: the Chrono Tank jumps there, then recharges.' },
    quake: { title: 'Deploy seismic charge', desc: 'The crew bails out and the charge arms, then quakes wreck every vehicle and structure nearby (friend or foe).' },
    detonate: { title: 'Detonate', desc: 'Set the charge off right here. Order an attack to arm it and drive it into a target.' },
    groundFire: { title: 'Fire at ground', desc: 'Force-fire at a location (click the target after).' },
    patrol: { title: 'Patrol', desc: 'Click the far end of a route (Shift-click for more waypoints): loop along it, engaging enemies on the way.' },
    guard: { title: 'Guard / escort', desc: 'Click a unit to escort (follow and defend it) or a structure to defend. Right-clicking a friendly unit escorts it too.' },
    mines: { title: 'Lay mines', desc: 'Click the ground to lay a minefield there (Ctrl + right click does the same). D drops a single mine.' },
    repairs: { title: 'Send for repairs', desc: 'Damaged vehicles queue at the nearest Service Depot, one on the pad at a time, and drive back when repaired. Ships moor at a Shipyard / Sub Pen.', selectDamaged: 'select every damaged unit' },
    sell: { title: 'Sell', desc: 'Sell this structure for a partial refund.' },
    repair: { title: 'Repair', desc: 'Toggle repairs on this structure (costs credits).' },
    primary: { title: 'Primary factory', desc: 'New units of this type are produced here.' },
    evacuate: { title: 'Evacuate', desc: 'The infantry inside come out next to the bunker.' },
  },
  // control groups bar
  groups: {
    title: 'Group {g}',
    desc: '{n, plural, one {# unit} other {# units}} · mostly {name}',
    select: 'select',
    jump: 'jump',
  },
  obj: {
    title: 'Objective',
    destroyAll: 'Destroy all enemy forces',
    desc: 'Destroy every enemy structure and unit.',
    eliminated: 'eliminated',
    objectives: 'Objectives',
    primary: 'primary',
    optional: 'optional',
    complete: 'complete',
    failed: 'failed',
    left: '{n} left',
  },
  // build-up time (ceasefire at the start of a skirmish)
  cf: {
    title: 'Build-up time',
    desc: 'Ceasefire: the enemy builds up its forces and only defends itself until the timer runs out; attacking it does not end the ceasefire early. Expect a big attack when it does.',
    slower: 'slower',
    faster: 'faster (up to ×{n})',
    unlimited: 'Ceasefire: [b]unlimited[/b] [small](enemy only defends)[/small]',
    left: 'Ceasefire: [b]{time}[/b]',
  },
  koth: {
    title: 'King of the Hill',
    firstTo: 'first to {time}',
    contested: 'Contested',
    youHold: 'You hold the hill',
    heldBy: 'Held by {name}',
    unclaimed: 'Unclaimed',
    you: 'You',
  },
  // battle loading screen steps
  loading: {
    battlefield: 'Generating battlefield',
    armies: 'Assembling armies',
    terrain: 'Rendering terrain',
    armoury: 'Preparing armoury',
    control: 'Establishing battle control',
    shaders: 'Compiling shaders',
    ready: 'Ready',
  },
  // labels floating over the battlefield
  float: {
    reinforcements: 'Reinforcements!',
    fieldRepair: 'Field repair',
    revealed: 'Area revealed',
    infiltrated: 'INFILTRATED',
    spy: 'SPY!',
    captured: 'CAPTURED',
    structureLost: 'STRUCTURE LOST',
    elite: 'ELITE',
    veteran: 'VETERAN',
  },
  // under VICTORY / DEFEAT at the end of a battle
  end: {
    // {name}: the mission's codename
    operation: 'Operation {name}',
    won: 'All enemy forces destroyed',
    lost: 'Your forces have been overrun',
  },
  // photo mode's lens controls (src/render/photo.ts)
  photo: {
    dof: 'Depth of field',
    focus: 'Focus',
    // focus slider at 0 means automatic focus; {key:photo} is the photo-mode key
    hint: 'Focus 0 = auto · [kbd]{key:photo}[/kbd] to exit',
  },
});
