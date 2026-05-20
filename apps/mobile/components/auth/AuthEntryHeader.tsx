import { View, Text, StyleSheet } from 'react-native'
import { Colors, Fonts, FontSize, FontWeight, Spacing } from '@/constants/theme'

type AuthEntryHeaderProps = {
  eyebrow?: string
  title: string
  body: string
  showWordmark?: boolean
}

export function AuthEntryHeader({
  eyebrow,
  title,
  body,
  showWordmark = false,
}: AuthEntryHeaderProps) {
  return (
    <View style={styles.wrap}>
      {showWordmark ? <Text style={styles.wordmark}>drape</Text> : null}
      {eyebrow ? (
        <Text style={[styles.eyebrow, !showWordmark && styles.eyebrowWithoutWordmark]}>
          {eyebrow}
        </Text>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
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
  body: {
    fontFamily: Fonts.body,
    fontSize: FontSize.md,
    color: Colors.inkLight,
    lineHeight: 24,
  },
})
