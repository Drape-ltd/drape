import { useMemo } from 'react'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native'
import { Image as ExpoImage } from 'expo-image'
import { Feather } from '@expo/vector-icons'
import { useRefreshOnFocus, useTailorShop } from '@/lib/queries'
import { Button } from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { goBackOrReturnToIfNeeded } from '@/lib/navigation'

export default function TailorShopScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { data, isLoading, refetch } = useTailorShop(id)
  const tailorName = data?.tailorName ?? 'This seller'
  const items = useMemo(() => data?.items ?? [], [data?.items])

  useRefreshOnFocus(() => { void refetch() }, 0)

  function goBack() {
    goBackOrReturnToIfNeeded(router, navigation, returnTo, `/(customer)/tailor/${id}`)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack}>
            <Feather name="arrow-left" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Shop</Text>
          <View style={{ width: 22 }} />
        </View>

        <View style={styles.bestUseCard}>
          <Text style={styles.bestUseEyebrow}>Shop now</Text>
          <Text style={styles.bestUseText}>Buy ready-made pieces from {tailorName}. If you need something custom, go back and start a custom order.</Text>
        </View>

        {isLoading && !data ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.emptyTitle}>Loading items…</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No ready-made pieces yet</Text>
            <Text style={styles.emptyHint}>This seller has not listed any live ready-made items yet.</Text>
            <Button
              label="Start custom order"
              onPress={() => router.push({
                pathname: `/(customer)/brief/${id}` as any,
                params: {
                  returnTo: `/(customer)/tailor/shop/${id}`,
                  draftSession: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                  freshStart: '1',
                },
              })}
            />
          </View>
        ) : (
          <View style={styles.itemList}>
            {items.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.itemCard}
                activeOpacity={0.95}
                onPress={() =>
                  router.push({
                    pathname: '/(customer)/tailor/item/[itemId]',
                    params: { itemId: item.id, returnTo: `/(customer)/tailor/shop/${id}` },
                  })
                }
              >
                {item.photoUrls[0] ? (
                  <ExpoImage source={{ uri: item.photoUrls[0] }} style={styles.itemImage} contentFit="cover" transition={180} />
                ) : (
                  <View style={[styles.itemImage, styles.itemPlaceholder]}>
                    <Feather name="shopping-bag" size={24} color={Colors.midGrey} />
                  </View>
                )}
                <View style={styles.itemBody}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  {item.category ? <Text style={styles.itemCategory}>{item.category}</Text> : null}
                  <Text style={styles.itemPrice}>{item.currency} {(item.priceAmount / 100).toFixed(2)}</Text>
                  <View style={styles.chipWrap}>
                    {item.pickupAvailable ? <Chip label="Pickup" /> : null}
                    {item.deliveryAvailable ? <Chip label="Delivery" /> : null}
                    {item.shippingAvailable ? <Chip label="Shipping" /> : null}
                  </View>
                </View>
              </TouchableOpacity>
            ))}
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.md, paddingBottom: Spacing.xxxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
  bestUseCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 4, ...Shadow.sm },
  bestUseEyebrow: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  bestUseText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 18 },
  emptyCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 16, gap: Spacing.sm, ...Shadow.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  emptyHint: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 18 },
  itemList: { gap: Spacing.md },
  itemCard: { backgroundColor: Colors.white, borderRadius: Radius.md, overflow: 'hidden', ...Shadow.sm },
  itemImage: { width: '100%', height: 168, backgroundColor: Colors.lightGrey },
  itemPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  itemBody: { padding: 14, gap: 4 },
  itemTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  itemCategory: { fontSize: FontSize.xs, color: Colors.midGrey },
  itemPrice: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.needleGreen, fontFamily: 'Georgia' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
  chip: { backgroundColor: Colors.bone, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  chipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
})
