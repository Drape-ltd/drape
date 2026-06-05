import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, RefreshControl, Modal, Platform } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { invokeFunction, supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { buildTailorStockAlert, formatSizeInventorySummary, normalizeSizeInventory, type SizeInventory } from '@/lib/ready-made-stock'
import { Button, RemoteImage } from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

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

type SupabaseErrorLike = {
  message?: unknown
  details?: unknown
  hint?: unknown
}

type SellerItemRow = {
  id: string
  title: string
  category: string | null
  sizes: unknown
  price_amount: number
  currency: string
  stock_status: string | null
  inventory_quantity: number | null
  size_inventory?: unknown
  is_live: boolean | null
  photo_urls: unknown
}

const FILTERS = ['LIVE', 'DRAFTS', 'SOLD'] as const
type Filter = typeof FILTERS[number]
type SellerItemAction = 'publish-item' | 'hide-item' | 'mark-sold' | 'relist-item' | 'delete-item'

type ShopEmptyAction = 'ADD' | Filter

const CURRENCY_SYMBOLS: Record<string, string> = {
  CAD: 'CA$',
  EUR: '€',
  GBP: '£',
  GHS: 'GH₵',
  KES: 'KSh',
  NGN: '₦',
  USD: '$',
}

function isMissingInventoryColumnError(error: unknown) {
  const candidate = error as SupabaseErrorLike | null
  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : ''
  const details = typeof candidate?.details === 'string' ? candidate.details.toLowerCase() : ''
  const hint = typeof candidate?.hint === 'string' ? candidate.hint.toLowerCase() : ''
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

function formatItemPrice(amountInMinorUnits: number, currency: string) {
  const amount = amountInMinorUnits / 100
  const hasCents = Math.abs(amount % 1) > 0
  const formattedAmount = amount.toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  })
  return `${CURRENCY_SYMBOLS[currency] ?? `${currency} `}${formattedAmount}`
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

function getShopEmptyState(
  filter: Filter,
  counts: { liveCount: number; draftCount: number; soldCount: number },
): { title: string; hint: string; ctaLabel: string; action: ShopEmptyAction } {
  if (filter === 'LIVE') {
    if (counts.draftCount > 0) {
      return {
        title: 'No live items yet',
        hint: 'You have drafts ready to review. Publish one when photos, stock, and pickup details are set.',
        ctaLabel: 'Review drafts',
        action: 'DRAFTS',
      }
    }

    if (counts.soldCount > 0) {
      return {
        title: 'No live items right now',
        hint: 'Your sold-out pieces are safe in Sold. Restock one or add a new ready-made piece when you are ready.',
        ctaLabel: 'Add item',
        action: 'ADD',
      }
    }

    return {
      title: 'Your shop is empty',
      hint: 'Add a ready-made piece when you want customers to buy without starting a custom order.',
      ctaLabel: 'Add item',
      action: 'ADD',
    }
  }

  if (filter === 'DRAFTS') {
    return {
      title: 'No drafts right now',
      hint: counts.liveCount > 0 || counts.soldCount > 0
        ? 'Drafts appear here when you save an item before publishing it.'
        : 'Start a draft when you want to prepare item details before buyers can see them.',
      ctaLabel: 'Add draft',
      action: 'ADD',
    }
  }

  return {
    title: 'No sold items yet',
    hint: counts.liveCount > 0 || counts.draftCount > 0
      ? 'Marked sold items appear here so you can restock or relist them later.'
      : 'Sold items will appear here once customers start buying from your shop.',
    ctaLabel: counts.liveCount > 0 || counts.draftCount > 0 ? 'View live items' : 'Add item',
    action: counts.liveCount > 0 || counts.draftCount > 0 ? 'LIVE' : 'ADD',
  }
}

export default function TailorShopScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ filter?: string }>()
  const { user } = useAuth()
  const userId = user?.id
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('LIVE')
  const [profile, setProfile] = useState<SellerProfile | null>(null)
  const [items, setItems] = useState<SellerItem[]>([])
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [actionSheetItem, setActionSheetItem] = useState<SellerItem | null>(null)

  useEffect(() => {
    const requestedFilter = typeof params.filter === 'string' ? params.filter.toUpperCase() : ''
    if (requestedFilter && FILTERS.includes(requestedFilter as Filter)) {
      const timer = setTimeout(() => {
        setFilter(requestedFilter as Filter)
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [params.filter])

  const loadShop = useCallback(async (showSpinner = true) => {
    if (!userId) {
      setProfile(null)
      setItems([])
      setLoading(false)
      return
    }
    if (showSpinner) setLoading(true)

    const { data: profileData } = await supabase
      .from('tailor_profiles')
      .select('id, supports_ready_made')
      .eq('user_id', userId)
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

    let itemsData = primary.data as SellerItemRow[] | null
    let itemsError = primary.error

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
      (itemsData ?? []).map((row) => ({
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
        stockStatus: row.stock_status ?? 'IN_STOCK',
        inventoryQuantity:
          typeof row.inventory_quantity === 'number'
            ? row.inventory_quantity
            : fallbackInventoryQuantity(row),
        isLive: row.is_live ?? false,
        photoUrls: Array.isArray(row.photo_urls) ? row.photo_urls.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0) : [],
      }))
    )
    setLoading(false)
  }, [userId])

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
  const liveCount = items.filter((item) => {
    const status = effectiveStockStatus(item)
    return item.isLive && status !== 'SOLD_OUT' && status !== 'HIDDEN'
  }).length
  const draftCount = items.filter((item) => effectiveStockStatus(item) === 'HIDDEN').length
  const soldCount = items.filter((item) => effectiveStockStatus(item) === 'SOLD_OUT').length
  const shopEmptyState = getShopEmptyState(filter, { liveCount, draftCount, soldCount })
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
    action: SellerItemAction,
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
    } catch (error) {
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

  function confirmItemAction(item: SellerItem, action: SellerItemAction) {
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

  function openItemEditor(item: SellerItem, fallbackFilter: Filter, intent?: 'restock') {
    setActionSheetItem(null)
    router.push({
      pathname: '/(tailor)/shop/new',
      params: {
        itemId: item.id,
        filter: fallbackFilter,
        ...(intent ? { intent } : {}),
      },
    })
  }

  function runSheetAction(item: SellerItem, action: SellerItemAction) {
    setActionSheetItem(null)
    confirmItemAction(item, action)
  }

  function handleEmptyAction(action: ShopEmptyAction) {
    if (action === 'ADD') {
      router.push('/(tailor)/shop/new')
      return
    }
    setFilter(action)
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

        {stockAlerts.length > 0 ? (
          <View style={styles.stockAlertCard}>
            <View style={styles.stockAlertHeader}>
              <Text style={styles.stockAlertEyebrow}>Inventory attention</Text>
              <Text style={styles.stockAlertHint}>Low stock and sold-out items that need a decision.</Text>
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
            <View style={styles.filterTabs}>
              {FILTERS.map((value) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.filterTab, filter === value && styles.filterTabActive]}
                  onPress={() => setFilter(value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === value }}
                >
                  <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>
                    {value === 'LIVE'
                      ? `Live ${liveCount}`
                      : value === 'DRAFTS'
                        ? `Drafts ${draftCount}`
                        : `Sold ${soldCount}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {filteredItems.length === 0 ? (
              <View style={styles.emptyCard}>
                <View style={styles.emptyIcon}>
                  <Feather name="package" size={24} color={Colors.needleGreen} />
                </View>
                <Text style={styles.emptyTitle}>{shopEmptyState.title}</Text>
                <Text style={styles.emptyHint}>{shopEmptyState.hint}</Text>
                <Button label={shopEmptyState.ctaLabel} onPress={() => handleEmptyAction(shopEmptyState.action)} />
              </View>
            ) : (
              <View style={styles.itemList}>
                {filteredItems.map((item) => {
                  const pillStyles = stockPillStyles(item)
                  const status = effectiveStockStatus(item)
                  const canRelist = status === 'SOLD_OUT' && item.inventoryQuantity > 0
                  const manageLabel =
                    status === 'HIDDEN'
                      ? 'Manage draft'
                      : status === 'SOLD_OUT'
                        ? canRelist ? 'Relist item' : 'Add stock'
                        : 'Manage item'

                  return (
                    <View key={item.id} style={styles.itemCard}>
                      <View style={styles.itemMediaWrap}>
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
                                <Feather name="image" size={22} color={Colors.midGrey} />
                              </View>
                            )}
                          />
                        ) : (
                          <View style={[styles.itemThumb, styles.itemThumbPlaceholder]}>
                            <Feather name="image" size={22} color={Colors.midGrey} />
                          </View>
                        )}
                        <View style={[styles.statusPill, styles.statusPillOverlay, pillStyles.container]}>
                          <Text style={[styles.statusText, pillStyles.text]}>
                            {stockLabel(item)}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.itemBody}>
                        <Text style={styles.itemTitle}>{item.title}</Text>
                        <Text style={styles.itemMeta}>
                          {item.category ? `${item.category} · ` : ''}{formatItemPrice(item.priceAmount, item.currency)} · {stockSummary(item)}
                        </Text>
                        <View style={styles.itemActions}>
                          <TouchableOpacity
                            style={[styles.itemActionBtn, updatingItemId === item.id && styles.itemActionBtnDisabled]}
                            onPress={() => setActionSheetItem(item)}
                            disabled={updatingItemId === item.id}
                          >
                            <Text style={styles.itemActionText}>
                              {updatingItemId === item.id ? 'Saving…' : manageLabel}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  )
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
      <ItemActionsSheet
        item={actionSheetItem}
        updating={!!actionSheetItem && updatingItemId === actionSheetItem.id}
        onClose={() => setActionSheetItem(null)}
        onEdit={(item, fallbackFilter, intent) => openItemEditor(item, fallbackFilter, intent)}
        onAction={(item, action) => runSheetAction(item, action)}
      />
    </SafeAreaView>
  )
}

function ItemActionsSheet({
  item,
  updating,
  onClose,
  onEdit,
  onAction,
}: {
  item: SellerItem | null
  updating: boolean
  onClose: () => void
  onEdit: (item: SellerItem, fallbackFilter: Filter, intent?: 'restock') => void
  onAction: (item: SellerItem, action: SellerItemAction) => void
}) {
  const insets = useSafeAreaInsets()
  const status = item ? effectiveStockStatus(item) : 'HIDDEN'
  const sheetBottomPadding =
    Platform.OS === 'android'
      ? Math.max(insets.bottom + 52, 76)
      : Math.max(insets.bottom + Spacing.lg, Spacing.xxl)

  return (
    <Modal visible={!!item} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetScrim} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: sheetBottomPadding }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleWrap}>
              <Text style={styles.sheetTitle}>{item?.title ?? 'Item options'}</Text>
              <Text style={styles.sheetSubtitle}>Update status, stock, and listing details for this item.</Text>
            </View>
            <TouchableOpacity style={styles.sheetClose} onPress={onClose}>
              <Feather name="x" size={18} color={Colors.ink} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.sheetOptions}
            contentContainerStyle={styles.sheetOptionsContent}
            showsVerticalScrollIndicator={false}
          >
            {item && status === 'HIDDEN' ? (
              <>
                <ItemSheetOption
                  icon="upload-cloud"
                  title="Move to live"
                  body="Publish this draft once photos, fit guide, stock, and fulfillment look right."
                  disabled={updating}
                  onPress={() => onAction(item, 'publish-item')}
                />
                <ItemSheetOption
                  icon="edit-3"
                  title="Edit draft"
                  body="Adjust photos, sizes, stock, or fulfillment before publishing."
                  disabled={updating}
                  onPress={() => onEdit(item, 'DRAFTS')}
                />
                <ItemSheetOption
                  icon="trash-2"
                  title="Delete draft"
                  body="Remove this draft before it goes live."
                  destructive
                  disabled={updating}
                  onPress={() => onAction(item, 'delete-item')}
                />
              </>
            ) : null}

            {item && item.isLive && status !== 'SOLD_OUT' ? (
              <>
                <ItemSheetOption
                  icon="check-circle"
                  title="Mark sold"
                  body="Move this item to Sold and stop showing it to buyers."
                  disabled={updating}
                  onPress={() => onAction(item, 'mark-sold')}
                />
                <ItemSheetOption
                  icon="edit-3"
                  title="Edit item"
                  body="Update listing details without changing order history."
                  disabled={updating}
                  onPress={() => onEdit(item, 'LIVE')}
                />
                <ItemSheetOption
                  icon="eye-off"
                  title="Move to draft"
                  body="Hide this item from buyers while you revise it."
                  disabled={updating}
                  onPress={() => onAction(item, 'hide-item')}
                />
              </>
            ) : null}

            {item && status === 'SOLD_OUT' ? (
              <>
                <ItemSheetOption
                  icon={item.inventoryQuantity > 0 ? 'refresh-cw' : 'plus-circle'}
                  title={item.inventoryQuantity > 0 ? 'Relist item' : 'Add stock'}
                  body={
                    item.inventoryQuantity > 0
                      ? 'Put this item back in the live shop with the current stock.'
                      : 'Add units by size before this item can go live again.'
                  }
                  disabled={updating}
                  onPress={() =>
                    item.inventoryQuantity > 0
                      ? onAction(item, 'relist-item')
                      : onEdit(item, 'SOLD', 'restock')
                  }
                />
                <ItemSheetOption
                  icon="edit-3"
                  title="Edit sold item"
                  body="Update details or prepare this item for restock."
                  disabled={updating}
                  onPress={() => onEdit(item, 'SOLD')}
                />
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function ItemSheetOption({
  icon,
  title,
  body,
  destructive,
  disabled,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap
  title: string
  body: string
  destructive?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.sheetOption, disabled && styles.sheetOptionDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={[styles.sheetOptionIcon, destructive && styles.sheetOptionIconDanger]}>
        <Feather name={icon} size={18} color={destructive ? Colors.error : Colors.needleGreen} />
      </View>
      <View style={styles.sheetOptionText}>
        <Text style={[styles.sheetOptionTitle, destructive && styles.sheetOptionTitleDanger]}>{title}</Text>
        <Text style={styles.sheetOptionBody}>{body}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={Colors.midGrey} />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 28, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
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
  filterTabs: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: Radius.lg,
    backgroundColor: Colors.boneDeep,
  },
  filterTab: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: Radius.md,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterTabActive: { backgroundColor: Colors.needleGreen },
  filterText: { color: Colors.inkLight, fontSize: FontSize.sm, fontWeight: FontWeight.medium, textAlign: 'center' },
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
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    flexDirection: 'row',
    alignItems: 'flex-start',
    ...Shadow.sm,
  },
  itemMediaWrap: {
    width: 116,
    height: 156,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.needleGreenLight,
  },
  itemThumb: {
    width: '100%',
    height: '100%',
    borderRadius: Radius.md,
    backgroundColor: Colors.lightGrey,
  },
  itemThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBody: {
    flex: 1,
    minWidth: 0,
    minHeight: 156,
    gap: 8,
    justifyContent: 'space-between',
  },
  itemTitle: { fontSize: 17, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display, lineHeight: 22 },
  itemMeta: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 1, lineHeight: 18 },
  itemActions: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  itemActionBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
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
  itemActionBtnDisabled: {
    opacity: 0.55,
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
  statusPillOverlay: {
    position: 'absolute',
    top: 10,
    right: 10,
    borderWidth: 1,
    borderColor: Colors.white + 'AA',
  },
  statusLive: { backgroundColor: Colors.needleGreenLight },
  statusWarning: { backgroundColor: Colors.kanteRust + '15' },
  statusMuted: { backgroundColor: Colors.bone },
  statusText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.4 },
  statusLiveText: { color: Colors.needleGreen },
  statusWarningText: { color: Colors.warning },
  statusMutedText: { color: Colors.midGrey },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.ink + '66',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    maxHeight: '82%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.lightGrey,
    marginBottom: Spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.xs,
  },
  sheetTitleWrap: {
    flex: 1,
    gap: 4,
  },
  sheetTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 24,
  },
  sheetSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  sheetClose: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  sheetOptions: {
    flexGrow: 0,
  },
  sheetOptionsContent: {
    gap: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 70,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    padding: Spacing.md,
  },
  sheetOptionDisabled: {
    opacity: 0.55,
  },
  sheetOptionIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  sheetOptionIconDanger: {
    backgroundColor: Colors.errorLight,
  },
  sheetOptionText: {
    flex: 1,
    gap: 2,
  },
  sheetOptionTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  sheetOptionTitleDanger: {
    color: Colors.error,
  },
  sheetOptionBody: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
  },
})
