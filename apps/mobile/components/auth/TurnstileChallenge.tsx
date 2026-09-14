import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

type ChallengeMessage =
  | { type: 'success'; token: string }
  | { type: 'expired' }
  | { type: 'error'; code?: string }
  | { type: 'interactive' }
  | { type: 'idle' }

export function TurnstileChallenge({
  action,
  onTokenChange,
}: {
  action: 'signin' | 'signup' | 'recovery'
  onTokenChange: (token: string | null) => void
}) {
  const siteUrl = (process.env.EXPO_PUBLIC_SITE_URL ?? 'https://drapeon.co').replace(/\/+$/, '')
  const siteKey = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? ''
  const [loaded, setLoaded] = useState(false)
  const [interactive, setInteractive] = useState(false)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const challengeUrl = useMemo(() => {
    const params = new URLSearchParams({ action })
    if (siteKey) params.set('siteKey', siteKey)
    return `${siteUrl}/auth/mobile-challenge?${params.toString()}`
  }, [action, siteKey, siteUrl])

  function retryChallenge() {
    setLoaded(false)
    setInteractive(false)
    setVerified(false)
    setError('')
    onTokenChange(null)
    setReloadKey((current) => current + 1)
  }

  function handleMessage(event: WebViewMessageEvent) {
    let message: ChallengeMessage
    try {
      message = JSON.parse(event.nativeEvent.data) as ChallengeMessage
    } catch {
      setError('The security check returned an invalid response. Retry before continuing.')
      onTokenChange(null)
      return
    }

    if (message.type === 'interactive') {
      setInteractive(true)
      setVerified(false)
      return
    }

    if (message.type === 'idle') {
      setInteractive(false)
      return
    }

    if (message.type === 'success' && message.token) {
      setError('')
      setInteractive(false)
      setVerified(true)
      onTokenChange(message.token)
      return
    }

    setVerified(false)
    onTokenChange(null)
    setError(
      message.type === 'expired'
        ? 'The security check expired. Complete it again to continue.'
        : 'The security check could not finish. Check your connection and retry.',
    )
  }

  return (
    <View style={styles.block} accessibilityLabel="Security check">
      <View style={[styles.challengeFrame, interactive && styles.challengeFrameInteractive]}>
        {!loaded ? (
          <View style={styles.loading}>
            <ActivityIndicator color={Colors.needleGreen} />
            <Text style={styles.loadingText}>Loading security check…</Text>
          </View>
        ) : null}
        <WebView
          key={reloadKey}
          source={{ uri: challengeUrl }}
          style={[styles.webView, !loaded && styles.webViewLoading]}
          containerStyle={styles.webViewContainer}
          originWhitelist={[
            'https://drapeon.co',
            'https://*.drapeon.co',
            'https://challenges.cloudflare.com',
            'about:blank',
            'about:srcdoc',
          ]}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          scrollEnabled={false}
          setSupportMultipleWindows={false}
          onLoadEnd={() => setLoaded(true)}
          onMessage={handleMessage}
          onError={() => {
            setLoaded(true)
            setVerified(false)
            setError('The security check could not load. Check your connection and retry.')
            onTokenChange(null)
          }}
          onHttpError={() => {
            setLoaded(true)
            setVerified(false)
            setError('The security check could not load. Check your connection and retry.')
            onTokenChange(null)
          }}
        />
        {verified ? (
          <View
            style={styles.verified}
            accessible
            accessibilityLabel="Security check complete"
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.verifiedIcon}>✓</Text>
            <Text style={styles.verifiedText}>Security check complete</Text>
          </View>
        ) : null}
      </View>
      {error ? <Text style={[styles.hint, styles.error]}>{error}</Text> : null}
      {error ? (
        <Pressable
          onPress={retryChallenge}
          accessibilityRole="button"
          accessibilityLabel="Retry security check"
          style={styles.retryButton}
        >
          <Text style={styles.retryText}>Retry security check</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  block: { alignItems: 'center', gap: Spacing.sm },
  challengeFrame: {
    width: 220,
    height: 44,
    overflow: 'hidden',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
  },
  challengeFrameInteractive: {
    width: '100%',
    maxWidth: 310,
    height: 72,
  },
  verified: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.bone,
  },
  verifiedIcon: {
    color: Colors.needleGreen,
    fontSize: 20,
    fontWeight: FontWeight.bold,
  },
  verifiedText: {
    color: Colors.ink,
    fontFamily: Fonts.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  loadingText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.medium,
  },
  webViewContainer: { backgroundColor: 'transparent' },
  webView: { flex: 1, backgroundColor: 'transparent' },
  webViewLoading: { opacity: 0 },
  hint: {
    maxWidth: 300,
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    lineHeight: 18,
    color: Colors.midGrey,
  },
  error: { color: Colors.error },
  retryButton: {
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.white,
  },
  retryText: {
    color: Colors.needleGreen,
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
})
