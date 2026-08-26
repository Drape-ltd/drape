import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Linking, Modal, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewNavigation } from 'react-native-webview'
import { Feather } from '@expo/vector-icons'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

export type PaystackCheckoutResult =
  | { type: 'success'; url: string }
  | { type: 'cancel' }
  | { type: 'error'; message: string }

type PendingCheckout = { authorizationUrl: string; returnUrl: string }
type Resolver = (result: PaystackCheckoutResult) => void

const PaystackCheckoutContext = createContext<{
  present: (authorizationUrl: string, returnUrl: string) => Promise<PaystackCheckoutResult>
} | null>(null)

function isPaystackHost(hostname: string) {
  const host = hostname.toLowerCase()
  return host === 'paystack.com' || host.endsWith('.paystack.com') || host === 'paystack.co' || host.endsWith('.paystack.co')
}

function isCheckoutCompletion(url: string, returnUrl: string) {
  try {
    const candidate = new URL(url)
    const expected = new URL(returnUrl)
    if (candidate.protocol === expected.protocol && candidate.host === expected.host && candidate.pathname === expected.pathname) return true
    return candidate.pathname.includes('/payments/paystack/callback')
      && (!!candidate.searchParams.get('reference') || !!candidate.searchParams.get('trxref'))
  } catch {
    return false
  }
}

export function PaystackCheckoutProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  const [checkout, setCheckout] = useState<PendingCheckout | null>(null)
  const resolver = useRef<Resolver | null>(null)
  const topInset = Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0)

  const finish = useCallback((result: PaystackCheckoutResult) => {
    const resolve = resolver.current
    resolver.current = null
    setCheckout(null)
    resolve?.(result)
  }, [])

  const present = useCallback((authorizationUrl: string, returnUrl: string) => {
    if (resolver.current) return Promise.resolve({ type: 'error', message: 'Another payment checkout is already open.' } as const)
    try {
      const initialUrl = new URL(authorizationUrl)
      if (initialUrl.protocol !== 'https:' || !isPaystackHost(initialUrl.hostname)) {
        return Promise.resolve({ type: 'error', message: 'Drapeon blocked an invalid Paystack checkout destination.' } as const)
      }
    } catch {
      return Promise.resolve({ type: 'error', message: 'Drapeon could not validate this Paystack checkout.' } as const)
    }
    setCheckout({ authorizationUrl, returnUrl })
    return new Promise<PaystackCheckoutResult>((resolve) => { resolver.current = resolve })
  }, [])

  const allowNavigation = useCallback((request: WebViewNavigation) => {
    if (!checkout) return false
    const url = request.url
    if (isCheckoutCompletion(url, checkout.returnUrl)) {
      finish({ type: 'success', url })
      return false
    }
    try {
      const parsed = new URL(url)
      // Paystack may hand card authentication to the issuer's HTTPS 3DS page.
      // The initial URL is Paystack-only; later HTTPS navigation stays inside
      // this isolated checkout and never counts as payment confirmation.
      if (parsed.protocol === 'https:') return true
      if (parsed.protocol === 'about:' || parsed.protocol === 'data:') return true
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        void Linking.openURL(url).catch(() => finish({ type: 'error', message: 'This bank verification step could not open.' }))
      }
    } catch {
      finish({ type: 'error', message: 'Paystack returned an invalid checkout destination.' })
    }
    return false
  }, [checkout, finish])

  return (
    <PaystackCheckoutContext.Provider value={{ present }}>
      {children}
      <Modal visible={!!checkout} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => finish({ type: 'cancel' })}>
        <View style={[styles.safe, { paddingTop: topInset, paddingBottom: insets.bottom }]}>
          <View style={styles.header}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close secure checkout" style={styles.closeButton} onPress={() => finish({ type: 'cancel' })}>
              <Feather name="x" size={22} color={Colors.ink} />
            </TouchableOpacity>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Secure checkout</Text>
              <Text style={styles.subtitle}>Paystack · protected by Drapeon</Text>
            </View>
            <Feather name="lock" size={18} color={Colors.needleGreen} />
          </View>
          {checkout ? (
            <WebView
              source={{ uri: checkout.authorizationUrl }}
              originWhitelist={['https://*', 'about:*', 'data:*']}
              onShouldStartLoadWithRequest={allowNavigation}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.loading}>
                  <ActivityIndicator size="large" color={Colors.needleGreen} />
                  <Text style={styles.loadingText}>Opening protected checkout…</Text>
                </View>
              )}
              onError={() => finish({ type: 'error', message: 'Secure checkout could not load. Check your connection and try again.' })}
              javaScriptEnabled
              domStorageEnabled
              sharedCookiesEnabled={false}
              thirdPartyCookiesEnabled={false}
              setSupportMultipleWindows={false}
              allowsBackForwardNavigationGestures
            />
          ) : null}
        </View>
      </Modal>
    </PaystackCheckoutContext.Provider>
  )
}

export function usePaystackCheckout() {
  const context = useContext(PaystackCheckoutContext)
  if (!context) throw new Error('usePaystackCheckout must be used inside PaystackCheckoutProvider.')
  return context
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: { minHeight: 68, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey, backgroundColor: Colors.boneDeep },
  closeButton: { width: 42, height: 42, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.white },
  headerCopy: { flex: 1 },
  title: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  subtitle: { color: Colors.midGrey, fontSize: FontSize.xs, marginTop: 2 },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.bone },
  loadingText: { color: Colors.midGrey, fontSize: FontSize.sm },
})
