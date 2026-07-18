import type { ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

type FeatureStateCardProps = {
  eyebrow: string
  title: string
  body: string
  accentColor?: string
  icon?: React.ComponentProps<typeof Feather>['name']
  loading?: boolean
  supportTitle?: string
  supportBody?: string
  children?: ReactNode
}

export function FeatureStateCard({
  eyebrow,
  title,
  body,
  accentColor = Colors.needleGreen,
  icon = 'bell',
  loading = false,
  supportTitle,
  supportBody,
  children,
}: FeatureStateCardProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={[styles.eyebrowPill, { borderColor: `${accentColor}24`, backgroundColor: `${accentColor}10` }]}>
          <Text style={[styles.eyebrowText, { color: accentColor }]}>{eyebrow}</Text>
        </View>

        <View style={[styles.iconHalo, { backgroundColor: `${accentColor}16` }]}>
          {loading ? (
            <ActivityIndicator color={accentColor} />
          ) : (
            <Feather name={icon} size={24} color={accentColor} />
          )}
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>

        {supportTitle && supportBody ? (
          <View style={styles.supportCard}>
            <Text style={styles.supportTitle}>{supportTitle}</Text>
            <Text style={styles.supportBody}>{supportBody}</Text>
          </View>
        ) : null}

        {children ? <View style={styles.actions}>{children}</View> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.md,
  },
  eyebrowPill: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  eyebrowText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  iconHalo: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
    fontFamily: Fonts.display,
  },
  body: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  supportCard: {
    alignSelf: 'stretch',
    backgroundColor: Colors.bone,
    borderRadius: Radius.md,
    padding: 10,
    gap: 4,
  },
  supportTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  supportBody: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 17,
    textAlign: 'center',
  },
  actions: {
    alignSelf: 'stretch',
    gap: Spacing.sm,
  },
})
