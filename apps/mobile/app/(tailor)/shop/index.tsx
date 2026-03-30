import { useCallback, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Image, Alert } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { invokeFunction, supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

type SellerItem = {
  id: string
  title: string
  category: string | null
  priceAmount: number
  currency: string
  stockStatus: string
  isLive: boolean
  photoUrls: string[]
}

type SellerProfile = {
  id: string
  supportsReadyMade: boolean
}

const FILTERS = ['LIVE', 'DRAFTS', 'SOLD'] as const
type Filter = typeof FILTERS[number]

export default function TailorShopScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('LIVE')
  const [profile, setProfile] = useState<SellerProfile | null>(null)
  const [items, setItems] = useState<SellerItem[]>([])
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      let active = true

      async function load() {
        if (!user?.id) return
        setLoading(true)

        const { data: profileData } = await supabase
          .from('tailor_profiles')
          .select('id, supports_ready_made')
          .eq('user_id', user.id)
          .maybeSingle()

        if (!active) return

        if (!profileData?.id) {
          setProfile(null)
          setItems([])
          setLoading(false)
          return
        }

        setProfile({
          id: profileData.id,
          supportsReadyMade: profileData.supports_ready_made ?? false,
        })

        const { data: itemsData } = await supabase
          .from('seller_items')
          .select('id, title, category, price_amount, currency, stock_status, is_live, photo_urls')
          .eq('tailor_profile_id', profileData.id)
          .order('updated_at', { ascending: false })

        if (!active) return

        setItems(
          (itemsData ?? []).map((row: any) => ({
            id: row.id,
            title: row.title,
            category: row.category ?? null,
            priceAmount: row.price_amount,
            currency: row.currency,
            stockStatus: row.stock_status,
            isLive: row.is_live,
            photoUrls: Array.isArray(row.photo_urls) ? row.photo_urls.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0) : [],
          }))
        )
        setLoading(false)
      }

      void load()
      return () => {
        active = false
      }
    }, [user?.id])
  )

  const filteredItems = items.filter((item) => {
    if (filter === 'LIVE') return item.isLive && item.stockStatus !== 'SOLD_OUT' && item.stockStatus !== 'HIDDEN'
    if (filter === 'DRAFTS') return !item.isLive || item.stockStatus === 'HIDDEN'
    return item.stockStatus === 'SOLD_OUT'
  })

  async function updateItemState(
    itemId: string,
    action: 'publish-item' | 'hide-item' | 'mark-sold' | 'relist-item'
  ) {
    if (updatingItemId) return
    setUpdatingItemId(itemId)
    try {
      const { data, error } = await invokeFunction<{ ok: boolean; itemId: string; isLive: boolean; stockStatus: string }>(
        'seller-item-action',
        { body: { action, itemId } }
      )

      if (error || !data?.itemId) {
        throw error ?? new Error('Could not update this item.')
      }

      setItems((current) =>
        current.map((item) =>
          item.id === data.itemId
            ? { ...item, isLive: data.isLive, stockStatus: data.stockStatus }
            : item
        )
      )
    } catch (error: any) {
      Alert.alert('Update failed', error?.message ?? 'Could not update this item right now.')
    } finally {
      setUpdatingItemId(null)
    }
  }

  function confirmItemAction(item: SellerItem, action: 'publish-item' | 'hide-item' | 'mark-sold' | 'relist-item') {
    if (action === 'mark-sold') {
      Alert.alert(
        'Mark as sold?',
        `"${item.title}" will move to Sold and stop showing to buyers.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Mark sold', onPress: () => void updateItemState(item.id, action) },
        ]
      )
      return
    }

    if (action === 'relist-item') {
      Alert.alert(
        'Relist item?',
        `"${item.title}" will go live again and buyers will be able to order it.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Relist', onPress: () => void updateItemState(item.id, action) },
        ]
      )
      return
    }

    void updateItemState(item.id, action)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Shop</Text>
          <TouchableOpacity style={styles.addBtn} onPress={() => router.push('/(tailor)/shop/new')}>
            <Feather name="plus" size={16} color={Colors.white} />
            <Text style={styles.addBtnText}>Add item</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bestUseCard}>
          <Text style={styles.bestUseEyebrow}>Best use</Text>
          <Text style={styles.bestUseText}>Keep ready-made items simple: clear photo, clear size, clear price, clear delivery choice.</Text>
        </View>

        {!profile?.supportsReadyMade ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Shop now is off</Text>
            <Text style={styles.emptyHint}>Turn on ready-made selling in your profile before you list items.</Text>
            <Button label="Open profile" variant="secondary" onPress={() => router.push('/(tailor)/profile/edit')} />
          </View>
        ) : loading ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.emptyTitle}>Loading your items…</Text>
          </View>
        ) : (
          <>
            <View style={styles.filterRow}>
              {FILTERS.map((value) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.filterPill, filter === value && styles.filterPillActive]}
                  onPress={() => setFilter(value)}
                >
                  <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{value === 'LIVE' ? 'Live' : value === 'DRAFTS' ? 'Drafts' : 'Sold'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {filteredItems.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No items here yet</Text>
                <Text style={styles.emptyHint}>
                  {filter === 'LIVE'
                    ? 'Add your first ready-made piece so customers can shop directly from your profile.'
                    : filter === 'DRAFTS'
                      ? 'Draft items will show here until you publish them.'
                      : 'Sold items will show here once you mark them sold.'}
                </Text>
                <Button label="Add item" onPress={() => router.push('/(tailor)/shop/new')} />
              </View>
            ) : (
              <View style={styles.itemList}>
                {filteredItems.map((item) => (
                  <View key={item.id} style={styles.itemCard}>
                    {item.photoUrls[0] ? (
                      <Image source={{ uri: item.photoUrls[0] }} style={styles.itemThumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.itemThumb, styles.itemThumbPlaceholder]}>
                        <Feather name="image" size={18} color={Colors.midGrey} />
                      </View>
                    )}
                    <View style={styles.itemBody}>
                      <Text style={styles.itemTitle}>{item.title}</Text>
                      <Text style={styles.itemMeta}>
                        {item.category ? `${item.category} · ` : ''}{item.currency} {(item.priceAmount / 100).toFixed(2)}
                      </Text>
                      <View style={styles.itemActions}>
                        {item.isLive && item.stockStatus !== 'SOLD_OUT' ? (
                          <>
                            <TouchableOpacity
                              style={[styles.itemActionBtn, styles.itemActionBtnGhost]}
                              onPress={() => confirmItemAction(item, 'hide-item')}
                              disabled={updatingItemId === item.id}
                            >
                              <Text style={styles.itemActionGhostText}>
                                {updatingItemId === item.id ? 'Saving…' : 'Move to draft'}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.itemActionBtn}
                              onPress={() => confirmItemAction(item, 'mark-sold')}
                              disabled={updatingItemId === item.id}
                            >
                              <Text style={styles.itemActionText}>Mark sold</Text>
                            </TouchableOpacity>
                          </>
                        ) : item.stockStatus === 'SOLD_OUT' ? (
                          <TouchableOpacity
                            style={styles.itemActionBtn}
                            onPress={() => confirmItemAction(item, 'relist-item')}
                            disabled={updatingItemId === item.id}
                          >
                            <Text style={styles.itemActionText}>
                              {updatingItemId === item.id ? 'Saving…' : 'Relist'}
                            </Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            style={styles.itemActionBtn}
                            onPress={() => confirmItemAction(item, 'publish-item')}
                            disabled={updatingItemId === item.id}
                          >
                            <Text style={styles.itemActionText}>
                              {updatingItemId === item.id ? 'Saving…' : 'Move to live'}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                    <View style={[styles.statusPill, item.isLive ? styles.statusLive : styles.statusMuted]}>
                      <Text style={[styles.statusText, item.isLive ? styles.statusLiveText : styles.statusMutedText]}>
                        {item.stockStatus === 'SOLD_OUT' ? 'Sold' : item.isLive ? 'Live' : 'Draft'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.lg, paddingBottom: Spacing.xxxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: FontSize.xxxl, fontWeight: FontWeight.bold, color: Colors.ink },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  addBtnText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  bestUseCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.lg, gap: 6, ...Shadow.sm },
  bestUseEyebrow: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  bestUseText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  filterRow: { flexDirection: 'row', gap: Spacing.sm },
  filterPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  filterPillActive: { backgroundColor: Colors.needleGreen, borderColor: Colors.needleGreen },
  filterText: { color: Colors.inkLight, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  filterTextActive: { color: Colors.white },
  emptyCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.xl, gap: Spacing.md, ...Shadow.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyHint: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  itemList: { gap: Spacing.sm },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...Shadow.sm,
  },
  itemThumb: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
    backgroundColor: Colors.lightGrey,
  },
  itemThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBody: {
    flex: 1,
    gap: Spacing.sm,
  },
  itemTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  itemMeta: { fontSize: FontSize.sm, color: Colors.midGrey, marginTop: 2 },
  itemActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  itemActionBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  itemActionBtnGhost: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  itemActionText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.white,
  },
  itemActionGhostText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  statusPill: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  statusLive: { backgroundColor: Colors.needleGreenLight },
  statusMuted: { backgroundColor: Colors.bone },
  statusText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.4 },
  statusLiveText: { color: Colors.needleGreen },
  statusMutedText: { color: Colors.midGrey },
})
