// ── Translations ─────────────────────────────────────────────────────────────
// Every user-facing text is wrapped in t`…`. The English text is the key
// (${…} parts become {{v0}}, {{v1}}…); src/i18n/locales/<lang>.json maps it
// to the translation (npm run i18n:extract refreshes en.json, the list of keys).
// A text missing from a catalog simply stays English.
//
// The language is fixed when the app starts — many texts are built once at
// load time — so changing it reloads the app. "auto" follows the system.

import de from '../i18n/locales/de.json'
import fr from '../i18n/locales/fr.json'
import es from '../i18n/locales/es.json'

export type Language = 'en' | 'de' | 'fr' | 'es'
export type LanguageSetting = 'auto' | Language

const CATALOGS: Record<Language, Record<string, string>> = { en: {}, de, fr, es }

export const LANGUAGE_OPTIONS: { value: LanguageSetting; label: string }[] = [
  { value: 'auto', label: 'System' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
]

const STORAGE_KEY = 'pianooo.language'

export function languageSetting(): LanguageSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'en' || v === 'de' || v === 'fr' || v === 'es') return v
  } catch {}
  return 'auto'
}

function systemLanguage(): Language {
  const list = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : []
  for (const l of list) {
    const code = (l ?? '').slice(0, 2).toLowerCase()
    if (code === 'en' || code === 'de' || code === 'fr' || code === 'es') return code
  }
  return 'en'
}

const chosen = languageSetting()
/** The language the app is showing */
export const language: Language = chosen === 'auto' ? systemLanguage() : chosen
const catalog = CATALOGS[language]
try { document.documentElement.lang = language } catch {}

/** Saves the choice and restarts the interface in the new language */
export function setLanguage(value: LanguageSetting) {
  try {
    if (value === 'auto') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, value)
  } catch {}
  location.reload()
}

export function t(strings: TemplateStringsArray, ...values: unknown[]): string {
  if (language !== 'en') {
    const key = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `{{v${i}}}` : ''), '')
    const tr = catalog[key]
    if (tr) return tr.replace(/\{\{v(\d+)\}\}/g, (_, i) => String(values[Number(i)]))
  }
  return strings.reduce((acc, str, i) => acc + str + (i < values.length ? String(values[i]) : ''), '')
}
