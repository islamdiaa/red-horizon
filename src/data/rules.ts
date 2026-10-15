/**
 * Game rules — weapons, warheads, units, structures.
 *
 * Values are taken from the original 1996 Red Alert RULES.INI (the source code
 * released by EA under GPL v3 reads these fields in WEAPON.CPP / WARHEAD.CPP /
 * TECHNO.CPP; see reference/CnC_Red_Alert). Raw values are kept in the original
 * units and converted with the helpers at the bottom so they stay traceable:
 *   - ROF:   game ticks at 15 ticks/sec
 *   - Speed: MPH value 0..100 (=> leptons/tick, 256 leptons per cell)
 *   - Range / Sight: cells
 */

export type Armor = 'none' | 'wood' | 'light' | 'heavy' | 'concrete';
export const ARMOR_INDEX: Record<Armor, number> = { none: 0, wood: 1, light: 2, heavy: 3, concrete: 4 };

export type Faction = 'allies' | 'soviet';
export type Category = 'building' | 'defense' | 'infantry' | 'vehicle' | 'aircraft';

/** Visual explosion family used by the renderer. */
export type ExplosionKind =
  | 'none' | 'piff' | 'small' | 'medium' | 'large' | 'huge' | 'fire' | 'electric' | 'nuke' | 'building';

/** How a weapon's shot travels. */
export type ProjectileKind =
  | 'bullet'      // instant hit, tracer line
  | 'flak'        // instant hit air burst
  | 'cannon'      // fast straight shell
  | 'ballistic'   // high arc artillery shell
  | 'lobbed'      // grenade arc
  | 'missile'     // homing rocket w/ smoke trail
  | 'scud'        // big V2 rocket, high arc
  | 'tesla'       // instant lightning bolt
  | 'flame'       // short-range fire stream
  | 'fireball'    // flame tower fireball
  | 'melee'       // dog jaw
  | 'heal';       // medic

export interface WarheadDef {
  id: string;
  spread: number;
  /** Damage multipliers vs none, wood, light, heavy, concrete */
  verses: [number, number, number, number, number];
  wall: boolean;
  wood: boolean;
  ore: boolean;
  explosion: ExplosionKind;
  infDeath: 'normal' | 'blown' | 'burn' | 'electro' | 'bite';
}

export interface WeaponDef {
  id: string;
  damage: number;
  rof: number;          // ticks @15Hz between shots
  range: number;        // cells
  minRange?: number;
  projectile: ProjectileKind;
  speed: number;        // projectile MPH (0..100), 100 = instant
  warhead: string;
  burst: number;
  report: string;       // sound effect key
  antiAir: boolean;
  antiGround: boolean;
  inaccuracy?: number;  // cells of scatter
  charge?: number;      // ticks of charge-up before firing (tesla)
}

export interface BaseTypeDef {
  id: string;
  name: string;
  cost: number;
  strength: number;
  armor: Armor;
  sight: number;
  owner: Faction[];
  /** Each entry must be satisfied; an entry "a|b" is satisfied by either. */
  prereq: string[];
  buildable: boolean;
  category: Category;
  description: string;
}

export interface UnitTypeDef extends BaseTypeDef {
  kind: 'vehicle' | 'infantry' | 'aircraft';
  speed: number;        // MPH 0..100
  rot: number;          // RA rotation rate (facing units per tick, 256 per revolution)
  primary?: string;
  secondary?: string;
  /** Fire primary and secondary alternately as a pair (twin barrels). */
  twinShot?: boolean;
  turret: boolean;
  tracked: boolean;
  crusher: boolean;
  crushable: boolean;
  /** Collision radius in cells. */
  radius: number;
  selfHealing?: boolean;
  harvester?: boolean;
  deploysInto?: string;
  noMovingFire?: boolean;
  passengers?: number;
  engineer?: boolean;
  medic?: boolean;
  dog?: boolean;
  c4?: boolean;
  hero?: boolean;
  /** Aircraft: needs a pad to rearm; VTOL = helicopter. */
  vtol?: boolean;
  ammo?: number;
}

