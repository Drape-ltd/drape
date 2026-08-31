import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { useRefreshOnFocus, useWishlistCollections, type WishlistCollection, type WishlistItem } from '@/lib/queries'
import { KeyboardAwareScrollView, RemoteImage, SkeletonBlock, StateCard } from '@/components/ui'
import { useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { hapticLight, hapticWarning } from '@/lib/haptics'
import { buildCustomerStockSignal } from '@/lib/ready-made-stock'
import { appendToHistory } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { loadRecentlyViewedTailors, type RecentlyViewedTailor } from '@/lib/recently-viewed-tailors'

const SAVED_GUIDE_KEY = 'drape_saved_best_use_dismissed'

type SheetMode =
  | { type: 'create' }
  | { type: 'rename'; collection: WishlistCollection }
  | { type: 'note'; item: WishlistItem }
  | null

type ReadyMadeSavedItem = Extract<WishlistItem, { itemType: 'READY_MADE_ITEM' }>['readyMadeItem']
type SavedItemSignal = {
  label: string
  tone: 'available' | 'urgent' | 'warning' | 'muted'
}

function savedReadyMadeSignal(item: ReadyMadeSavedItem): SavedItemSignal | null {
  const signal = buildCustomerStockSignal(item)
  return signal.tone === 'available' ? null : signal
}

export default function SavedScreen() {
  const router = useRouter()
  const capsuleNavScroll = useDrapeCapsuleNavScroll()
  const { user } = useAuth()
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [showGuide, setShowGuide] = useState(true)
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
  const [sheetMode, setSheetMode] = useState<SheetMode>(null)
  const [sheetValue, setSheetValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewedTailor[]>([])

  useEffect(() => {
    AsyncStorage.getItem(`${SAVED_GUIDE_KEY}:${user?.id ?? 'guest'}`)
      .then((value) => setShowGuide(value !== '1'))
      .catch(() => {})
  }, [user?.id])

  const {
    data: collections = [],
    isLoading: loading,
    isFetching,
    isError: fetchError,
    refetch,
  } = useWishlistCollections(user?.id)

  useRefreshOnFocus(refetch, 0)
  const refreshRecentlyViewed = useCallback(async () => {
    setRecentlyViewed(await loadRecentlyViewedTailors(user?.id))
  }, [user?.id])
  useEffect(() => {
    let cancelled = false
    loadRecentlyViewedTailors(user?.id)
      .then((tailors) => {
        if (!cancelled) setRecentlyViewed(tailors)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user?.id])
  useRefreshOnFocus(refreshRecentlyViewed, 0)

  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId) ?? null,
    [collections, selectedCollectionId],
  )
  const gridCardWidth = Math.floor((width - Spacing.lg * 2 - Spacing.md) / 2)
  const savedItemCount = useMemo(
    () => collections.reduce((total, collection) => total + collection.itemCount, 0),
    [collections],
  )

  useEffect(() => {
    if (!selectedCollectionId || selectedCollection) return undefined
    const timer = setTimeout(() => setSelectedCollectionId(null), 0)
    return () => clearTimeout(timer)
  }, [selectedCollection, selectedCollectionId])

  function closeSelectedCollection() {
    setSelectedCollectionId(null)
  }

  // A wishlist collection is an in-tab detail surface rather than a nested
  // router screen. Consume Android system/gesture Back while it is open so it
  // follows the same exit contract as the visible Back control.
  useContextualBackHandler(closeSelectedCollection, selectedCollection !== null)

  async function dismissGuide() {
    setShowGuide(false)
    try {
      await AsyncStorage.setItem(`${SAVED_GUIDE_KEY}:${user?.id ?? 'guest'}`, '1')
    } catch {
      // Non-critical preference write; keep wishlists responsive.
    }
  }

  function openCreateSheet() {
    setSheetValue('')
    setSheetMode({ type: 'create' })
  }

  function openRenameSheet(collection: WishlistCollection) {
    setSheetValue(collection.name)
    setSheetMode({ type: 'rename', collection })
  }

  function openNoteSheet(item: WishlistItem) {
    setSheetValue(item.note ?? '')
    setSheetMode({ type: 'note', item })
  }

  async function submitSheet() {
    if (!sheetMode || submitting) return
    const value = sheetValue.trim()
    if ((sheetMode.type === 'create' || sheetMode.type === 'rename') && !value) return

    setSubmitting(true)
    try {
      const body =
        sheetMode.type === 'create'
          ? { action: 'create-collection', name: value }
          : sheetMode.type === 'rename'
            ? { action: 'rename-collection', collectionId: sheetMode.collection.id, name: value }
            : { action: 'add-note', itemId: sheetMode.item.id, note: value || null }

      const { error } = await invokeFunction('saved-tailor-action', { body })
      if (error) throw error

      hapticLight()
      setSheetMode(null)
      setSheetValue('')
      await refetch()
    } catch (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not update your wishlist yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not update your wishlist right now. Please try again in a moment.')
      Alert.alert('Wishlist not updated', message)
    } finally {
      setSubmitting(false)
    }
  }

  async function removeItem(item: WishlistItem) {
    hapticWarning()
    const name = item.itemType === 'TAILOR' ? item.tailor.displayName : item.readyMadeItem.title
    Alert.alert('Remove from wishlist?', `Remove ${name} from this wishlist?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await invokeFunction('saved-tailor-action', {
            body: { action: 'remove-item', itemId: item.id },
          })
          if (error) {
            const message = await readFunctionErrorMessage(error, 'Could not remove this item right now.')
            Alert.alert('Wishlist not updated', message)
            return
          }
          hapticLight()
          void refetch()
        },
      },
    ])
  }

  async function moveItem(item: WishlistItem, targetCollectionId: string) {
    const { error } = await invokeFunction('saved-tailor-action', {
      body: { action: 'move-item', itemId: item.id, targetCollectionId },
    })
    if (error) {
      const message = await readFunctionErrorMessage(error, 'Could not move this item right now.')
      Alert.alert('Wishlist not updated', message)
      return
    }
    hapticLight()
    void refetch()
  }

  function openItemActions(item: WishlistItem) {
    const moveTargets = collections.filter((collection) => collection.id !== selectedCollection?.id)
    Alert.alert('Wishlist item', 'Choose what to do with this saved item.', [
      { text: 'Add a note', onPress: () => openNoteSheet(item) },
      ...(moveTargets.length > 0
        ? [{ text: 'Move to another wishlist', onPress: () => openMovePicker(item, moveTargets) }]
        : []),
      { text: 'Remove from this wishlist', style: 'destructive', onPress: () => void removeItem(item) },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  function openMovePicker(item: WishlistItem, moveTargets: WishlistCollection[]) {
    Alert.alert(
      'Move to',
      'Choose a wishlist.',
      [
        ...moveTargets.slice(0, 6).map((collection) => ({
          text: collection.name,
          onPress: () => void moveItem(item, collection.id),
        })),
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  function openCollectionMenu(collection: WishlistCollection) {
    Alert.alert(collection.name, 'Manage this wishlist.', [
      { text: 'Rename wishlist', onPress: () => openRenameSheet(collection) },
      { text: 'Delete wishlist', style: 'destructive', onPress: () => deleteCollection(collection) },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  function deleteCollection(collection: WishlistCollection) {
    hapticWarning()
    Alert.alert(
      'Delete wishlist?',
      `Delete "${collection.name}" and remove its ${collection.itemCount} saved item${collection.itemCount === 1 ? '' : 's'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await invokeFunction('saved-tailor-action', {
              body: { action: 'delete-collection', collectionId: collection.id },
            })
            if (error) {
              const message = await readFunctionErrorMessage(error, 'Could not delete this wishlist right now.')
              Alert.alert('Wishlist not deleted', message)
              return
            }
            setSelectedCollectionId(null)
            hapticLight()
            void refetch()
          },
        },
      ],
    )
  }

  if (selectedCollection) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.iconButton} onPress={closeSelectedCollection} accessibilityRole="button" accessibilityLabel="Back to wishlists">
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerTitleButton} onPress={() => openRenameSheet(selectedCollection)} accessibilityRole="button" accessibilityLabel="Rename wishlist">
            <Text style={styles.title} numberOfLines={1}>{selectedCollection.name}</Text>
            <Feather name="edit-2" size={16} color={Colors.midGrey} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={() => openCollectionMenu(selectedCollection)} accessibilityRole="button" accessibilityLabel="Wishlist options">
            <Feather name="more-horizontal" size={20} color={Colors.ink} />
          </TouchableOpacity>
        </View>

        <FlatList
          {...capsuleNavScroll}
          data={selectedCollection.items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Math.max(insets.bottom + 112, Spacing.xxxl) },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isFetching && !loading} onRefresh={refetch} tintColor={Colors.needleGreen} colors={[Colors.needleGreen]} />}
          ListHeaderComponent={
            selectedCollection.items.length > 0 ? (
              <View style={styles.collectionDetailIntro}>
                <Text style={styles.collectionDetailCopy}>
                  {selectedCollection.itemCount} saved item{selectedCollection.itemCount === 1 ? '' : 's'}
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={<EmptyCollectionView onBrowse={() => router.navigate('/(customer)')} />}
          renderItem={({ item }) => (
            <WishlistItemCard
              item={item}
              width={gridCardWidth}
              onPress={() => {
                if (item.itemType === 'TAILOR') {
                  router.push({
                    pathname: '/(customer)/tailor/[id]',
                    params: { id: item.tailor.id, historyChain: appendToHistory(undefined, '/(customer)/saved') },
                  })
                } else {
                  router.push({
                    pathname: '/(customer)/tailor/item/[itemId]',
                    params: {
                      itemId: item.readyMadeItem.id,
                      returnTo: '/(customer)/saved',
                      historyChain: appendToHistory(undefined, '/(customer)/saved'),
                    },
                  })
                }
              }}
              onLongPress={() => openItemActions(item)}
              onActions={() => openItemActions(item)}
            />
          )}
        />
        <WishlistSheet
          mode={sheetMode}
          value={sheetValue}
          submitting={submitting}
          onChange={setSheetValue}
          onClose={() => setSheetMode(null)}
          onSubmit={submitSheet}
        />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Wishlists</Text>
        <TouchableOpacity style={styles.newButton} onPress={openCreateSheet} accessibilityRole="button" accessibilityLabel="Create wishlist">
          <Feather name="plus" size={18} color={Colors.needleGreen} />
          <Text style={styles.newButtonText}>New wishlist</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <WishlistSkeleton />
      ) : fetchError ? (
        <View style={styles.stateWrap}>
          <StateCard
            tone="error"
            icon="alert-circle"
            title="Couldn't load your wishlists"
            body="Your saved tailors and items should stay ready whenever you want to compare them again."
            actionLabel="Try again"
            onAction={() => {
              void refetch()
            }}
          />
        </View>
      ) : (
        <FlatList
          {...capsuleNavScroll}
          data={collections}
          keyExtractor={(collection) => collection.id}
          numColumns={2}
          columnWrapperStyle={collections.length > 0 ? styles.row : undefined}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Math.max(insets.bottom + 112, Spacing.xxxl) },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isFetching && !loading} onRefresh={refetch} tintColor={Colors.needleGreen} colors={[Colors.needleGreen]} />}
          ListHeaderComponent={
            collections.length > 0 || recentlyViewed.length > 0 ? (
              <View style={styles.savedHeaderContent}>
                {recentlyViewed.length > 0 ? (
                  <RecentlyViewedRail
                    tailors={recentlyViewed}
                    onPress={(tailor) =>
                      router.push({
                        pathname: '/(customer)/tailor/[id]',
                        params: { id: tailor.id, historyChain: appendToHistory(undefined, '/(customer)/saved') },
                      })
                    }
                  />
                ) : null}
                {collections.length > 0 ? (
                  <WishlistOverview
                    collectionCount={collections.length}
                    itemCount={savedItemCount}
                    showGuide={showGuide}
                    onDismissGuide={dismissGuide}
                  />
                ) : null}
              </View>
            ) : null
          }
          ListEmptyComponent={<EmptyWishlistView onCreate={openCreateSheet} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.collectionCard, { width: gridCardWidth }]}
              activeOpacity={0.86}
              onPress={() => setSelectedCollectionId(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.name} wishlist`}
            >
              <View style={styles.collectionCover}>
                {item.coverImageUrl ? (
                  <RemoteImage
                    uri={item.coverImageUrl}
                    style={styles.collectionCoverImage}
                    contentFit="cover"
                    transition={160}
                    surface="customer_wishlist_collection_cover"
                    fallback={<CollectionPlaceholder />}
                  />
                ) : (
                  <CollectionPlaceholder />
                )}
              </View>
              <Text style={styles.collectionName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.collectionCount}>{item.itemCount} item{item.itemCount === 1 ? '' : 's'}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <WishlistSheet
        mode={sheetMode}
        value={sheetValue}
        submitting={submitting}
        onChange={setSheetValue}
        onClose={() => setSheetMode(null)}
        onSubmit={submitSheet}
      />
    </SafeAreaView>
  )
}

function WishlistOverview({
  collectionCount,
  itemCount,
  showGuide,
  onDismissGuide,
}: {
  collectionCount: number
  itemCount: number
  showGuide: boolean
  onDismissGuide: () => Promise<void>
}) {
  return (
    <View style={styles.overview}>
      <Text style={styles.overviewMeta}>
        {collectionCount} wishlist{collectionCount === 1 ? '' : 's'} · {itemCount} saved item{itemCount === 1 ? '' : 's'}
      </Text>
      {showGuide ? (
        <View style={styles.wishlistHint}>
          <Feather name="heart" size={16} color={Colors.needleGreen} />
          <Text style={styles.wishlistHintText} numberOfLines={2}>
            Tap the heart on any tailor or item to save it here.
          </Text>
          <TouchableOpacity onPress={() => void onDismissGuide()} style={styles.guideClose} accessibilityRole="button" accessibilityLabel="Hide wishlist guide">
            <Feather name="x" size={16} color={Colors.midGrey} />
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  )
}

function CollectionPlaceholder() {
  return (
    <View style={styles.collectionPlaceholder}>
      <View style={styles.placeholderHeartBadge}>
        <Feather name="heart" size={24} color={Colors.needleGreen} />
      </View>
      <Text style={styles.placeholderLabel}>No saves yet</Text>
    </View>
  )
}

function RecentlyViewedRail({
  tailors,
  onPress,
}: {
  tailors: RecentlyViewedTailor[]
  onPress: (tailor: RecentlyViewedTailor) => void
}) {
  return (
    <View style={styles.recentRail}>
      <View style={styles.recentRailHeader}>
        <View style={styles.recentRailTitleRow}>
          <View style={styles.recentRailIcon}>
            <Feather name="clock" size={14} color={Colors.needleGreen} />
          </View>
          <Text style={styles.recentRailTitle}>Recently viewed</Text>
        </View>
        <Text style={styles.recentRailHint}>Reopen a profile or save it into a collection.</Text>
      </View>
      <FlatList
        data={tailors.slice(0, 8)}
        keyExtractor={(tailor) => tailor.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.recentRailList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.recentTailorCard}
            onPress={() => onPress(item)}
            activeOpacity={0.86}
            accessibilityRole="button"
            accessibilityLabel={`Open recently viewed tailor ${item.displayName}`}
          >
            <View style={styles.recentTailorImageWrap}>
              {item.portfolioPhoto ? (
                <RemoteImage
                  uri={item.portfolioPhoto}
                  bucket={item.exploreImageBucket ?? 'portfolio-photos'}
                  style={styles.recentTailorImage}
                  contentFit="cover"
                  transition={140}
                  surface="customer_wishlist_recent_tailor"
                  fallback={<RecentTailorPlaceholder tailor={item} />}
                />
              ) : (
                <RecentTailorPlaceholder tailor={item} />
              )}
              <View style={styles.recentTailorBadge}>
                <Feather name="clock" size={11} color={Colors.textInverse} />
              </View>
            </View>
            <Text style={styles.recentTailorName} numberOfLines={1}>{item.displayName}</Text>
            <Text style={styles.recentTailorMeta} numberOfLines={1}>
              {item.avgRating > 0 ? `${item.avgRating.toFixed(1)} · ` : ''}{item.location}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  )
}

function RecentTailorPlaceholder({ tailor }: { tailor: RecentlyViewedTailor }) {
  const initials =
    tailor.displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'D'
  return (
    <View style={[styles.recentTailorImage, styles.recentTailorPlaceholder]}>
      <Text style={styles.recentTailorInitials}>{initials}</Text>
    </View>
  )
}

function WishlistSkeleton() {
  return (
    <View style={styles.skeletonGrid}>
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={styles.skeletonCard}>
          <SkeletonBlock style={styles.skeletonCover} />
          <SkeletonBlock style={styles.skeletonTitle} />
          <SkeletonBlock style={styles.skeletonLine} />
        </View>
      ))}
    </View>
  )
}

function EmptyWishlistView({ onCreate }: { onCreate: () => void }) {
  return (
    <View style={styles.emptyWishlistPanel}>
      <View style={styles.emptyWishlistIcon}>
        <Feather name="heart" size={24} color={Colors.needleGreen} />
      </View>
      <Text style={styles.emptyWishlistTitle}>Start your first wishlist</Text>
      <Text style={styles.emptyWishlistBody}>
        Group tailors and ready-made pieces by wedding, gift, trip, or everyday favorites.
      </Text>
      <TouchableOpacity
        style={styles.emptyWishlistButton}
        onPress={onCreate}
        accessibilityRole="button"
        accessibilityLabel="Create your first wishlist"
      >
        <Text style={styles.emptyWishlistButtonText}>New wishlist</Text>
      </TouchableOpacity>
    </View>
  )
}

function EmptyCollectionView({ onBrowse }: { onBrowse: () => void }) {
  return (
    <View style={styles.emptyContainer}>
      <StateCard
        title="Nothing saved here yet"
        body="Browse tailors and tap the heart to save."
        icon="bookmark"
        actionLabel="Browse tailors"
        onAction={onBrowse}
      />
    </View>
  )
}

function WishlistItemCard({
  item,
  onPress,
  onLongPress,
  onActions,
  width,
}: {
  item: WishlistItem
  onPress: () => void
  onLongPress: () => void
  onActions: () => void
  width: number
}) {
  const title = item.itemType === 'TAILOR' ? item.tailor.displayName : item.readyMadeItem.title
  const readyMadeSignal = item.itemType === 'READY_MADE_ITEM' ? savedReadyMadeSignal(item.readyMadeItem) : null
  const subtitle =
    item.itemType === 'TAILOR'
      ? item.tailor.location
      : item.readyMadeItem.priceAmount > 0
        ? `${item.readyMadeItem.currency} ${(item.readyMadeItem.priceAmount / 100).toFixed(2)}`
        : item.readyMadeItem.sellerName
  const imageUrl = item.itemType === 'TAILOR' ? item.tailor.portfolioPhoto : item.readyMadeItem.photoUrl

  return (
    <TouchableOpacity
      style={[styles.itemCard, { width }]}
      activeOpacity={0.86}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.itemImageWrap}>
        {imageUrl ? (
          <RemoteImage
            uri={imageUrl}
            bucket={item.itemType === 'TAILOR' ? 'portfolio-photos' : 'seller-item-media'}
            style={styles.itemImage}
            contentFit="cover"
            transition={140}
            surface="customer_wishlist_item"
            fallback={<View style={[styles.itemImage, styles.itemImagePlaceholder]}><Feather name="image" size={22} color={Colors.midGrey} /></View>}
          />
        ) : (
          <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
            <Feather name={item.itemType === 'TAILOR' ? 'user' : 'shopping-bag'} size={22} color={Colors.midGrey} />
          </View>
        )}
        <TouchableOpacity
          style={styles.itemActionButton}
          onPress={onActions}
          accessibilityRole="button"
          accessibilityLabel={`Wishlist actions for ${title}`}
        >
          <Feather name="more-horizontal" size={16} color={Colors.ink} />
        </TouchableOpacity>
      </View>
      {readyMadeSignal ? (
        <View
          style={[
            styles.itemSignal,
            readyMadeSignal.tone === 'urgent' && styles.itemSignalUrgent,
            readyMadeSignal.tone === 'warning' && styles.itemSignalWarning,
            readyMadeSignal.tone === 'muted' && styles.itemSignalMuted,
          ]}
        >
          <Text
            style={[
              styles.itemSignalText,
              readyMadeSignal.tone === 'urgent' && styles.itemSignalTextUrgent,
              readyMadeSignal.tone === 'warning' && styles.itemSignalTextWarning,
              readyMadeSignal.tone === 'muted' && styles.itemSignalTextMuted,
            ]}
            numberOfLines={1}
          >
            {readyMadeSignal.label}
          </Text>
        </View>
      ) : null}
      <Text style={styles.itemTitle} numberOfLines={2}>{title}</Text>
      <Text style={styles.itemSubtitle} numberOfLines={1}>{subtitle}</Text>
      {item.note ? <Text style={styles.itemNote} numberOfLines={2}>{item.note}</Text> : null}
    </TouchableOpacity>
  )
}

function WishlistSheet({
  mode,
  value,
  submitting,
  onChange,
  onClose,
  onSubmit,
}: {
  mode: SheetMode
  value: string
  submitting: boolean
  onChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const title =
    mode?.type === 'create'
      ? 'Create a wishlist'
      : mode?.type === 'rename'
        ? 'Rename wishlist'
        : 'Add a private note'
  const placeholder =
    mode?.type === 'note'
      ? 'e.g. Ask about matching gele'
      : 'e.g. December Wedding'
  const disabled = submitting || (mode?.type !== 'note' && !value.trim())

  return (
    <Modal visible={!!mode} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetScrim} activeOpacity={1} onPress={onClose} />
        <KeyboardAwareScrollView
          style={styles.sheet}
          contentContainerStyle={styles.sheetContent}
          keyboardClearance={88}
        >
          <View style={styles.sheetHandle} />
          <View style={styles.sheetTitleRow}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity
              style={styles.sheetCloseButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close wishlist sheet"
              activeOpacity={0.76}
            >
              <Feather name="x" size={20} color={Colors.ink} />
            </TouchableOpacity>
          </View>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={Colors.midGrey}
            style={styles.sheetInput}
            autoFocus
            maxLength={mode?.type === 'note' ? 240 : 80}
            multiline={mode?.type === 'note'}
            returnKeyType={mode?.type === 'note' ? 'default' : 'done'}
            onSubmitEditing={mode?.type === 'note' ? undefined : onSubmit}
            accessibilityLabel={mode?.type === 'note' ? 'Private wishlist note' : 'Wishlist name'}
          />
          {mode?.type !== 'note' && !value.trim() ? (
            <Text style={styles.sheetRequirement} accessibilityLiveRegion="polite">
              Enter a wishlist name to continue.
            </Text>
          ) : null}
          <TouchableOpacity
            style={[styles.sheetButton, disabled && styles.sheetButtonDisabled]}
            onPress={onSubmit}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={mode?.type === 'note' ? 'Save private note' : mode?.type === 'rename' ? 'Save wishlist name' : 'Create wishlist'}
            accessibilityState={{ disabled, busy: submitting }}
          >
            {submitting ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <Text style={styles.sheetButtonText}>
                {mode?.type === 'note' ? 'Save note' : mode?.type === 'rename' ? 'Save changes' : 'Create wishlist'}
              </Text>
            )}
          </TouchableOpacity>
        </KeyboardAwareScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  headerTitleButton: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    ...Shadow.sm,
  },
  newButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  newButtonText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md, flexGrow: 1 },
  row: { gap: Spacing.md },
  savedHeaderContent: {
    gap: Spacing.lg,
    marginBottom: Spacing.xs,
  },
  overview: {
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  overviewMeta: {
    fontFamily: Fonts.bodyMedium,
    fontSize: FontSize.sm,
    lineHeight: 20,
    color: Colors.midGrey,
  },
  collectionDetailIntro: {
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  collectionDetailCopy: {
    fontFamily: Fonts.body,
    fontSize: FontSize.sm,
    lineHeight: 21,
    color: Colors.inkLight,
  },
  wishlistHint: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.full,
    paddingLeft: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  wishlistHintText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: FontSize.sm,
    lineHeight: 19,
    color: Colors.inkLight,
  },
  guideClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  collectionCard: {
    marginBottom: Spacing.md,
  },
  collectionCover: {
    width: '100%',
    aspectRatio: 1.08,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    backgroundColor: Colors.white,
    ...Shadow.sm,
  },
  collectionCoverImage: { width: '100%', height: '100%' },
  collectionPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.white,
    overflow: 'hidden',
  },
  placeholderHeartBadge: {
    width: 52,
    height: 52,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  placeholderLabel: {
    fontFamily: Fonts.bodyMedium,
    fontSize: FontSize.xs,
    lineHeight: 17,
    color: Colors.inkLight,
  },
  recentRail: {
    gap: Spacing.sm,
  },
  recentRailHeader: {
    gap: 3,
  },
  recentRailTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  recentRailIcon: {
    width: 26,
    height: 26,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  recentRailTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.md,
    lineHeight: 21,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  recentRailHint: {
    fontFamily: Fonts.body,
    fontSize: FontSize.sm,
    lineHeight: 20,
    color: Colors.inkLight,
  },
  recentRailList: {
    gap: Spacing.sm,
    paddingRight: Spacing.lg,
  },
  recentTailorCard: {
    width: 126,
  },
  recentTailorImageWrap: {
    width: 126,
    height: 146,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.needleGreenLight,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  recentTailorImage: {
    width: '100%',
    height: '100%',
  },
  recentTailorBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26,26,24,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  recentTailorName: {
    marginTop: Spacing.xs,
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    lineHeight: 19,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  recentTailorMeta: {
    marginTop: 1,
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    lineHeight: 17,
    color: Colors.inkLight,
  },
  recentTailorPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  recentTailorInitials: {
    fontFamily: Fonts.bodyBold,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.needleGreen,
    letterSpacing: 0.8,
  },
  collectionName: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  collectionCount: {
    marginTop: 2,
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    lineHeight: 17,
    color: Colors.inkLight,
  },
  itemCard: {
    marginBottom: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    ...Shadow.sm,
  },
  itemImageWrap: {
    width: '100%',
    aspectRatio: 0.95,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.needleGreenLight,
  },
  itemImage: { width: '100%', height: '100%' },
  itemImagePlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.boneDeep },
  itemActionButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  itemTitle: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.sm,
    lineHeight: 19,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  itemSignal: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    backgroundColor: Colors.needleGreenLight,
  },
  itemSignalUrgent: { backgroundColor: Colors.errorLight },
  itemSignalWarning: { backgroundColor: Colors.statusPendingBg },
  itemSignalMuted: { backgroundColor: Colors.boneDeep },
  itemSignalText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
  },
  itemSignalTextUrgent: { color: Colors.error },
  itemSignalTextWarning: { color: Colors.statusPending },
  itemSignalTextMuted: { color: Colors.midGrey },
  itemSubtitle: { marginTop: 2, fontFamily: Fonts.body, fontSize: FontSize.xs, color: Colors.midGrey },
  itemNote: {
    marginTop: 4,
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 17,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 90,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyWishlistPanel: {
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xl,
    marginTop: Spacing.lg,
    gap: Spacing.sm,
    borderRadius: Radius.xl,
    backgroundColor: Colors.white,
    ...Shadow.sm,
  },
  emptyWishlistIcon: {
    width: 58,
    height: 58,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  emptyWishlistTitle: {
    marginTop: Spacing.xs,
    fontFamily: Fonts.bodyBold,
    fontSize: FontSize.xl,
    lineHeight: 28,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  emptyWishlistBody: {
    maxWidth: 310,
    fontFamily: Fonts.body,
    fontSize: FontSize.md,
    lineHeight: 23,
    color: Colors.inkLight,
    textAlign: 'center',
  },
  emptyWishlistButton: {
    marginTop: Spacing.md,
    minHeight: 52,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
  },
  emptyWishlistButtonText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, paddingHorizontal: Spacing.lg },
  skeletonCard: { width: '47%', gap: Spacing.sm, marginBottom: Spacing.md },
  skeletonCover: { width: '100%', aspectRatio: 1, borderRadius: Radius.lg },
  skeletonTitle: { width: '74%', height: 16 },
  skeletonLine: { width: '48%', height: 12 },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '82%',
  },
  sheetContent: {
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  sheetHandle: { alignSelf: 'center', width: 90, height: 5, borderRadius: 3, backgroundColor: Colors.lightGrey },
  sheetTitle: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  sheetCloseButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  sheetInput: {
    minHeight: 58,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontFamily: Fonts.body,
    fontSize: 16,
    color: Colors.ink,
    backgroundColor: Colors.bone,
  },
  sheetButton: {
    minHeight: 56,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
  },
  sheetButtonDisabled: { opacity: 0.5 },
  sheetRequirement: {
    color: Colors.inkLight,
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    lineHeight: 18,
  },
  sheetButtonText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
})
