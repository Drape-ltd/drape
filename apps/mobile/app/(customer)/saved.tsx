import { useEffect, useMemo, useState } from 'react'
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
} from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { useRefreshOnFocus, useWishlistCollections, type WishlistCollection, type WishlistItem } from '@/lib/queries'
import { RemoteImage, SkeletonBlock } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { hapticLight, hapticWarning } from '@/lib/haptics'
import { buildCustomerStockSignal } from '@/lib/ready-made-stock'

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
  const { user } = useAuth()
  const [showGuide, setShowGuide] = useState(true)
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
  const [sheetMode, setSheetMode] = useState<SheetMode>(null)
  const [sheetValue, setSheetValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

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

  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId) ?? null,
    [collections, selectedCollectionId],
  )

  useEffect(() => {
    if (selectedCollectionId && !selectedCollection) setSelectedCollectionId(null)
  }, [selectedCollection, selectedCollectionId])

  async function dismissGuide() {
    setShowGuide(false)
    try {
      await AsyncStorage.setItem(`${SAVED_GUIDE_KEY}:${user?.id ?? 'guest'}`, '1')
    } catch {}
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
          <TouchableOpacity style={styles.iconButton} onPress={() => setSelectedCollectionId(null)} accessibilityRole="button" accessibilityLabel="Back to wishlists">
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerTitleButton} onPress={() => openRenameSheet(selectedCollection)} accessibilityRole="button" accessibilityLabel="Rename wishlist">
            <Text style={styles.title} numberOfLines={1}>{selectedCollection.name}</Text>
            <Feather name="edit-2" size={16} color={Colors.midGrey} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={() => deleteCollection(selectedCollection)} accessibilityRole="button" accessibilityLabel="Delete wishlist">
            <Feather name="more-horizontal" size={20} color={Colors.ink} />
          </TouchableOpacity>
        </View>

        <FlatList
          data={selectedCollection.items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isFetching && !loading} onRefresh={refetch} tintColor={Colors.needleGreen} colors={[Colors.needleGreen]} />}
          ListEmptyComponent={<EmptyCollectionView />}
          renderItem={({ item }) => (
            <WishlistItemCard
              item={item}
              onPress={() => {
                if (item.itemType === 'TAILOR') {
                  router.push(`/(customer)/tailor/${item.tailor.id}`)
                } else {
                  router.push({
                    pathname: '/(customer)/tailor/item/[itemId]',
                    params: { itemId: item.readyMadeItem.id, returnTo: '/(customer)/saved' },
                  })
                }
              }}
              onLongPress={() => openItemActions(item)}
              onRemove={() => void removeItem(item)}
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
        <Text style={styles.title}>Your wishlists</Text>
        <TouchableOpacity style={styles.newButton} onPress={openCreateSheet} accessibilityRole="button" accessibilityLabel="Create wishlist">
          <Feather name="plus" size={18} color={Colors.textInverse} />
          <Text style={styles.newButtonText}>New</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <WishlistSkeleton />
      ) : fetchError ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Wishlist</Text>
            <View style={styles.stateIcon}>
              <Feather name="alert-circle" size={26} color={Colors.kanteRust} />
            </View>
            <Text style={styles.stateTitle}>Couldn't load your wishlists.</Text>
            <Text style={styles.stateHint}>Your saved tailors and items should stay ready whenever you want to compare them again.</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => { void refetch() }}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <FlatList
          data={collections}
          keyExtractor={(collection) => collection.id}
          numColumns={2}
          columnWrapperStyle={collections.length > 0 ? styles.row : undefined}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isFetching && !loading} onRefresh={refetch} tintColor={Colors.needleGreen} colors={[Colors.needleGreen]} />}
          ListHeaderComponent={showGuide && collections.length > 0 ? (
            <View style={styles.guideCard}>
              <View style={styles.guideHeader}>
                <View style={styles.heroBadge}>
                  <Text style={styles.heroBadgeText}>Best use</Text>
                </View>
                <TouchableOpacity onPress={() => void dismissGuide()} style={styles.guideClose} accessibilityRole="button" accessibilityLabel="Hide wishlist guide">
                  <Feather name="x" size={16} color={Colors.midGrey} />
                </TouchableOpacity>
              </View>
              <Text style={styles.guideTitle}>Make a wishlist for each event, gift, or style idea, then save tailors and ready-made pieces where they belong.</Text>
            </View>
          ) : null}
          ListEmptyComponent={<EmptyWishlistView onCreate={openCreateSheet} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.collectionCard} activeOpacity={0.86} onPress={() => setSelectedCollectionId(item.id)}>
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

