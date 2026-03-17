/**
 * Saved Tailors screen — heart-saved tailors, persisted in Supabase saved_tailors table.
 * Requires: CREATE TABLE saved_tailors (id uuid primary key default gen_random_uuid(),
 *   user_id uuid references auth.users not null, tailor_profile_id uuid references tailor_profiles not null,
 *   created_at timestamptz default now(), unique(user_id, tailor_profile_id));
 */
import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { TierBadgeChip, StarRating } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

type SavedTailor = {
  savedId: string
  id: string
  displayName: string
  location: string
  tier: string
  avgRating: number
  totalReviews: number
  availability: string
  portfolioPhoto: string | null
}

export default function SavedScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [saved, setSaved] = useState<SavedTailor[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function fetchSaved() {
    const { data } = await supabase
      .from('saved_tailors')
      .select(`
        id,
        tailor_profiles!tailor_profile_id(
          id, display_name, location, tier, avg_rating, total_reviews, availability, portfolio_photo_urls
        )
      `)
      .eq('user_id', user?.id)
      .order('created_at', { ascending: false })

    if (!data) return

    setSaved(
      data.map((row: any) => {
        const t = row.tailor_profiles
        return {
          savedId: row.id,
          id: t.id,
          displayName: t.display_name,
          location: t.location,
          tier: t.tier,
          avgRating: t.avg_rating,
          totalReviews: t.total_reviews,
          availability: t.availability,
          portfolioPhoto: (t.portfolio_photo_urls ?? [])[0] ?? null,
        }
      })
    )
  }

  useFocusEffect(useCallback(() => {
    setLoading(true)
    fetchSaved().finally(() => setLoading(false))
  }, [user?.id]))

  async function onRefresh() {
    setRefreshing(true)
    await fetchSaved()
    setRefreshing(false)
  }

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
            await supabase.from('saved_tailors').delete().eq('id', savedId)
            setSaved((prev) => prev.filter((s) => s.savedId !== savedId))
          },
        },
      ]
    )
  }

  const CARD_GAP = Spacing.md
  const CARD_WIDTH = '48%'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Wishlist</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />
      ) : (
        <FlatList
          data={saved}
          keyExtractor={(s) => s.savedId}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />}
          ListEmptyComponent={<EmptyWishlistView onExplore={() => router.navigate('/(customer)')} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/(customer)/tailor/${item.id}`)}
              activeOpacity={0.85}
            >
              {/* Image */}
              <View style={styles.imageWrap}>
                {item.portfolioPhoto ? (
                  <Image source={{ uri: item.portfolioPhoto }} style={styles.image} resizeMode="cover" />
                ) : (
                  <View style={[styles.image, styles.imagePlaceholder]}>
                    <Text style={{ fontSize: 32 }}>🧵</Text>
                  </View>
                )}
                {/* Heart button */}
                <TouchableOpacity
                  style={styles.heartBtn}
                  onPress={() => unsave(item.savedId, item.displayName)}
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
        <Text style={emptyStyles.heading}>Save the tailors you love</Text>
        <Text style={emptyStyles.sub}>
          Tap the ♡ on any tailor's profile to save{'\n'}them here for whenever you're ready.
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
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },

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
  name: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, flex: 1 },
  location: { fontSize: FontSize.xs, color: Colors.midGrey },

})
