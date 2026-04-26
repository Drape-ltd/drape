import { useEffect, useRef, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Input } from './Input'
import { parseNominatimSuggestion } from '@/lib/address'
import { Colors, FontSize, Radius, Shadow, Spacing } from '@/constants/theme'
import type { TextInputProps } from 'react-native'

type Suggestion = {
  place_id?: string | number
  display_name?: string
  address?: Record<string, string | undefined>
}

type AddressAutocompleteInputProps = {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  hint?: string
  error?: string
} & Omit<TextInputProps, 'value' | 'onChangeText' | 'placeholder'>

export function AddressAutocompleteInput({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  ...inputProps
}: AddressAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suppressNextLookup = useRef(false)

  useEffect(() => {
    const text = value.trim()
    setShowSuggestions(false)

    if (suppressNextLookup.current) {
      suppressNextLookup.current = false
      return
    }

    if (text.length < 5) {
      setSuggestions([])
      return
    }

    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&addressdetails=1&limit=5`,
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'Drape/1.0' } },
        )
        const data = (await response.json()) as Suggestion[]
        const filtered = data.filter((item) => typeof item?.display_name === 'string' && item.display_name.trim().length > 0)
        setSuggestions(filtered)
        setShowSuggestions(filtered.length > 0)
      } catch {
        setSuggestions([])
        setShowSuggestions(false)
      }
    }, 350)

    return () => clearTimeout(timeout)
  }, [value])

  function selectSuggestion(suggestion: Suggestion) {
    const nextValue = parseNominatimSuggestion(suggestion).displayValue
    suppressNextLookup.current = true
    onChangeText(nextValue)
    setSuggestions([])
    setShowSuggestions(false)
  }

  return (
    <View style={styles.container}>
      <Input
        label={label}
        value={value}
        onChangeText={(text) => {
          onChangeText(text)
          if (!text.trim()) {
            setSuggestions([])
            setShowSuggestions(false)
          }
        }}
        placeholder={placeholder}
        hint={hint}
        error={error}
        {...inputProps}
      />
      {showSuggestions ? (
        <View style={styles.suggestionsCard}>
          {suggestions.map((suggestion, index) => (
            <TouchableOpacity
              key={`${suggestion.place_id ?? suggestion.display_name ?? index}`}
              style={[styles.suggestionRow, index === suggestions.length - 1 && styles.suggestionRowLast]}
              onPress={() => selectSuggestion(suggestion)}
            >
              <Text style={styles.suggestionText}>{suggestion.display_name}</Text>
            </TouchableOpacity>
          ))}
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
  suggestionRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
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
})
