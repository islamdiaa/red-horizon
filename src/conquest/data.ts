/**
 * Conquest content: commander doctrines, roguelite perks, the research tree, enemy commanders and their
 * personalities, territory resources, veteran call signs. Pure data; the rules live in run.ts / battle.ts.
 */
import type { Faction } from '../data/rules';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type ResourceKind = 'oil' | 'industry' | 'science' | 'manpower' | 'airfield' | 'port';

/** Pictogram name (src/meta/art.ts PICTO) + display info. */
interface Named {
  id: string;
  name: string;
  desc: string;
  icon: string;
}

// =====================================================================================================
// Perks (roguelite upgrade picks)
// =====================================================================================================
export interface PerkDef extends Named {
  /** Only offered to this side. */
  faction?: Faction;
  /** Meta progression: renown needed before the perk joins the pool (0 = always). */
  renown?: number;
  /** Research needed before the perk is offered. */
  needs?: string;
  /** Rarer perks are offered less often (weight, default 1). */
  weight?: number;
  /** Category tag shown on the card. */
  tag: 'Economy' | 'Production' | 'Forces' | 'Veterans' | 'Intel' | 'Strategy';
}

export const PERKS: PerkDef[] = [
  { id: 'ore_boom', name: 'Ore Boom', tag: 'Economy', icon: 'ore', desc: 'Harvesters earn 20% more in every battle.' },
  { id: 'war_bonds', name: 'War Bonds', tag: 'Economy', icon: 'coin', desc: 'Start every battle with $1,500 extra.' },
  { id: 'scavengers', name: 'Scavengers', tag: 'Economy', icon: 'crate', desc: 'Salvage crews pay $75 per enemy unit and $250 per structure destroyed.' },
  { id: 'lend_lease', name: 'Lend-Lease', tag: 'Economy', icon: 'money', desc: '+$1,000 to the war chest every turn.' },
  { id: 'cheap_navy', name: 'Cheaper Naval Yards', tag: 'Production', icon: 'anchor', desc: 'Shipyards, Sub Pens and warships cost 35% less (refunded on completion).' },
  { id: 'assembly_rush', name: 'Rapid Assembly', tag: 'Production', icon: 'gear', desc: 'All production is 20% faster.' },
  { id: 'drill_sergeants', name: 'Drill Sergeants', tag: 'Production', icon: 'helmet', desc: 'Newly trained infantry start as veterans.', renown: 150 },
  { id: 'tank_aces', name: 'Tank Aces', tag: 'Production', icon: 'tank', desc: 'Newly built tanks start as veterans.', renown: 600, weight: 0.7 },
  { id: 'elite_paratroopers', name: 'Elite Paratroopers', tag: 'Forces', icon: 'parachute', desc: 'Two sticks of elite paratroopers reinforce you in every battle (1:30 and 6:00).' },
  { id: 'armoured_spearhead', name: 'Armoured Spearhead', tag: 'Forces', icon: 'mammoth', desc: 'Start every battle with two extra battle tanks.' },
  { id: 'forward_outpost', name: 'Tesla Outpost', faction: 'soviet', tag: 'Forces', icon: 'bolt', desc: 'Start every battle with a powered Tesla Coil guarding your landing zone.' },
  { id: 'forward_outpost', name: 'Fortified Bridgehead', faction: 'allies', tag: 'Forces', icon: 'tower', desc: 'Start every battle with a Turret, two Pillboxes and a Power Plant.' },
  { id: 'commandos', name: 'Commando Insertion', faction: 'allies', tag: 'Forces', icon: 'pistol', desc: 'Tanya joins every battle.' },
  { id: 'commandos', name: 'Shock Squad', faction: 'soviet', tag: 'Forces', icon: 'flames', desc: 'A flamethrower squad and attack dogs join every battle.' },
  { id: 'engineer_corps', name: 'Engineer Corps', tag: 'Forces', icon: 'capture', desc: 'Start every battle with three engineers.' },
  { id: 'hardened_core', name: 'Hardened Core', tag: 'Veterans', icon: 'shield', desc: '+3 core army slots.' },
  { id: 'field_promotions', name: 'Field Promotions', tag: 'Veterans', icon: 'chevrons', desc: 'Surviving core units gain a rank after every victory.', renown: 300 },
  { id: 'iron_will', name: 'Iron Will', tag: 'Veterans', icon: 'ironwill', desc: '+1 morale now, and +1 maximum morale.' },
  { id: 'recon_flights', name: 'Recon Flights', tag: 'Intel', icon: 'eye', desc: 'Battles begin with the enemy base photographed.' },
  { id: 'spy_network', name: 'Spy Network', tag: 'Intel', icon: 'spy', desc: 'Strike where it hurts: enemy garrisons fight one level weaker.', renown: 450, weight: 0.8 },
  { id: 'blitzkrieg', name: 'Blitzkrieg', tag: 'Strategy', icon: 'stopwatch', desc: 'Victories under par time pay $2,000 and 1 research point.' },
  { id: 'fortified_lines', name: 'Fortified Lines', tag: 'Strategy', icon: 'wall', desc: 'Undefended territories repel counterattacks half the time; defence battles start with extra defences.' },
  { id: 'plunder', name: 'Spoils of War', tag: 'Strategy', icon: 'trophy', desc: 'Captured territories yield 50% more loot.' },
  { id: 'partisans', name: 'Partisan Contacts', tag: 'Strategy', icon: 'flag', desc: 'Risky gambles in events succeed more often; partisans join your attacks.', renown: 200 },
  { id: 'superweapon_priority', name: 'Superweapon Priority', tag: 'Production', icon: 'nuke', desc: 'Your superweapons start every battle 40% charged.', needs: 'superweapons', weight: 0.8 },
];

