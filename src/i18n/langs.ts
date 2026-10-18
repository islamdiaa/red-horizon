/**
 * The interface languages. English is the source and the fallback for any missing key; every other language is a
 * flat JSON catalogue in ./locales, loaded on demand (only the active one is downloaded).
 */
export const LANGS = ['en', 'ru', 'de', 'es', 'pt-BR', 'fr', 'zh-CN'] as const;
export type Lang = (typeof LANGS)[number];
/** The stored preference: a language, or 'auto' (follow the browser). */
export type LangPref = Lang | 'auto';

/** Each language's own name, as shown in the language picker. */
export const LANG_NAMES: Record<Lang, string> = {
  en: 'English',
  ru: 'Русский',
  de: 'Deutsch',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  fr: 'Français',
  'zh-CN': '简体中文',
};

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

/**
 * The supported language for a BCP 47 tag, or null: "de-AT" → de, "pt" / "pt-PT" → pt-BR (the only Portuguese),
 * any Chinese → zh-CN (the only Chinese). Ukrainian, Belarusian etc. are deliberately not mapped to Russian.
 */
export function matchLang(tag: string): Lang | null {
  const t = String(tag || '').trim().toLowerCase().replace(/_/g, '-');
  if (!t) return null;
  const base = t.split('-')[0];
  switch (base) {
    case 'en': return 'en';
    case 'ru': return 'ru';
    case 'de': return 'de';
    case 'es': return 'es';
    case 'pt': return 'pt-BR';
    case 'fr': return 'fr';
    case 'zh': return 'zh-CN';
    default: return null;
  }
}

/** The first supported language in a browser's preference list (navigator.languages), else English. */
export function detectLang(tags: readonly string[] | undefined | null): Lang {
  for (const tag of tags ?? []) {
    const l = matchLang(tag);
    if (l) return l;
  }
  return 'en';
}