export interface BuildingTypeDef extends BaseTypeDef {
  kind: 'building';
  size: [number, number];   // footprint in cells [x, y]
  power: number;            // + produces, - consumes
  storage?: number;
  primary?: string;
  turret?: boolean;
  freeUnit?: string;
  factory?: 'building' | 'infantry' | 'vehicle' | 'aircraft';
  /** Only produces these unit ids (e.g. kennel => dogs). */
  factoryOnly?: string[];
  /** Weapon/feature is disabled under low power. */
  requiresPower?: boolean;
  /** Cell (relative to footprint top-left) where units dock / exit. */
  dock?: [number, number];
  exit?: [number, number];
  /** Footprint cells (relative) that units can drive over (e.g. depot pad). */
  passable?: [number, number][];
  repairPad?: boolean;
  radar?: boolean;
  superweapon?: 'nuke' | 'ironcurtain' | 'chrono';
  /** Seconds to charge the superweapon. */
  superCharge?: number;
  wall?: boolean;
}

export type TypeDef = UnitTypeDef | BuildingTypeDef;

// ---------------------------------------------------------------------------
// Warheads
// ---------------------------------------------------------------------------

const p = (a: number, b: number, c: number, d: number, e: number): [number, number, number, number, number] =>
  [a / 100, b / 100, c / 100, d / 100, e / 100];

export const WARHEADS: Record<string, WarheadDef> = {
  SA:          { id: 'SA', spread: 3, verses: p(100, 50, 60, 25, 25), wall: false, wood: false, ore: false, explosion: 'piff', infDeath: 'normal' },
  HE:          { id: 'HE', spread: 6, verses: p(90, 75, 60, 25, 100), wall: true, wood: true, ore: true, explosion: 'medium', infDeath: 'blown' },
  AP:          { id: 'AP', spread: 3, verses: p(30, 75, 75, 100, 50), wall: true, wood: true, ore: false, explosion: 'small', infDeath: 'blown' },
  Fire:        { id: 'Fire', spread: 8, verses: p(90, 100, 60, 25, 50), wall: false, wood: true, ore: true, explosion: 'fire', infDeath: 'burn' },
  HollowPoint: { id: 'HollowPoint', spread: 1, verses: p(100, 5, 5, 5, 5), wall: false, wood: false, ore: false, explosion: 'piff', infDeath: 'normal' },
  Super:       { id: 'Super', spread: 1, verses: p(100, 100, 100, 100, 100), wall: false, wood: false, ore: false, explosion: 'electric', infDeath: 'electro' },
  Organic:     { id: 'Organic', spread: 0, verses: p(100, 0, 0, 0, 0), wall: false, wood: false, ore: false, explosion: 'none', infDeath: 'bite' },
  Nuke:        { id: 'Nuke', spread: 6, verses: p(90, 100, 60, 25, 50), wall: true, wood: true, ore: true, explosion: 'nuke', infDeath: 'burn' },
};

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

const W = (w: Partial<WeaponDef> & Pick<WeaponDef, 'id' | 'damage' | 'rof' | 'range' | 'projectile' | 'warhead' | 'report'>): WeaponDef => ({
  speed: 100, burst: 1, antiAir: false, antiGround: true, ...w,
});

