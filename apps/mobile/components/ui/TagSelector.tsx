/**
 * TagSelector — searchable, grouped, multi-select row component.
 *
 * Handles both flat string[] and grouped TagGroup[] option sets.
 * Designed for large lists like specialties (~28 items) and languages (~36 items).
 */
import React, { useCallback, useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

export type TagGroup = { label: string; items: string[] }

interface TagSelectorProps {
  options: string[] | TagGroup[]
  selected: string[]
  onChange: (selected: string[]) => void
  maxSelected?: number
  maxSelectedMessage?: string
  /** Show a search/filter input at the top */
  searchable?: boolean
  /** Hide the full list until the user types; show selected items as a removable inline list when idle */
  searchOnly?: boolean
  label?: string
  required?: boolean
  hint?: string
}

function isGrouped(options: string[] | TagGroup[]): options is TagGroup[] {
  return options.length > 0 && typeof (options as TagGroup[])[0] === 'object'
}

function OptionRow({
  item,
  selected,
  toggle,
}: {
  item: string
  selected: boolean
  toggle: (item: string) => void
}) {
  return (
    <TouchableOpacity
      style={styles.optionRow}
      onPress={() => toggle(item)}
      activeOpacity={0.65}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.optionText, selected && styles.optionTextActive]}>{item}</Text>
      <View style={[styles.optionCheck, selected && styles.optionCheckActive]}>
        {selected ? <Feather name="check" size={14} color={Colors.textInverse} /> : null}
      </View>
    </TouchableOpacity>
  )
}

export function TagSelector({
  options,
  selected,
  onChange,
  maxSelected,
  maxSelectedMessage,
  searchable = false,
  searchOnly = false,
  label,
  required,
  hint,
}: TagSelectorProps) {
  const [query, setQuery] = useState('')
  const [limitMessage, setLimitMessage] = useState('')

  const toggle = useCallback((item: string) => {
    if (!selected.includes(item) && maxSelected && selected.length >= maxSelected) {
      setLimitMessage(maxSelectedMessage ?? `Choose up to ${maxSelected}.`)
      return
    }
    setLimitMessage('')
    onChange(
      selected.includes(item)
        ? selected.filter((s) => s !== item)
        : [...selected, item]
    )
  }, [maxSelected, maxSelectedMessage, onChange, selected])

  const allItems = useMemo<string[]>(() => {
    if (isGrouped(options)) return options.flatMap((g) => g.items)
    return options as string[]
  }, [options])

  const filteredItems = useMemo<string[] | null>(() => {
    if (!query.trim()) return null
    const q = query.toLowerCase()
    return allItems.filter((item) => item.toLowerCase().includes(q))
  }, [query, allItems])

  return (
    <View>
      {label && (
        <Text style={styles.label}>
          {label}{required && <Text style={styles.required}> *</Text>}
        </Text>
      )}
      {hint && <Text style={styles.hint}>{hint}</Text>}

      {searchable && (
        <View style={styles.searchRow}>
          <Feather name="search" size={14} color={Colors.midGrey} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search…"
            placeholderTextColor={Colors.midGrey}
            accessibilityLabel={label ? `Search ${label}` : 'Search options'}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="done"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => setQuery('')}
              style={styles.clearBtn}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Feather name="x" size={14} color={Colors.midGrey} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Selected items — shown in searchOnly mode when idle */}
      {searchOnly && !query.trim() && selected.length > 0 && (
        <View style={styles.selectedList}>
          {selected.map((item, i) => (
            <TouchableOpacity
              key={item}
              style={[styles.selectedRow, i === selected.length - 1 && styles.selectedRowLast]}
              onPress={() => toggle(item)}
              activeOpacity={0.65}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item}`}
            >
              <Text style={styles.selectedRowText}>{item}</Text>
              <Feather name="x" size={14} color={Colors.midGrey} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Full list — hidden in searchOnly mode until a query is typed */}
      {(!searchOnly || !!query.trim()) && (
        filteredItems ? (
          <View style={styles.optionList}>
            {filteredItems.length === 0
              ? <Text style={styles.noResults}>No results for "{query}"</Text>
              : filteredItems.map((item) => (
                <OptionRow
                  key={item}
                  item={item}
                  selected={selected.includes(item)}
                  toggle={toggle}
                />
              ))
            }
          </View>
        ) : isGrouped(options) ? (
          options.map((group) => (
            <View key={group.label} style={styles.group}>
              <Text style={styles.groupLabel}>{group.label}</Text>
              <View style={styles.optionList}>
                {group.items.map((item) => (
                  <OptionRow
                    key={item}
                    item={item}
                    selected={selected.includes(item)}
                    toggle={toggle}
                  />
                ))}
              </View>
            </View>
          ))
        ) : (
          <View style={styles.optionList}>
            {(options as string[]).map((item) => (
              <OptionRow
                key={item}
                item={item}
                selected={selected.includes(item)}
                toggle={toggle}
              />
            ))}
          </View>
        )
      )}

      {selected.length > 0 && (
        <Text style={styles.selectionCount}>
          {selected.length}{maxSelected ? `/${maxSelected}` : ''} selected
        </Text>
      )}
      {!!limitMessage && (
        <Text style={styles.limitMessage}>{limitMessage}</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    marginBottom: Spacing.xs,
  },
  required: { color: Colors.error },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    lineHeight: 18,
    marginBottom: Spacing.md,
  },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.ink,
    padding: 0,
  },
  clearBtn: { padding: Spacing.xs },

  noResults: {
    fontSize: FontSize.sm,
    color: Colors.midGrey,
    fontStyle: 'italic',
    paddingVertical: Spacing.sm,
  },

  group: { marginBottom: Spacing.lg },
  selectedList: {
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.white,
    marginBottom: Spacing.xs,
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  selectedRowLast: { borderBottomWidth: 0 },
  selectedRowText: {
    fontSize: FontSize.sm,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  groupLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.midGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: Spacing.sm,
  },

  optionList: {
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.white,
  },
  optionRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  optionText: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.medium,
  },
  optionTextActive: {
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  optionCheck: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionCheckActive: { backgroundColor: Colors.needleGreen, borderColor: Colors.needleGreen },

  selectionCount: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.medium,
    marginTop: Spacing.sm,
  },
  limitMessage: {
    fontSize: FontSize.xs,
    color: Colors.kanteRust,
    lineHeight: 18,
    marginTop: Spacing.xs,
  },
})
