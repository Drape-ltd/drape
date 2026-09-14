import { useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

type ChallengeMessage =
  | { type: 'success'; token: string }
  | { type: 'expired' }
  | { type: 'error' }
  | { type: 'interactive' }
  | { type: 'idle' }

function challengeHtml(siteKey: string, action: string) {
  return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      html, body { margin: 0; min-height: 100%; background: transparent; }
      body { display: flex; align-items: center; justify-content: center; overflow: hidden; }
    </style>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
  </head>
  <body>
    <div id="challenge"></div>
    <script>
      function send(message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)); }
      window.onload = function () {
        if (!window.turnstile) { send({ type: 'error' }); return; }
        window.turnstile.render('#challenge', {
          sitekey: ${JSON.stringify(siteKey)},
          action: ${JSON.stringify(action)},
          appearance: 'interaction-only',
          size: 'compact',
          theme: 'light',
          callback: function (token) { send({ type: 'success', token: token }); },
          'expired-callback': function () { send({ type: 'expired' }); },
          'error-callback': function () { send({ type: 'error' }); },
          'before-interactive-callback': function () { send({ type: 'interactive' }); },
          'after-interactive-callback': function () { send({ type: 'idle' }); }
        });
      };
    </script>
  </body>
</html>`
}

export function TurnstileChallenge({
  action,
  onTokenChange,
}: {
  action: 'signin' | 'signup' | 'recovery'
  onTokenChange: (token: string | null) => void
}) {
  const siteKey = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? ''
  const [loaded, setLoaded] = useState(false)
  const [interactive, setInteractive] = useState(false)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState(siteKey ? '' : 'Security verification is not configured for this build.')
  const html = useMemo(() => challengeHtml(siteKey, action), [action, siteKey])

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
        {!loaded && siteKey ? (
          <View style={styles.loading}>
            <ActivityIndicator color={Colors.needleGreen} />
            <Text style={styles.loadingText}>Loading security check…</Text>
          </View>
        ) : null}
        {siteKey ? (
          <WebView
            source={{ html, baseUrl: 'https://drapeon.co' }}
            style={[styles.webView, !loaded && styles.webViewLoading]}
            containerStyle={styles.webViewContainer}
            originWhitelist={['https://*']}
            javaScriptEnabled
            domStorageEnabled
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
          />
        ) : null}
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
    width: 166,
    height: 148,
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
})
