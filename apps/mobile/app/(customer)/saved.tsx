/**
 * Saved Tailors screen — heart-saved tailors, persisted in Supabase saved_tailors table.
 * Requires: CREATE TABLE saved_tailors (id uuid primary key default gen_random_uuid(),
 *   user_id uuid references auth.users not null, tailor_profile_id uuid references tailor_profiles not null,
 *   created_at timestamptz default now(), unique(user_id, tailor_profile_id));
 */
import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Image as ExpoImage } from 'expo-image'
import { invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { useRefreshOnFocus, useSavedTailors } from '@/lib/queries'
import { TierBadgeChip, StarRating } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const SAVED_GUIDE_KEY = 'drape_saved_best_use_dismissed'

export default function SavedScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [failedImages, setFailedImages] = useState<string[]>([])
  const [showGuide, setShowGuide] = useState(true)

  useEffect(() => {
    AsyncStorage.getItem(`${SAVED_GUIDE_KEY}:${user?.id ?? 'guest'}`)
      .then((value) => setShowGuide(value !== '1'))
      .catch(() => {})
  }, [user?.id])

  async function dismissGuide() {
    setShowGuide(false)
    try {
      await AsyncStorage.setItem(`${SAVED_GUIDE_KEY}:${user?.id ?? 'guest'}`, '1')
    } catch {}
  }

  const {
    data: saved = [],
    isLoading: loading,
    isFetching,
    isError: fetchError,
    refetch,
  } = useSavedTailors(user?.id)

  useRefreshOnFocus(refetch)

  async function unsave(savedId: string, name: string) {
    Alert.alert(
      'Remove from saved?',
      `Remove ${name} from your saved tailors?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await invokeFunction('saved-tailor-action', {
              body: { action: 'unsave-by-id', savedId },
            })
            if (error) {
              const message = isLikelyConnectivityIssue(error)
                ? 'Connection looks weak. We could not update your saved tailors yet. Retry when the signal improves.'
                : await readFunctionErrorMessage(error, 'Could not update your saved tailors right now. Please try again in a moment.')
              Alert.alert('Error', message)
              return
            }
            void refetch()
          },
        },
      ]
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Wishlist</Text>
      </View>

      {loading ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Wishlist</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your saved sellers…</Text>
            <Text style={styles.stateHint}>
              We’re gathering the makers you bookmarked so they stay easy to revisit when you are ready to order.
            </Text>
          </View>
        </View>
      ) : fetchError ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Wishlist</Text>
            <Text style={styles.stateTitle}>Couldn't load your saved sellers.</Text>
            <Text style={styles.stateHint}>
              Your shortlist should stay ready whenever you want to compare styles, pricing, and availability again.
            </Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Best recovery move</Text>
              <Text style={styles.stateGuideText}>
                Refresh this screen first. If it still fails, head back to discovery and reopen the profiles you trust most so your shortlist stays easy to rebuild.
              </Text>
            </View>
            <TouchableOpacity style={styles.retryBtn} onPress={() => { void refetch() }}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.navigate('/(customer)')}>
              <Text style={styles.secondaryBtnText}>Explore sellers</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <FlatList
          data={saved}
          keyExtractor={(s) => s.savedId}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isFetching && !loading} onRefresh={refetch} tintColor={Colors.needleGreen} />}
          ListHeaderComponent={(
            <>
              {showGuide && (
                <View style={styles.guideCard}>
                  <View style={styles.guideHeader}>
                    <View style={styles.heroBadge}>
                      <Text style={styles.heroBadgeText}>Best use</Text>
                    </View>
                    <TouchableOpacity onPress={() => void dismissGuide()} style={styles.guideClose}>
                      <Feather name="x" size={16} color={Colors.midGrey} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.guideTitle}>Keep a tight shortlist here, then open profiles when you are ready to place a brief.</Text>
                </View>
              )}
            </>
          )}
          ListEmptyComponent={<EmptyWishlistView onExplore={() => router.navigate('/(customer)')} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/(customer)/tailor/${item.id}`)}
              activeOpacity={0.85}
            >
              {/* Image */}
              <View style={styles.imageWrap}>
                {item.portfolioPhoto && !failedImages.includes(item.id) ? (
                  <ExpoImage
                    source={{ uri: item.portfolioPhoto }}
                    style={styles.image}
                    contentFit="cover"
                    transition={120}
                    onError={() => {
                      setFailedImages((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]))
                    }}
                  />
                ) : (
                  <View style={[styles.image, styles.imagePlaceholder]}>
                    <Text style={{ fontSize: 32 }}>🧵</Text>
                  </View>
                )}
                {/* Heart button */}
                <TouchableOpacity
                  style={styles.heartBtn}
                  onPress={(event) => {
                    event.stopPropagation()
                    void unsave(item.savedId, item.displayName)
                  }}
                >
                  <Text style={styles.heartIcon}>❤️</Text>
                </TouchableOpacity>
                {/* Availability dot */}
                {item.availability === 'OPEN' && (
                  <View style={styles.availDot} />
                )}
              </View>

              {/* Info */}
              <View style={styles.info}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>{item.displayName}</Text>
                  <TierBadgeChip tier={item.tier as any} />
                </View>
                <Text style={styles.location} numberOfLines={1}>{item.location}</Text>
                <StarRating rating={item.avgRating} count={item.totalReviews} />
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  )
}

