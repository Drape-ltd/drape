import { StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import Text from 'react-native-ui-lib/src/components/text'
import View from 'react-native-ui-lib/src/components/view'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

type Props = {
  blocked: boolean
  blockedMessage?: string | null
  inDispute: boolean
}

export function ChatSafetyBar({
  blocked,
  blockedMessage,
  inDispute,
}: Props) {
  if (!blocked && !inDispute) return null

  const statusMessage = blocked
    ? blockedMessage ?? 'This conversation is paused while Drapeon reviews a safety concern.'
    : 'Calls are paused during review. Keep updates and evidence in this thread.'

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
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xs,
    marginBottom: 0,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 48,
    borderRadius: Radius.md,
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
    gap: Spacing.sm,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  icon: {
    width: 30,
    height: 30,
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
})
