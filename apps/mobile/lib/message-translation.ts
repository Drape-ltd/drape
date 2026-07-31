import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FALLBACK_TRANSLATION_LANGUAGES,
  translationTargetFromLocale,
  type ConversationTranslationPreference,
  type MessageTranslation,
  type TranslationLanguage,
} from '@drape/shared/message-translation'
import { invokeFunction } from './supabase'

type SettingsResponse = { preference?: ConversationTranslationPreference }
type LanguagesResponse = { languages?: TranslationLanguage[] }
type TranslationResponse = { translation?: MessageTranslation }

function deviceTargetLanguage() {
  try {
    return translationTargetFromLocale(Intl.DateTimeFormat().resolvedOptions().locale)
  } catch {
    return 'en'
  }
}

export function useConversationTranslation(orderId: string) {
  const defaultPreference = useMemo<ConversationTranslationPreference>(() => ({
    autoTranslate: false,
    targetLanguage: deviceTargetLanguage(),
    sourceLanguage: null,
  }), [])
  const [preference, setPreference] = useState(defaultPreference)
  const [languages, setLanguages] = useState<TranslationLanguage[]>(FALLBACK_TRANSLATION_LANGUAGES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orderId) return
    let active = true
    setLoading(true)
    void Promise.all([
      invokeFunction<SettingsResponse>('message-translation', {
        body: { action: 'settings', orderId },
      }),
      invokeFunction<LanguagesResponse>('message-translation', {
        body: { action: 'languages', orderId },
      }),
    ]).then(([settingsResult, languageResult]) => {
      if (!active) return
      if (settingsResult.data?.preference) setPreference(settingsResult.data.preference)
      if (languageResult.data?.languages?.length) setLanguages(languageResult.data.languages)
      setError(settingsResult.error?.message ?? null)
      setLoading(false)
    })
    return () => { active = false }
  }, [orderId])

  const updatePreference = useCallback(async (next: ConversationTranslationPreference) => {
    const previous = preference
    setPreference(next)
    setSaving(true)
    setError(null)
    const { data, error: invokeError } = await invokeFunction<SettingsResponse>('message-translation', {
      body: {
        action: 'update-settings',
        orderId,
        autoTranslate: next.autoTranslate,
        targetLanguage: next.targetLanguage,
        sourceLanguage: next.sourceLanguage,
      },
    })
    setSaving(false)
    if (invokeError || !data?.preference) {
      setPreference(previous)
      const message = invokeError?.message ?? 'Could not save translation settings.'
      setError(message)
      throw new Error(message)
    }
    setPreference(data.preference)
  }, [orderId, preference])

  const translateMessage = useCallback(async (messageId: string) => {
    const { data, error: invokeError } = await invokeFunction<TranslationResponse>('message-translation', {
      body: {
        action: 'translate',
        orderId,
        messageId,
        targetLanguage: preference.targetLanguage,
        sourceLanguage: preference.sourceLanguage,
      },
    })
    if (invokeError || !data?.translation) {
      throw new Error(invokeError?.message ?? 'This message could not be translated right now.')
    }
    return data.translation
  }, [orderId, preference.sourceLanguage, preference.targetLanguage])

  return {
    preference,
    languages,
    loading,
    saving,
    error,
    updatePreference,
    translateMessage,
  }
}
