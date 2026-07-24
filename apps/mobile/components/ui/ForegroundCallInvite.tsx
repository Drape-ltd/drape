import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { type Href, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useForegroundCallInvite } from '@/lib/notifications'
import { FontSize, FontWeight, Fonts, Radius, Shadow, Spacing, useDrapeTheme } from '@/constants/theme'

export function ForegroundCallInviteSurface() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors } = useDrapeTheme()
  const { invite, dismiss } = useForegroundCallInvite()

  function joinCall() {
    if (!invite) return
    const params = new URLSearchParams({
      orderId: invite.orderId,
      callKind: invite.callKind,
      callType: invite.callType,
    })
    dismiss()
    router.push(`/call-join?${params.toString()}` as Href)
  }

  return (
    <Modal
      visible={!!invite}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.lightGrey,
              marginTop: Math.max(insets.top, Spacing.lg),
            },
          ]}
        >
          <View style={[styles.iconWrap, { backgroundColor: colors.needleGreen }]}>
            <Feather
              name={invite?.callType === 'audio' ? 'phone-call' : 'video'}
              size={24}
              color={colors.textInverse}
            />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.eyebrow, { color: colors.needleGreen }]}>Incoming Drapeon call</Text>
            <Text style={[styles.title, { color: colors.ink }]}>{invite?.title ?? 'Call ready'}</Text>
            <Text style={[styles.body, { color: colors.inkLight }]}>{invite?.body}</Text>
          </View>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss call invitation"
              onPress={dismiss}
              style={({ pressed }) => [
                styles.secondary,
                { borderColor: colors.lightGrey },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.secondaryText, { color: colors.ink }]}>Not now</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Join Drapeon call"
              onPress={joinCall}
              style={({ pressed }) => [
                styles.primary,
                { backgroundColor: colors.needleGreen },
                pressed && styles.pressed,
              ]}
            >
              <Feather name="phone-call" size={18} color={colors.textInverse} />
              <Text style={[styles.primaryText, { color: colors.textInverse }]}>Join call</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.54)',
    paddingHorizontal: Spacing.lg,
    justifyContent: 'flex-start',
  },
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.lg,
    ...Shadow.lg,
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: Radius.full,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  copy: {
    gap: Spacing.xs,
    marginTop: Spacing.md,
  },
  eyebrow: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  secondary: {
    alignItems: 'center',
    borderRadius: Radius.full,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: Spacing.md,
  },
  secondaryText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  primary: {
    alignItems: 'center',
    borderRadius: Radius.full,
    flex: 1.3,
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: Spacing.md,
  },
  primaryText: {
    fontFamily: Fonts.bodyBold,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  pressed: {
    opacity: 0.82,
  },
})
