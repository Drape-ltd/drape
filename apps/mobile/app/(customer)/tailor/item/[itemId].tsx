import { useMemo, useState } from 'react'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Alert } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useCustomerMeasurements, useRefreshOnFocus, useSellerItem } from '@/lib/queries'
import { quantityForSize } from '@/lib/ready-made-stock'
import { invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { READY_MADE_POLICY_ROWS } from '@/lib/ready-made-policy'
import { isLikelyConnectivityIssue, readFunctionErrorMessage, readFunctionErrorPayload } from '@/lib/function-errors'
import {
  formatFitRange,
  hasReadyMadeSizeGuide,
  normalizeReadyMadeSizeGuide,
  READY_MADE_FIT_FIELDS,
  recommendReadyMadeSize,
} from '@/lib/ready-made-fit'
import { Button } from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

const HOME_BG = '#F9F7F3'
const PRIMARY_GREEN = '#1D9E75'
const CHARCOAL = '#2C2C2A'
const MUTED_GREY = '#8F8D88'

function availabilityCopy(inventoryQuantity: number) {
  if (inventoryQuantity <= 1) return 'Only 1 left'
  if (inventoryQuantity <= 2) return `Only ${inventoryQuantity} left`
  return `${inventoryQuantity} ready now`
}

export default function SellerItemDetailScreen() {
  const { itemId, returnTo } = useLocalSearchParams<{ itemId: string; returnTo?: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [startingInquiry, setStartingInquiry] = useState(false)
  const [imageIndex, setImageIndex] = useState(0)
  const { data: item, isLoading, refetch } = useSellerItem(itemId)
  const { data: measurements } = useCustomerMeasurements(user?.id)

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

  function goBack() {
    if (returnTo) {
      router.replace(returnTo as any)
    } else if (navigation.canGoBack()) router.back()
    else if (item?.tailorProfileId) router.replace(`/(customer)/tailor/${item.tailorProfileId}`)
    else router.replace('/(customer)')
  }

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
        const payload = error ? await readFunctionErrorPayload(error) : null
        const message =
          typeof payload?.error === 'string' && payload.error.length > 0
            ? payload.error
            : await readFunctionErrorMessage(error, 'Could not start this conversation.')
        throw new Error(message)
      }

      router.push({
        pathname: '/(customer)/messages/[orderId]',
        params: { orderId: data.orderId, returnTo: `/(customer)/tailor/item/${item.id}` },
      })
    } catch (error: any) {
      Alert.alert(
        'Could not start chat',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Retry from this item when the signal improves, or check Messages if the inquiry already started.'
          : error?.message ?? 'Please try again.',
      )
    } finally {
      setStartingInquiry(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.headerBackButton}>
            <Feather name="arrow-left" size={20} color={CHARCOAL} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Item</Text>
          <View style={styles.headerSpacer} />
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
              {item.photoUrls[imageIndex] ? (
                <Image source={{ uri: item.photoUrls[imageIndex] }} style={styles.heroImage} resizeMode="cover" />
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
                      <Image source={{ uri: url }} style={styles.thumb} resizeMode="cover" />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : null}
            </View>

            <View style={styles.summaryCard}>
              <Text style={styles.sellerName}>{item.sellerName}</Text>
              <Text style={styles.title}>{item.title}</Text>
              {item.category ? <Text style={styles.category}>{item.category}</Text> : null}
              <View style={styles.availabilityPill}>
                <Text style={styles.availabilityText}>{availabilityCopy(item.inventoryQuantity)}</Text>
              </View>
              <Text style={styles.price}>{item.currency} {(item.priceAmount / 100).toFixed(2)}</Text>
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
                    onPress={() => router.push('/(customer)/profile/measurements')}
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

            <View style={styles.bestUseCard}>
              <Text style={styles.bestUseEyebrow}>Best use</Text>
              <Text style={styles.bestUseText}>If you need another size, colour, fabric, or finish, message the seller or place a custom order instead.</Text>
            </View>

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
        <View style={styles.footer}>
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
              label="Buy now"
              size="md"
              fullWidth={false}
              style={styles.footerHalfButton}
              onPress={() => router.push({
                pathname: '/(customer)/tailor/item/checkout/[itemId]',
                params: {
                  itemId: item.id,
                  returnTo: `/(customer)/tailor/item/${item.id}`,
                },
              })}
            />
          </View>
          <Button
            label="Custom order instead"
            variant="ghost"
            size="sm"
            onPress={() => router.push({
              pathname: `/(customer)/brief/${item.tailorProfileId}` as any,
              params: { returnTo: `/(customer)/tailor/${item.tailorProfileId}` },
            })}
          />
        </View>
      ) : null}
    </SafeAreaView>
  )
}

function Chip({ label, muted = false }: { label: string; muted?: boolean }) {
  return (
    <View style={[styles.chip, muted && styles.chipMuted]}>
      <Text style={[styles.chipText, muted && styles.chipTextMuted]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: HOME_BG },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.md, paddingBottom: Spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44 },
  headerBackButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerSpacer: { width: 44, height: 44 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: FontWeight.semibold, color: CHARCOAL },
  loadingCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm, ...Shadow.sm },
  loadingText: { fontSize: 14, color: Colors.inkLight },
  emptyCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm },
  emptyTitle: { fontSize: 16, fontWeight: FontWeight.semibold, color: CHARCOAL },
  emptyText: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  mediaCard: { gap: Spacing.sm },
  heroImage: { width: '100%', height: 264, borderRadius: Radius.md, backgroundColor: Colors.lightGrey },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  thumbRow: { gap: Spacing.sm },
  thumbWrap: { width: 60, height: 60, borderRadius: Radius.sm, overflow: 'hidden', borderWidth: 1.5, borderColor: 'transparent' },
  thumbWrapActive: { borderColor: PRIMARY_GREEN },
  thumb: { width: '100%', height: '100%' },
  summaryCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 4, ...Shadow.sm },
  sellerName: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  title: { fontSize: 28, lineHeight: 32, fontWeight: FontWeight.bold, color: CHARCOAL },
  category: { fontSize: 13, color: MUTED_GREY },
  availabilityPill: {
    alignSelf: 'flex-start',
    marginTop: 2,
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  availabilityText: { fontSize: 12, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  price: { marginTop: 4, fontSize: 22, fontWeight: FontWeight.bold, color: PRIMARY_GREEN },
  sectionCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 8, ...Shadow.sm },
  sectionTitle: { fontSize: 15, fontWeight: FontWeight.semibold, color: CHARCOAL },
  recommendationCard: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.md,
    padding: 14,
    gap: 4,
  },
  recommendationEyebrow: { fontSize: 11, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  recommendationTitle: { fontSize: 24, color: CHARCOAL, fontWeight: FontWeight.bold },
  recommendationBody: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
  recommendationSecondary: { fontSize: 12, color: PRIMARY_GREEN, fontWeight: FontWeight.medium },
  fitPromptCard: {
    backgroundColor: HOME_BG,
    borderRadius: Radius.md,
    padding: 14,
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
  bestUseCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 4, ...Shadow.sm },
  bestUseEyebrow: { fontSize: 11, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  bestUseText: { fontSize: 13, color: Colors.inkLight, lineHeight: 18 },
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
