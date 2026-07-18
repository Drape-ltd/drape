import { useMemo, useState } from 'react'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useRefreshOnFocus, useTailorShop } from '@/lib/queries'
import { Button, RemoteImage } from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { appendToHistory, goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { buildCustomerStockSignal } from '@/lib/ready-made-stock'
import { formatAmount, useCurrency, type CurrencyCode } from '@/lib/currency'
import { isVideoMediaUrl } from '@drape/shared/media-policy'

function createDraftSessionId() {
  return `${new Date().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export default function TailorShopScreen() {
  const { id, returnTo, historyChain } = useLocalSearchParams<{
    id: string
    returnTo?: string
    historyChain?: string
  }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { data, isLoading, refetch } = useTailorShop(id)
  const { currency: accountCurrency, rates } = useCurrency()
  const [refreshing, setRefreshing] = useState(false)
  const tailorName = data?.tailorName ?? 'This seller'
  const items = useMemo(() => data?.items ?? [], [data?.items])
  const sellerUnavailable = data ? data.shopPaused || !data.sellerLive : false
  const customOrdersAvailable = data ? data.supportsCustomOrders && data.acceptsCustomOrdersNow && data.sellerLive : false

  useRefreshOnFocus(() => { void refetch() }, 0)

  async function onRefresh() {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }

  function goBack() {
    goBackOrReturnTo(
      router,
      navigation,
      pickSafeReturnTo(historyChain, returnTo),
      `/(customer)/tailor/${id}`,
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} colors={[Colors.needleGreen]} />}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack}>
            <Feather name="arrow-left" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Shop</Text>
          <View style={{ width: 22 }} />
        </View>

        <View style={styles.bestUseCard}>
          <Text style={styles.bestUseEyebrow}>Shop now</Text>
          <Text style={styles.bestUseText}>
            Buy ready-made pieces from {tailorName}. {customOrdersAvailable ? 'If you need something custom, go back and start a custom order.' : 'If this seller is unavailable, save a piece and check back later.'}
          </Text>
        </View>

        {sellerUnavailable ? (
          <View style={styles.unavailableCard}>
            <Feather name="pause-circle" size={18} color={Colors.error} />
            <Text style={styles.unavailableText}>
              {tailorName} has paused ready-made checkout right now. You can still browse and save pieces until checkout reopens.
            </Text>
          </View>
        ) : null}

        {isLoading && !data ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.emptyTitle}>Loading items…</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Feather name="shopping-bag" size={24} color={Colors.needleGreen} />
            </View>
            <Text style={styles.emptyTitle}>No ready-made pieces yet</Text>
            <Text style={styles.emptyHint}>This seller has not listed any live ready-made items yet.</Text>
            <Button
              label={customOrdersAvailable ? 'Start custom order' : 'Custom orders unavailable'}
              disabled={!customOrdersAvailable}
              onPress={() => router.push({
                pathname: '/(customer)/brief/[tailorId]',
                params: {
                  tailorId: id,
                  returnTo: `/(customer)/tailor/shop/${id}`,
                  historyChain: appendToHistory(historyChain, `/(customer)/tailor/shop/${id}`),
                  draftSession: createDraftSessionId(),
                  freshStart: '1',
                },
              })}
            />
          </View>
        ) : (
          <View style={styles.itemList}>
            {items.map((item) => {
              const stockSignal = buildCustomerStockSignal({
                stockStatus: item.stockStatus,
                inventoryQuantity: item.inventoryQuantity,
                showAvailableCount: true,
              })
              const coverImageUrl = item.photoUrls.find((url) => !isVideoMediaUrl(url)) ?? null

              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.itemCard}
                  activeOpacity={0.95}
                  onPress={() =>
                    router.push({
                      pathname: '/(customer)/tailor/item/[itemId]',
                      params: {
                        itemId: item.id,
                        returnTo: `/(customer)/tailor/shop/${id}`,
                        historyChain: appendToHistory(historyChain, `/(customer)/tailor/shop/${id}`),
                      },
                    })
                  }
                >
                  <View style={styles.itemImageWrap}>
                    {coverImageUrl ? (
                      <RemoteImage
                        uri={coverImageUrl}
                        bucket="seller-item-media"
                        style={styles.itemImage}
                        contentFit="contain"
                        transition={180}
                        surface="customer_ready_made_shop"
                        fallback={(
                          <View style={[styles.itemImage, styles.itemPlaceholder]}>
                            <Feather name="shopping-bag" size={24} color={Colors.midGrey} />
                          </View>
                        )}
                      />
                    ) : (
                      <View style={[styles.itemImage, styles.itemPlaceholder]}>
                        <Feather name="shopping-bag" size={24} color={Colors.midGrey} />
                      </View>
                    )}
                    {stockSignal.tone !== 'available' ? <StockPill signal={stockSignal} floating /> : null}
                  </View>
                  <View style={styles.itemBody}>
                    <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
                    {item.category ? <Text style={styles.itemCategory}>{item.category}</Text> : null}
                    <View style={styles.priceRow}>
                      <Text style={styles.itemPrice}>
                        {formatAmount(item.priceAmount, item.currency as CurrencyCode, item.currency as CurrencyCode, rates)}
                      </Text>
                      {stockSignal.tone === 'available' ? <StockPill signal={stockSignal} compact /> : null}
                    </View>
                    {item.currency !== accountCurrency ? (
                      <Text style={styles.itemApproxPrice}>
                        Approx. {formatAmount(item.priceAmount, item.currency as CurrencyCode, accountCurrency, rates)}
                      </Text>
                    ) : null}
                    <View style={styles.chipWrap}>
                      {item.pickupAvailable ? <Chip label="Pickup" /> : null}
                      {item.deliveryAvailable ? <Chip label="Delivery" /> : null}
                      {item.shippingAvailable ? <Chip label="Shipping" /> : null}
                    </View>
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  )
}

function StockPill({
  signal,
  compact = false,
  floating = false,
}: {
  signal: ReturnType<typeof buildCustomerStockSignal>
  compact?: boolean
  floating?: boolean
}) {
  return (
    <View
      style={[
        styles.stockPill,
        compact && styles.stockPillCompact,
        floating && styles.stockPillFloating,
        signal.tone === 'available' && styles.stockPillAvailable,
        signal.tone === 'warning' && styles.stockPillWarning,
        signal.tone === 'urgent' && styles.stockPillUrgent,
        signal.tone === 'muted' && styles.stockPillMuted,
      ]}
    >
      <Text
        style={[
          styles.stockPillText,
          compact && styles.stockPillTextCompact,
          signal.tone === 'available' && styles.stockPillTextAvailable,
          signal.tone === 'warning' && styles.stockPillTextWarning,
          signal.tone === 'urgent' && styles.stockPillTextUrgent,
          signal.tone === 'muted' && styles.stockPillTextMuted,
        ]}
        numberOfLines={1}
      >
        {signal.label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.md, paddingBottom: Spacing.xxxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  bestUseCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 4, ...Shadow.sm },
  bestUseEyebrow: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  bestUseText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 18 },
  emptyCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 16, gap: Spacing.sm, alignItems: 'center', ...Shadow.sm },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  emptyHint: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 18, textAlign: 'center' },
  unavailableCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.errorLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.error + '22',
  },
  unavailableText: { flex: 1, fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  itemList: { gap: Spacing.md },
  itemCard: { backgroundColor: Colors.white, borderRadius: Radius.md, overflow: 'hidden', ...Shadow.sm },
  itemImageWrap: { position: 'relative' },
  itemImage: { width: '100%', height: 168, backgroundColor: Colors.boneDeep },
  itemPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  itemBody: { padding: 14, gap: 4 },
  itemTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  itemCategory: { fontSize: FontSize.xs, color: Colors.midGrey },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  itemPrice: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.needleGreen, fontFamily: Fonts.display },
  itemApproxPrice: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 17 },
  stockPill: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    backgroundColor: Colors.needleGreenLight,
  },
  stockPillCompact: { maxWidth: 132, paddingVertical: 4 },
  stockPillFloating: {
    position: 'absolute',
    left: Spacing.sm,
    bottom: Spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.82)',
  },
  stockPillAvailable: { backgroundColor: Colors.needleGreenLight },
  stockPillWarning: { backgroundColor: Colors.statusPendingBg },
  stockPillUrgent: { backgroundColor: Colors.errorLight },
  stockPillMuted: { backgroundColor: Colors.boneDeep },
  stockPillText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  stockPillTextCompact: { fontSize: 11 },
  stockPillTextAvailable: { color: Colors.needleGreen },
  stockPillTextWarning: { color: Colors.statusPending },
  stockPillTextUrgent: { color: Colors.error },
  stockPillTextMuted: { color: Colors.midGrey },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
  chip: { backgroundColor: Colors.bone, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  chipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
})