function CollectionPlaceholder() {
  return (
    <View style={styles.collectionPlaceholder}>
      <Feather name="heart" size={28} color={Colors.needleGreen} />
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
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIcon}>
        <Feather name="heart" size={32} color={Colors.needleGreen} />
      </View>
      <Text style={styles.emptyHeading}>Your wishlists</Text>
      <Text style={styles.emptySub}>Save tailors and items you love to come back to them later.</Text>
      <TouchableOpacity style={styles.ctaBtn} onPress={onCreate} accessibilityRole="button" accessibilityLabel="Create your first wishlist">
        <Text style={styles.ctaBtnText}>Create your first wishlist</Text>
      </TouchableOpacity>
    </View>
  )
}

function EmptyCollectionView() {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIcon}>
        <Feather name="bookmark" size={30} color={Colors.needleGreen} />
      </View>
      <Text style={styles.emptyHeading}>Nothing saved here yet</Text>
      <Text style={styles.emptySub}>Browse tailors and tap the heart to save.</Text>
    </View>
  )
}

function WishlistItemCard({
  item,
  onPress,
  onLongPress,
  onRemove,
}: {
  item: WishlistItem
  onPress: () => void
  onLongPress: () => void
  onRemove: () => void
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
    <TouchableOpacity style={styles.itemCard} activeOpacity={0.86} onPress={onPress} onLongPress={onLongPress}>
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
        <TouchableOpacity style={styles.removeButton} onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Remove ${title} from wishlist`}>
          <Feather name="x" size={15} color={Colors.textInverse} />
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
      <Text style={styles.itemTitle} numberOfLines={1}>{title}</Text>
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
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{title}</Text>
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
          />
          <TouchableOpacity style={[styles.sheetButton, disabled && styles.sheetButtonDisabled]} onPress={onSubmit} disabled={disabled}>
            {submitting ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={styles.sheetButtonText}>{mode?.type === 'note' ? 'Save note' : 'Create'}</Text>}
          </TouchableOpacity>
        </View>
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
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  title: { flex: 1, fontSize: 30, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
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
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.needleGreen,
  },
  newButtonText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md, flexGrow: 1 },
  row: { gap: Spacing.md },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  guideClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.sm },
  guideTitle: { fontSize: FontSize.sm, color: Colors.ink, lineHeight: 21 },
  collectionCard: { flex: 1, marginBottom: Spacing.md },
  collectionCover: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.needleGreenLight,
    ...Shadow.sm,
  },
  collectionCoverImage: { width: '100%', height: '100%' },
  collectionPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  collectionName: { marginTop: Spacing.sm, fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
  collectionCount: { marginTop: 2, fontSize: FontSize.xs, color: Colors.midGrey },
  itemCard: { flex: 1, marginBottom: Spacing.md },
  itemImageWrap: {
    width: '100%',
    aspectRatio: 0.92,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.white,
    ...Shadow.sm,
  },
  itemImage: { width: '100%', height: '100%' },
  itemImagePlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.boneDeep },
  removeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
  },
  itemTitle: { marginTop: Spacing.sm, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
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
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
  },
  itemSignalTextUrgent: { color: Colors.error },
  itemSignalTextWarning: { color: Colors.statusPending },
  itemSignalTextMuted: { color: Colors.midGrey },
  itemSubtitle: { marginTop: 2, fontSize: FontSize.xs, color: Colors.midGrey },
  itemNote: { marginTop: 4, fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 17 },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 90,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  emptyHeading: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia', textAlign: 'center' },
  emptySub: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 21, maxWidth: 300 },
  ctaBtn: {
    marginTop: Spacing.sm,
    minHeight: 52,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
  },
  ctaBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    alignItems: 'center',
    ...Shadow.lg,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stateIcon: {
    width: 58,
    height: 58,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.kanteRustLight,
  },
  stateTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center', fontFamily: 'Georgia' },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
  retryBtn: {
    minHeight: 44,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
  },
  retryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, paddingHorizontal: Spacing.lg },
  skeletonCard: { width: '47%', gap: Spacing.sm, marginBottom: Spacing.md },
  skeletonCover: { width: '100%', aspectRatio: 1, borderRadius: Radius.lg },
  skeletonTitle: { width: '74%', height: 16 },
  skeletonLine: { width: '48%', height: 12 },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: Colors.lightGrey },
  sheetTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
  sheetInput: {
    minHeight: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.ink,
    backgroundColor: Colors.bone,
  },
  sheetButton: {
    minHeight: 52,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
  },
  sheetButtonDisabled: { opacity: 0.5 },
  sheetButtonText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textInverse },
})
