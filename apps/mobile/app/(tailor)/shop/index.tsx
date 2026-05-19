import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, RefreshControl } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { invokeFunction, supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { buildTailorStockAlert, formatSizeInventorySummary, normalizeSizeInventory, type SizeInventory } from '@/lib/ready-made-stock'
import { Button, RemoteImage } from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

type SellerItem = {
  id: string
  title: string
  category: string | null
  priceAmount: number
  currency: string
  sizes: string[]
  sizeInventory: SizeInventory
  stockStatus: string
  inventoryQuantity: number
  isLive: boolean
  photoUrls: string[]
}

type SellerProfile = {
  id: string
  supportsReadyMade: boolean
}

const FILTERS = ['LIVE', 'DRAFTS', 'SOLD'] as const
type Filter = typeof FILTERS[number]

function isMissingInventoryColumnError(error: any) {
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : ''
  const details = typeof error?.details === 'string' ? error.details.toLowerCase() : ''
  const hint = typeof error?.hint === 'string' ? error.hint.toLowerCase() : ''
  return [message, details, hint].some((value) => value.includes('inventory_quantity') || value.includes('size_inventory'))
}

function fallbackInventoryQuantity(item: { stock_status?: string | null; is_live?: boolean | null }) {
  if (!item.is_live || item.stock_status === 'SOLD_OUT' || item.stock_status === 'HIDDEN') return 0
  if (item.stock_status === 'LOW_STOCK') return 1
  return 1
}

function effectiveStockStatus(item: SellerItem) {
  if (item.stockStatus === 'SOLD_OUT') return 'SOLD_OUT'
  if (!item.isLive || item.stockStatus === 'HIDDEN') return 'HIDDEN'
  if (item.inventoryQuantity <= 0) return 'SOLD_OUT'
  if (item.stockStatus === 'LOW_STOCK' || item.inventoryQuantity <= 2) return 'LOW_STOCK'
  return 'IN_STOCK'
}

function stockLabel(item: SellerItem) {
  const status = effectiveStockStatus(item)
  if (status === 'SOLD_OUT' && item.inventoryQuantity > 0) return 'Ready to relist'
  if (status === 'SOLD_OUT') return 'Sold out'
  if (status === 'HIDDEN') return 'Draft'
  if (status === 'LOW_STOCK') return 'Low stock'
  return 'Live'
}

function stockSummary(item: SellerItem) {
  return formatSizeInventorySummary(item.sizes, item.sizeInventory, item.inventoryQuantity)
}

function stockPillStyles(item: SellerItem) {
  const status = effectiveStockStatus(item)
  if (status === 'SOLD_OUT' && item.inventoryQuantity > 0) {
    return { container: styles.statusWarning, text: styles.statusWarningText }
  }
  if (status === 'SOLD_OUT') {
    return { container: styles.statusMuted, text: styles.statusMutedText }
  }
  if (status === 'HIDDEN') {
    return { container: styles.statusMuted, text: styles.statusMutedText }
  }
  if (status === 'LOW_STOCK') {
    return { container: styles.statusWarning, text: styles.statusWarningText }
  }
  return { container: styles.statusLive, text: styles.statusLiveText }
}

export default function TailorShopScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ filter?: string }>()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('LIVE')
  const [profile, setProfile] = useState<SellerProfile | null>(null)
  const [items, setItems] = useState<SellerItem[]>([])
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const requestedFilter = typeof params.filter === 'string' ? params.filter.toUpperCase() : ''
    if (requestedFilter && FILTERS.includes(requestedFilter as Filter)) {
      setFilter(requestedFilter as Filter)
    }
  }, [params.filter])

  const loadShop = useCallback(async (showSpinner = true) => {
    if (!user?.id) {
      setProfile(null)
      setItems([])
      setLoading(false)
      return
    }
    if (showSpinner) setLoading(true)

    const { data: profileData } = await supabase
      .from('tailor_profiles')
      .select('id, supports_ready_made')
      .eq('user_id', user.id)
      .maybeSingle()

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

    const primary = await supabase
      .from('seller_items')
      .select('id, title, category, sizes, price_amount, currency, stock_status, inventory_quantity, size_inventory, is_live, photo_urls')
      .eq('tailor_profile_id', profileData.id)
      .order('updated_at', { ascending: false })

    let itemsData: any[] | null = primary.data as any[] | null
    let itemsError: any = primary.error

    if (itemsError && isMissingInventoryColumnError(itemsError)) {
      const fallback = await supabase
        .from('seller_items')
        .select('id, title, category, sizes, price_amount, currency, stock_status, inventory_quantity, is_live, photo_urls')
        .eq('tailor_profile_id', profileData.id)
        .order('updated_at', { ascending: false })

      itemsData = fallback.data
      itemsError = fallback.error
    }

    if (itemsError) {
      Alert.alert('Shop unavailable', 'We could not load your shop items right now.')
      setItems([])
      setLoading(false)
      return
    }

    setItems(
      (itemsData ?? []).map((row: any) => ({
        id: row.id,
        title: row.title,
        category: row.category ?? null,
        sizes: Array.isArray(row.sizes) ? row.sizes.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0) : [],
        sizeInventory: normalizeSizeInventory(
          Array.isArray(row.sizes) ? row.sizes.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0) : [],
          row.size_inventory,
          typeof row.inventory_quantity === 'number'
            ? row.inventory_quantity
            : fallbackInventoryQuantity(row),
        ),
        priceAmount: row.price_amount,
        currency: row.currency,
        stockStatus: row.stock_status,
        inventoryQuantity:
          typeof row.inventory_quantity === 'number'
            ? row.inventory_quantity
            : fallbackInventoryQuantity(row),
        isLive: row.is_live,
        photoUrls: Array.isArray(row.photo_urls) ? row.photo_urls.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0) : [],
      }))
    )
    setLoading(false)
  }, [user?.id])

  useFocusEffect(
    useCallback(() => {
      void loadShop()
    }, [loadShop])
  )

  async function onRefresh() {
    setRefreshing(true)
    await loadShop(false)
    setRefreshing(false)
  }

  const filteredItems = items.filter((item) => {
    const status = effectiveStockStatus(item)
    if (filter === 'LIVE') return item.isLive && status !== 'SOLD_OUT' && status !== 'HIDDEN'
    if (filter === 'DRAFTS') return status === 'HIDDEN'
    return status === 'SOLD_OUT'
  })
  const stockAlerts = items
    .map((item) =>
      buildTailorStockAlert({
        itemId: item.id,
        title: item.title,
        sizes: item.sizes,
        sizeInventory: item.sizeInventory,
        inventoryQuantity: item.inventoryQuantity,
        isLive: item.isLive,
        stockStatus: item.stockStatus,
      }),
    )
    .filter((value): value is NonNullable<typeof value> => !!value)
    .slice(0, 3)

  async function updateItemState(
    itemId: string,
    action: 'publish-item' | 'hide-item' | 'mark-sold' | 'relist-item' | 'delete-item'
  ) {
    if (updatingItemId) return
    setUpdatingItemId(itemId)
    try {
      const { data, error } = await invokeFunction<{ ok: boolean; itemId: string; isLive?: boolean; stockStatus?: string; inventoryQuantity?: number; sizeInventory?: SizeInventory; deleted?: boolean }>(
        'seller-item-action',
        { body: { action, itemId } }
      )

      if (error || !data?.itemId) {
        throw error ?? new Error('Could not update this item.')
      }

      if (data.deleted) {
        setItems((current) => current.filter((item) => item.id !== data.itemId))
        return
      }

      setItems((current) =>
        current.map((item) =>
          item.id === data.itemId
            ? {
                ...item,
                isLive: data.isLive ?? item.isLive,
                stockStatus: data.stockStatus ?? item.stockStatus,
                inventoryQuantity: data.inventoryQuantity ?? item.inventoryQuantity,
                sizeInventory: data.sizeInventory ?? item.sizeInventory,
              }
            : item
        )
      )
    } catch (error: any) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not update this item yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not update this item right now.')
      Alert.alert(
        action === 'publish-item' || action === 'relist-item'
          ? 'Not live yet'
          : action === 'delete-item'
            ? 'Could not delete draft'
            : 'Update failed',
        message,
      )
    } finally {
      setUpdatingItemId(null)
    }
  }

  function confirmItemAction(item: SellerItem, action: 'publish-item' | 'hide-item' | 'mark-sold' | 'relist-item' | 'delete-item') {
    if (action === 'publish-item') {
      Alert.alert(
        'Go live now?',
        'Buyers will be able to discover and pay for this item. Make sure the photos, sizes, stock by size, delivery choices, and details all look right.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Go live', onPress: () => void updateItemState(item.id, action) },
        ]
      )
      return
    }

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
        item.inventoryQuantity <= 0 ? 'Restock and relist item?' : 'Relist item?',
        item.inventoryQuantity <= 0
          ? `"${item.title}" will be relisted with 1 unit ready so buyers can order it again.`
          : `"${item.title}" will go live again and buyers will be able to order it.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: item.inventoryQuantity <= 0 ? 'Restock and relist' : 'Relist', onPress: () => void updateItemState(item.id, action) },
        ]
      )
      return
    }

    if (action === 'delete-item') {
      Alert.alert(
        'Delete draft?',
        `"${item.title}" will be removed from your drafts. This only works while the item has never gone live or collected order history.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete draft', style: 'destructive', onPress: () => void updateItemState(item.id, action) },
        ]
      )
      return
    }

    void updateItemState(item.id, action)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} colors={[Colors.needleGreen]} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Shop</Text>
          <TouchableOpacity style={styles.addBtn} onPress={() => router.push('/(tailor)/shop/new')}>
            <Feather name="plus" size={16} color={Colors.textInverse} />
            <Text style={styles.addBtnText}>Add item</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bestUseCard}>
          <Text style={styles.bestUseEyebrow}>Best use</Text>
          <Text style={styles.bestUseText}>Keep ready-made items simple: clear photo, clear size, clear price, real stock by size, and clear delivery choice.</Text>
        </View>

        {stockAlerts.length > 0 ? (
          <View style={styles.stockAlertCard}>
            <View style={styles.stockAlertHeader}>
              <Text style={styles.stockAlertEyebrow}>Stock watch</Text>
              <Text style={styles.stockAlertHint}>Top up popular sizes before buyers hit sold out.</Text>
            </View>
            {stockAlerts.map((alert) => (
              <View key={alert.itemId} style={styles.stockAlertRow}>
                <View
                  style={[
                    styles.stockAlertDot,
                    alert.severity === 'sold_out' ? styles.stockAlertDotCritical : styles.stockAlertDotWarning,
                  ]}
                />
                <View style={styles.stockAlertTextWrap}>
                  <Text style={styles.stockAlertTitle}>{alert.headline}</Text>
                  <Text style={styles.stockAlertDetail}>{alert.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {!profile?.supportsReadyMade ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Feather name="toggle-left" size={24} color={Colors.needleGreen} />
            </View>
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
                <View style={styles.emptyIcon}>
                  <Feather name="package" size={24} color={Colors.needleGreen} />
                </View>
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
                {filteredItems.map((item) => {
                  const pillStyles = stockPillStyles(item)
                  const status = effectiveStockStatus(item)
                  const canRelist = status === 'SOLD_OUT' && item.inventoryQuantity > 0

                  return (
                    <View key={item.id} style={styles.itemCard}>
                    {item.photoUrls[0] ? (
                      <RemoteImage
                        uri={item.photoUrls[0]}
                        bucket="seller-item-media"
                        style={styles.itemThumb}
                        contentFit="cover"
                        transition={180}
                        surface="tailor_shop_item_thumb"
                        fallback={(
                          <View style={[styles.itemThumb, styles.itemThumbPlaceholder]}>
                            <Feather name="image" size={18} color={Colors.midGrey} />
                          </View>
                        )}
                      />
                    ) : (
                      <View style={[styles.itemThumb, styles.itemThumbPlaceholder]}>
                        <Feather name="image" size={18} color={Colors.midGrey} />
                      </View>
                    )}
                    <View style={styles.itemBody}>
                      <Text style={styles.itemTitle}>{item.title}</Text>
                      <Text style={styles.itemMeta}>
                        {item.category ? `${item.category} · ` : ''}{item.currency} {(item.priceAmount / 100).toFixed(2)} · {stockSummary(item)}
                      </Text>
                      <View style={styles.itemActions}>
                        {status === 'HIDDEN' ? (
                          <>
                            <TouchableOpacity
                              style={[styles.itemActionBtn, styles.itemActionBtnGhost]}
                              onPress={() => router.push({
                                pathname: '/(tailor)/shop/new',
                                params: { itemId: item.id, filter: 'DRAFTS' },
                              })}
                            >
                              <Text style={styles.itemActionGhostText}>Edit draft</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.itemActionBtn, styles.itemActionBtnDangerGhost]}
                              onPress={() => confirmItemAction(item, 'delete-item')}
                              disabled={updatingItemId === item.id}
                            >
                              <Text style={styles.itemActionDangerGhostText}>Delete draft</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.itemActionBtn}
                              onPress={() => confirmItemAction(item, 'publish-item')}
                              disabled={updatingItemId === item.id}
                            >
                              <Text style={styles.itemActionText}>
                                {updatingItemId === item.id ? 'Saving…' : 'Move to live'}
                              </Text>
                            </TouchableOpacity>
                          </>
                        ) : item.isLive && status !== 'SOLD_OUT' ? (
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
                        ) : status === 'SOLD_OUT' ? (
                          <>
                            <TouchableOpacity
                              style={[styles.itemActionBtn, styles.itemActionBtnGhost]}
                              onPress={() => router.push({
                                pathname: '/(tailor)/shop/new',
                                params: { itemId: item.id, filter: 'SOLD' },
                              })}
                            >
                              <Text style={styles.itemActionGhostText}>Edit item</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.itemActionBtn}
                              onPress={() =>
                                canRelist
                                  ? confirmItemAction(item, 'relist-item')
                                  : router.push({
                                      pathname: '/(tailor)/shop/new',
                                      params: { itemId: item.id, filter: 'SOLD', intent: 'restock' },
                                    })
                              }
                              disabled={updatingItemId === item.id}
                            >
                              <Text style={styles.itemActionText}>
                                {updatingItemId === item.id ? 'Saving…' : canRelist ? 'Relist item' : 'Add stock'}
                              </Text>
                            </TouchableOpacity>
                          </>
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
                    <View style={[styles.statusPill, pillStyles.container]}>
                      <Text style={[styles.statusText, pillStyles.text]}>
                        {stockLabel(item)}
                      </Text>
                    </View>
                  </View>
                  )
                })}
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
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 28, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
  },
  addBtnText: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  bestUseCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: 4, ...Shadow.sm },
  bestUseEyebrow: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  bestUseText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 18 },
  stockAlertCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.kanteRust + '18',
    ...Shadow.sm,
  },
  stockAlertHeader: { gap: 4 },
  stockAlertEyebrow: { fontSize: FontSize.xs, color: Colors.kanteRust, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  stockAlertHint: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  stockAlertRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stockAlertDot: { width: 8, height: 8, borderRadius: Radius.full, marginTop: 4 },
  stockAlertDotWarning: { backgroundColor: Colors.kanteRust },
  stockAlertDotCritical: { backgroundColor: Colors.kanteRust },
  stockAlertTextWrap: { flex: 1, gap: 2 },
  stockAlertTitle: { fontSize: 13, fontWeight: FontWeight.semibold, color: Colors.ink },
  stockAlertDetail: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    minHeight: 44,
    justifyContent: 'center',
  },
  filterPillActive: { backgroundColor: Colors.needleGreen, borderColor: Colors.needleGreen },
  filterText: { color: Colors.inkLight, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  filterTextActive: { color: Colors.textInverse },
  emptyCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 16, gap: Spacing.sm, alignItems: 'center', ...Shadow.sm },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyHint: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 18, textAlign: 'center' },
  itemList: { gap: Spacing.sm },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    ...Shadow.sm,
  },
  itemThumb: {
    width: 60,
    height: 60,
    borderRadius: Radius.sm,
    backgroundColor: Colors.lightGrey,
  },
  itemThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBody: {
    flex: 1,
    gap: 6,
  },
  itemTitle: { fontSize: 15, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  itemMeta: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 1, lineHeight: 18 },
  itemActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  itemActionBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemActionBtnGhost: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  itemActionBtnDangerGhost: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.error + '40',
  },
  itemActionText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
  itemActionGhostText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  itemActionDangerGhostText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.error,
  },
  statusPill: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  statusLive: { backgroundColor: Colors.needleGreenLight },
  statusWarning: { backgroundColor: Colors.kanteRust + '15' },
  statusMuted: { backgroundColor: Colors.bone },
  statusText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.4 },
  statusLiveText: { color: Colors.needleGreen },
  statusWarningText: { color: Colors.warning },
  statusMutedText: { color: Colors.midGrey },
})
