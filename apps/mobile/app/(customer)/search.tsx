import { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable, FlatList, ScrollView, ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { Input, TierBadgeChip, StarRating, Tag } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const GARMENT_FILTERS = ['All', 'Agbada', 'Suits', 'Ankara', 'Bridal', 'Lehenga', 'Kaftans', 'Bespoke']
const TIER_FILTERS = ['All', 'MASTER', 'RISING', 'VERIFIED']

type TailorResult = {
  id: string
  displayName: string
  location: string
  specialtyTags: string[]
  avgRating: number
  totalReviews: number
  tier: string
  availability: string
  avgResponseHours: number | null
  priceRangeMin: number | null
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function availabilityHint(tailor: TailorResult): string | null {
  if (tailor.availability === 'LIMITED') return 'Taking a limited number of orders'
  if (tailor.avgResponseHours != null) return `Usually replies in about ${Math.round(tailor.avgResponseHours)}h`
  return null
}

export default function SearchScreen() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [garment, setGarment] = useState('All')
  const [tier, setTier] = useState('All')
  const [results, setResults] = useState<TailorResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [fetchError, setFetchError] = useState(false)

  const search = useCallback(async (q: string, g: string, t: string) => {
    setLoading(true)
    setSearched(true)
    setFetchError(false)

    try {
      let query = supabase
        .from('tailor_profiles')
        .select('id, display_name, location, specialty_tags, avg_rating, total_reviews, tier, availability, avg_response_hours, price_range_min')
        .eq('is_live', true)
        .neq('availability', 'FULLY_BOOKED')

      if (q.trim()) {
        query = query.or(`display_name.ilike.%${q}%,location.ilike.%${q}%,specialty_tags.cs.{${q}}`)
      }
      if (g !== 'All') {
        query = query.contains('specialty_tags', [g])
      }
      if (t !== 'All') {
        query = query.eq('tier', t)
      }

      const { data, error } = await query.order('ranking_score', { ascending: false }).limit(30)
      if (error) throw error

      setResults(
        (data ?? []).map((d: any) => ({
          id: d.id,
          displayName: d.display_name,
          location: d.location,
          specialtyTags: asStringList(d.specialty_tags),
          avgRating: d.avg_rating,
          totalReviews: d.total_reviews,
          tier: d.tier,
          availability: d.availability,
          avgResponseHours: d.avg_response_hours,
          priceRangeMin: d.price_range_min,
        }))
      )
    } catch {
      setFetchError(true)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  function handleSearch() { search(query, garment, tier) }

  function selectGarment(g: string) {
    setGarment(g)
    search(query, g, tier)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Find a tailor</Text>
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Search with intent</Text>
          </View>
          <Text style={styles.heroTitle}>Search by style, city, or specialty and narrow the field fast.</Text>
          <Text style={styles.heroSub}>
            Use this screen when you already know the kind of maker or location you want to start from.
          </Text>
        </View>
        <View style={styles.guideCard}>
          <Text style={styles.guideTitle}>Best search habit</Text>
          <Text style={styles.guideText}>
            Start broad, then tighten by specialty or tier only after you have a few promising matches worth comparing.
          </Text>
        </View>
        <Input
          placeholder="Name, location, or specialty..."
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          containerStyle={styles.searchInput}
          testID="search-input"
          rightElement={
            <TouchableOpacity onPress={handleSearch} testID="search-submit-btn" style={{ padding: 4 }}>
              <Text style={{ fontSize: 16 }}>🔍</Text>
            </TouchableOpacity>
          }
        />

        {/* Garment filter chips */}
        <FlatList
          horizontal
          data={GARMENT_FILTERS}
          keyExtractor={(i) => i}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.chip, garment === item && styles.chipActive]}
              onPress={() => selectGarment(item)}
            >
              <Text style={[styles.chipText, garment === item && styles.chipTextActive]}>{item}</Text>
            </TouchableOpacity>
          )}
        />

        <FlatList
          horizontal
          data={TIER_FILTERS}
          keyExtractor={(i) => i}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.chip, tier === item && styles.chipActive]}
              onPress={() => {
                setTier(item)
                search(query, garment, item)
              }}
            >
              <Text style={[styles.chipText, tier === item && styles.chipTextActive]}>
                {item === 'All' ? 'All tiers' : item}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {loading ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Search</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Searching tailors…</Text>
            <Text style={styles.stateHint}>
              We’re narrowing the field by name, city, and specialty so you can choose from live options quickly.
            </Text>
          </View>
        </View>
      ) : !searched ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Search</Text>
            <Text style={styles.stateTitle}>Search for a tailor when you already know the direction.</Text>
            <Text style={styles.stateHint}>
              Try a city, a specialty, or the name of a tailor you trust. We’ll narrow the list so you can move into a brief with more confidence.
            </Text>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/(customer)')}>
              <Text style={styles.secondaryBtnText}>Browse home instead</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : fetchError ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Search</Text>
            <Text style={styles.stateTitle}>Couldn't load search results.</Text>
            <Text style={styles.stateHint}>
              Search should help you narrow down live tailors by specialty or location without guesswork.
            </Text>
            <TouchableOpacity style={styles.retryBtn} onPress={handleSearch}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/(customer)')}>
              <Text style={styles.secondaryBtnText}>Open home</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Search</Text>
            <Text style={styles.stateTitle}>No tailors matched that search yet.</Text>
            <Text style={styles.stateHint}>
              Try widening the specialty, switching the city, or browsing live tailors from home to find a better starting point.
            </Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Best recovery move</Text>
              <Text style={styles.stateGuideText}>
                Remove one filter at a time. Usually the fastest way forward is to keep the style you want, then loosen location or tier until you find a promising shortlist.
              </Text>
            </View>
            <TouchableOpacity style={styles.retryBtn} onPress={() => search(query, 'All', 'All')}>
              <Text style={styles.retryBtnText}>Clear filters</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/(customer)')}>
              <Text style={styles.secondaryBtnText}>Browse top tailors</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {results.map((item) => (
            <Pressable
              key={item.id}
              style={styles.card}
              testID={`tailor-result-${item.id}`}
              accessibilityLabel={`${item.displayName} card`}
              onPress={() => router.push(`/(customer)/tailor/${item.id}`)}
            >
              <View style={styles.cardTop}>
                <View style={styles.avatar}>
                  <Text style={{ fontSize: 28 }}>👤</Text>
                </View>
                <View style={styles.info}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name}>{item.displayName}</Text>
                    <TierBadgeChip tier={item.tier as any} />
                  </View>
                  <Text style={styles.location}>{item.location}</Text>
                  <View style={styles.metaRow}>
                    <StarRating rating={item.avgRating} count={item.totalReviews} />
                    {item.priceRangeMin != null && (
                      <Text style={styles.response}>From ${item.priceRangeMin}</Text>
                    )}
                  </View>
                </View>
              </View>
              <View style={styles.tags}>
                {(item.specialtyTags ?? []).slice(0, 4).map((t) => <Tag key={t} label={t} />)}
              </View>
              {availabilityHint(item) && (
                <Text style={styles.availabilityHint} numberOfLines={1}>
                  {availabilityHint(item)}
                </Text>
              )}
              {item.availability === 'LIMITED' && (
                <View style={styles.limitedBadge}>
                  <Text style={styles.limitedText}>Limited availability</Text>
                </View>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

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
  header: { padding: Spacing.xl, gap: Spacing.md, backgroundColor: Colors.bone },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadow.sm,
  },
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
  heroTitle: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 38,
  },
  heroSub: {
    fontSize: FontSize.md,
    color: Colors.inkLight,
    lineHeight: 24,
  },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  guideTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  guideText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  searchInput: { marginBottom: -Spacing.sm },
  filterRow: { gap: Spacing.sm, paddingRight: Spacing.xl },
  chip: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  chipActive: { backgroundColor: Colors.needleGreen, borderColor: Colors.needleGreen },
  chipText: { fontSize: FontSize.sm, color: Colors.inkLight, fontWeight: FontWeight.medium },
  chipTextActive: { color: Colors.white },
  retryBtn: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
  },
  retryBtnText: { fontSize: FontSize.sm, color: Colors.white, fontWeight: FontWeight.semibold },
  secondaryBtn: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  secondaryBtnText: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  list: { padding: Spacing.xl, gap: Spacing.md },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm,
  },
  cardTop: { flexDirection: 'row', gap: Spacing.md },
  avatar: {
    width: 52, height: 52, borderRadius: Radius.full,
    backgroundColor: Colors.boneDeep, alignItems: 'center', justifyContent: 'center',
  },
  info: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  location: { fontSize: FontSize.sm, color: Colors.midGrey },
  metaRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  response: { fontSize: FontSize.xs, color: Colors.midGrey },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  availabilityHint: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  limitedBadge: {
    backgroundColor: '#FEF3C7', paddingHorizontal: Spacing.md,
    paddingVertical: 4, borderRadius: Radius.full, alignSelf: 'flex-start',
  },
  limitedText: { fontSize: FontSize.xs, color: '#92400E', fontWeight: FontWeight.medium },
})
