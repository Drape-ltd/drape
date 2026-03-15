import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { TierBadgeChip, StarRating, Tag } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS } from '@drape/shared/order-machine'

type ActiveOrder = {
  id: string
  reference: string
  garmentType: string
  stage: string
  tailorName: string
  estimatedDate: string | null
  photoUrl: string | null
}

type TailorCard = {
  id: string
  displayName: string
  location: string
  specialtyTags: string[]
  avgRating: number
  totalReviews: number
  tier: string
  priceRangeMin: number | null
  priceRangeMax: number | null
}

export default function CustomerHomeScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([])
  const [featuredTailors, setFeaturedTailors] = useState<TailorCard[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const firstName = user?.user_metadata?.display_name?.split(' ')[0] ?? 'there'

  async function fetchData() {
    const [ordersRes, tailorsRes] = await Promise.all([
      supabase
        .from('orders')
        .select(`
          id, reference, garment_type, stage,
          tailor_profiles!tailor_profile_id(display_name),
          quoted_completion_date,
          order_stage_updates(photo_url, created_at)
        `)
        .eq('customer_id', user?.id)
        .not('stage', 'in', '("COMPLETE","DECLINED","EXPIRED","REFUNDED","CANCELLED")')
        .order('created_at', { ascending: false })
        .limit(3),
      supabase
        .from('tailor_profiles')
        .select('id, display_name, location, specialty_tags, avg_rating, total_reviews, tier, price_range_min, price_range_max')
        .eq('is_live', true)
        .order('avg_rating', { ascending: false })
        .limit(10),
    ])

    if (ordersRes.data) {
      setActiveOrders(
        ordersRes.data.map((o: any) => ({
          id: o.id,
          reference: o.reference,
          garmentType: o.garment_type,
          stage: o.stage,
          tailorName: o.tailor_profiles?.display_name ?? '',
          estimatedDate: o.quoted_completion_date,
          photoUrl: o.order_stage_updates?.[0]?.photo_url ?? null,
        }))
      )
    }
    if (tailorsRes.data) setFeaturedTailors(tailorsRes.data as any)
  }

  useFocusEffect(useCallback(() => {
    fetchData()
    // Ensure customer_profiles row exists (created lazily on first home load)
    if (user?.id) {
      const now = new Date().toISOString()
      supabase.from('customer_profiles').upsert(
        {
          user_id: user.id,
          display_name: user.user_metadata?.display_name ?? null,
          updated_at: now,
        },
        { onConflict: 'user_id', ignoreDuplicates: true },
      )
    }
  }, [user?.id]))

  async function onRefresh() {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Good morning, {firstName}</Text>
            <Text style={styles.wordmark}>drape</Text>
          </View>
        </View>

        {/* Active orders */}
        {activeOrders.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your orders</Text>
            {activeOrders.map((order) => (
              <TouchableOpacity
                key={order.id}
                style={styles.orderCard}
                onPress={() => router.push(`/(customer)/orders/${order.id}`)}
              >
                <View style={styles.orderTop}>
                  <View>
                    <Text style={styles.orderGarment}>{order.garmentType}</Text>
                    <Text style={styles.orderTailor}>{order.tailorName}</Text>
                  </View>
                  <View style={[styles.stagePill, { backgroundColor: Colors.needleGreenLight }]}>
                    <Text style={styles.stagePillText}>
                      {STAGE_LABELS[order.stage as keyof typeof STAGE_LABELS] ?? order.stage}
                    </Text>
                  </View>
                </View>
                {order.estimatedDate && (
                  <Text style={styles.orderEta}>
                    Est. ready {new Date(order.estimatedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Search bar */}
        <TouchableOpacity style={styles.searchBar} onPress={() => router.push('/(customer)/search')}>
          <Text style={styles.searchPlaceholder}>🔍  Search tailors...</Text>
        </TouchableOpacity>

        {/* Quick filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          {['Agbada', 'Suits', 'Ankara', 'Bridal', 'Lehenga', 'Bespoke'].map((tag) => (
            <TouchableOpacity key={tag} style={styles.filterChip}>
              <Text style={styles.filterChipText}>{tag}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Featured tailors */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tailors for you</Text>
          {featuredTailors.map((tailor) => (
            <TailorCardItem
              key={tailor.id}
              tailor={tailor}
              onPress={() => router.push(`/(customer)/tailor/${tailor.id}`)}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function TailorCardItem({ tailor, onPress }: { tailor: TailorCard; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.tailorCard} onPress={onPress}>
      <View style={styles.tailorAvatar}>
        <Text style={{ fontSize: 28 }}>👤</Text>
      </View>
      <View style={styles.tailorInfo}>
        <View style={styles.tailorRow}>
          <Text style={styles.tailorName}>{tailor.displayName}</Text>
          <TierBadgeChip tier={tailor.tier as any} />
        </View>
        <Text style={styles.tailorLocation}>{tailor.location}</Text>
        <View style={styles.tailorMeta}>
          <StarRating rating={tailor.avgRating} count={tailor.totalReviews} />
          {tailor.priceRangeMin && (
            <Text style={styles.tailorPrice}>
              {'£'.repeat(Math.ceil((tailor.priceRangeMin / 100) / 50)).slice(0, 3)}
            </Text>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {(tailor.specialtyTags ?? []).slice(0, 3).map((tag) => (
              <Tag key={tag} label={tag} />
            ))}
          </View>
        </ScrollView>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: Spacing.xxxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  greeting: { fontSize: FontSize.sm, color: Colors.inkLight },
  wordmark: { fontSize: 32, fontWeight: FontWeight.bold, color: Colors.needleGreen, letterSpacing: -1 },
  section: { gap: Spacing.md },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },

  // Order card
  orderCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  orderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  orderGarment: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  orderTailor: { fontSize: FontSize.sm, color: Colors.inkLight },
  stagePill: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  stagePillText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  orderEta: { fontSize: FontSize.sm, color: Colors.midGrey },

  // Search
  searchBar: {
    backgroundColor: Colors.white,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  searchPlaceholder: { color: Colors.midGrey, fontSize: FontSize.md },

  // Filter chips
  filterScroll: { marginHorizontal: -Spacing.xl, paddingHorizontal: Spacing.xl },
  filterChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    marginRight: Spacing.sm,
  },
  filterChipText: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.medium },

  // Tailor card
  tailorCard: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  tailorAvatar: {
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    backgroundColor: Colors.boneDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tailorInfo: { flex: 1, gap: 4 },
  tailorRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tailorName: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  tailorLocation: { fontSize: FontSize.sm, color: Colors.midGrey },
  tailorMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  tailorPrice: { fontSize: FontSize.sm, color: Colors.inkLight },
})
