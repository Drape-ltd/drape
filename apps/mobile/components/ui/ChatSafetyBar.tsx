import { ActivityIndicator, Pressable, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import Text from 'react-native-ui-lib/src/components/text'
import View from 'react-native-ui-lib/src/components/view'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

type Props = {
  blocked: boolean
  blockedMessage?: string | null
  inDispute: boolean
  loading: boolean
  reporting: boolean
  onPressReport: () => void
}

export function ChatSafetyBar({
  blocked,
  blockedMessage,
  inDispute,
  loading,
  reporting,
  onPressReport,
}: Props) {
  const statusMessage = blocked
    ? blockedMessage ?? 'This conversation is paused while Drapeon reviews a safety concern.'
    : inDispute
      ? 'Calls are paused during review. Keep updates and evidence in this thread.'
      : 'Payments, approvals, and decisions stay protected here.'

  return (
    <View style={[styles.card, (blocked || inDispute) && styles.cardWarning]}>
      <View style={styles.row}>
        <View style={[styles.icon, (blocked || inDispute) && styles.iconWarning]}>
          <Feather
            name={blocked || inDispute ? 'alert-triangle' : 'shield'}
            size={16}
            color={blocked || inDispute ? Colors.kanteRust : Colors.needleGreen}
          />
        </View>
        <View style={styles.content}>
          <Text style={styles.title}>{blocked ? 'Chat paused' : 'Protected by Drapeon'}</Text>
          <Text style={[styles.message, (blocked || inDispute) && styles.messageWarning]} numberOfLines={2}>
            {statusMessage}
          </Text>
        </View>
        <Pressable
          style={styles.reportButton}
          onPress={onPressReport}
          disabled={reporting}
          accessibilityRole="button"
          accessibilityLabel={blocked ? 'View chat safety options' : 'Report a chat safety concern'}
        >
          {reporting || loading ? (
            <ActivityIndicator size="small" color={Colors.kanteRust} />
          ) : (
            <>
              <Feather name="flag" size={15} color={Colors.kanteRust} />
              <Text style={styles.reportLabel}>Report</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    minHeight: 72,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.surface,
  },
  cardWarning: {
    borderColor: Colors.kanteRust + '55',
    backgroundColor: Colors.kanteRustLight,
  },
  row: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
    flexShrink: 0,
  },
  iconWarning: {
    backgroundColor: Colors.kanteRust + '18',
  },
  title: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  message: {
    marginTop: 1,
    fontSize: FontSize.xs,
    lineHeight: 17,
    color: Colors.inkLight,
  },
  messageWarning: {
    color: Colors.kanteRust,
  },
  reportButton: {
    minWidth: 74,
    minHeight: 44,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
    backgroundColor: Colors.kanteRust + '12',
    flexShrink: 0,
  },
  reportLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.kanteRust,
  },
})