// Ghost card entries — what a filled wishlist looks like
const GHOST_ITEMS = [
  { specialty: 'Bespoke Suits' },
  { specialty: 'Ankara Gowns' },
  { specialty: 'Agbada Sets' },
  { specialty: 'Bridal Wear' },
]

function EmptyWishlistView({ onExplore }: { onExplore: () => void }) {
  return (
    <View style={emptyStyles.container}>
      {/* Ghost 2-column grid — fading opacity like Airbnb Trips */}
      <View style={emptyStyles.ghostGrid}>
        {GHOST_ITEMS.map((item, i) => (
          <View key={i} style={[emptyStyles.ghostCard, { opacity: 1 - i * 0.18 }]}>
            {/* Image placeholder with scissors icon */}
            <View style={emptyStyles.ghostImageWrap}>
              <Feather name="scissors" size={26} color={Colors.midGrey} />
              {/* Ghost heart overlay */}
              <View style={emptyStyles.ghostHeart}>
                <Feather name="heart" size={13} color={Colors.midGrey} />
              </View>
            </View>
            {/* Info skeleton lines */}
            <View style={emptyStyles.ghostInfo}>
              <View style={[emptyStyles.ghostLine, { width: '75%' }]} />
              <View style={[emptyStyles.ghostLine, { width: '50%', marginTop: 6 }]} />
              <View style={[emptyStyles.ghostLine, { width: '60%', marginTop: 4 }]} />
            </View>
          </View>
        ))}
      </View>

      {/* Heading + copy */}
      <View style={emptyStyles.textBlock}>
        <View style={emptyStyles.eyebrowPill}>
          <Text style={emptyStyles.eyebrowText}>Wishlist</Text>
        </View>
        <Text style={emptyStyles.heading}>Save the tailors you love</Text>
        <Text style={emptyStyles.sub}>
          Tap the heart on any tailor profile to keep promising makers close, compare them later,
          and come back when you’re ready to place the right order.
        </Text>
      </View>

      {/* CTA */}
      <TouchableOpacity style={emptyStyles.ctaBtn} onPress={onExplore} activeOpacity={0.85}>
        <Text style={emptyStyles.ctaBtnText}>Explore tailors</Text>
      </TouchableOpacity>
    </View>
  )
}

const emptyStyles = StyleSheet.create({
  container: {
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxxl,
    alignItems: 'center',
    gap: Spacing.xl,
  },
  ghostGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  ghostCard: {
    width: '47%',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  ghostImageWrap: {
    width: '100%',
    aspectRatio: 0.85,
    backgroundColor: Colors.boneDeep,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ghostHeart: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostInfo: {
    padding: Spacing.md,
    gap: 0,
  },
  ghostLine: {
    height: 9,
    borderRadius: 5,
    backgroundColor: Colors.boneDeep,
  },

  textBlock: { alignItems: 'center', gap: Spacing.sm },
  eyebrowPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  eyebrowText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heading: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  sub: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 22 },

  ctaBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  ctaBtnText: { color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.md },
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
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
  stateTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
  stateGuideCard: {
    alignSelf: 'stretch',
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: 4,
  },
  stateGuideTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  stateGuideText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
  heroBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  guideClose: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },

  list: { padding: Spacing.xl, gap: Spacing.md, paddingBottom: 100 },
  row: { gap: Spacing.md, justifyContent: 'space-between' },

  card: {
    width: '48%',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  imageWrap: { width: '100%', aspectRatio: 0.85, position: 'relative' },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { backgroundColor: Colors.boneDeep, alignItems: 'center', justifyContent: 'center' },
  heartBtn: {
    position: 'absolute', top: 8, right: 8,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  heartIcon: { fontSize: 16 },
  availDot: {
    position: 'absolute', bottom: 8, left: 8,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: Colors.success,
    borderWidth: 2, borderColor: Colors.white,
  },

  info: { padding: Spacing.md, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  name: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, flex: 1, fontFamily: 'Georgia' },
  location: { fontSize: FontSize.xs, color: Colors.midGrey },
  retryBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  retryBtnText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  secondaryBtn: {
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  secondaryBtnText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.medium },

})
