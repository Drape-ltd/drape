import { View, Text, StyleSheet } from 'react-native'
import { Colors, Fonts, FontSize, FontWeight, Spacing } from '@/constants/theme'

type AuthEntryHeaderProps = {
  eyebrow?: string
  title: string
  body: string
  showWordmark?: boolean
  compact?: boolean
}

export function AuthEntryHeader({
  eyebrow,
  title,
  body,
  showWordmark = false,
  compact = false,
}: AuthEntryHeaderProps) {
  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {showWordmark ? <Text style={styles.wordmark}>Drapeon</Text> : null}
      {eyebrow ? (
        <Text style={[styles.eyebrow, !showWordmark && styles.eyebrowWithoutWordmark]}>
          {eyebrow}
        </Text>
      ) : null}
      <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
      <Text style={[styles.body, compact && styles.bodyCompact]}>{body}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  wrapCompact: {
    gap: 6,
    paddingTop: 0,
  },
  wordmark: {
    fontFamily: Fonts.display,
    fontSize: 38,
    fontWeight: FontWeight.bold,
    color: Colors.needleGreen,
    lineHeight: 46,
  },
  eyebrow: {
    fontFamily: Fonts.bodySemiBold,
    marginTop: Spacing.md,
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  eyebrowWithoutWordmark: {
    marginTop: 0,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 34,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 40,
    letterSpacing: 0,
  },
  titleCompact: {
    fontSize: 28,
    lineHeight: 33,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: FontSize.md,
    color: Colors.inkLight,
    lineHeight: 24,
  },
  bodyCompact: {
    fontSize: FontSize.sm,
    lineHeight: 21,
  },
})
