/**
 * The mod checker's messages (src/mods/engine.ts), in English. The engine reports each problem with a code and
 * its parameters as well as the English text, so the Mods screen can show it in the player's language
 * (src/i18n/en/mods.ts registers these templates under mods.issue.*).
 *
 * Dependency-free: the engine runs in the simulation tests and on the leaderboard server.
 *
 * Parameters: {got} a value as written in the file (JSON), {id} an id, {table} one of unit, structure, weapon,
 * warhead, type, {hint} a "did you mean" suggestion (or nothing), {example} a fragment of the file format.
 */
export const MOD_ISSUES = {
  notObject: 'a mod must be a JSON object',
  format: 'expected "{want}", got {got}',
  version: 'unsupported version {got} (this build reads version {want})',
  id: 'required: lower-case letters, digits and dashes (e.g. "tank-rush")',
  name: 'required: a display name of up to 60 characters',
  mustString: 'must be a string',
  unknownSection: 'unknown section ignored{hint}',
  sectionObject: 'must be an object of id -> fields',
  scaleArray: 'must be an array of scale rules',
  readOnlyField: 'this field can\'t be modded ({why})',
  number: 'expected a number, got {got}',
  whole: 'expected a whole number, got {got}',
  atLeast: 'must be at least {min}, got {got}',
  atMost: 'must be at most {max}, got {got}',
  string: 'expected a string, got {got}',
  maxChars: 'at most {max} characters',
  bool: 'expected true or false, got {got}',
  oneOf: 'expected one of {values}; got {got}{hint}',
  sound: 'expected a weapon sound ({values}); got {got}',
  refType: 'expected a {table} id, got {got}',
  unknownRef: 'unknown {table} "{id}"{hint}',
  idArray: 'expected an array of ids, got {got}',
  idStrings: 'expected ids (strings), got {got}',
  factions: 'expected ["allies"], ["soviet"] or ["allies", "soviet"]; got {got}',
  verses: 'expected 5 multipliers (vs none, wood, light, heavy, concrete armour), each 0..10; got {got}',
  readOnly: 'read-only',
  twice: 'the mod "{id}" is in the set twice',
  patchObject: 'must be an object of field -> value',
  reservedId: 'reserved id',
  unknownClone: 'unknown {table} "{id}" to copy{hint}',
  exists: '"{id}" already exists: drop "clone" to change it, or pick a new id for the variant',
  newId: 'a new id must be 1-32 letters, digits, "-", "_" or "."',
  usedBy: '"{id}" is already used by a {table}',
  unknownEntry: 'unknown {table} "{id}"{hint}; to add a variant, set "clone" to the id it is based on',
  unknownField: 'unknown field for a {table}{hint}',
  minRange: 'must be less than the range ({range})',
  selfPrereq: 'a type cannot require itself',
  ruleObject: 'must be an object {example}',
  expected: 'expected {example}',
  numericOnly: 'only numeric fields can be scaled',
  multiplier: 'expected a multiplier between 0 and 100, got {got}',
  idsArray: 'expected an array of ids',
  noEntry: 'no {table} "{id}" in this build (skipped){hint}',
  matchesNone: 'matches no entries',
  changesNothing: 'this mod changes nothing',
  // the {hint} after an unknown name (with a space before it)
  didYouMean: '(did you mean "{s}"?)',
} as const;

export type ModIssueCode = Exclude<keyof typeof MOD_ISSUES, 'didYouMean'>;

/** Why a field is read-only ({why} of readOnlyField). */
export const MOD_WHY = {
  model: 'models and animations are built for the original type',
  behaviour: 'it selects hard-coded behaviour',
  key: 'the id is the key of the entry',
  category: 'production queues and the sidebar depend on it',
  footprint: 'the 3D model is built for the original footprint',
  structured: 'structured fields added after this mod format can only be changed by code',
  readOnly: 'read-only',
} as const;

export type ModWhy = keyof typeof MOD_WHY;

/** Fill `{name}` placeholders verbatim (no number formatting). */
export function fillIssue(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(params, k) ? params[k] : m));
}
