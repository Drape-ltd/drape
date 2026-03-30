import { useEffect, useMemo, useState } from 'react'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSellerItem } from '@/lib/queries'
import { invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

type FulfillmentOption = 'PICKUP' | 'DELIVERY' | 'SHIPPING'
import type { SellerItemDetail as ItemDetail } from '@/lib/queries'

function defaultFulfillment(item: ItemDetail | null): FulfillmentOption | null {
  if (!item) return null
  if (item.pickupAvailable) return 'PICKUP'
  if (item.deliveryAvailable) return 'DELIVERY'
  if (item.shippingAvailable) return 'SHIPPING'
  return null
}

export default function ReadyMadeCheckoutScreen() {
  const { itemId, returnTo } = useLocalSearchParams<{ itemId: string; returnTo?: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [selectedSize, setSelectedSize] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [fulfillment, setFulfillment] = useState<FulfillmentOption | null>(null)
  const [addressSearch, setAddressSearch] = useState('')
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [addressLine1, setAddressLine1] = useState('')
  const [city, setCity] = useState('')
  const [stateRegion, setStateRegion] = useState('')
  const [postcode, setPostcode] = useState('')
  const [country, setCountry] = useState('')
  const [addressError, setAddressError] = useState('')
  const { data: item, isLoading, isFetching } = useSellerItem(itemId)

  function goBack() {
    if (returnTo) {
      router.replace(returnTo as any)
    } else if (navigation.canGoBack()) router.back()
    else router.replace(`/(customer)/tailor/item/${itemId}`)
  }

  useEffect(() => {
    if (!item) return
    setSelectedSize((current) => current || item.sizes[0] || '')
    setFulfillment((current) => current ?? defaultFulfillment(item))
  }, [item])

  useEffect(() => {
    const text = addressSearch.trim()
    setShowSuggestions(false)
    if (text.length < 5) {
      setAddressSuggestions([])
      return
    }

    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&addressdetails=1&limit=5`,
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'Drape/1.0' } }
        )
        const data: any[] = await res.json()
        const filtered = data.filter((entry) => entry?.display_name && entry?.address)
        setAddressSuggestions(filtered)
        setShowSuggestions(filtered.length > 0)
      } catch {
        setAddressSuggestions([])
        setShowSuggestions(false)
      }
    }, 400)

    return () => clearTimeout(timeout)
  }, [addressSearch])

  function selectSuggestion(item: any) {
    const address = item.address ?? {}
    const houseNumber = typeof address.house_number === 'string' ? address.house_number.trim() : ''
    const road = address.road ?? address.pedestrian ?? address.residential ?? address.street ?? ''
    const line1 = [houseNumber, road].filter(Boolean).join(' ').trim() || item.display_name.split(',')[0]?.trim() || ''
    const nextCity = address.city ?? address.town ?? address.village ?? address.hamlet ?? address.county ?? ''
    const nextState = address.state ?? address.region ?? address.state_district ?? ''
    const nextPostcode = address.postcode ?? ''
    const nextCountry = address.country ?? ''

    setAddressSearch(item.display_name)
    setAddressLine1(line1)
    setCity(nextCity)
    setStateRegion(nextState)
    setPostcode(nextPostcode)
    setCountry(nextCountry)
    setAddressError('')
    setAddressSuggestions([])
    setShowSuggestions(false)
  }

  function composeAddress() {
    return [
      addressLine1.trim(),
      [city.trim(), stateRegion.trim()].filter(Boolean).join(', '),
      postcode.trim(),
      country.trim(),
    ].filter(Boolean).join('\n')
  }

  function validate() {
    if (!item || !fulfillment) return false
    if (item.sizes.length > 0 && !selectedSize.trim()) {
      Alert.alert('Choose a size', 'Pick the size you want before continuing.')
      return false
    }
    if (quantity < 1) {
      Alert.alert('Invalid quantity', 'Quantity must be at least 1.')
      return false
    }
    if (fulfillment !== 'PICKUP') {
      if (!addressLine1.trim() || !city.trim() || !stateRegion.trim() || !postcode.trim() || !country.trim()) {
        setAddressError('Enter the full delivery address before continuing.')
        return false
      }
      setAddressError('')
    }
    return true
  }

  const subtotal = useMemo(() => (item ? item.priceAmount * quantity : 0), [item, quantity])

  async function createOrder() {
    if (!user?.id || !item || !fulfillment || saving) return
    if (!validate()) return

    setSaving(true)
    try {
      const { data, error } = await invokeFunction<{ ok: boolean; orderId?: string }>('ready-made-order-action', {
        body: {
          action: 'create-checkout',
          sellerItemId: item.id,
          size: selectedSize || undefined,
          quantity,
          fulfillment,
          address: fulfillment === 'PICKUP' ? undefined : composeAddress(),
        },
      })

      if (error || !data?.orderId) {
        Alert.alert('Checkout failed', error?.message ?? 'Could not create this order right now.')
        return
      }

      router.replace({
        pathname: '/(customer)/orders/[id]',
        params: { id: data.orderId, tab: 'active' },
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack}>
            <Feather name="arrow-left" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Checkout</Text>
          <View style={{ width: 22 }} />
        </View>

        {isLoading && !item ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateText}>Loading checkout…</Text>
          </View>
        ) : !item ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>Item unavailable</Text>
            <Text style={styles.stateText}>This piece is no longer available right now.</Text>
            <Button label="Back to seller" variant="secondary" onPress={goBack} />
          </View>
        ) : (
          <>
            <View style={styles.summaryCard}>
              {isFetching ? <Text style={styles.refreshingText}>Refreshing item…</Text> : null}
              <Text style={styles.sellerName}>{item.sellerName}</Text>
              <Text style={styles.itemTitle}>{item.title}</Text>
              <Text style={styles.itemPrice}>{item.currency} {(item.priceAmount / 100).toFixed(2)}</Text>
            </View>

            {item.sizes.length > 0 ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Choose size</Text>
                <View style={styles.optionWrap}>
                  {item.sizes.map((size) => (
                    <TouchableOpacity
                      key={size}
                      style={[styles.pill, selectedSize === size && styles.pillActive]}
                      onPress={() => setSelectedSize(size)}
                    >
                      <Text style={[styles.pillText, selectedSize === size && styles.pillTextActive]}>{size}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Quantity</Text>
              <View style={styles.quantityRow}>
                <TouchableOpacity style={styles.quantityBtn} onPress={() => setQuantity((value) => Math.max(1, value - 1))}>
                  <Text style={styles.quantityBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.quantityValue}>{quantity}</Text>
                <TouchableOpacity style={styles.quantityBtn} onPress={() => setQuantity((value) => Math.min(9, value + 1))}>
                  <Text style={styles.quantityBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>How you’ll get it</Text>
              <View style={styles.choiceGroup}>
                {item.pickupAvailable ? (
                  <ChoiceCard title="Pickup" hint="Collect directly from the seller." active={fulfillment === 'PICKUP'} onPress={() => setFulfillment('PICKUP')} />
                ) : null}
                {item.deliveryAvailable ? (
                  <ChoiceCard title="Delivery" hint="Seller or team delivers nearby." active={fulfillment === 'DELIVERY'} onPress={() => setFulfillment('DELIVERY')} />
                ) : null}
                {item.shippingAvailable ? (
                  <ChoiceCard title="Shipping" hint="Courier handles it." active={fulfillment === 'SHIPPING'} onPress={() => setFulfillment('SHIPPING')} />
                ) : null}
              </View>
            </View>

            {fulfillment !== 'PICKUP' ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Delivery address</Text>
                <TextInput
                  style={styles.input}
                  value={addressSearch}
                  onChangeText={(value) => {
                    setAddressSearch(value)
                    if (addressError) setAddressError('')
                  }}
                  placeholder="Search address"
                  placeholderTextColor={Colors.midGrey}
                />
                {showSuggestions ? (
                  <View style={styles.suggestionsCard}>
                    {addressSuggestions.map((suggestion, index) => (
                      <TouchableOpacity
                        key={`${suggestion.place_id ?? suggestion.display_name}-${index}`}
                        style={[styles.suggestionRow, index === addressSuggestions.length - 1 && styles.suggestionRowLast]}
                        onPress={() => selectSuggestion(suggestion)}
                      >
                        <Text style={styles.suggestionText}>{suggestion.display_name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
                <TextInput style={styles.input} value={addressLine1} onChangeText={setAddressLine1} placeholder="Address line 1" placeholderTextColor={Colors.midGrey} />
                <View style={styles.inlineRow}>
                  <TextInput style={[styles.input, styles.inlineInput]} value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={Colors.midGrey} />
                  <TextInput style={[styles.input, styles.inlineInput]} value={stateRegion} onChangeText={setStateRegion} placeholder="State / region" placeholderTextColor={Colors.midGrey} />
                </View>
                <View style={styles.inlineRow}>
                  <TextInput style={[styles.input, styles.inlineInput]} value={postcode} onChangeText={setPostcode} placeholder="Postcode" placeholderTextColor={Colors.midGrey} />
                  <TextInput style={[styles.input, styles.inlineInput]} value={country} onChangeText={setCountry} placeholder="Country" placeholderTextColor={Colors.midGrey} />
                </View>
                {addressError ? <Text style={styles.errorText}>{addressError}</Text> : null}
              </View>
            ) : null}

            <View style={styles.breakdownCard}>
              <Text style={styles.sectionTitle}>Order summary</Text>
              <SummaryRow label="Item subtotal" value={`${item.currency} ${(subtotal / 100).toFixed(2)}`} />
              <SummaryRow label="Fulfillment" value={fulfillment === 'PICKUP' ? 'Pickup' : fulfillment === 'DELIVERY' ? 'Delivery' : 'Shipping'} />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{item.currency} {(subtotal / 100).toFixed(2)}</Text>
              </View>
            </View>

            <View style={styles.bestUseCard}>
              <Text style={styles.bestUseEyebrow}>Best use</Text>
              <Text style={styles.bestUseText}>This creates a ready-made order now. Payment breakdowns and live checkout rails plug in next without changing this flow.</Text>
            </View>
          </>
        )}
      </ScrollView>

      {item ? (
        <View style={styles.footer}>
          <Button label={saving ? 'Creating order…' : 'Place order'} onPress={createOrder} disabled={saving || !fulfillment} />
        </View>
      ) : null}
    </SafeAreaView>
  )
}

function ChoiceCard({ title, hint, active, onPress }: { title: string; hint: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.choiceCard, active && styles.choiceCardActive]} onPress={onPress}>
      <Text style={[styles.choiceTitle, active && styles.choiceTitleActive]}>{title}</Text>
      <Text style={styles.choiceHint}>{hint}</Text>
    </TouchableOpacity>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.lg, paddingBottom: Spacing.xxxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  stateCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.xl, gap: Spacing.md, alignItems: 'center', ...Shadow.sm },
  stateTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  stateText: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 20 },
  summaryCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.xl, gap: 4, ...Shadow.sm },
  refreshingText: { fontSize: FontSize.xs, color: Colors.midGrey },
  sellerName: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  itemTitle: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
  itemPrice: { marginTop: Spacing.xs, fontSize: FontSize.xl, color: Colors.needleGreen, fontWeight: FontWeight.bold },
  sectionCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  pill: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.bone, borderWidth: 1, borderColor: Colors.lightGrey },
  pillActive: { backgroundColor: Colors.needleGreenLight, borderColor: Colors.needleGreen },
  pillText: { fontSize: FontSize.sm, color: Colors.inkLight, fontWeight: FontWeight.medium },
  pillTextActive: { color: Colors.needleGreen },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  quantityBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.bone, alignItems: 'center', justifyContent: 'center' },
  quantityBtnText: { fontSize: 24, color: Colors.ink, fontWeight: FontWeight.semibold },
  quantityValue: { minWidth: 32, textAlign: 'center', fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  choiceGroup: { gap: Spacing.sm },
  choiceCard: { backgroundColor: Colors.bone, borderRadius: Radius.lg, padding: Spacing.lg, gap: 4, borderWidth: 1.5, borderColor: Colors.lightGrey },
  choiceCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  choiceTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  choiceTitleActive: { color: Colors.needleGreen },
  choiceHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  input: { backgroundColor: Colors.bone, borderRadius: Radius.lg, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, color: Colors.ink, fontSize: FontSize.md },
  inlineRow: { flexDirection: 'row', gap: Spacing.sm },
  inlineInput: { flex: 1 },
  suggestionsCard: { backgroundColor: Colors.white, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.lightGrey, overflow: 'hidden' },
  suggestionRow: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey },
  suggestionRowLast: { borderBottomWidth: 0 },
  suggestionText: { fontSize: FontSize.sm, color: Colors.ink },
  errorText: { fontSize: FontSize.xs, color: Colors.error, marginTop: 2 },
  breakdownCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: FontSize.sm, color: Colors.midGrey },
  summaryValue: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.medium },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.lightGrey },
  totalLabel: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.semibold },
  totalValue: { fontSize: FontSize.md, color: Colors.needleGreen, fontWeight: FontWeight.bold },
  bestUseCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.lg, gap: 6, ...Shadow.sm },
  bestUseEyebrow: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  bestUseText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  footer: { padding: Spacing.xl, backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.lightGrey },
})
