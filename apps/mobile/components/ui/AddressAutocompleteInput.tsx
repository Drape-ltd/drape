import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Keyboard, ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Input } from './Input'
import { parseNominatimSuggestion } from '@/lib/address'
import type { NominatimSuggestion, StructuredAddressFields } from '@/lib/address'
import { Colors, FontSize, Radius, Shadow, Spacing } from '@/constants/theme'
import type { TextInputProps } from 'react-native'

type AddressAutocompleteInputProps = {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  hint?: string
  error?: string
  onSelectAddress?: (address: StructuredAddressFields & { displayValue: string; reference: string }) => void
} & Omit<TextInputProps, 'value' | 'onChangeText' | 'placeholder'>

export function AddressAutocompleteInput({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  onSelectAddress,
  ...inputProps
}: AddressAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<NominatimSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle')
  const [retryKey, setRetryKey] = useState(0)
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const suppressNextLookup = useRef(false)
  const userInitiatedLookup = useRef(false)
  const requestSequence = useRef(0)

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  useEffect(() => {
    const text = value.trim()

    // Loading a saved address should not immediately query the provider and
    // paint a stale "No exact match" warning. Only search after the person
    // edits this field (or explicitly retries a failed lookup).
    if (!userInitiatedLookup.current) return

    if (suppressNextLookup.current) {
      suppressNextLookup.current = false
      userInitiatedLookup.current = false
      return
    }

    if (text.length < 5) {
      const resetTimer = setTimeout(() => {
        setSuggestions([])
        setShowSuggestions(false)
        setLookupState('idle')
      }, 0)
      return () => clearTimeout(resetTimer)
    }

    const sequence = ++requestSequence.current
    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      setLookupState('loading')
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&addressdetails=1&limit=5`,
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'Drapeon/1.0' }, signal: controller.signal },
        )
        if (!response.ok) throw new Error(`Address lookup failed with ${response.status}`)
        const data = (await response.json()) as NominatimSuggestion[]
        if (sequence !== requestSequence.current) return
        const filtered = Array.isArray(data)
          ? data.filter((item) => typeof item?.display_name === 'string' && item.display_name.trim().length > 0)
          : []
        setSuggestions(filtered)
        setShowSuggestions(filtered.length > 0)
        setLookupState(filtered.length > 0 ? 'idle' : 'empty')
      } catch {
        if (controller.signal.aborted || sequence !== requestSequence.current) return
        setSuggestions([])
        setShowSuggestions(false)
        setLookupState('error')
      }
    }, 350)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [retryKey, value])

  function selectSuggestion(suggestion: NominatimSuggestion) {
    const parsed = parseNominatimSuggestion(suggestion)
    suppressNextLookup.current = true
    onChangeText(parsed.displayValue)
    onSelectAddress?.({
      ...parsed,
      reference: String(suggestion.place_id ?? suggestion.display_name ?? ''),
    })
    setSuggestions([])
    setShowSuggestions(false)
    setLookupState('idle')
    Keyboard.dismiss()
  }

  const suggestionList = showSuggestions ? (
    <View style={[styles.suggestionsCard, keyboardVisible && styles.suggestionsCardKeyboard]}>
      <Text style={styles.suggestionsLabel}>Suggested addresses</Text>
      <ScrollView
        nestedScrollEnabled
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
        style={styles.suggestionsScroll}
      >
        {suggestions.slice(0, 3).map((suggestion, index, visibleSuggestions) => (
          <TouchableOpacity
            key={`${suggestion.place_id ?? suggestion.display_name ?? index}`}
            style={[styles.suggestionRow, index === visibleSuggestions.length - 1 && styles.suggestionRowLast]}
            onPress={() => selectSuggestion(suggestion)}
            accessibilityRole="button"
            accessibilityLabel={`Use address ${suggestion.display_name}`}
          >
            <Text style={styles.suggestionText} numberOfLines={2}>{suggestion.display_name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  ) : null

  return (
    <View style={styles.container}>
      <Input
        label={label}
        value={value}
        onChangeText={(text) => {
          userInitiatedLookup.current = text.trim().length > 0
          onChangeText(text)
          if (!text.trim()) {
            userInitiatedLookup.current = false
            setSuggestions([])
            setShowSuggestions(false)
            setLookupState('idle')
          }
        }}
        placeholder={placeholder}
        hint={hint}
        error={error}
        {...inputProps}
      />
      {suggestionList}
      {lookupState === 'loading' ? (
        <View style={styles.lookupStatus} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={Colors.needleGreen} />
          <Text style={styles.lookupStatusText}>Searching addresses…</Text>
        </View>
      ) : null}
      {lookupState === 'empty' ? (
        <Text style={styles.lookupStatusText} accessibilityLiveRegion="polite">
          No exact match. Try a nearby landmark, or enter the address manually.
        </Text>
      ) : null}
      {lookupState === 'error' ? (
        <View style={styles.lookupStatus} accessibilityLiveRegion="polite">
          <Text style={styles.lookupStatusText}>Address suggestions are unavailable. You can still enter it manually.</Text>
          <TouchableOpacity
            onPress={() => {
              userInitiatedLookup.current = true
              setRetryKey((key) => key + 1)
            }}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.xs,
  },
  suggestionsCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  suggestionsCardKeyboard: {
    maxHeight: 190,
  },
  suggestionsLabel: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    color: Colors.midGrey,
    fontSize: FontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  suggestionsScroll: {
    maxHeight: 154,
  },
  suggestionRow: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
  },
  suggestionRowLast: {
    borderBottomWidth: 0,
  },
  suggestionText: {
    color: Colors.ink,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  lookupStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  lookupStatusText: {
    color: Colors.midGrey,
    fontSize: FontSize.xs,
    lineHeight: 18,
    flexShrink: 1,
  },
  retryText: {
    color: Colors.needleGreen,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
})
