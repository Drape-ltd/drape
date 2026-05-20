import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

export type TierBadge = 'VERIFIED' | 'RISING' | 'MASTER'

const TIER_CONFIG: Record<TierBadge, { label: string; emoji: string; bg: string; text: string }> = {
  VERIFIED: {
    label: 'Verified',
    emoji: '✓',
    bg: Colors.needleGreenLight,
    text: Colors.needleGreenDark,
  },
  RISING: { label: 'Rising', emoji: '★', bg: Colors.statusPendingBg, text: Colors.statusPending },
  MASTER: { label: 'Master', emoji: '◆', bg: Colors.boneDeep, text: Colors.needleGreenDark },
}

export function TierBadgeChip({
  tier,
  size = 'md',
}: {
  tier: TierBadge | null | undefined
  size?: 'sm' | 'md' | 'lg'
}) {
  const config = tier ? TIER_CONFIG[tier] : null
  if (!config) return null
  const fontSize = size === 'lg' ? 13 : size === 'sm' ? 10 : 12
  const paddingH = size === 'lg' ? 12 : size === 'sm' ? 6 : 10
  return (
    <View style={[styles.chip, { backgroundColor: config.bg, paddingHorizontal: paddingH }]}>
      <Text style={[styles.chipText, { color: config.text, fontSize }]}>
        {config.emoji} {config.label}
      </Text>
    </View>
  )
}

export function StarRating({ rating, count }: { rating: number; count?: number }) {
  return (
    <View style={styles.starRow}>
      <Text style={styles.star}>★</Text>
      <Text style={styles.ratingText}>{(rating ?? 0).toFixed(1)}</Text>
      {count !== undefined && <Text style={styles.countText}> ({count})</Text>}
    </View>
  )
}

export function Tag({ label }: { label: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    alignSelf: 'flex-start',
  },
  chipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  starRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  star: {
    color: Colors.statusPending,
    fontSize: FontSize.sm,
  },
  ratingText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  countText: {
    fontFamily: Fonts.body,
    fontSize: FontSize.sm,
    color: Colors.midGrey,
  },
  tag: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
    backgroundColor: Colors.boneDeep,
    alignSelf: 'flex-start',
  },
  tagText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    fontWeight: FontWeight.medium,
  },
})
