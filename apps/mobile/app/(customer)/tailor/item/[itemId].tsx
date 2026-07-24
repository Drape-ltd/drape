import { useMemo, useState } from 'react'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useCustomerMeasurements, useRefreshOnFocus, useSellerItem, useWishlistCollections } from '@/lib/queries'
import { buildCustomerStockSignal, isReadyMadeBuyableForCustomer, quantityForSize } from '@/lib/ready-made-stock'
import { invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { READY_MADE_POLICY_ROWS } from '@/lib/ready-made-policy'
import { appendToHistory, goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import {
  formatFitRange,
  hasReadyMadeSizeGuide,
  normalizeReadyMadeSizeGuide,
  READY_MADE_FIT_FIELDS,
  recommendReadyMadeSize,
} from '@/lib/ready-made-fit'
import { Button, PortfolioVideoPreview, RemoteImage, SaveToWishlistSheet } from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { hapticLight } from '@/lib/haptics'
import { formatAmount, useCurrency, type CurrencyCode } from '@/lib/currency'
import { isVideoMediaUrl } from '@drape/shared/media-policy'

const HOME_BG = Colors.bone
const PRIMARY_GREEN = Colors.needleGreen
const CHARCOAL = Colors.ink
const MUTED_GREY = Colors.midGrey

function createDraftSessionId() {
  return `${new Date().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export default function SellerItemDetailScreen() {
  const { itemId, returnTo, historyChain } = useLocalSearchParams<{
    itemId: string
    returnTo?: string
    historyChain?: string
  }>()
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { currency: accountCurrency, rates } = useCurrency()
  const [startingInquiry, setStartingInquiry] = useState(false)
  const [imageIndex, setImageIndex] = useState(0)
  const [wishlistPickerOpen, setWishlistPickerOpen] = useState(false)
  const [newWishlistName, setNewWishlistName] = useState('')
  const [savingWishlist, setSavingWishlist] = useState(false)
  const { data: item, isLoading, refetch } = useSellerItem(itemId)
  const { data: measurements } = useCustomerMeasurements(user?.id)
  const { data: wishlistCollections = [], refetch: refetchWishlists } = useWishlistCollections(user?.id)

  useRefreshOnFocus(() => { void refetch() }, 0)

  const sizeGuide = useMemo(
    () => normalizeReadyMadeSizeGuide(item?.sizeGuide ?? null, item?.sizes ?? []),
    [item?.sizeGuide, item?.sizes],
  )
  const inStockSizes = useMemo(
    () => item?.sizes.filter((size) => quantityForSize(item.sizeInventory, size, item.inventoryQuantity) > 0) ?? [],
    [item],
  )
  const sizeRecommendation = useMemo(
    () => recommendReadyMadeSize({ guide: sizeGuide, measurements, sizes: inStockSizes }),
    [inStockSizes, measurements, sizeGuide],
  )
  const savedWishlistItem = useMemo(() => {
    if (!item) return null
    for (const collection of wishlistCollections) {
      const found = collection.items.find((savedItem) =>
        savedItem.itemType === 'READY_MADE_ITEM' && savedItem.readyMadeItem.id === item.id
      )
      if (found) return found
    }
    return null
  }, [item, wishlistCollections])
  const stockSignal = item
    ? buildCustomerStockSignal({
        stockStatus: item.stockStatus,
        inventoryQuantity: item.inventoryQuantity,
        isLive: item.sellerLive,
        showAvailableCount: true,
      })
    : null
  const canBuy = item
    ? isReadyMadeBuyableForCustomer({
        stockStatus: item.stockStatus,
        inventoryQuantity: item.inventoryQuantity,
        isLive: item.sellerLive,
      }) && !item.shopPaused
    : false
  const sellerUnavailable = item ? item.shopPaused || !item.sellerLive : false

  function goBack() {
    goBackOrReturnTo(
      router,
      navigation,
      pickSafeReturnTo(historyChain, returnTo),
      item?.tailorProfileId ? `/(customer)/tailor/${item.tailorProfileId}` : '/(customer)',
    )
  }

  useContextualBackHandler(goBack)

  async function startSellerInquiry() {
    if (!user?.id || !item || startingInquiry) return

    setStartingInquiry(true)
    try {
      const { data, error } = await invokeFunction<{ ok: boolean; orderId?: string }>('ready-made-order-action', {
        body: {
          action: 'start-inquiry',
          sellerItemId: item.id,
        },
      })

      if (error || !data?.orderId) {
        const message = await readFunctionErrorMessage(error, 'Could not start this conversation.')
        throw new Error(message)
      }

      router.push({
        pathname: '/(customer)/messages/[orderId]',
        params: {
          orderId: data.orderId,
          returnTo: `/(customer)/tailor/item/${item.id}`,
          historyChain: appendToHistory(historyChain, `/(customer)/tailor/item/${item.id}`),
        },
      })
    } catch (error) {
      Alert.alert(
        'Could not start chat',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Retry from this item when the signal improves, or check Messages if the inquiry already started.'
          : 'We could not open this chat right now. Please try again in a moment.',
      )
    } finally {
      setStartingInquiry(false)
    }
  }

  async function saveReadyMadeToWishlist(input: { collectionId?: string; collectionName?: string }) {
    if (!item || savingWishlist) return
    setSavingWishlist(true)
    try {
      const { error } = await invokeFunction('saved-tailor-action', {
        body: {
          action: 'save-ready-made-item',
          readyMadeItemId: item.id,
          collectionId: input.collectionId,
          collectionName: input.collectionName,
        },
      })
      if (error) throw error
      setWishlistPickerOpen(false)
      setNewWishlistName('')
      hapticLight()
      void refetchWishlists()
    } catch (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not update your wishlist yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not update your wishlist right now. Please try again in a moment.')
      Alert.alert('Wishlist not updated', message)
    } finally {
      setSavingWishlist(false)
    }
  }

  async function removeReadyMadeFromWishlist() {
    if (!savedWishlistItem || savingWishlist) return
    setSavingWishlist(true)
    try {
      const { error } = await invokeFunction('saved-tailor-action', {
        body: { action: 'remove-item', itemId: savedWishlistItem.id },
      })
      if (error) throw error
      hapticLight()
      void refetchWishlists()
    } catch (error) {
      const message = await readFunctionErrorMessage(error, 'Could not remove this item from your wishlist right now.')
      Alert.alert('Wishlist not updated', message)
    } finally {
      setSavingWishlist(false)
    }
  }

  function toggleWishlistSave() {
    if (!item) return
    if (savedWishlistItem) {
      void removeReadyMadeFromWishlist()
      return
    }
    if (wishlistCollections.length === 1) {
      void saveReadyMadeToWishlist({ collectionId: wishlistCollections[0].id })
      return
    }
    setWishlistPickerOpen(true)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.headerBackButton}>
            <Feather name="arrow-left" size={20} color={CHARCOAL} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Item</Text>
          <TouchableOpacity
            style={[styles.headerHeartButton, savedWishlistItem && styles.headerHeartButtonSaved]}
            onPress={toggleWishlistSave}
            disabled={!item || savingWishlist}
            accessibilityRole="button"
            accessibilityLabel={savedWishlistItem ? 'Remove item from wishlist' : 'Save item to wishlist'}
          >
            <Feather name="heart" size={18} color={savedWishlistItem ? Colors.textInverse : Colors.midGrey} />
          </TouchableOpacity>
        </View>

        {isLoading && !item ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.loadingText}>Loading item…</Text>
          </View>
        ) : !item ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Item unavailable</Text>
            <Text style={styles.emptyText}>This piece is no longer available right now.</Text>
            <Button label="Back" variant="secondary" onPress={goBack} />
          </View>
        ) : (
          <>
            <View style={styles.mediaCard}>
              {item.photoUrls[imageIndex] && isVideoMediaUrl(item.photoUrls[imageIndex]) ? (
                <PortfolioVideoPreview
                  uri={item.photoUrls[imageIndex]}
                  style={styles.heroImage}
                  contentFit="contain"
                  nativeControls
                />
              ) : item.photoUrls[imageIndex] ? (
                <RemoteImage
                  uri={item.photoUrls[imageIndex]}
                  bucket="seller-item-media"
                  style={styles.heroImage}
                  contentFit="contain"
                  transition={120}
                  surface="customer_ready_made_detail_hero"
                  fallback={(
                    <View style={[styles.heroImage, styles.placeholder]}>
                      <Feather name="shopping-bag" size={28} color={Colors.midGrey} />
                    </View>
                  )}
                />
              ) : (
                <View style={[styles.heroImage, styles.placeholder]}>
                  <Feather name="shopping-bag" size={28} color={Colors.midGrey} />
                </View>
              )}
              {item.photoUrls.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
                  {item.photoUrls.map((url, index) => (
                    <TouchableOpacity
                      key={url}
                      onPress={() => setImageIndex(index)}
                      style={[styles.thumbWrap, index === imageIndex && styles.thumbWrapActive]}
                    >
                      {isVideoMediaUrl(url) ? (
                        <View style={styles.videoThumbWrap}>
                          <PortfolioVideoPreview uri={url} style={styles.thumb} contentFit="contain" autoplay={index === imageIndex} />
                          <View style={styles.videoThumbBadge}>
                            <Feather name="play" size={11} color={Colors.textInverse} />
                          </View>
                        </View>
                      ) : (
                        <RemoteImage
                          uri={url}
                          bucket="seller-item-media"
                          style={styles.thumb}
                          contentFit="contain"
                          transition={120}
                          surface="customer_ready_made_detail_thumb"
                          fallback={(
                            <View style={[styles.thumb, styles.placeholder]}>
                              <Feather name="shopping-bag" size={16} color={Colors.midGrey} />
                            </View>
                          )}
                        />
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : null}
            </View>

            <View style={styles.summaryCard}>
              <Text style={styles.sellerName}>{item.sellerName}</Text>
              <Text style={styles.title}>{item.title}</Text>
              {item.category ? <Text style={styles.category}>{item.category}</Text> : null}
              {stockSignal ? <StockPill signal={stockSignal} /> : null}
              <Text style={styles.price}>
                {formatAmount(item.priceAmount, item.currency as CurrencyCode, item.currency as CurrencyCode, rates)}
              </Text>
              {item.currency !== accountCurrency ? (
                <Text style={styles.priceApprox}>
                  Approx. {formatAmount(item.priceAmount, item.currency as CurrencyCode, accountCurrency, rates)} in your display currency. Checkout uses {item.currency}.
                </Text>
              ) : null}
              {sellerUnavailable ? (
                <View style={styles.unavailableNotice}>
                  <Feather name="pause-circle" size={16} color={Colors.error} />
                  <Text style={styles.unavailableNoticeText}>
                    {item.sellerName} is not accepting new orders right now. Save this item and check back later.
                  </Text>
                </View>
              ) : !canBuy && item.sizes.length > 0 && inStockSizes.length === 0 ? (
                <View style={styles.unavailableNotice}>
                  <Feather name="x-circle" size={16} color={Colors.error} />
                  <Text style={styles.unavailableNoticeText}>
                    All sizes are currently sold out. Save this item to be notified when stock returns.
                  </Text>
                </View>
              ) : null}
            </View>

            {item.sizes.length > 0 ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Available sizes</Text>
                <View style={styles.chipWrap}>
                  {item.sizes.map((size) => (
                    <Chip
                      key={size}
                      label={`${size} · ${quantityForSize(item.sizeInventory, size, item.inventoryQuantity)}`}
                      muted={quantityForSize(item.sizeInventory, size, item.inventoryQuantity) <= 0}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Size guide and fit</Text>
              {sizeRecommendation.status === 'RECOMMENDED' || sizeRecommendation.status === 'BETWEEN' ? (
                <View style={styles.recommendationCard}>
                  <Text style={styles.recommendationEyebrow}>Recommended size</Text>
                  <Text style={styles.recommendationTitle}>{sizeRecommendation.size}</Text>
                  <Text style={styles.recommendationBody}>{sizeRecommendation.detail}</Text>
                  {sizeRecommendation.secondarySize ? (
                    <Text style={styles.recommendationSecondary}>Also close: {sizeRecommendation.secondarySize}</Text>
                  ) : null}
                </View>
              ) : null}
              {sizeRecommendation.status === 'MISSING_MEASUREMENTS' ? (
                <View style={styles.fitPromptCard}>
                  <Text style={styles.fitPromptTitle}>{sizeRecommendation.summary}</Text>
                  <Text style={styles.fitPromptBody}>{sizeRecommendation.detail}</Text>
                  <Button
                    label="Add measurements"
                    variant="secondary"
                    onPress={() =>
                      router.push({
                        pathname: '/(customer)/profile/measurements',
                        params: {
                          returnTo: `/(customer)/tailor/item/${item.id}`,
                          historyChain: appendToHistory(historyChain, `/(customer)/tailor/item/${item.id}`),
                        },
                      })
                    }
                  />
                </View>
              ) : null}
              {sizeRecommendation.status === 'MISSING_GUIDE' ? (
                <View style={styles.fitPromptCard}>
                  <Text style={styles.fitPromptTitle}>Seller fit guide missing</Text>
                  <Text style={styles.fitPromptBody}>
                    This seller has not added body-size ranges for this item yet. Ask a question before you pay if you are unsure about the fit.
                  </Text>
                </View>
              ) : null}
              {sizeRecommendation.status === 'NO_MATCH' ? (
                <View style={styles.fitPromptCard}>
                  <Text style={styles.fitPromptTitle}>{sizeRecommendation.summary}</Text>
                  <Text style={styles.fitPromptBody}>{sizeRecommendation.detail}</Text>
                </View>
              ) : null}
              {hasReadyMadeSizeGuide(sizeGuide, item.sizes) ? (
                <View style={styles.sizeGuideList}>
                  {item.sizes.map((size) => (
                    <View key={size} style={styles.sizeGuideCard}>
                      <View style={styles.sizeGuideHeader}>
                        <Text style={styles.sizeGuideSize}>{size}</Text>
                        {sizeRecommendation.size === size && (
                          <View style={styles.sizeGuideRecommendedBadge}>
                            <Text style={styles.sizeGuideRecommendedText}>Best fit</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.sizeGuideRows}>
                        {sizeGuide.fields.map((field) => {
                          const range = formatFitRange(sizeGuide.sizeRanges[size]?.[field], sizeGuide.unit)
                          if (!range) return null
                          return (
                            <View key={`${size}-${field}`} style={styles.sizeGuideRow}>
                              <Text style={styles.sizeGuideLabel} numberOfLines={1}>
                                {READY_MADE_FIT_FIELDS.find((entry) => entry.key === field)?.label ?? field}
                              </Text>
                              <Text style={styles.sizeGuideValue}>{range}</Text>
                            </View>
                          )
                        })}
                      </View>
                    </View>
                  ))}
                  {sizeGuide.fitNotes ? (
                    <Text style={styles.fitGuideNote}>Fit note: {sizeGuide.fitNotes}</Text>
                  ) : null}
                  {sizeGuide.stretchNotes ? (
                    <Text style={styles.fitGuideNote}>Stretch note: {sizeGuide.stretchNotes}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>How you can get it</Text>
              <View style={styles.chipWrap}>
                {item.pickupAvailable ? <Chip label="Pickup" /> : null}
                {item.deliveryAvailable ? <Chip label="Delivery" /> : null}
                {item.shippingAvailable ? <Chip label="Shipping" /> : null}
              </View>
            </View>

            {item.description ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Details</Text>
                <Text style={styles.description}>{item.description}</Text>
              </View>
            ) : null}

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Returns and remedies</Text>
              <View style={styles.policyWrap}>
                {READY_MADE_POLICY_ROWS.map((row) => (
                  <View key={row.title} style={styles.policyRow}>
                    <Text style={styles.policyTitle}>{row.title}</Text>
                    <Text style={styles.policyBody}>{row.body}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {item ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + Spacing.sm, 14) }]}>
          <View style={styles.footerRow}>
            <Button
              label={startingInquiry ? 'Opening chat...' : 'Ask a question'}
              variant="secondary"
              size="md"
              fullWidth={false}
              style={styles.footerHalfButton}
              onPress={() => { void startSellerInquiry() }}
              disabled={startingInquiry}
            />
            <Button
              label={sellerUnavailable ? 'Seller unavailable' : canBuy && item.inventoryQuantity === 1 ? 'Buy last one' : canBuy ? 'Buy now' : 'Unavailable'}
              size="md"
              fullWidth={false}
              style={styles.footerHalfButton}
              disabled={!canBuy}
              onPress={() => router.push({
                pathname: '/(customer)/tailor/item/checkout/[itemId]',
                params: {
                  itemId: item.id,
                  returnTo: `/(customer)/tailor/item/${item.id}`,
                  historyChain: appendToHistory(historyChain, `/(customer)/tailor/item/${item.id}`),
                },
              })}
            />
          </View>
          <Button
            label={sellerUnavailable ? 'Custom orders unavailable' : 'Custom order instead'}
            variant="ghost"
            size="sm"
            disabled={sellerUnavailable}
            onPress={() => router.push({
              pathname: '/(customer)/brief/[tailorId]',
              params: {
                tailorId: item.tailorProfileId,
                returnTo: `/(customer)/tailor/${item.tailorProfileId}`,
                historyChain: appendToHistory(historyChain, `/(customer)/tailor/item/${item.id}`),
                draftSession: createDraftSessionId(),
                freshStart: '1',
              },
            })}
          />
        </View>
      ) : null}
      <ReadyMadeWishlistModal
        visible={wishlistPickerOpen}
        collections={wishlistCollections}
        newWishlistName={newWishlistName}
        saving={savingWishlist}
        onChangeNewWishlistName={setNewWishlistName}
        onClose={() => {
          setWishlistPickerOpen(false)
          setNewWishlistName('')
        }}
        onSelect={(collectionId) => {
          void saveReadyMadeToWishlist({ collectionId })
        }}
        onCreate={() => {
          const name = newWishlistName.trim()
          if (!name) return
          void saveReadyMadeToWishlist({ collectionName: name })
        }}
      />
    </SafeAreaView>
  )
}

function ReadyMadeWishlistModal({
  visible,
  collections,
  newWishlistName,
  saving,
  onChangeNewWishlistName,
  onClose,
  onSelect,
  onCreate,
}: {
  visible: boolean
  collections: Array<{ id: string; name: string; itemCount: number }>
  newWishlistName: string
  saving: boolean
  onChangeNewWishlistName: (value: string) => void
  onClose: () => void
  onSelect: (collectionId: string) => void
  onCreate: () => void
}) {
  return (
    <SaveToWishlistSheet
      visible={visible}
      collections={collections}
      newWishlistName={newWishlistName}
      saving={saving}
      createPlaceholder="e.g. Ankara Inspo"
      onChangeNewWishlistName={onChangeNewWishlistName}
      onClose={onClose}
      onSelect={onSelect}
      onCreate={onCreate}
    />
  )
}

function Chip({ label, muted = false }: { label: string; muted?: boolean }) {
  return (
    <View style={[styles.chip, muted && styles.chipMuted]}>
      <Text style={[styles.chipText, muted && styles.chipTextMuted]}>{label}</Text>
    </View>
  )
}

function StockPill({ signal }: { signal: ReturnType<typeof buildCustomerStockSignal> }) {
  return (
    <View
      style={[
        styles.availabilityPill,
        signal.tone === 'available' && styles.availabilityPillAvailable,
        signal.tone === 'warning' && styles.availabilityPillWarning,
        signal.tone === 'urgent' && styles.availabilityPillUrgent,
        signal.tone === 'muted' && styles.availabilityPillMuted,
      ]}
    >
      <Text
        style={[
          styles.availabilityText,
          signal.tone === 'available' && styles.availabilityTextAvailable,
          signal.tone === 'warning' && styles.availabilityTextWarning,
          signal.tone === 'urgent' && styles.availabilityTextUrgent,
          signal.tone === 'muted' && styles.availabilityTextMuted,
        ]}
      >
        {signal.label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: HOME_BG },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.sm, paddingBottom: Spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44 },
  headerBackButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerHeartButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    ...Shadow.sm,
  },
  headerHeartButtonSaved: { backgroundColor: Colors.needleGreen },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: FontWeight.semibold, color: CHARCOAL, fontFamily: Fonts.display },
  loadingCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm, ...Shadow.sm },
  loadingText: { fontSize: 14, color: Colors.inkLight },
  emptyCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm },
  emptyTitle: { fontSize: 16, fontWeight: FontWeight.semibold, color: CHARCOAL },
  emptyText: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  mediaCard: { gap: Spacing.xs },
  heroImage: { width: '100%', height: 244, borderRadius: Radius.md, backgroundColor: Colors.boneDeep },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  thumbRow: { gap: Spacing.sm },
  thumbWrap: { width: 60, height: 60, borderRadius: Radius.sm, overflow: 'hidden', borderWidth: 1.5, borderColor: 'transparent' },
  thumbWrapActive: { borderColor: PRIMARY_GREEN },
  thumb: { width: '100%', height: '100%', backgroundColor: Colors.boneDeep },
  videoThumbWrap: { width: '100%', height: '100%', position: 'relative' },
  videoThumbBadge: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(17,17,17,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 12, gap: 4, ...Shadow.sm },
  sellerName: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  title: { fontSize: 24, lineHeight: 28, fontWeight: FontWeight.bold, color: CHARCOAL, fontFamily: Fonts.display },
  category: { fontSize: 13, color: MUTED_GREY },
  availabilityPill: {
    alignSelf: 'flex-start',
    marginTop: 2,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  availabilityPillAvailable: { backgroundColor: Colors.needleGreenLight },
  availabilityPillWarning: { backgroundColor: Colors.statusPendingBg },
  availabilityPillUrgent: { backgroundColor: Colors.errorLight },
  availabilityPillMuted: { backgroundColor: Colors.boneDeep },
  availabilityText: { fontSize: 12, fontWeight: FontWeight.semibold },
  availabilityTextAvailable: { color: PRIMARY_GREEN },
  availabilityTextWarning: { color: Colors.statusPending },
  availabilityTextUrgent: { color: Colors.error },
  availabilityTextMuted: { color: Colors.midGrey },
  price: { marginTop: 4, fontSize: 22, fontWeight: FontWeight.bold, color: PRIMARY_GREEN, fontFamily: Fonts.display },
  priceApprox: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  unavailableNotice: {
    marginTop: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: Colors.errorLight,
    padding: Spacing.sm,
  },
  unavailableNoticeText: { flex: 1, fontSize: FontSize.xs, color: Colors.error, lineHeight: 18 },
  sectionCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 12, gap: 8, ...Shadow.sm },
  sectionTitle: { fontSize: 15, fontWeight: FontWeight.semibold, color: CHARCOAL, fontFamily: Fonts.display },
  recommendationCard: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.md,
    padding: 12,
    gap: 4,
  },
  recommendationEyebrow: { fontSize: 11, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  recommendationTitle: { fontSize: 22, color: CHARCOAL, fontWeight: FontWeight.bold, fontFamily: Fonts.display },
  recommendationBody: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  recommendationSecondary: { fontSize: 12, color: PRIMARY_GREEN, fontWeight: FontWeight.medium },
  fitPromptCard: {
    backgroundColor: HOME_BG,
    borderRadius: Radius.md,
    padding: 12,
    gap: 8,
  },
  fitPromptTitle: { fontSize: 14, color: CHARCOAL, fontWeight: FontWeight.semibold },
  fitPromptBody: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  sizeGuideList: { gap: 8 },
  sizeGuideCard: {
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    padding: 12,
    gap: 8,
  },
  sizeGuideHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  sizeGuideSize: { fontSize: 14, color: CHARCOAL, fontWeight: FontWeight.semibold },
  sizeGuideRecommendedBadge: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sizeGuideRecommendedText: { fontSize: 10, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  sizeGuideRows: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  sizeGuideRow: { width: '48%', gap: 2 },
  sizeGuideLabel: { fontSize: 11, color: MUTED_GREY },
  sizeGuideValue: { fontSize: 12, color: CHARCOAL, fontWeight: FontWeight.medium },
  fitGuideNote: { fontSize: 12, color: MUTED_GREY, lineHeight: 16 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: HOME_BG, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 6, minHeight: 28, justifyContent: 'center' },
  chipMuted: { opacity: 0.7 },
  chipText: { fontSize: 12, color: Colors.inkLight, fontWeight: FontWeight.medium },
  chipTextMuted: { color: MUTED_GREY },
  description: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  policyWrap: { gap: 8 },
  policyRow: { gap: 4 },
  policyTitle: { fontSize: 13, fontWeight: FontWeight.semibold, color: CHARCOAL },
  policyBody: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 8,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
  },
  footerRow: { flexDirection: 'row', gap: 8 },
  footerHalfButton: { flex: 1, minHeight: 44 },
})