export const WEAPONS: Record<string, WeaponDef> = {
  Colt45:           W({ id: 'Colt45', damage: 50, rof: 5, range: 5.75, projectile: 'bullet', warhead: 'HollowPoint', report: 'pistol' }),
  M1Carbine:        W({ id: 'M1Carbine', damage: 15, rof: 20, range: 3, projectile: 'bullet', warhead: 'SA', report: 'rifle' }),
  M60mg:            W({ id: 'M60mg', damage: 15, rof: 20, range: 4, projectile: 'bullet', warhead: 'SA', report: 'mg' }),
  Vulcan:           W({ id: 'Vulcan', damage: 40, rof: 10, range: 5, projectile: 'bullet', warhead: 'SA', report: 'mg' }),
  TurretGun:        W({ id: 'TurretGun', damage: 40, rof: 40, range: 6, projectile: 'cannon', speed: 40, warhead: 'AP', report: 'cannon_med' }),
  Dragon:           W({ id: 'Dragon', damage: 35, rof: 50, range: 5, projectile: 'missile', speed: 30, warhead: 'AP', report: 'rocket' }),
  RedEye:           W({ id: 'RedEye', damage: 50, rof: 50, range: 7.5, projectile: 'missile', speed: 50, warhead: 'AP', report: 'rocket', antiAir: true, antiGround: false }),
  Grenade:          W({ id: 'Grenade', damage: 50, rof: 60, range: 4, projectile: 'lobbed', speed: 12, warhead: 'HE', report: 'grenade', inaccuracy: 0.6 }),
  Flamer:           W({ id: 'Flamer', damage: 70, rof: 50, range: 3.5, projectile: 'flame', speed: 12, warhead: 'Fire', report: 'flame' }),
  FireballLauncher: W({ id: 'FireballLauncher', damage: 125, rof: 50, range: 5, projectile: 'fireball', speed: 12, warhead: 'Fire', report: 'flame' }),
  '75mm':           W({ id: '75mm', damage: 25, rof: 40, range: 4, projectile: 'cannon', speed: 40, warhead: 'AP', report: 'cannon_small' }),
  '90mm':           W({ id: '90mm', damage: 30, rof: 50, range: 4.75, projectile: 'cannon', speed: 40, warhead: 'AP', report: 'cannon_med' }),
  '105mm':          W({ id: '105mm', damage: 30, rof: 70, range: 4.75, projectile: 'cannon', speed: 40, warhead: 'AP', report: 'cannon_heavy' }),
  '120mm':          W({ id: '120mm', damage: 40, rof: 80, range: 4.75, projectile: 'cannon', speed: 40, warhead: 'AP', report: 'cannon_heavy' }),
  MammothTusk:      W({ id: 'MammothTusk', damage: 75, rof: 80, range: 5, projectile: 'missile', speed: 30, warhead: 'HE', report: 'rocket', burst: 2, antiAir: true }),
  '155mm':          W({ id: '155mm', damage: 150, rof: 65, range: 6, minRange: 2, projectile: 'ballistic', speed: 12, warhead: 'HE', report: 'artillery', inaccuracy: 1 }),
  SCUD:             W({ id: 'SCUD', damage: 600, rof: 400, range: 10, minRange: 3, projectile: 'scud', speed: 25, warhead: 'HE', report: 'missile_launch', inaccuracy: 0.5 }),
  TeslaZap:         W({ id: 'TeslaZap', damage: 100, rof: 45, range: 8.5, projectile: 'tesla', warhead: 'Super', report: 'tesla_zap', charge: 10 }),
  DogJaw:           W({ id: 'DogJaw', damage: 100, rof: 10, range: 1.5, projectile: 'melee', warhead: 'Organic', report: 'dog_attack' }),
  Heal:             W({ id: 'Heal', damage: -50, rof: 80, range: 1.83, projectile: 'heal', warhead: 'Organic', report: 'heal' }),
  Nike:             W({ id: 'Nike', damage: 50, rof: 20, range: 7.5, projectile: 'missile', speed: 50, warhead: 'AP', report: 'missile_launch', antiAir: true, antiGround: false }),
  'ZSU-23':         W({ id: 'ZSU-23', damage: 25, rof: 10, range: 6, projectile: 'flak', warhead: 'AP', report: 'flak', antiAir: true, antiGround: false }),
  Hellfire:         W({ id: 'Hellfire', damage: 40, rof: 60, range: 4, projectile: 'missile', speed: 40, warhead: 'AP', report: 'rocket', burst: 2 }),
  ChainGun:         W({ id: 'ChainGun', damage: 25, rof: 10, range: 5, projectile: 'bullet', warhead: 'SA', report: 'mg' }),
  Maverick:         W({ id: 'Maverick', damage: 50, rof: 30, range: 6, projectile: 'missile', speed: 50, warhead: 'AP', report: 'missile_launch', burst: 2 }),
  Nuke:             W({ id: 'Nuke', damage: 1000, rof: 1, range: 99, projectile: 'scud', speed: 25, warhead: 'Nuke', report: 'nuke_launch' }),
};

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const BOTH: Faction[] = ['allies', 'soviet'];

