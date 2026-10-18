/**
 * Every player-facing string added by the accessibility pass (settings, key rebinding, subtitles, diagnostics).
 * The English tables live in src/i18n/en/a11y.ts and translate on read.
 */
import { format } from '../i18n/core';

export { SETTINGS_TEXT, CONTROLS_TEXT, KEY_TEXT, GROUP_TEXT, ACTION_TEXT, SUB_TEXT, BATTLE_TEXT, ARIA_TEXT } from '../i18n/en/a11y';

/** Fill `{name}` placeholders (ICU-lite: plurals too) in the active language. */
export function fmt(s: string, vars: Record<string, string | number>): string {
  return format(s, vars);
}
