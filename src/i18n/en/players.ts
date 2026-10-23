/**
 * Built-in player names: the AI commanders' names and the default human names. The game and the network use the
 * English (it is part of the match setup, saved and sent to other players); the interface shows playerName(),
 * which translates these and leaves every name a player chose unchanged.
 */
import { sourceStrings, strings, trSource, translation } from '../core';

/** The AI commanders of skirmish, multiplayer and special operations (rank abbreviation and name). */
export const AI_COMMANDERS = sourceStrings('players.ai', {
  volkov: 'Gen. Volkov',
  krukov: 'Marshal Krukov',
  nadia: 'Col. Nadia',
  stavros: 'Gen. Stavros',
  // Cdr. = Commander (a naval rank)
  bennett: 'Cdr. Bennett',
  kane: 'Maj. Kane',
  // the AI allies of co-op Survival (src/missions/special.ts)
  hartmann: 'Gen. Hartmann',
  dubois: 'Col. Dubois',
});

export const DEFAULT_NAMES = sourceStrings('players.default', {
  // the player's default name (profile, skirmish, multiplayer)
  commander: 'Commander',
  // the Allied side in the main menu's background battle
  alliedCommand: 'Allied Command',
});

/** A player's name for display: a built-in name in the interface language, a chosen name as it is. */
export const playerName = (name: string): string => trSource(name);

/**
 * Conquest's enemy commanders (src/conquest/data.ts COMMANDERS and SUPREME; Marshal Krukov is above, General
 * Morozov and Field Marshal Rourke are campaign characters: src/i18n/en/campaign-cast.ts).
 */
export const CONQUEST_COMMANDERS = sourceStrings('players.conquest', {
  volkov: 'General Volkov',
  petrova: 'Colonel Nadia Petrova',
  ostrov: 'General Ostrov',
  dragunov: 'Major Dragunov',
  gorshin: 'Admiral Gorshin',
  lebedev: 'Commissar Lebedev',
  stavros: 'General Stavros',
  // a naval rank
  bennett: 'Commander Bennett',
  kane: 'Major Kane',
  carville: 'General Carville',
  hale: 'Field Marshal Hale',
  whitcombe: 'Admiral Whitcombe',
  duval: 'Colonel Duval',
});

/**
 * Rivals' first and last names (src/meta/rivals.ts FIRST and LAST; a Soviet woman's surname takes -a: Volkova).
 * Latin-script languages keep the spelling; Russian and Chinese write the names in their own script.
 */
const person = {
  first: {
    dmitri: 'Dmitri', nadia: 'Nadia', yuri: 'Yuri', katarina: 'Katarina', viktor: 'Viktor', irina: 'Irina', pavel: 'Pavel', ludmila: 'Ludmila',
    sergei: 'Sergei', olga: 'Olga', anatoly: 'Anatoly', vera: 'Vera', mikhail: 'Mikhail', tatiana: 'Tatiana', grigori: 'Grigori', zoya: 'Zoya',
    arkady: 'Arkady', yelena: 'Yelena', ivan: 'Ivan',
    marcus: 'Marcus', helena: 'Helena', pierre: 'Pierre', ingrid: 'Ingrid', thomas: 'Thomas', clara: 'Clara', henrik: 'Henrik', sophie: 'Sophie',
    james: 'James', margot: 'Margot', erik: 'Erik', lena: 'Lena', arthur: 'Arthur', freya: 'Freya', victor: 'Victor', rosalind: 'Rosalind',
    jan: 'Jan', elise: 'Elise',
  },
  last: {
    volkov: 'Volkov', kuznetsov: 'Kuznetsov', drozdov: 'Drozdov', belov: 'Belov', sokolov: 'Sokolov', petrov: 'Petrov', orlov: 'Orlov',
    zaitsev: 'Zaitsev', morozko: 'Morozko', gromov: 'Gromov', karpov: 'Karpov', lebedev: 'Lebedev', ryabov: 'Ryabov', tikhonov: 'Tikhonov',
    shubin: 'Shubin', yermakov: 'Yermakov',
    // a woman's form
    volkova: 'Volkova', kuznetsova: 'Kuznetsova', drozdova: 'Drozdova', belova: 'Belova', sokolova: 'Sokolova', petrova: 'Petrova',
    orlova: 'Orlova', zaitseva: 'Zaitseva', gromova: 'Gromova', karpova: 'Karpova', lebedeva: 'Lebedeva', ryabova: 'Ryabova',
    tikhonova: 'Tikhonova', shubina: 'Shubina', yermakova: 'Yermakova',
    harrington: 'Harrington', lindqvist: 'Lindqvist', moreau: 'Moreau', calloway: 'Calloway', vanDijk: 'van Dijk', ashford: 'Ashford',
    brennan: 'Brennan', delacroix: 'Delacroix', whitmore: 'Whitmore', bergstrom: 'Bergstrom', kessler: 'Kessler', fairfax: 'Fairfax',
    rasmussen: 'Rasmussen', duval: 'Duval', hale: 'Hale', okafor: 'Okafor',
  },
};
strings('players.person', person);
const PERSON_KEY = new Map<string, string>();
for (const part of ['first', 'last'] as const) for (const [k, v] of Object.entries(person[part])) PERSON_KEY.set(v, `players.person.${part}.${k}`);

/** A rival's first or last name in the active language's script (Russian, Chinese); any other name unchanged. */
export function personName(english: string): string {
  const k = PERSON_KEY.get(english);
  return (k && translation(k)) || english;
}
/** Whether a name is one of the rivals' generated first or last names. */
export const isPersonName = (english: string): boolean => PERSON_KEY.has(english);
