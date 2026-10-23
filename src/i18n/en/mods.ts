/**
 * Mods: the Mods screen (src/mods/ui.ts), the "Modded" markers (src/mods/index.ts) and the mod checker's
 * messages (src/mods/messages.ts: the engine reports a code + parameters, the screen translates them).
 * Field names, ids and file-format fragments in the messages are code: keep them as they are.
 */
import { strings } from '../core';
import { MOD_ISSUES, MOD_WHY } from '../../mods/messages';

export default strings('mods', {
  /** Mod checker messages: {got} a value from the file, {id} an id, {table} a word from tableWord, {hint} a "did you mean" (or nothing). */
  issue: MOD_ISSUES,
  /** Why a field is read-only. */
  why: MOD_WHY,
  /** The changed field in the mod preview (the file's field name stays in a tooltip; other fields show as written). */
  field: {
    cost: 'Cost',
    speed: 'Speed',
    strength: 'Health',
    armor: 'Armour',
    sight: 'Sight',
    range: 'Range',
    damage: 'Damage',
    rof: 'Reload time',
    power: 'Power',
    ammo: 'Ammo',
    burst: 'Burst',
    minRange: 'Minimum range',
    rot: 'Turn rate',
    passengers: 'Passengers',
    spread: 'Blast spread',
    storage: 'Ore storage',
  },
  /** The {table} word in the checker messages. */
  tableWord: {
    unit: 'unit',
    structure: 'structure',
    weapon: 'weapon',
    warhead: 'warhead',
    type: 'type',
  },
  screen: {
    kicker: 'RULES WORKSHOP',
    title: 'MODS',
    // header summary: "{n} ACTIVE" in bold over "RULE SET 1A2B3C4D"
    active: '{n} ACTIVE',
    ruleSet: 'RULE SET {hash}',
    conflict: 'CONFLICT',
    conflictSub: 'ENABLED MODS DO NOT VALIDATE',
    baseRules: 'BASE RULES',
    noMods: 'NO MODS ACTIVE',
    import: 'Import mod',
    installed: 'INSTALLED',
    examples: 'EXAMPLES',
    empty: 'No mods installed yet.',
    // {file} is the file extension .rhmod.json (shown as code)
    emptyHint: 'Import a {file} file or install an example below.',
    help: 'Mods change unit, structure, weapon and warhead rules for [b]new[/b] matches. Saves and replays remember the mods they were played with.',
    // {format} is a sample of the file format (shown as code)
    format: 'Format: {format} — see public/mods for examples.',
    activeSet: 'ACTIVE RULE SET',
    enabled: '{n} ENABLED',
    combined: '{n, plural, one {COMBINED (# MOD, IN ORDER)} other {COMBINED (# MODS, IN ORDER)}}',
    combinedSummary: '{changes, plural, one {# change} other {# changes}}, {added, plural, one {# new variant} other {# new variants}}',
    hash: 'hash',
  },
  card: {
    enable: 'Enable',
    disable: 'Disable',
    changes: '{n, plural, one {# CHANGE} other {# CHANGES}}',
    changesActive: '{n, plural, one {# CHANGE} other {# CHANGES}} · ACTIVE #{pos}',
    errors: '{n, plural, one {# ERROR} other {# ERRORS}}',
    earlier: 'Apply earlier',
    later: 'Apply later',
    export: 'Export',
    remove: 'Remove',
    install: 'Install',
    confirmRemove: 'Remove the mod "{name}"?',
  },
  changes: {
    variants: 'NEW VARIANTS',
    // a new variant: its id and the type it copies
    copyOf: '{id} · copy of {name}',
    // heading of a table's changes, e.g. "UNITS · 3 changes"
    head: '{table} · {n, plural, one {# change} other {# changes}}',
    none: 'No changes.',
  },
  // rule tables (headings in capitals, and one entry of each)
  table: {
    units: 'UNITS',
    buildings: 'STRUCTURES',
    weapons: 'WEAPONS',
    warheads: 'WARHEADS',
    unit: 'Unit',
    building: 'Structure',
    weapon: 'Weapon',
    warhead: 'Warhead',
  },
  file: {
    tooLarge: 'File too large for a mod (2 MB max).',
    invalidJson: 'Not a mod file (invalid JSON).',
    installed: 'Installed "{name}". Enable it to use it in new matches.',
    updated: 'Updated "{name}". Enable it to use it in new matches.',
    installedEnabled: 'Installed and enabled "{name}".',
  },
  marker: {
    // corner tags on build cards (capitals)
    newTag: 'NEW',
    modTag: 'MOD',
    moddedBy: 'Modded by {mods}',
    variantHead: 'Mod variant · {mods}',
    moddedHead: 'Modded · {mods}',
    badge: 'Modded',
    badgeTip: 'Rules changed by mods (set {hash}); saves and replays of this match keep these rules.',
    chip: 'MODDED',
    chipTip: 'These mods change the rules of the next match. Click to manage mods.',
    // the rule changes of the skirmish mutators, shown as a mod: {names} = the mutators' names
    mutators: 'Mutators: {names}',
  },
});
