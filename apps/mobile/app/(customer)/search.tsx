import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable, FlatList, ScrollView, ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { Input, TierBadgeChip, StarRating, Tag, RemoteImage } from '@/components/ui'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const GARMENT_FILTERS = ['All', 'Agbada', 'Suits', 'Ankara', 'Bridal', 'Crochet', 'Knitwear', 'Ready-made']
const TIER_FILTERS = ['All', 'MASTER', 'RISING', 'VERIFIED']
const SEARCH_GUIDE_KEY = 'drape_search_best_use_dismissed'

type TailorResult = {
  id: string
  displayName: string
  location: string
  sellerType: 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP'
  specialtyTags: string[]
  avgRating: number
  totalReviews: number
  tier: string
  availability: string
  avgResponseHours: number | null
  priceRangeMin: number | null
  currency: CurrencyCode
  avatarUrl: string | null
  supportsCustomOrders: boolean
  supportsReadyMade: boolean
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

function parseSearchQuery(input: string): { specialty: string; location: string; general: string } {
  const trimmed = input.trim()
  const lower = trimmed.toLowerCase()

  const sellersInMatch = lower.match(/^sellers?\s+in\s+(.+)$/)
  if (sellersInMatch) {
    return { specialty: '', location: sellersInMatch[1].trim(), general: '' }
  }

  const tailorsInMatch = lower.match(/^tailors?\s+in\s+(.+)$/)
  if (tailorsInMatch) {
    return { specialty: '', location: tailorsInMatch[1].trim(), general: '' }
  }

  const inMatch = trimmed.match(/^(.+?)\s+in\s+(.+)$/i)
  if (inMatch) {
    return { specialty: inMatch[1].trim(), location: inMatch[2].trim(), general: '' }
  }

  return { specialty: '', location: '', general: trimmed }
}

function applyLocationBoost(results: TailorResult[], location: string): TailorResult[] {
  if (!location) return results
  const loc = location.toLowerCase()
  return results
    .map((item) => ({
      item,
      score: (item.avgRating ?? 0) + (item.location.toLowerCase().includes(loc) ? 100 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item)
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
  const [showGuide, setShowGuide] = useState(true)

  useEffect(() => {
    AsyncStorage.getItem(SEARCH_GUIDE_KEY)
      .then((value) => {
        if (value === '1') setShowGuide(false)
      })
      .catch(() => {})
  }, [])

  const search = useCallback(async (q: string, g: string, t: string) => {
    setLoading(true)
    setSearched(true)
    setFetchError(false)

    try {
      const { specialty, location, general } = parseSearchQuery(q)

      const baseQuery = supabase
        .from('tailor_profiles')
        .select('id, display_name, location, seller_type, specialty_tags, avg_rating, total_reviews, tier, availability, avg_response_hours, price_range_min, currency, avatar_url, supports_custom_orders, supports_ready_made')
        .eq('is_live', true)
        .neq('availability', 'FULLY_BOOKED')

      let query = baseQuery

      if (specialty) {
        query = query.or(`display_name.ilike.%${specialty}%,specialty_tags.cs.{${specialty}}`)
      } else if (general) {
        query = query.or(`display_name.ilike.%${general}%,location.ilike.%${general}%,specialty_tags.cs.{${general}}`)
      }
      if (g !== 'All') {
        query = query.contains('specialty_tags', [g])
      }
      if (t !== 'All') {
        query = query.eq('tier', t)
      }

      let strictResults: TailorResult[] = []

      if (location) {
        let strictQuery = baseQuery.ilike('location', `%${location}%`)
        if (specialty) {
          strictQuery = strictQuery.or(`display_name.ilike.%${specialty}%,specialty_tags.cs.{${specialty}}`)
        }
        if (g !== 'All') {
          strictQuery = strictQuery.contains('specialty_tags', [g])
        }
        if (t !== 'All') {
          strictQuery = strictQuery.eq('tier', t)
        }

        const { data: strictData, error: strictError } = await strictQuery.order('ranking_score', { ascending: false }).limit(30)
        if (strictError) throw strictError
        strictResults = (strictData ?? []).map((d: any) => ({
          id: d.id,
          displayName: d.display_name,
          location: d.location,
          sellerType: d.seller_type ?? 'TAILOR',
          specialtyTags: asStringList(d.specialty_tags),
          avgRating: d.avg_rating,
          totalReviews: d.total_reviews,
          tier: d.tier,
          availability: d.availability,
          avgResponseHours: d.avg_response_hours,
          priceRangeMin: d.price_range_min,
          currency: (d.currency ?? 'USD') as CurrencyCode,
          avatarUrl: d.avatar_url ?? null,
          supportsCustomOrders: d.supports_custom_orders ?? true,
          supportsReadyMade: d.supports_ready_made ?? false,
        }))
      }

      let mappedResults = strictResults

      if (mappedResults.length === 0) {
        const { data, error } = await query.order('ranking_score', { ascending: false }).limit(30)
        if (error) throw error

        mappedResults = (data ?? []).map((d: any) => ({
          id: d.id,
          displayName: d.display_name,
          location: d.location,
          sellerType: d.seller_type ?? 'TAILOR',
          specialtyTags: asStringList(d.specialty_tags),
          avgRating: d.avg_rating,
          totalReviews: d.total_reviews,
          tier: d.tier,
          availability: d.availability,
          avgResponseHours: d.avg_response_hours,
          priceRangeMin: d.price_range_min,
          currency: (d.currency ?? 'USD') as CurrencyCode,
          avatarUrl: d.avatar_url ?? null,
          supportsCustomOrders: d.supports_custom_orders ?? true,
          supportsReadyMade: d.supports_ready_made ?? false,
        }))
        if (location) {
          mappedResults = applyLocationBoost(mappedResults, location)
        }
      }

      setResults(mappedResults)
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

  async function dismissGuide() {
    setShowGuide(false)
    try {
      await AsyncStorage.setItem(SEARCH_GUIDE_KEY, '1')
    } catch {}
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Find a tailor</Text>
        {showGuide ? (
          <View style={styles.guideCard}>
            <View style={styles.guideHeader}>
              <Text style={styles.guideEyebrow}>Best use</Text>
              <TouchableOpacity
                onPress={() => { void dismissGuide() }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Dismiss search tips"
              >
                <Feather name="x" size={16} color={Colors.midGrey} />
              </TouchableOpacity>
            </View>
            <Text style={styles.guideTitle}>Search by name, city, style, or craft, then narrow only if needed.</Text>
          </View>
        ) : null}
        <Input
          placeholder="Name, city, style, or craft..."
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          containerStyle={styles.searchInput}
          testID="search-input"
          rightElement={
            <TouchableOpacity onPress={handleSearch} testID="search-submit-btn" style={{ padding: 4 }}>
              <Feather name="search" size={16} color={Colors.needleGreen} />
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
            <Text style={styles.stateHint}>Checking live matches now.</Text>
          </View>
        </View>
      ) : !searched ? (
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Search</Text>
            <Text style={styles.stateTitle}>Search when you already know the direction.</Text>
            <Text style={styles.stateHint}>Try a city, style, craft, or tailor name.</Text>
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
            <Text style={styles.stateHint}>Refresh and try again.</Text>
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
            <Text style={styles.stateHint}>Try fewer filters or a broader search.</Text>
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
                  <RemoteImage
                    uri={item.avatarUrl}
                    bucket="avatars"
                    style={styles.avatarImage}
                    contentFit="cover"
                    transition={120}
                    surface="customer_search_avatar"
                    fallback={(
                      <View style={styles.avatarFallback}>
                        <Feather name="user" size={24} color={Colors.needleGreen} />
                      </View>
                    )}
                  />
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
                      <Text style={styles.response}>
                        From {formatAmount(item.priceRangeMin, item.currency, item.currency, STATIC_FALLBACK_RATES)}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
              <View style={styles.tags}>
                {(item.specialtyTags ?? []).slice(0, 3).map((t) => <Tag key={t} label={t} />)}
                {item.supportsCustomOrders ? <Tag label="Custom" /> : null}
                {item.supportsReadyMade ? <Tag label="Shop now" /> : null}
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
    gap: Spacing.md,
    alignItems: 'center',
    ...Shadow.md,
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
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
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
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 28,
    fontFamily: 'Georgia',
  },
  heroSub: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  guideHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  guideEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  guideTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  guideText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 18 },
  searchInput: { marginBottom: -Spacing.sm },
  filterRow: { gap: Spacing.sm, paddingRight: Spacing.xl },
  chip: {
    minHeight: 40,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: Colors.needleGreen, borderColor: Colors.needleGreen },
  chipText: { fontSize: FontSize.sm, color: Colors.inkLight, fontWeight: FontWeight.medium },
  chipTextActive: { color: Colors.textInverse },
  retryBtn: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
  },
  retryBtnText: { fontSize: FontSize.sm, color: Colors.textInverse, fontWeight: FontWeight.semibold },
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
  list: { padding: Spacing.lg, gap: Spacing.sm },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.md, gap: Spacing.sm, ...Shadow.sm,
  },
  cardTop: { flexDirection: 'row', gap: Spacing.md },
  avatar: {
    width: 52, height: 52, borderRadius: Radius.full,
    overflow: 'hidden',
    backgroundColor: Colors.boneDeep, alignItems: 'center', justifyContent: 'center',
  },
  avatarImage: { width: 52, height: 52, borderRadius: Radius.full },
  avatarFallback: {
    width: 52,
    height: 52,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  info: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  location: { fontSize: FontSize.sm, color: Colors.midGrey },
  metaRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  response: { fontSize: FontSize.xs, color: Colors.midGrey },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  availabilityHint: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  limitedBadge: {
    backgroundColor: Colors.statusPendingBg, paddingHorizontal: Spacing.md,
    paddingVertical: 4, borderRadius: Radius.full, alignSelf: 'flex-start',
  },
  limitedText: { fontSize: FontSize.xs, color: Colors.statusPending, fontWeight: FontWeight.medium },
})
