import { useState, type ReactNode } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

type DisclosureTone = 'neutral' | 'info' | 'success' | 'warning' | 'critical'

type DisclosureSectionProps = {
  title: string
  summary?: string
  children: ReactNode
  defaultExpanded?: boolean
  tone?: DisclosureTone
  icon?: keyof typeof Feather.glyphMap
}

const TONE_COLOR: Record<DisclosureTone, string> = {
  neutral: Colors.lightGrey,
  info: Colors.needleGreen,
  success: Colors.needleGreen,
  warning: Colors.kanteRust,
  critical: Colors.error,
}

export function DisclosureSection({
  title,
  summary,
  children,
  defaultExpanded = false,
  tone = 'neutral',
  icon = 'chevron-down',
}: DisclosureSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const toneColor = TONE_COLOR[tone]

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={title}
        activeOpacity={0.78}
      >
        <View style={styles.iconWrap}>
          <Feather name={icon} size={16} color={toneColor === Colors.lightGrey ? Colors.midGrey : toneColor} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{title}</Text>
          {summary ? <Text style={styles.summary}>{summary}</Text> : null}
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.midGrey} />
      </TouchableOpacity>
      {expanded ? <View style={styles.content}>{children}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    overflow: 'hidden',
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  copy: { flex: 1, gap: 2 },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.md,
    lineHeight: 22,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  summary: {
    fontFamily: Fonts.body,
    fontSize: FontSize.sm,
    lineHeight: 19,
    color: Colors.inkLight,
  },
  content: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.lightGrey,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
})
