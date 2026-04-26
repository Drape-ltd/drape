import { useMemo } from 'react'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image } from 'react-native'
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
                params: { returnTo: `/(customer)/tailor/shop/${id}` },
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
                  <Image source={{ uri: item.photoUrls[0] }} style={styles.itemImage} resizeMode="cover" />
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
  content: { padding: Spacing.xl, gap: Spacing.lg, paddingBottom: Spacing.xxxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  bestUseCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.lg, gap: 6, ...Shadow.sm },
  bestUseEyebrow: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  bestUseText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  emptyCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.xl, gap: Spacing.md, ...Shadow.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyHint: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  itemList: { gap: Spacing.md },
  itemCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, overflow: 'hidden', ...Shadow.sm },
  itemImage: { width: '100%', height: 180, backgroundColor: Colors.lightGrey },
  itemPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  itemBody: { padding: Spacing.lg, gap: 6 },
  itemTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  itemCategory: { fontSize: FontSize.sm, color: Colors.midGrey },
  itemPrice: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
  chip: { backgroundColor: Colors.bone, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  chipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
})
