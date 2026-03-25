/**
 * Locale system for memoryblock.
 *
 * Usage:
 *   import { t } from '@memoryblock/locale';
 *   log.error(t.general.notInitialized);
 *   log.error(t.block.notFound('home'));
 *
 * To add a new language:
 *   1. Copy `en.ts` → `fr.ts` (or any language code)
 *   2. Translate all values, keep function signatures identical
 *   3. Import and register here with registerLocale('fr', fr)
 *   4. Set via config or env: MBLK_LANG=fr
 */
import { en, type Locale } from './en.js';

const locales: Record<string, Locale> = { en };
let active: Locale = en;

/**
 * Set the active locale by language code.
 * Falls back to English if the locale is not found.
 */
export function setLocale(lang: string): void {
    active = locales[lang] || en;
}

/**
 * Register a new locale.
 * Call this before setLocale() to make a language available.
 */
export function registerLocale(lang: string, locale: Locale): void {
    locales[lang] = locale;
}

/**
 * Get the active locale strings.
 * Use as: t.block.notFound('home')
 *
 * Uses a Proxy so switching locales at runtime works seamlessly.
 */
export const t: Locale = new Proxy({} as Locale, {
    get(_target, prop) {
        return (active as any)[prop];
    },
});

export type { Locale } from './en.js';