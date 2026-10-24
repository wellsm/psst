import en from '../locales/en.json';
import pt from '../locales/pt.json';

export type Lang = 'en' | 'pt';
export const LANGS: readonly Lang[] = ['en', 'pt'];
export const LANG_NAMES: Record<Lang, string> = { en: 'English', pt: 'Português' };

const TABLES: Record<Lang, Record<string, string>> = { en, pt };

let current: Lang = 'en';
const listeners = new Set<() => void>();

export function detectLang(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en';
  return nav.startsWith('pt') ? 'pt' : 'en';
}

export function setLang(lang: Lang) {
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
  for (const l of listeners) l();
}

export const getLang = () => current;

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function hasKey(key: string, lang: Lang = current): boolean {
  return key in TABLES[lang];
}

/** Translate `key`, replacing `{name}` placeholders. Falls back to English, then the key itself. */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = TABLES[current][key] ?? TABLES.en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export const localeTables = TABLES;
