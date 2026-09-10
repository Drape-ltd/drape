import { useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

type ChallengeMessage =
  | { type: 'success'; token: string }
  | { type: 'expired' }
  | { type: 'error' }

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
          appearance: 'always',
          size: 'compact',
          theme: 'light',
          callback: function (token) { send({ type: 'success', token: token }); },
          'expired-callback': function () { send({ type: 'expired' }); },
          'error-callback': function () { send({ type: 'error' }); }
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

    if (message.type === 'success' && message.token) {
      setError('')
      onTokenChange(message.token)
      return
    }

    onTokenChange(null)
    setError(
      message.type === 'expired'
        ? 'The security check expired. Complete it again to continue.'
        : 'The security check could not finish. Check your connection and retry.',
    )
  }

  return (
    <View style={styles.block} accessibilityLabel="Security check">
      <View style={styles.challengeFrame}>
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
              setError('The security check could not load. Check your connection and retry.')
              onTokenChange(null)
            }}
          />
        ) : null}
      </View>
      <Text style={[styles.hint, error ? styles.error : null]}>
        {error || 'Complete the quick security check to continue. It helps block automated account abuse.'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { alignItems: 'center', gap: Spacing.sm },
  challengeFrame: {
    width: 166,
    height: 148,
    overflow: 'hidden',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
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
