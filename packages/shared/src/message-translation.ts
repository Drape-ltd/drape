export type TranslationLanguage = {
  code: string
  name: string
}

export type ConversationTranslationPreference = {
  autoTranslate: boolean
  targetLanguage: string
  sourceLanguage: string | null
}

export type MessageTranslation = {
  messageId: string
  translatedText: string
  sourceLanguage: string
  targetLanguage: string
}

export const DEFAULT_TRANSLATION_LANGUAGE = 'en'

export const FALLBACK_TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { code: 'ar', name: 'Arabic' },
  { code: 'bn', name: 'Bengali' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' },
  { code: 'nl', name: 'Dutch' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'ha', name: 'Hausa' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ig', name: 'Igbo' },
  { code: 'id', name: 'Indonesian' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'pcm', name: 'Nigerian Pidgin' },
  { code: 'fa', name: 'Persian' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'es', name: 'Spanish' },
  { code: 'sw', name: 'Swahili' },
  { code: 'sv', name: 'Swedish' },
  { code: 'tl', name: 'Tagalog' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'cy', name: 'Welsh' },
  { code: 'yo', name: 'Yoruba' },
  { code: 'zu', name: 'Zulu' },
]

export function normalizeTranslationLanguageCode(value: string | null | undefined) {
  const trimmed = value?.trim().replace('_', '-') ?? ''
  if (!/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/u.test(trimmed)) return null
  const [language = '', region] = trimmed.split('-')
  return region ? `${language.toLowerCase()}-${region.toUpperCase()}` : language.toLowerCase()
}

export function translationTargetFromLocale(locale: string | null | undefined) {
  const normalized = normalizeTranslationLanguageCode(locale)
  if (!normalized) return DEFAULT_TRANSLATION_LANGUAGE
  if (normalized === 'zh-TW' || normalized === 'zh-CN') return normalized
  return normalized.split('-')[0] ?? DEFAULT_TRANSLATION_LANGUAGE
}

export function languageName(code: string, languages: TranslationLanguage[] = FALLBACK_TRANSLATION_LANGUAGES) {
  const normalized = normalizeTranslationLanguageCode(code) ?? code
  return languages.find((language) => language.code.toLowerCase() === normalized.toLowerCase())?.name ?? normalized
}
