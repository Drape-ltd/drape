import { useState } from 'react'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Alert } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSellerItem } from '@/lib/queries'
import { invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue, readFunctionErrorMessage, readFunctionErrorPayload } from '@/lib/function-errors'
import { Button } from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

export default function SellerItemDetailScreen() {
  const { itemId, returnTo } = useLocalSearchParams<{ itemId: string; returnTo?: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [startingInquiry, setStartingInquiry] = useState(false)
  const [imageIndex, setImageIndex] = useState(0)
  const { data: item, isLoading, isFetching } = useSellerItem(itemId)

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
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack}>
            <Feather name="arrow-left" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Item</Text>
          <View style={{ width: 22 }} />
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
              {isFetching ? <Text style={styles.refreshingText}>Refreshing item…</Text> : null}
              <Text style={styles.sellerName}>{item.sellerName}</Text>
              <Text style={styles.title}>{item.title}</Text>
              {item.category ? <Text style={styles.category}>{item.category}</Text> : null}
              <Text style={styles.price}>{item.currency} {(item.priceAmount / 100).toFixed(2)}</Text>
            </View>

            {item.sizes.length > 0 ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Available sizes</Text>
                <View style={styles.chipWrap}>
                  {item.sizes.map((size) => (
                    <Chip key={size} label={size} />
                  ))}
                </View>
              </View>
            ) : null}

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
          </>
        )}
      </ScrollView>

      {item ? (
        <View style={styles.footer}>
          <Button
            label={startingInquiry ? 'Opening chat…' : 'Message seller'}
            variant="secondary"
            onPress={() => { void startSellerInquiry() }}
            disabled={startingInquiry}
          />
          <Button
            label="Buy now"
            onPress={() => router.push({
              pathname: '/(customer)/tailor/item/checkout/[itemId]',
              params: {
                itemId: item.id,
                returnTo: `/(customer)/tailor/item/${item.id}`,
              },
            })}
          />
          <Button
            label="Custom order instead"
            variant="ghost"
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

function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.lg, paddingBottom: Spacing.xxxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  loadingCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center', gap: Spacing.md, ...Shadow.sm },
  loadingText: { fontSize: FontSize.md, color: Colors.inkLight },
  emptyCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.xl, gap: Spacing.md, ...Shadow.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  refreshingText: { fontSize: FontSize.xs, color: Colors.midGrey },
  mediaCard: { gap: Spacing.sm },
  heroImage: { width: '100%', height: 320, borderRadius: Radius.xl, backgroundColor: Colors.lightGrey },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  thumbRow: { gap: Spacing.sm },
  thumbWrap: { width: 72, height: 72, borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1.5, borderColor: 'transparent' },
  thumbWrapActive: { borderColor: Colors.needleGreen },
  thumb: { width: '100%', height: '100%' },
  summaryCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.xl, gap: 4, ...Shadow.sm },
  sellerName: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
  category: { fontSize: FontSize.sm, color: Colors.midGrey },
  price: { marginTop: Spacing.sm, fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  sectionCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { backgroundColor: Colors.bone, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  chipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
  description: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  bestUseCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.lg, gap: 6, ...Shadow.sm },
  bestUseEyebrow: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  bestUseText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    gap: Spacing.sm,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
  },
})
