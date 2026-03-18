import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Image, Dimensions,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { TierBadgeChip, StarRating, Tag } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

const STAGE_PILL_COLOR: Partial<Record<OrderStage, { bg: string; text: string }>> = {
  PENDING_QUOTE:   { bg: '#FFF3CD', text: '#856404' },
  CONSULTATION:    { bg: '#FFF3CD', text: '#856404' },
  QUOTE_SENT:      { bg: '#D1ECF1', text: '#0C5460' },
  PAYMENT_PENDING: { bg: '#D1ECF1', text: '#0C5460' },
  IN_DISPUTE:      { bg: '#F8D7DA', text: '#721C24' },
}

const CATEGORY_FILTERS = [
  { label: 'All', emoji: '✨' },
  { label: 'Agbada', emoji: '👘' },
  { label: 'Suits', emoji: '🕴️' },
  { label: 'Ankara', emoji: '🎨' },
  { label: 'Bridal', emoji: '💍' },
  { label: 'Lehenga', emoji: '🌺' },
  { label: 'Bespoke', emoji: '✂️' },
  { label: 'Kaftans', emoji: '🌙' },
]

type ActiveOrder = {
  id: string
  reference: string
  garmentType: string
  stage: OrderStage
  tailorName: string
  estimatedDate: string | null
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
  portfolioPhoto: string | null
  availability: string
}