type UnitInit = Omit<UnitTypeDef, 'buildable' | 'turret' | 'tracked' | 'crusher' | 'crushable' | 'radius' | 'sight' | 'armor' | 'owner' | 'prereq' | 'category'> &
  Partial<Pick<UnitTypeDef, 'buildable' | 'turret' | 'tracked' | 'crusher' | 'crushable' | 'radius' | 'sight' | 'armor' | 'owner' | 'prereq' | 'category'>>;

const INF = (u: Omit<UnitInit, 'kind' | 'rot'> & { rot?: number }): UnitTypeDef => ({
  kind: 'infantry', category: 'infantry', buildable: true, turret: false, tracked: false, crusher: false, crushable: true,
  radius: 0.16, sight: 4, armor: 'none', owner: BOTH, prereq: ['tent|barr'], rot: 32, ...u,
});

const VEH = (u: Omit<UnitInit, 'kind'>): UnitTypeDef => ({
  kind: 'vehicle', category: 'vehicle', buildable: true, turret: false, tracked: true, crusher: true, crushable: false,
  radius: 0.38, sight: 4, armor: 'heavy', owner: BOTH, prereq: ['weap'], ...u,
});

const AIR = (u: Omit<UnitInit, 'kind'>): UnitTypeDef => ({
  kind: 'aircraft', category: 'aircraft', buildable: true, turret: false, tracked: false, crusher: false, crushable: false,
  radius: 0.4, sight: 6, armor: 'light', owner: BOTH, prereq: ['hpad'], ...u,
});