/** The perk definition for a side (two perks share an id with faction variants). */
export function perkDef(id: string, faction: Faction): PerkDef | undefined {
  return PERKS.find((p) => p.id === id && (!p.faction || p.faction === faction)) ?? PERKS.find((p) => p.id === id);
}

// =====================================================================================================
// Doctrines (starting choice)
// =====================================================================================================
export interface DoctrineDef extends Named {
  /** Perks granted at the start of the run. */
  perks: string[];
  /** Research completed at the start. */
  research: string[];
  /** Extra starting war chest / research points. */
  credits?: number;
  rp?: number;
  /** Veterans in the starting core army ([type per side] x rank). */
  core?: { allies: string; soviet: string; rank: number }[];
  /** Meta progression: renown needed to pick it (0 = available from the start). */
  renown: number;
}

export const DOCTRINES: DoctrineDef[] = [
  { id: 'combined_arms', name: 'Combined Arms', icon: 'sword', renown: 0, perks: ['armoured_spearhead'], research: [],
    desc: 'Balanced and dependable: two extra battle tanks join every battle.' },
  { id: 'logistics', name: 'Logistics Corps', icon: 'ore', renown: 0, perks: ['ore_boom'], research: [], credits: 4000,
    desc: 'Wars are won by supply: +$4,000 war chest and harvesters earn 20% more.' },
  { id: 'vanguard', name: 'Vanguard', icon: 'chevrons', renown: 0, perks: [], research: [],
    core: [{ allies: '2tnk', soviet: '3tnk', rank: 1 }, { allies: '2tnk', soviet: '3tnk', rank: 1 }, { allies: 'e3', soviet: 'e3', rank: 1 }, { allies: 'e3', soviet: 'e3', rank: 1 }, { allies: 'jeep', soviet: 'v2rl', rank: 2 }],
    desc: 'Start with a core army of five veterans, one of them elite.' },
  { id: 'airborne', name: 'Airborne Doctrine', icon: 'parachute', renown: 250, perks: ['elite_paratroopers'], research: ['airborne'],
    desc: 'Elite paratroopers and an extra veteran drop in every battle.' },
  { id: 'fortress', name: 'Fortress Doctrine', icon: 'tower', renown: 600, perks: ['forward_outpost', 'fortified_lines'], research: [],
    desc: 'Every landing zone is fortified, and your lines hold against counterattacks.' },
  { id: 'admiralty', name: 'Admiralty', icon: 'anchor', renown: 1000, perks: ['cheap_navy'], research: ['naval'],
    desc: 'Naval Yards researched from the start, and cheaper fleets.' },
  { id: 'deep_strike', name: 'Deep Strike', icon: 'eye', renown: 1600, perks: ['recon_flights', 'spy_network'], research: [], rp: 2,
    desc: 'Know your enemy: recon photos of every enemy base, weaker garrisons and 2 research points.' },
  { id: 'scientific', name: 'Scientific Directorate', icon: 'chart', renown: 2500, perks: [], research: ['techcenter', 'power'], rp: 4,
    desc: 'Advanced labs and power from the start, plus 4 research points.' },
];

