import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

export type MeasurementModuleField = {
  key: string
  label: string
  value?: string | number | null
  unit?: string
  onPress?: () => void
}

type MeasurementModuleProps = {
  title: string
  subtitle?: string
  icon?: keyof typeof Feather.glyphMap
  fields: MeasurementModuleField[]
  emptyLabel?: string
  actionLabel?: string
  onActionPress?: () => void
}

export function MeasurementModule({
  title,
  subtitle,
  icon = 'sliders',
  fields,
  emptyLabel = 'Not added',
  actionLabel,
  onActionPress,
}: MeasurementModuleProps) {
  const filledCount = fields.filter((field) => field.value !== null && field.value !== undefined && String(field.value).trim()).length

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Feather name={icon} size={17} color={Colors.needleGreen} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <Text style={styles.count}>{filledCount}/{fields.length}</Text>
      </View>
      <View style={styles.fieldGrid}>
        {fields.map((field) => {
          const hasValue = field.value !== null && field.value !== undefined && String(field.value).trim().length > 0
          const content = (
            <>
              <Text style={styles.fieldLabel}>{field.label}</Text>
              <Text style={[styles.fieldValue, !hasValue && styles.fieldValueEmpty]} numberOfLines={1}>
                {hasValue ? `${field.value}${field.unit ? ` ${field.unit}` : ''}` : emptyLabel}
              </Text>
            </>
          )
          if (field.onPress) {
            return (
              <TouchableOpacity
                key={field.key}
                style={styles.field}
                onPress={field.onPress}
                activeOpacity={0.76}
                accessibilityRole="button"
                accessibilityLabel={`${field.label}: ${hasValue ? `${field.value} ${field.unit ?? ''}` : emptyLabel}`}
              >
                {content}
              </TouchableOpacity>
            )
          }
          return (
            <View key={field.key} style={styles.field}>
              {content}
            </View>
          )
        })}
      </View>
      {actionLabel && onActionPress ? (
        <TouchableOpacity
          style={styles.action}
          onPress={onActionPress}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
          <Feather name="chevron-right" size={15} color={Colors.needleGreen} />
        </TouchableOpacity>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    padding: Spacing.md,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1, gap: 2 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    lineHeight: 17,
    color: Colors.inkLight,
  },
  count: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  field: {
    width: '48%',
    minHeight: 64,
    borderRadius: Radius.md,
    backgroundColor: Colors.bone,
    padding: Spacing.sm,
    justifyContent: 'center',
    gap: 2,
  },
  fieldLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    lineHeight: 15,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  fieldValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: FontSize.md,
    lineHeight: 22,
    color: Colors.ink,
    fontWeight: FontWeight.bold,
  },
  fieldValueEmpty: { color: Colors.midGrey, fontWeight: FontWeight.medium },
  action: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  actionText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
})