export const UNITS: Record<string, UnitTypeDef> = {
  // ---- Infantry
  e1:   INF({ id: 'e1', name: 'Rifle Infantry', cost: 100, strength: 50, speed: 4, primary: 'M1Carbine', description: 'Cheap, versatile foot soldier. Strong against infantry.' }),
  e2:   INF({ id: 'e2', name: 'Grenadier', cost: 160, strength: 50, speed: 5, primary: 'Grenade', owner: ['soviet'], prereq: ['barr'], description: 'Lobs grenades over obstacles. Good against infantry and structures.' }),
  e3:   INF({ id: 'e3', name: 'Rocket Soldier', cost: 300, strength: 45, speed: 3, primary: 'Dragon', secondary: 'RedEye', description: 'Anti-armour and anti-air rocket infantry.' }),
  e4:   INF({ id: 'e4', name: 'Flamethrower', cost: 300, strength: 40, speed: 3, primary: 'Flamer', owner: ['soviet'], prereq: ['barr', 'ftur'], description: 'Incinerates infantry and wooden structures at close range.' }),
  e6:   INF({ id: 'e6', name: 'Engineer', cost: 500, strength: 25, speed: 4, engineer: true, description: 'Captures heavily damaged enemy structures, repairs friendly ones.' }),
  medi: INF({ id: 'medi', name: 'Field Medic', cost: 500, strength: 80, speed: 4, primary: 'Heal', medic: true, owner: ['allies'], prereq: ['tent'], description: 'Heals nearby wounded infantry.' }),
  e7:   INF({ id: 'e7', name: 'Tanya', cost: 1200, strength: 100, speed: 5, sight: 6, primary: 'Colt45', c4: true, hero: true, owner: ['allies'], prereq: ['tent', 'atek'], description: 'Commando. Deadly against infantry; demolishes structures with C4.' }),
  dog:  INF({ id: 'dog', name: 'Attack Dog', cost: 200, strength: 25, speed: 9, sight: 5, primary: 'DogJaw', dog: true, owner: ['soviet'], prereq: ['kenn'], radius: 0.18, description: 'Fast scout that lunges at enemy infantry.' }),

  // ---- Vehicles
  jeep: VEH({ id: 'jeep', name: 'Ranger', cost: 600, strength: 150, armor: 'light', speed: 10, rot: 10, sight: 6, primary: 'M60mg', turret: true, tracked: false, crusher: false, owner: ['allies'], radius: 0.32, description: 'Fast scout car with a machine gun turret.' }),
  apc:  VEH({ id: 'apc', name: 'APC', cost: 800, strength: 200, speed: 10, rot: 5, sight: 5, primary: 'M60mg', owner: ['allies'], prereq: ['weap', 'tent'], passengers: 5, description: 'Armoured personnel carrier. Transports up to five infantry.' }),
  '1tnk': VEH({ id: '1tnk', name: 'Light Tank', cost: 700, strength: 300, speed: 9, rot: 5, primary: '75mm', turret: true, owner: ['allies'], radius: 0.34, description: 'Fast, lightly armed tank.' }),
  '2tnk': VEH({ id: '2tnk', name: 'Medium Tank', cost: 800, strength: 400, speed: 8, rot: 5, sight: 5, primary: '90mm', turret: true, owner: ['allies'], radius: 0.42, description: 'Allied main battle tank.' }),
  '3tnk': VEH({ id: '3tnk', name: 'Heavy Tank', cost: 950, strength: 400, speed: 7, rot: 5, sight: 5, primary: '105mm', secondary: '105mm', twinShot: true, turret: true, owner: ['soviet'], radius: 0.46, description: 'Soviet twin-barrel main battle tank.' }),
  '4tnk': VEH({ id: '4tnk', name: 'Mammoth Tank', cost: 1700, strength: 600, speed: 4, rot: 5, sight: 6, primary: '120mm', secondary: 'MammothTusk', twinShot: true, turret: true, selfHealing: true, owner: ['soviet'], prereq: ['weap', 'stek'], radius: 0.56, description: 'Massive twin-cannon tank with missile pods. Self-repairs.' }),
  arty: VEH({ id: 'arty', name: 'Artillery', cost: 600, strength: 75, armor: 'light', speed: 6, rot: 2, sight: 5, primary: '155mm', noMovingFire: true, owner: ['allies'], prereq: ['weap', 'dome'], description: 'Long-range howitzer. Devastating but fragile.' }),
  v2rl: VEH({ id: 'v2rl', name: 'V2 Rocket Launcher', cost: 700, strength: 150, armor: 'light', speed: 7, rot: 5, sight: 5, primary: 'SCUD', tracked: false, noMovingFire: true, owner: ['soviet'], prereq: ['weap', 'dome'], radius: 0.4, description: 'Fires a long-range ballistic rocket.' }),
  harv: VEH({ id: 'harv', name: 'Ore Truck', cost: 1400, strength: 600, speed: 6, rot: 5, harvester: true, prereq: ['weap', 'proc'], radius: 0.5, description: 'Harvests ore and gems and delivers them to a refinery.' }),
  mcv:  VEH({ id: 'mcv', name: 'Mobile Construction Vehicle', cost: 2500, strength: 600, armor: 'light', speed: 6, rot: 5, deploysInto: 'fact', prereq: ['weap', 'fix'], radius: 0.56, description: 'Deploys into a Construction Yard.' }),

  // ---- Aircraft
  heli: AIR({ id: 'heli', name: 'Longbow', cost: 1200, strength: 225, armor: 'heavy', speed: 16, rot: 4, primary: 'Hellfire', vtol: true, ammo: 6, owner: ['allies'], description: 'Attack helicopter armed with Hellfire missiles.' }),
  hind: AIR({ id: 'hind', name: 'Hind', cost: 1200, strength: 225, armor: 'heavy', speed: 12, rot: 4, primary: 'ChainGun', vtol: true, ammo: 12, owner: ['soviet'], description: 'Assault helicopter with a chain gun.' }),
  mig:  AIR({ id: 'mig', name: 'MiG', cost: 1200, strength: 50, speed: 20, rot: 5, primary: 'Maverick', ammo: 3, owner: ['soviet'], prereq: ['afld'], description: 'Strike jet armed with Maverick missiles.' }),
  yak:  AIR({ id: 'yak', name: 'Yak', cost: 800, strength: 60, speed: 16, rot: 5, primary: 'ChainGun', ammo: 15, owner: ['soviet'], prereq: ['afld'], description: 'Ground-attack plane with cannons.' }),
};

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

