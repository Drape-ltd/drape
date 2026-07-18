import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { type Href, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useUserRole } from '@/lib/auth'
import { createConsultationRoom, openConsultationCallUrl } from '@/lib/consultation'
import { createOrderCallRoom, openDrapeCallUrl } from '@/lib/order-call'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

type CallKind = 'consultation' | 'ready-made'
type CallType = 'audio' | 'video'

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function readCallKind(value: string | null | undefined): CallKind {
  return value === 'consultation' ? 'consultation' : 'ready-made'
}

function readCallType(value: string | null | undefined): CallType {
  return value === 'audio' ? 'audio' : 'video'
}

function messagesPath(role: string | null | undefined, orderId: string | null) {
  const base = role === 'TAILOR' ? '/(tailor)' : '/(customer)'
  return orderId ? `${base}/messages/${orderId}` : base
}

export default function CallJoinScreen() {
  const router = useRouter()
  const role = useUserRole()
  const params = useLocalSearchParams<{
    orderId?: string | string[]
    callKind?: string | string[]
    callType?: string | string[]
  }>()
  const orderId = firstParam(params.orderId)
  const validOrderId = isUuid(orderId) ? orderId : null
  const callKind = readCallKind(firstParam(params.callKind))
  const callType = readCallType(firstParam(params.callType))
  const [joining, setJoining] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const title = callKind === 'consultation'
    ? 'Consultation call ready'
    : 'Order call ready'
  const body = callType === 'audio'
    ? 'Join the protected audio room for this order.'
    : 'Join the protected video room for this order.'
  const roleAudience = role === 'TAILOR' ? 'tailor' : role === 'CUSTOMER' ? 'customer' : 'generic'

  function openMessages() {
    router.replace(messagesPath(role ?? null, validOrderId) as Href)
  }

  async function joinCall() {
    if (!validOrderId) {
      Alert.alert('Call unavailable', 'This call link is missing its order context.')
      return
    }
    if (joining) return

    setJoining(true)
    setStatus(null)
    try {
      const room = callKind === 'consultation'
        ? await createConsultationRoom(validOrderId, callType, { notifyCounterpart: false })
        : await createOrderCallRoom(validOrderId, callType, roleAudience, { notifyCounterpart: false })

      if (!room?.url) {
        setStatus(room?.message ?? 'Calling is unavailable right now. Continue inside Messages.')
        return
      }

      const opened = callKind === 'consultation'
        ? await openConsultationCallUrl(room.url, roleAudience)
        : await openDrapeCallUrl(room.url, roleAudience)

      setStatus(opened ? 'Call opened. Keep this screen nearby if you need to return to Messages.' : 'Could not open the call link.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={openMessages} style={styles.iconButton}>
          <Feather name="x" size={22} color={Colors.ink} />
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={styles.badge}>
          <Feather name={callType === 'audio' ? 'phone-call' : 'video'} size={30} color={Colors.needleGreen} />
        </View>
        <Text style={styles.eyebrow}>Drapeon call</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>

        {!validOrderId ? (
          <Text style={styles.warning}>This link is missing its order context. Open Messages to find the active thread.</Text>
        ) : null}

        {status ? <Text style={styles.status}>{status}</Text> : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => { void joinCall() }}
          disabled={!validOrderId || joining}
          style={({ pressed }) => [
            styles.primaryButton,
            (!validOrderId || joining) && styles.primaryButtonDisabled,
            pressed && !joining ? styles.pressed : null,
          ]}
        >
          {joining ? <ActivityIndicator color={Colors.textInverse} /> : (
            <>
              <Feather name={callType === 'audio' ? 'phone-call' : 'video'} size={18} color={Colors.textInverse} />
              <Text style={styles.primaryText}>Join now</Text>
            </>
          )}
        </Pressable>

        <Pressable accessibilityRole="button" onPress={openMessages} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Open Messages instead</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bone,
  },
  header: {
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
    ...Shadow.sm,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.full,
    height: 86,
    justifyContent: 'center',
    marginBottom: Spacing.xl,
    width: 86,
  },
  eyebrow: {
    color: Colors.needleGreen,
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0,
    marginBottom: Spacing.sm,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  title: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: FontSize.xxxl,
    fontWeight: FontWeight.bold,
    lineHeight: 40,
    textAlign: 'center',
  },
  body: {
    color: Colors.inkLight,
    fontFamily: Fonts.body,
    fontSize: FontSize.lg,
    lineHeight: 26,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  warning: {
    color: Colors.error,
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    lineHeight: 20,
    marginTop: Spacing.xl,
    textAlign: 'center',
  },
  status: {
    color: Colors.inkLight,
    fontFamily: Fonts.body,
    fontSize: FontSize.sm,
    lineHeight: 20,
    marginTop: Spacing.xl,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
    marginTop: Spacing.xxxl,
    minHeight: 58,
    paddingHorizontal: Spacing.xl,
  },
  primaryButtonDisabled: {
    backgroundColor: Colors.disabledFill,
  },
  pressed: {
    opacity: 0.86,
  },
  primaryText: {
    color: Colors.textInverse,
    fontFamily: Fonts.bodyBold,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginTop: Spacing.md,
  },
  secondaryText: {
    color: Colors.needleGreen,
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
})
