/**
 * Conquest text helpers. The run (saved) and its battles (simulated) keep English: their templates live in
 * src/i18n/en/conquest-run.ts and conquest-battle.ts, and the screens translate the English where it is shown.
 */

/**
 * Fill `{name}` placeholders, always in English (no locale formatting): the result is stored in the run or
 * emitted by the battle simulation, and must be the same on every machine.
 */
export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}