// =====================================================================================================
// Research tree
// =====================================================================================================
export interface ResearchDef extends Named {
  cost: number;
  /** Prerequisite projects. */
  needs?: string[];
  /** Type ids unlocked for the human (missing ids, e.g. Aftermath units not in the rules yet, are ignored). */
  unlocks?: string[];
  faction?: Faction;
}

export const RESEARCH: ResearchDef[] = [
  { id: 'power', name: 'Advanced Power Grid', icon: 'lightning', cost: 1, unlocks: ['apwr'], desc: 'Advanced Power Plants.' },
  { id: 'engineering', name: 'Combat Engineering', icon: 'wall', cost: 1, unlocks: ['brik', 'mnly', 'hbox', 'facf', 'weaf', 'syrf', 'spef'], desc: 'Concrete walls, minelayers, camouflaged pillboxes and decoys.' },
  { id: 'artillery', name: 'Artillery Doctrine', icon: 'target', cost: 2, unlocks: ['arty', 'v2rl'], desc: 'Artillery (Allies) and V2 rocket launchers (Soviets).' },
  { id: 'techcenter', name: 'Advanced Research Labs', icon: 'chart', cost: 2, unlocks: ['atek', 'stek'], desc: 'Tech Centers: the gateway to the most advanced equipment.' },
  { id: 'air', name: 'Air Wing', icon: 'plane', cost: 3, unlocks: ['hpad', 'afld', 'heli', 'hind', 'mig', 'yak', 'tran'], desc: 'Helipads, airfields and combat aircraft.' },
  { id: 'naval', name: 'Naval Yards', icon: 'anchor', cost: 2, unlocks: ['syrd', 'spen', 'pt', 'dd', 'ss', 'lst'], desc: 'Shipyards and Sub Pens with gunboats, destroyers, submarines and transports.' },
  { id: 'capital_ships', name: 'Capital Ships', icon: 'periscope', cost: 2, needs: ['naval', 'techcenter'], unlocks: ['ca', 'msub'], desc: 'Cruisers (Allies) and missile submarines (Soviets).' },
  { id: 'mammoth', name: 'Heavy Armour Programme', icon: 'mammoth', cost: 3, needs: ['techcenter'], faction: 'soviet', unlocks: ['4tnk', 'qtnk', 'dtrk'], desc: 'Mammoth Tanks, M.A.D. tanks and demolition trucks.' },
  { id: 'tesla', name: 'Tesla Technology', icon: 'bolt', cost: 3, faction: 'soviet', unlocks: ['tsla', 'ttnk', 'shok'], desc: 'Tesla Coils, Tesla Tanks and Shock Troopers.' },
  { id: 'special_forces', name: 'Special Forces', icon: 'spy', cost: 2, needs: ['techcenter'], faction: 'allies', unlocks: ['e7', 'spy', 'thf'], desc: 'Tanya, spies and thieves.' },
  { id: 'electronic', name: 'Chrono & Electronic Warfare', icon: 'chrono', cost: 3, faction: 'allies', unlocks: ['gap', 'mgg', 'mrj', 'ctnk', 'stnk'], desc: 'Gap generators, radar jammers, Chrono Tanks and Phase Transports.' },
  { id: 'superweapons', name: 'Strategic Weapons', icon: 'nuke', cost: 4, needs: ['techcenter'], unlocks: ['mslo', 'iron', 'pdox'], desc: 'Missile Silo plus the Iron Curtain or the Chronosphere.' },
  { id: 'ore_refining', name: 'Ore Refining', icon: 'ore', cost: 2, desc: 'Harvest income +15% in every battle.' },
  { id: 'assembly', name: 'Assembly Lines', icon: 'gear', cost: 2, desc: 'Production speed +15% in every battle.' },
  { id: 'logistics_net', name: 'Logistics Network', icon: 'money', cost: 2, desc: '+$750 to the war chest every turn.' },
  { id: 'academy', name: 'Officer Academy', icon: 'helmet', cost: 2, desc: '+3 core army slots.' },
  { id: 'field_recovery', name: 'Field Recovery Teams', icon: 'crate', cost: 3, needs: ['academy'], desc: 'Fallen core veterans are recovered half the time (one rank lower).' },
  { id: 'airborne', name: 'Airborne Command', icon: 'parachute', cost: 2, desc: 'A veteran paratrooper stick reinforces you 2:30 into every battle.' },
];

