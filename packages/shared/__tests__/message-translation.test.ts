import {
  languageName,
  normalizeTranslationLanguageCode,
  translationTargetFromLocale,
} from '../src/message-translation'

describe('message translation', () => {
  it('normalizes provider language codes', () => {
    expect(normalizeTranslationLanguageCode('pt_br')).toBe('pt-BR')
    expect(normalizeTranslationLanguageCode(' pcm ')).toBe('pcm')
    expect(normalizeTranslationLanguageCode('not a locale')).toBeNull()
  })

  it('uses the device language without coupling it to account region', () => {
    expect(translationTargetFromLocale('es-MX')).toBe('es')
    expect(translationTargetFromLocale('zh-TW')).toBe('zh-TW')
  })

  it('labels Nigerian Pidgin explicitly', () => {
    expect(languageName('pcm')).toBe('Nigerian Pidgin')
  })
})
