import { useEffect, useState } from 'react'
import { Alert, ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { resolvePaymentProviderForCurrency } from '@drape/shared'
import { Button } from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { SUPPORTED_CURRENCIES, useCurrency, type CurrencyCode } from '@/lib/currency'
import { goBackOrFallback } from '@/lib/navigation'

type AccountRole = 'CUSTOMER' | 'TAILOR'

export function CurrencySettingsScreen({ role }: { role: AccountRole }) {
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { currency, loading, setCurrency, unsupportedMessage } = useCurrency()
  const [selected, setSelected] = useState<CurrencyCode>(currency)
  const [saving, setSaving] = useState(false)
  const isTailor = role === 'TAILOR'

  useEffect(() => {
    if (!saving) {
      const timer = setTimeout(() => {
        setSelected(currency)
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [currency, saving])

  function goBack() {
    goBackOrFallback(router, navigation, isTailor ? '/(tailor)/profile/account-settings' : '/(customer)/profile/account-settings')
  }

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      await setCurrency(selected, { source: 'USER_SELECTED' })
      Alert.alert(
        'Currency updated',
        'New orders and browsing totals will use this currency. Existing orders stay locked to the currency they were placed in.',
        [{ text: 'OK', onPress: goBack }],
      )
    } catch {
      Alert.alert('Could not update currency', 'Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel="Back to account settings">
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Currency</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom + 128, 112) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.infoCard}>
          <Text style={styles.eyebrow}>Account default</Text>
          <Text style={styles.title}>{selected}</Text>
          <Text style={styles.copy}>
            This controls browsing, checkout, and payment-history totals. Orders already placed do not change currency after payment starts.
          </Text>
          <Text style={styles.copy}>
            {isTailor
              ? 'Your payout currency is managed in payout setup. Changing account currency does not rewrite existing earnings or payout accounts.'
              : 'Payment routing follows the order currency: NGN, GHS, and KES use Paystack; USD, GBP, EUR, and CAD use Stripe.'}
          </Text>
          {unsupportedMessage ? <Text style={styles.warning}>{unsupportedMessage}</Text> : null}
        </View>

        <View style={styles.listCard}>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={Colors.needleGreen} />
              <Text style={styles.rowSub}>Loading currency options...</Text>
            </View>
          ) : (
            SUPPORTED_CURRENCIES.map((item, index) => {
              const active = selected === item.code
              const provider = resolvePaymentProviderForCurrency(item.code)
              return (
                <TouchableOpacity
                  key={item.code}
                  style={[styles.currencyRow, index === SUPPORTED_CURRENCIES.length - 1 && styles.rowLast]}
                  onPress={() => setSelected(item.code)}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${item.name}`}
                >
                  <View style={styles.symbolBadge}>
                    <Text style={styles.symbol}>{item.symbol}</Text>
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{item.code} · {item.name}</Text>
                    <Text style={styles.rowSub}>{provider === 'PAYSTACK' ? 'Paystack checkout' : 'Stripe checkout'}</Text>
                  </View>
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active ? <Feather name="check" size={14} color={Colors.textInverse} /> : null}
                  </View>
                </TouchableOpacity>
              )
            })
          )}
        </View>

        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>Before you switch</Text>
          <Text style={styles.noticeText}>
            If you move countries, switch your account currency before starting a new order. Once an order is created, payment, refund, tax, and payout records stay in the original locked currency.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + Spacing.sm, Spacing.lg) }]}>
        <Button
          label={saving ? 'Saving...' : selected === currency ? 'Currency saved' : `Use ${selected}`}
          onPress={save}
          loading={saving}
          disabled={saving || selected === currency}
        />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  body: { padding: Spacing.lg, gap: Spacing.md },
  infoCard: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm },
  eyebrow: { fontSize: FontSize.xs, color: Colors.needleGreenDark, fontWeight: FontWeight.semibold, textTransform: 'uppercase' },
  title: { fontSize: 34, color: Colors.ink, fontWeight: FontWeight.bold, fontFamily: Fonts.display },
  copy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  warning: { fontSize: FontSize.sm, color: Colors.warning, lineHeight: 20 },
  listCard: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  loadingRow: { minHeight: 72, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    minHeight: 68,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  rowLast: { borderBottomWidth: 0 },
  symbolBadge: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbol: { color: Colors.needleGreenDark, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  rowText: { flex: 1 },
  rowTitle: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.semibold },
  rowSub: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { backgroundColor: Colors.needleGreen, borderColor: Colors.needleGreen },
  noticeCard: { backgroundColor: Colors.needleGreenLight, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.xs },
  noticeTitle: { fontSize: FontSize.md, color: Colors.needleGreenDark, fontWeight: FontWeight.semibold },
  noticeText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: Spacing.lg,
    backgroundColor: Colors.bone,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.lightGrey,
  },
})