/** Type ids locked until researched (only for the human; the enemy builds whatever its tech allows). */
export const LOCKED_TYPES = new Set(RESEARCH.flatMap((r) => r.unlocks ?? []));

// =====================================================================================================
// Territory resources
// =====================================================================================================
export const RESOURCES: Record<ResourceKind, { name: string; icon: string; desc: string }> = {
  oil: { name: 'Oil fields', icon: 'fire', desc: '+$600 to the war chest every turn.' },
  industry: { name: 'Industry', icon: 'gear', desc: '+5% production speed in battle (up to +20%).' },
  science: { name: 'Research institute', icon: 'chart', desc: '+1 research point every turn.' },
  manpower: { name: 'Manpower', icon: 'helmet', desc: '+1 core army slot.' },
  airfield: { name: 'Airbase', icon: 'plane', desc: 'A paratrooper stick joins every battle (max 2).' },
  port: { name: 'Naval port', icon: 'anchor', desc: '+$300 every turn; naval battles start with two warships.' },
};

// =====================================================================================================
// Enemy commanders and personalities
// =====================================================================================================
export type PersonalityId = 'steamroller' | 'siege' | 'air' | 'fortress' | 'blitz' | 'naval' | 'horde' | 'raider';

export interface PersonalityDef {
  id: PersonalityId;
  name: string;
  desc: string;
  icon: string;
  /** Counterattack eagerness multiplier. */
  aggression: number;
  /** Matching commander personality of the strategic AI (src/sim/ai-personality.ts), applied when supported. */
  ai: string;
}

export const PERSONALITIES: Record<PersonalityId, PersonalityDef> = {
  steamroller: { id: 'steamroller', name: 'Iron Fist', icon: 'mammoth', aggression: 1.2, ai: 'ironfist', desc: 'Massed heavy armour. Expect crushing tank columns.' },
  siege: { id: 'siege', name: 'Siege Master', icon: 'target', aggression: 0.9, ai: 'siege', desc: 'Artillery and rocket batteries pound your base from range.' },
  air: { id: 'air', name: 'Air Marshal', icon: 'plane', aggression: 1, ai: 'airmarshal', desc: 'Air raids on your economy. Build anti-air early.' },
  fortress: { id: 'fortress', name: 'Iron Wall', icon: 'wall', aggression: 0.7, ai: 'turtle', desc: 'Heavily fortified bases and few attacks, but a deadly late game.' },
  blitz: { id: 'blitz', name: 'Armour Rusher', icon: 'stopwatch', aggression: 1.4, ai: 'rusher', desc: 'Fast, early tank raids. Do not be caught napping.' },
  naval: { id: 'naval', name: 'Admiral', icon: 'anchor', aggression: 1, ai: 'admiral', desc: 'Strong fleets and shore bombardment on coastal fronts.' },
  horde: { id: 'horde', name: 'Human Wave', icon: 'helmet', aggression: 1.3, ai: 'horde', desc: 'Endless infantry assaults. Flame and machine guns are your friends.' },
  raider: { id: 'raider', name: 'Guerrilla', icon: 'paw', aggression: 1.1, ai: 'guerrilla', desc: 'Raids on harvesters and outposts; never where you expect.' },
};

