import { StyleSheet, Text, View } from 'react-native'
import { Colors, Fonts, FontWeight, Radius, Spacing } from '@/constants/theme'

type BrandCompanionCardProps = {
  title?: string
  body?: string
  label?: string
}

export function BrandCompanionCard({
  title = 'Drapeon',
  body = '',
  label = '',
}: BrandCompanionCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      <View style={styles.threadRow}>
        <View style={styles.threadLine} />
        <View style={styles.threadMark}>
          <Text style={styles.threadInitial}>D</Text>
        </View>
      </View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.xl,
    padding: Spacing.xxxl,
    gap: Spacing.md,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 27,
    lineHeight: 34,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    letterSpacing: 0,
  },
  body: {
    maxWidth: 330,
    fontFamily: Fonts.body,
    fontSize: 16,
    lineHeight: 25,
    color: Colors.inkLight,
  },
  threadRow: {
    marginTop: Spacing.lg,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
  },
  threadLine: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.needleGreen,
  },
  threadMark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  threadInitial: {
    fontFamily: Fonts.display,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
  },
  label: {
    alignSelf: 'flex-end',
    marginTop: -Spacing.sm,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
  },
})
