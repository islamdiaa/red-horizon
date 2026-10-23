/**
 * Names the game makes up from word lists: the Daily Challenge's operation ("IRON HAMMER", src/meta/daily.ts), a
 * Conquest campaign's operation ("Operation Iron Tide", src/conquest/generate.ts) and the call signs of Conquest
 * veterans ("Cobra", "Cobra 47": src/conquest/data.ts CALLSIGNS). The generators keep the English (it is seeded,
 * saved and shared); the screens translate it where it is shown:
 *  - code names through trSource() (this module registers a resolver, so a code name inside other text, such as
 *    "Operation {name}", is translated too; capitals stay capitals);
 *  - call signs through callSignName() (call-sign words are ordinary words, so they are only translated where the
 *    text is known to hold a call sign: see addParamResolver below).
 * Each code name is one entry (adjective + noun), so a translation can make the words agree and order them as its
 * language does. The word lists must match the generators' (tests/i18n-generated.test.ts checks).
 */
import { addParamResolver, addSourceResolver, currentLang, hasKey, strings, translation } from '../core';

/** The Daily Challenge's words (src/meta/daily.ts ADJ x NOUN, written there in capitals). */
export const DAILY_CODE_WORDS = {
  adj: ['Iron', 'Crimson', 'Silent', 'Broken', 'Frozen', 'Burning', 'Steel', 'Midnight', 'Amber', 'Cobalt', 'Scarlet', 'Ghost', 'Thunder', 'Shattered', 'Hollow', 'Cold'],
  noun: ['Hammer', 'Tide', 'Anvil', 'Spear', 'Vigil', 'Falcon', 'Curtain', 'Tempest', 'Bastion', 'Lantern', 'Serpent', 'Wolf', 'Harvest', 'Sabre', 'Comet', 'Gambit'],
};
/** A Conquest campaign's words (src/conquest/generate.ts CODE_A x CODE_B). */
export const CONQUEST_CODE_WORDS = {
  adj: ['Iron', 'Red', 'Northern', 'Steel', 'Thunder', 'Crimson', 'Silent', 'Winter', 'Broken', 'Golden', 'Black', 'Burning', 'Distant', 'Last', 'Grey'],
  noun: ['Tide', 'Dawn', 'Hammer', 'Storm', 'Lance', 'Anvil', 'Gale', 'Spear', 'Horizon', 'Citadel', 'Avalanche', 'Sabre', 'Harvest', 'Bastion', 'Rampart'],
};

const op: Record<string, Record<string, string>> = {};
for (const w of [DAILY_CODE_WORDS, CONQUEST_CODE_WORDS]) {
  for (const a of w.adj) for (const n of w.noun) (op[a.toLowerCase()] ??= {})[n.toLowerCase()] = `${a} ${n}`;
}

const callsign = {
  anvil: 'Anvil', bulldog: 'Bulldog', cobra: 'Cobra', dagger: 'Dagger', echo: 'Echo', falcon: 'Falcon', granite: 'Granite', hammer: 'Hammer',
  iron: 'Iron', jackal: 'Jackal', kodiak: 'Kodiak', lancer: 'Lancer', mauler: 'Mauler', nomad: 'Nomad', onyx: 'Onyx', phantom: 'Phantom',
  quarry: 'Quarry', ranger: 'Ranger', sabre: 'Sabre', tempest: 'Tempest', undertow: 'Undertow', viper: 'Viper', warden: 'Warden', xray: 'Xray',
  yukon: 'Yukon', zealot: 'Zealot', badger: 'Badger', comet: 'Comet', drake: 'Drake', ember: 'Ember', fury: 'Fury', ghost: 'Ghost',
  havoc: 'Havoc', jaguar: 'Jaguar', kestrel: 'Kestrel', longbow: 'Longbow', mustang: 'Mustang', nightjar: 'Nightjar', outlaw: 'Outlaw', python: 'Python',
  raven: 'Raven', spectre: 'Spectre', thunder: 'Thunder', valkyrie: 'Valkyrie', wolfhound: 'Wolfhound', zephyr: 'Zephyr',
};

strings('codename', {
  // operation code names: "Iron Hammer" (shown as "Operation Iron Hammer" / "IRON HAMMER"). Write each as the name
  // of a military operation in your language, the two words agreeing; capitals are applied where the screen needs them.
  op,
  // Conquest veterans' call signs (one word, said over the radio; "Cobra 47" when the list runs out)
  callsign,
});

/** The translation of a generated code name ("Iron Tide", "IRON HAMMER"); null when it isn't one or untranslated. */
export function codeName(english: string): string | null {
  const m = /^([A-Za-z]+) ([A-Za-z]+)$/.exec(english);
  if (!m) return null;
  const key = `codename.op.${m[1].toLowerCase()}.${m[2].toLowerCase()}`;
  const t = hasKey(key) ? translation(key) : null;
  if (!t) return null;
  return english === english.toUpperCase() ? t.toLocaleUpperCase(currentLang()) : t;
}

/** A Conquest veteran's call sign ("Cobra", "Cobra 47") in the active language; anything else unchanged. */
export function callSignName(english: string): string {
  const m = /^([A-Za-z]+)(?: (\d+))?$/.exec(english);
  const key = m ? `codename.callsign.${m[1].toLowerCase()}` : '';
  const t = m && hasKey(key) ? translation(key) : null;
  return t ? (m![2] ? `${t} ${m![2]}` : t) : english;
}
/** A list of call signs as the run joins them ("Cobra, Viper"). */
export const callSignList = (english: string): string => english.split(', ').map(callSignName).join(', ');

addSourceResolver(codeName);
// Conquest text that names veterans: {vet}, {a} {b} {c} (src/i18n/en/conquest-run.ts) and {names}
// (conquest-battle.ts) hold call signs
addParamResolver((key, param) => key.startsWith('conquest.') && ['vet', 'a', 'b', 'c', 'names'].includes(param), (v) => {
  const t = callSignList(v);
  return t === v ? null : t;
});