type BInit = Omit<BuildingTypeDef, 'kind' | 'buildable' | 'sight' | 'armor' | 'owner' | 'category'> &
  Partial<Pick<BuildingTypeDef, 'buildable' | 'sight' | 'armor' | 'owner' | 'category'>>;
const BLD = (b: BInit): BuildingTypeDef => ({
  kind: 'building', buildable: true, sight: 4, armor: 'wood', owner: BOTH, category: 'building', ...b,
});
const DEF = (b: BInit): BuildingTypeDef => BLD({ category: 'defense', sight: 6, armor: 'heavy', ...b });

export const BUILDINGS: Record<string, BuildingTypeDef> = {
  fact: BLD({ id: 'fact', name: 'Construction Yard', cost: 2500, strength: 1000, armor: 'heavy', size: [3, 3], power: 0, prereq: [], buildable: false, factory: 'building', sight: 5, description: 'Builds all other structures.' }),
  powr: BLD({ id: 'powr', name: 'Power Plant', cost: 300, strength: 400, size: [2, 2], power: 100, prereq: ['fact'], description: 'Generates power for your base.' }),
  apwr: BLD({ id: 'apwr', name: 'Advanced Power Plant', cost: 500, strength: 700, size: [3, 3], power: 200, prereq: ['powr', 'dome'], description: 'Generates twice the power of a standard plant.' }),
  proc: BLD({ id: 'proc', name: 'Ore Refinery', cost: 2000, strength: 900, size: [3, 3], power: -30, prereq: ['powr'], storage: 2000, freeUnit: 'harv', dock: [1, 3], description: 'Processes ore into credits. Comes with an Ore Truck.' }),
  silo: BLD({ id: 'silo', name: 'Ore Silo', cost: 150, strength: 300, size: [1, 1], power: -10, prereq: ['proc'], storage: 1500, description: 'Stores excess processed ore.' }),
  tent: BLD({ id: 'tent', name: 'Barracks', cost: 300, strength: 800, size: [2, 2], power: -20, prereq: ['powr'], owner: ['allies'], factory: 'infantry', exit: [1, 2], description: 'Trains Allied infantry.' }),
  barr: BLD({ id: 'barr', name: 'Barracks', cost: 300, strength: 800, size: [2, 2], power: -20, prereq: ['powr'], owner: ['soviet'], factory: 'infantry', exit: [1, 2], description: 'Trains Soviet infantry.' }),
  kenn: BLD({ id: 'kenn', name: 'Kennel', cost: 200, strength: 400, size: [1, 1], power: -10, prereq: ['barr'], owner: ['soviet'], factory: 'infantry', factoryOnly: ['dog'], exit: [0, 1], description: 'Trains attack dogs.' }),
  weap: BLD({ id: 'weap', name: 'War Factory', cost: 2000, strength: 1000, armor: 'light', size: [3, 3], power: -30, prereq: ['proc'], factory: 'vehicle', exit: [1, 3], description: 'Produces vehicles.' }),
  dome: BLD({ id: 'dome', name: 'Radar Dome', cost: 1000, strength: 1000, size: [2, 2], power: -40, prereq: ['proc'], radar: true, requiresPower: true, sight: 10, description: 'Provides the radar minimap.' }),
  fix:  BLD({ id: 'fix', name: 'Service Depot', cost: 1200, strength: 800, armor: 'heavy', size: [3, 3], power: -30, prereq: ['weap'], repairPad: true, passable: [[1, 1], [0, 2], [1, 2], [2, 2]], description: 'Repairs vehicles parked on its pad.' }),
  atek: BLD({ id: 'atek', name: 'Allied Tech Center', cost: 1500, strength: 400, size: [2, 2], power: -200, prereq: ['weap', 'dome'], owner: ['allies'], description: 'Unlocks advanced Allied technology.' }),
  stek: BLD({ id: 'stek', name: 'Soviet Tech Center', cost: 1500, strength: 600, size: [3, 3], power: -100, prereq: ['weap', 'dome'], owner: ['soviet'], description: 'Unlocks advanced Soviet technology.' }),
  hpad: BLD({ id: 'hpad', name: 'Helipad', cost: 1500, strength: 800, size: [2, 2], power: -10, prereq: ['dome'], factory: 'aircraft', factoryOnly: ['heli', 'hind'], description: 'Builds and rearms helicopters.' }),
  afld: BLD({ id: 'afld', name: 'Airfield', cost: 600, strength: 1000, armor: 'heavy', size: [3, 2], power: -30, prereq: ['dome'], owner: ['soviet'], factory: 'aircraft', factoryOnly: ['mig', 'yak'], description: 'Builds and rearms Soviet aircraft.' }),
  mslo: BLD({ id: 'mslo', name: 'Missile Silo', cost: 2500, strength: 400, armor: 'heavy', size: [2, 1], power: -100, prereq: ['stek|atek'], superweapon: 'nuke', superCharge: 300, requiresPower: true, description: 'Launches a devastating atomic missile.' }),
  iron: BLD({ id: 'iron', name: 'Iron Curtain', cost: 2800, strength: 400, size: [2, 2], power: -200, prereq: ['stek'], owner: ['soviet'], superweapon: 'ironcurtain', superCharge: 240, requiresPower: true, description: 'Makes a group of units invulnerable for a short time.' }),
  pdox: BLD({ id: 'pdox', name: 'Chronosphere', cost: 2800, strength: 400, size: [2, 2], power: -200, prereq: ['atek'], owner: ['allies'], superweapon: 'chrono', superCharge: 240, requiresPower: true, description: 'Teleports a vehicle anywhere on the battlefield.' }),

  // ---- Defenses
  pbox: DEF({ id: 'pbox', name: 'Pillbox', cost: 400, strength: 400, armor: 'wood', size: [1, 1], power: -15, prereq: ['tent'], owner: ['allies'], primary: 'Vulcan', description: 'Machine-gun bunker. Shreds infantry.' }),
  gun:  DEF({ id: 'gun', name: 'Turret', cost: 600, strength: 500, size: [1, 1], power: -40, prereq: ['tent'], owner: ['allies'], primary: 'TurretGun', turret: true, sight: 7, description: 'Anti-armour cannon turret.' }),
  agun: DEF({ id: 'agun', name: 'AA Gun', cost: 600, strength: 400, size: [1, 1], power: -50, prereq: ['dome'], owner: ['allies'], primary: 'ZSU-23', turret: true, description: 'Anti-aircraft flak cannon.' }),
  ftur: DEF({ id: 'ftur', name: 'Flame Tower', cost: 600, strength: 400, size: [1, 1], power: -20, prereq: ['barr'], owner: ['soviet'], primary: 'FireballLauncher', description: 'Hurls fireballs at nearby enemies.' }),
  tsla: DEF({ id: 'tsla', name: 'Tesla Coil', cost: 1500, strength: 400, size: [1, 2], power: -150, prereq: ['weap'], owner: ['soviet'], primary: 'TeslaZap', requiresPower: true, sight: 8, description: 'Fires devastating bolts of lightning. Requires power.' }),
  // walls: placed in lines, block movement, only explosive warheads (Wall=yes) damage them
  sbag: DEF({ id: 'sbag', name: 'Sandbags', cost: 25, strength: 150, armor: 'wood', size: [1, 1], power: 0, prereq: ['fact'], owner: ['allies'], wall: true, sight: 1, description: 'Cheap sandbag wall. Drag to build a line. Blocks movement.' }),
  barb: DEF({ id: 'barb', name: 'Barbed Wire', cost: 25, strength: 100, armor: 'wood', size: [1, 1], power: 0, prereq: ['fact'], owner: ['soviet'], wall: true, sight: 1, description: 'Barbed-wire barrier. Drag to build a line. Blocks movement.' }),
  brik: DEF({ id: 'brik', name: 'Concrete Wall', cost: 100, strength: 500, armor: 'concrete', size: [1, 1], power: 0, prereq: ['fact', 'weap'], wall: true, sight: 1, description: 'Heavy concrete wall. Drag to build a line. Only explosives breach it.' }),
  sam:  DEF({ id: 'sam', name: 'SAM Site', cost: 750, strength: 400, size: [2, 1], power: -20, prereq: ['dome'], owner: ['soviet'], primary: 'Nike', turret: true, description: 'Surface-to-air missile launcher.' }),
};

