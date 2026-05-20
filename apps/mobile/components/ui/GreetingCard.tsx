import type { ComponentProps } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors, Fonts, FontWeight, Spacing } from '@/constants/theme'

type GreetingCardTone = 'morning' | 'afternoon' | 'evening'

type GreetingCardProps = {
  tone: GreetingCardTone
  title?: string
  subtitle?: string
}

const toneConfig: Record<
  GreetingCardTone,
  { icon: ComponentProps<typeof Feather>['name']; iconColor: string; iconBg: string; fallbackTitle: string; fallbackSubtitle: string }
> = {
  morning: {
    icon: 'sun',
    iconColor: Colors.statusPending,
    iconBg: Colors.statusPendingBg,
    fallbackTitle: 'Good morning',
    fallbackSubtitle: 'Bright, focused start state',
  },
  afternoon: {
    icon: 'sun',
    iconColor: Colors.needleGreen,
    iconBg: Colors.needleGreenLight,
    fallbackTitle: 'Good afternoon',
    fallbackSubtitle: 'Productive green check-in',
  },
  evening: {
    icon: 'moon',
    iconColor: Colors.timeEvening,
    iconBg: Colors.timeEveningBg,
    fallbackTitle: 'Good evening',
    fallbackSubtitle: 'Calmer return-to-order state',
  },
}

export function GreetingCard({ tone, title, subtitle }: GreetingCardProps) {
  const config = toneConfig[tone]

  return (
    <View style={styles.card}>
      <View style={[styles.iconCircle, { backgroundColor: config.iconBg }]}>
        <Feather name={config.icon} size={22} color={config.iconColor} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{title ?? config.fallbackTitle}</Text>
        <Text style={styles.subtitle}>{subtitle ?? config.fallbackSubtitle}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    minHeight: 104,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xl,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: 18,
    paddingHorizontal: 21,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.inkLight,
  },
})