export const COMMANDERS: Record<Faction, { name: string; personality: PersonalityId }[]> = {
  soviet: [
    { name: 'Marshal Krukov', personality: 'steamroller' },
    { name: 'General Volkov', personality: 'siege' },
    { name: 'Colonel Nadia Petrova', personality: 'air' },
    { name: 'General Ostrov', personality: 'fortress' },
    { name: 'Major Dragunov', personality: 'blitz' },
    { name: 'Admiral Gorshin', personality: 'naval' },
    { name: 'Commissar Lebedev', personality: 'horde' },
  ],
  allies: [
    { name: 'General Stavros', personality: 'fortress' },
    { name: 'Commander Bennett', personality: 'air' },
    { name: 'Major Kane', personality: 'blitz' },
    { name: 'General Carville', personality: 'siege' },
    { name: 'Field Marshal Hale', personality: 'steamroller' },
    { name: 'Admiral Whitcombe', personality: 'naval' },
    { name: 'Colonel Duval', personality: 'raider' },
  ],
};

/** The enemy capital's supreme commander (the boss battle). */
export const SUPREME: Record<Faction, { name: string; personality: PersonalityId }> = {
  soviet: { name: 'General Morozov', personality: 'steamroller' },
  allies: { name: 'Field Marshal Rourke', personality: 'fortress' },
};

/** Unit pools per enemy side and personality (scripted waves and starting garrisons). */
export const ENEMY_POOLS: Record<Faction, { inf: string[]; armour: string[]; light: string[]; arty: string[]; air: string[]; navy: string[]; heavy: string[] }> = {
  soviet: { inf: ['e1', 'e1', 'e2', 'e3', 'e4', 'dog'], armour: ['3tnk', '3tnk'], light: ['3tnk', 'e1', 'dog'], arty: ['v2rl'], air: ['mig', 'yak', 'hind'], navy: ['ss', 'ss'], heavy: ['4tnk'] },
  allies: { inf: ['e1', 'e1', 'e3', 'e3', 'medi'], armour: ['2tnk', '2tnk', '1tnk'], light: ['jeep', '1tnk'], arty: ['arty'], air: ['heli'], navy: ['dd', 'pt'], heavy: ['2tnk'] },
};

// =====================================================================================================
// Veteran call signs
// =====================================================================================================
export const CALLSIGNS = [
  'Anvil', 'Bulldog', 'Cobra', 'Dagger', 'Echo', 'Falcon', 'Granite', 'Hammer', 'Iron', 'Jackal', 'Kodiak', 'Lancer', 'Mauler', 'Nomad', 'Onyx', 'Phantom',
  'Quarry', 'Ranger', 'Sabre', 'Tempest', 'Undertow', 'Viper', 'Warden', 'Xray', 'Yukon', 'Zealot', 'Badger', 'Comet', 'Drake', 'Ember', 'Fury', 'Ghost',
  'Havoc', 'Jaguar', 'Kestrel', 'Longbow', 'Mustang', 'Nightjar', 'Outlaw', 'Python', 'Raven', 'Spectre', 'Thunder', 'Valkyrie', 'Wolfhound', 'Zephyr',
];

// =====================================================================================================
// Meta progression: titles
// =====================================================================================================
export interface TitleDef { id: string; name: string; desc: string }
export const TITLES: TitleDef[] = [
  { id: 'field_commander', name: 'Field Commander', desc: 'Finish a Conquest campaign.' },
  { id: 'liberator', name: 'Liberator of Europe', desc: 'Win a Conquest campaign as the Allies.' },
  { id: 'hero_soviet', name: 'Hero of the Soviet Union', desc: 'Win a Conquest campaign as the Soviets.' },
  { id: 'iron_marshal', name: 'Iron Marshal', desc: 'Win a Conquest campaign on Hard.' },
  { id: 'conqueror', name: 'Conqueror', desc: 'Hold 18 territories at once.' },
  { id: 'old_guard', name: 'The Old Guard', desc: 'Finish a campaign with 8 elite veterans in the core army.' },
  { id: 'blitz_master', name: 'Master of Blitzkrieg', desc: 'Win a Conquest campaign in 12 turns or fewer.' },
  { id: 'veteran_commander', name: 'Veteran Commander', desc: 'Play 5 Conquest campaigns.' },
];

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