export function getType(id: string): TypeDef {
  const t = UNITS[id] ?? BUILDINGS[id];
  if (!t) throw new Error(`Unknown type ${id}`);
  return t;
}
export const isBuildingType = (t: TypeDef): t is BuildingTypeDef => t.kind === 'building';

// ---------------------------------------------------------------------------
// Unit conversions & global tuning
// ---------------------------------------------------------------------------

/** Original game logic rate. */
export const RA_TICKS_PER_SECOND = 15;
/** Global pace multiplier for movement (1 = original). Modern players like it a bit snappier. */
export const MOVE_SPEED_SCALE = 1.35;
/** Seconds to build 1000 credits worth with one factory at full power. */
export const BUILD_SECONDS_PER_1000 = 16;

export const raTicksToSeconds = (ticks: number) => ticks / RA_TICKS_PER_SECOND;
/** MPH (0..100) => cells per second. 256 leptons/cell, MPH*256/100 leptons/tick. */
export const mphToCellsPerSecond = (mph: number) => (mph * 256 / 100) * RA_TICKS_PER_SECOND / 256 * MOVE_SPEED_SCALE;
/** RA ROT (facing steps per tick, 256 per revolution) => radians per second. */
export const rotToRadPerSecond = (rot: number) => rot * RA_TICKS_PER_SECOND * (Math.PI * 2 / 256) * 1.6;

/** Value of one "bail" of ore / gems. Harvester holds BAIL_COUNT bails. */
export const GOLD_VALUE = 25;
export const GEM_VALUE = 50;
export const BAIL_COUNT = 28;
export const REFUND_PERCENT = 0.5;
export const REPAIR_PERCENT = 0.2;
/** Building health fraction at/below which an engineer captures instead of damaging. */
export const ENGINEER_CAPTURE_LEVEL = 0.25;
export const ENGINEER_DAMAGE = 1 / 3;
export const CONDITION_YELLOW = 0.5;
export const CONDITION_RED = 0.25;
