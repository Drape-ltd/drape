import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { Sentry } from '@/lib/sentry'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

type ResolveHandoffResponse = {
  handoffId?: string
  status?: string
  expiresAt?: string
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default function VerifyHandoffRoute() {
  const router = useRouter()
  const params = useLocalSearchParams<{ token?: string | string[] }>()
  const token = firstParam(params.token)?.trim() ?? ''
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const openSetup = useCallback(() => {
    router.replace({
      pathname: '/(tailor)/profile/setup',
      params: { handoffToken: token, openIdentity: '1' },
    } as never)
  }, [router, token])

  const resolveToken = useCallback(async () => {
    if (!token) {
      setError('This identity handoff link is missing its secure token.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const { data, error: resolveError } = await supabase.functions.invoke<ResolveHandoffResponse>(
        'identity-handoff-action',
        { body: { action: 'resolve-token', token } },
      )
      if (resolveError) throw resolveError
      if (!data?.handoffId) {
        throw new Error('Identity handoff could not be found. Start a new session from your web dashboard.')
      }

      requestAnimationFrame(openSetup)
    } catch (resolveError) {
      Sentry.captureException(resolveError, {
        extra: { context: 'mobile_identity_handoff_resolve' },
      })
      setError(
        resolveError instanceof Error
          ? resolveError.message
          : 'Identity handoff could not open. Start a new session from your web dashboard.',
      )
      setLoading(false)
    }
  }, [openSetup, token])

  useEffect(() => {
    void resolveToken()
  }, [resolveToken])

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.replace('/(tailor)/profile/setup')} style={styles.iconButton}>
          <Feather name="x" size={22} color={Colors.ink} />
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={styles.badge}>
          <Feather name="shield" size={30} color={Colors.needleGreen} />
        </View>
        <Text style={styles.eyebrow}>Identity verification</Text>
        <Text style={styles.title}>{loading ? 'Opening secure handoff' : 'Handoff needs attention'}</Text>
        <Text style={styles.body}>
          {loading
            ? 'We are validating your secure link before opening the camera-only identity step.'
            : error}
        </Text>
        {loading ? <ActivityIndicator color={Colors.needleGreen} size="large" /> : null}
        {!loading && error ? (
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={() => { void resolveToken() }} style={styles.primaryButton}>
              <Text style={styles.primaryText}>Try again</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.replace('/(tailor)/profile/setup')} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>Open setup</Text>
            </Pressable>
          </View>
        ) : null}
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
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    ...Shadow.sm,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  badge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  eyebrow: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xxl,
    color: Colors.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: FontSize.md,
    color: Colors.midGrey,
    lineHeight: 24,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
  },
  primaryText: {
    fontFamily: Fonts.bodyBold,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Colors.textInverse,
  },
  secondaryButton: {
    minHeight: 54,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  secondaryText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
  },
})