export default function CustomerHomeScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([])
  const [tailors, setTailors] = useState<TailorCard[]>([])
  const [filteredTailors, setFilteredTailors] = useState<TailorCard[]>([])
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [refreshing, setRefreshing] = useState(false)

  async function fetchData() {
    const [ordersRes, tailorsRes] = await Promise.all([
      supabase
        .from('orders')
        .select(`
          id, reference, garment_type, stage,
          tailor_profiles!tailor_profile_id(display_name),
          quoted_completion_date
        `)
        .eq('customer_id', user?.id)
        .not('stage', 'in', '("COMPLETE","DELIVERED","COLLECTED","DECLINED","EXPIRED","REFUNDED","CANCELLED")')
        .order('created_at', { ascending: false })
        .limit(3),
      supabase
        .from('tailor_profiles')
        .select('id, display_name, location, specialty_tags, avg_rating, total_reviews, tier, price_range_min, price_range_max, portfolio_photo_urls, availability')
        .eq('is_live', true)
        .order('avg_rating', { ascending: false })
        .limit(30),
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
        }))
      )
    }

    if (tailorsRes.data) {
      const mapped: TailorCard[] = tailorsRes.data.map((t: any) => ({
        id: t.id,
        displayName: t.display_name,
        location: t.location,
        specialtyTags: t.specialty_tags ?? [],
        avgRating: t.avg_rating,
        totalReviews: t.total_reviews,
        tier: t.tier,
        priceRangeMin: t.price_range_min,
        priceRangeMax: t.price_range_max,
        portfolioPhoto: (t.portfolio_photo_urls ?? [])[0] ?? null,
        availability: t.availability,
      }))
      setTailors(mapped)
      setFilteredTailors(mapped)
    }
  }

  useFocusEffect(useCallback(() => {
    if (!user?.id) return
    fetchData()
  }, [user?.id]))

  async function onRefresh() {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }

  function selectCategory(cat: string) {
    setSelectedCategory(cat)
    if (cat === 'All') {
      setFilteredTailors(tailors)
    } else {
      setFilteredTailors(tailors.filter((t) =>
        t.specialtyTags.some((tag) => tag.toLowerCase().includes(cat.toLowerCase()))
      ))
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <TouchableOpacity
            style={styles.searchBar}
            onPress={() => router.push('/(customer)/search')}
            activeOpacity={0.9}
          >
            <Text style={styles.searchIcon}>🔍</Text>
            <View style={styles.searchTextWrap}>
              <Text style={styles.searchMainText}>Find a tailor</Text>
              <Text style={styles.searchSubText}>Location · Specialty · Style</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Active orders */}
        {activeOrders.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Your orders</Text>
              <TouchableOpacity onPress={() => router.navigate('/(customer)/orders')}>
                <Text style={styles.sectionLink}>See all</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.ordersScroll}>
              <View style={styles.ordersRow}>
                {activeOrders.map((order) => {
                  const c = STAGE_PILL_COLOR[order.stage as OrderStage]
                  return (
                    <TouchableOpacity
                      key={order.id}
                      style={styles.orderCard}
                      onPress={() => router.navigate(`/(customer)/orders/${order.id}`)}
                    >
                      <View style={[styles.orderStagePill, { backgroundColor: c?.bg ?? Colors.needleGreenLight }]}>
                        <Text style={[styles.orderStageText, { color: c?.text ?? Colors.needleGreen }]}>
                          {STAGE_LABELS[order.stage as OrderStage] ?? order.stage}
                        </Text>
                      </View>
                      <Text style={styles.orderGarment} numberOfLines={1}>{order.garmentType}</Text>
                      <Text style={styles.orderTailor} numberOfLines={1}>{order.tailorName}</Text>
                      {order.estimatedDate && (
                        <Text style={styles.orderEta}>
                          Ready {new Date(order.estimatedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )
                })}
              </View>
            </ScrollView>
          </View>
        )}

        {/* Category filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          <View style={styles.filterRow}>
            {CATEGORY_FILTERS.map((cat) => (
              <TouchableOpacity
                key={cat.label}
                style={[styles.filterChip, selectedCategory === cat.label && styles.filterChipActive]}
                onPress={() => selectCategory(cat.label)}
              >
                <Text style={styles.filterEmoji}>{cat.emoji}</Text>
                <Text style={[styles.filterLabel, selectedCategory === cat.label && styles.filterLabelActive]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* Tailors grid — Airbnb-style image-first cards */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {selectedCategory === 'All' ? 'Tailors for you' : `${selectedCategory} specialists`}
            </Text>
          </View>

          {filteredTailors.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No tailors found for "{selectedCategory}".</Text>
            </View>
          ) : (
            <View style={styles.cardsGrid}>
              {filteredTailors.map((tailor) => (
                <TailorCard
                  key={tailor.id}
                  tailor={tailor}
                  onPress={() => router.navigate(`/(customer)/tailor/${tailor.id}`)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function TailorCard({ tailor, onPress }: { tailor: TailorCard; onPress: () => void }) {
  const CARD_WIDTH = (SCREEN_WIDTH - Spacing.xl * 2 - Spacing.md) / 2

  return (
    <TouchableOpacity
      style={[styles.tailorCard, { width: CARD_WIDTH }]}
      onPress={onPress}
      activeOpacity={0.88}
    >
      {/* Hero image */}
      <View style={styles.tailorImageWrap}>
        {tailor.portfolioPhoto ? (
          <Image
            source={{ uri: tailor.portfolioPhoto }}
            style={styles.tailorImage}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.tailorImage, styles.tailorImagePlaceholder]}>
            <Text style={{ fontSize: 36 }}>🧵</Text>
          </View>
        )}
        {/* Availability indicator */}
        {tailor.availability === 'OPEN' && (
          <View style={styles.availBadge}>
            <View style={styles.availDot} />
            <Text style={styles.availText}>Available</Text>
          </View>
        )}
        {tailor.availability === 'FULLY_BOOKED' && (
          <View style={[styles.availBadge, styles.availBadgeFull]}>
            <Text style={[styles.availText, styles.availTextFull]}>Fully booked</Text>
          </View>
        )}
      </View>

      {/* Info below image */}
      <View style={styles.tailorInfo}>
        <View style={styles.tailorTopRow}>
          <Text style={styles.tailorName} numberOfLines={1}>{tailor.displayName}</Text>
          <TierBadgeChip tier={tailor.tier as any} />
        </View>
        <Text style={styles.tailorLocation} numberOfLines={1}>{tailor.location}</Text>
        <StarRating rating={tailor.avgRating} count={tailor.totalReviews} />
        {tailor.specialtyTags.length > 0 && (
          <Text style={styles.tailorTags} numberOfLines={1}>
            {tailor.specialtyTags.slice(0, 2).join(' · ')}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { paddingBottom: 100 },

  // Search bar — Airbnb style
  searchContainer: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.bone,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    ...Shadow.md,
  },
  searchIcon: { fontSize: 18 },
  searchTextWrap: { flex: 1 },
  searchMainText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  searchSubText: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 1 },

  // Section
  section: { paddingTop: Spacing.lg },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
  },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  sectionLink: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  // Orders horizontal scroll
  ordersScroll: { marginLeft: Spacing.xl },
  ordersRow: { flexDirection: 'row', gap: Spacing.md, paddingRight: Spacing.xl },
  orderCard: {
    width: 140,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  orderStagePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
    marginBottom: Spacing.xs,
  },
  orderStageText: { fontSize: 10, fontWeight: FontWeight.bold },
  orderGarment: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  orderTailor: { fontSize: FontSize.xs, color: Colors.midGrey },
  orderEta: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  // Category filters
  filterScroll: { marginHorizontal: 0 },
  filterRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  filterChipActive: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  filterEmoji: { fontSize: 14 },
  filterLabel: { fontSize: FontSize.sm, color: Colors.inkLight, fontWeight: FontWeight.medium },
  filterLabelActive: { color: Colors.white },

  // Tailors grid
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  tailorCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  tailorImageWrap: { width: '100%', aspectRatio: 0.9, position: 'relative' },
  tailorImage: { width: '100%', height: '100%' },
  tailorImagePlaceholder: {
    backgroundColor: Colors.boneDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  availBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  availBadgeFull: { backgroundColor: 'rgba(0,0,0,0.55)' },
  availDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.success },
  availText: { fontSize: 10, fontWeight: FontWeight.semibold, color: Colors.ink },
  availTextFull: { color: Colors.white },

  tailorInfo: { padding: Spacing.md, gap: 4 },
  tailorTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tailorName: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, flex: 1, marginRight: 4 },
  tailorLocation: { fontSize: FontSize.xs, color: Colors.midGrey },
  tailorTags: { fontSize: FontSize.xs, color: Colors.inkLight, marginTop: 2 },

  empty: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xl },
  emptyText: { fontSize: FontSize.sm, color: Colors.midGrey },
})
