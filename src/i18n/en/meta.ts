/**
 * Progression layer strings (src/meta/**): XP breakdown lines, medal / promotion / contract / unlock toasts, the
 * post-battle XP card, cosmetic unlock requirements, the rank badge and battle report highlights.
 * Medal, contract, cosmetic and rank names come from the game data (dt(): achievement.*, contract.*, cosmetic.*, rank.*).
 */
import { liveStrings, sourceStrings, strings } from '../core';

export default strings('meta', {
  /** Unit of experience points ("+250 XP"). */
  xpUnit: 'XP',
  /** XP breakdown lines (post-battle card and results screen). */
  xp: {
    combat: 'Combat experience',
    victory: 'Victory',
    victoryDiff: 'Victory · {difficulty}',
    // {n} = number of opponents beaten
    victoryMany: 'Victory x{n}',
    victoryDiffMany: 'Victory · {difficulty} x{n}',
    survival: 'Survival · {n, plural, one {# wave} other {# waves}}',
    bosses: 'Boss waves destroyed',
    personalBest: 'New personal best',
    mission: 'Mission complete · {n, plural, one {# star} other {# stars}}',
    firstCompletion: 'First completion',
    newStars: 'New stars',
    daily: 'Daily Challenge',
    streak: 'Streak bonus · {n, plural, one {# day} other {# days}}',
    dailyReplay: 'Daily Challenge (replay)',
    dailyAttempt: 'Daily Challenge attempt',
    contracts: 'Contracts',
    medals: 'Medals',
    kills: 'Enemies destroyed',
  },
  /** Medal tiers. */
  tier: { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' },
  rarity: { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' },
  cadence: { daily: 'Daily', weekly: 'Weekly' },
  /** Toasts (top-centre) and their notification texts. */
  toast: {
    promotion: 'Promotion',
    contract: 'Contract complete',
    contractTier: 'Contract complete · {tier}',
    unlocked: 'Unlocked',
    unlockedTier: 'Unlocked · {tier}',
    medal: 'Medal unlocked',
    medalTier: 'Medal unlocked · {tier}',
    promoted: 'Promoted for valour. Next: {rank} at {xp} XP',
    topRank: 'The highest rank a commander can hold.',
    contractDesc: '{desc} +{n, plural, one {# Commendation} other {# Commendations}}.',
    moreUnlocks: '{n, plural, one {# more unlock} other {# more unlocks}}',
    moreUnlocksDesc: 'Open the Locker to see everything you earned.',
  },
  /** Post-battle XP card (bottom-right). */
  card: {
    serviceRecord: 'Service record',
    victory: 'Victory',
    debrief: 'Debrief',
    // the top rank: no next rank to show progress towards
    max: 'MAX',
    promotedTo: 'Promoted to {rank}',
    contracts: 'Contracts',
    commendations: '+{n, plural, one {# Commendation} other {# Commendations}}',
    complete: 'Complete',
    unlocked: 'Unlocked: [b]{items}[/b]',
    next: 'Next: [b]{text}[/b]',
  },
  /** Main-menu commander badge. */
  badge: {
    title: 'Commander profile',
    progress: '{xp} / {next} XP',
    max: '{xp} XP · max rank',
  },
  /** What a cosmetic takes to unlock (Locker, results screen, teasers). */
  unlock: {
    standard: 'Standard issue',
    rankHow: 'Reach the rank of {rank}',
    rankNeed: '{xp} XP to {rank}',
    winsHow: 'Win {n, plural, one {# battle} other {# battles}}',
    winsNeed: '{n, plural, one {# more win} other {# more wins}}',
    gamesHow: 'Fight {n, plural, one {# battle} other {# battles}}',
    gamesNeed: '{n, plural, one {# more battle} other {# more battles}}',
    contractsHow: 'Complete {n, plural, one {# contract} other {# contracts}}',
    contractsNeed: '{n, plural, one {# more contract} other {# more contracts}}',
    streakHow: 'Reach a {n}-day Daily Challenge streak',
    streakNeed: 'a {n}-day daily streak (best {best})',
    renownHow: 'Earn {n} Conquest renown',
    renownNeed: '{n} more Conquest renown',
    medalHow: 'Earn the {medal} medal',
    medalTierHow: 'Earn the {medal} ({tier}) medal',
    medalSecretHow: 'Earn a classified medal',
    medalNeed: 'the {medal} medal',
    medalTierNeed: 'the {medal} ({tier}) medal',
    medalSecretNeed: 'a classified medal',
    medalProgress: '{medal} medal ({cur}/{target})',
    medalTierProgress: '{medal} ({tier}) medal ({cur}/{target})',
    cmdHow: 'Claim with {n, plural, one {# Commendation} other {# Commendations}}',
    cmdReady: 'ready to claim in the Locker',
    cmdNeed: '{n, plural, one {# more Commendation} other {# more Commendations}}',
    /** The next unlock to chase: "2 more wins → Arctic White paint". */
    teaser: '{need} → {item}',
    teaserReady: '{item}: {need}',
  },
  /** A cosmetic named with its kind: "Arctic White paint", "“Tank Hunter” title". */
  item: {
    paint: '{name} paint',
    theme: '{name} HUD theme',
    portrait: '{name} portrait',
    title: '“{name}” title',
    banner: '{name} banner',
    voice: '{name} announcer',
    fanfare: '{name} fanfare',
  },
  /** Battle report highlights (results screen). */
  report: {
    firstBlood: 'First blood',
    nuke: 'Atomic strike launched',
    elite: 'First Elite: {unit}',
    captured: 'Captured {building}',
    capturedUnknown: 'Captured a structure',
    chrono: 'Chronoshifted a {unit}',
    overrun: 'Your forces were overrun',
    eliminated: '{player} eliminated',
    peak: 'Peak army {money}',
    clash: 'Biggest clash: {n} lost in {s} s',
    comeback: 'Comeback from {pct} of the army strength',
  },
  /** Short money amounts: "$12k", "$12.5k". */
  moneyK: '${n}k',
});

/** Cosmetic slots (Locker tabs, unlock toasts), keys meta.slot.<slot>. */
export const SLOT_TEXT = liveStrings('meta.slot', {
  paint: 'Paint scheme',
  theme: 'HUD theme',
  portrait: 'Portrait',
  title: 'Title',
  banner: 'Banner',
  voice: 'Announcer',
  fanfare: 'Victory fanfare',
});

/**
 * Match history titles, stored in English in the profile (rh.profile) and translated where they are shown
 * (trSource).
 */
export const RECORD_SRC = sourceStrings('meta.record', {
  daily: 'Daily Challenge #{n}',
  skirmishOne: 'Skirmish · {n} AI',
  skirmishMany: 'Skirmish · {n} AIs',
  battle: 'Battle',
});
