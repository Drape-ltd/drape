import { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable, ScrollView, ActivityIndicator, Modal,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { Input, TierBadgeChip, StarRating, Tag, RemoteImage } from '@/components/ui'
import type { TierBadge } from '@/components/ui'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const GARMENT_FILTERS = ['All', 'Agbada', 'Suits', 'Ankara', 'Bridal', 'Crochet', 'Knitwear', 'Ready-made']
const TIER_FILTERS = ['All', 'MASTER', 'RISING', 'VERIFIED']

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

type TailorResultRow = {
  id: string
  display_name: string | null
  location: string | null
  seller_type: 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP' | null
  specialty_tags: unknown
  avg_rating: number | null
  total_reviews: number | null
  tier: string | null
  availability: string | null
  avg_response_hours: number | null
  price_range_min: number | null
  currency: CurrencyCode | null
  avatar_url: string | null
  supports_custom_orders: boolean | null
  supports_ready_made: boolean | null
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function toTierBadge(tier: string | null | undefined): TierBadge | null {
  if (tier === 'VERIFIED' || tier === 'RISING' || tier === 'MASTER') return tier
  return null
}

function mapTailorResult(row: TailorResultRow): TailorResult {
  return {
    id: row.id,
    displayName: row.display_name ?? 'Drapeon seller',
    location: row.location ?? 'Location not added',
    sellerType: row.seller_type ?? 'TAILOR',
    specialtyTags: asStringList(row.specialty_tags),
    avgRating: row.avg_rating ?? 0,
    totalReviews: row.total_reviews ?? 0,
    tier: row.tier ?? '',
    availability: row.availability ?? 'OPEN',
    avgResponseHours: row.avg_response_hours,
    priceRangeMin: row.price_range_min,
    currency: row.currency ?? 'USD',
    avatarUrl: row.avatar_url ?? null,
    supportsCustomOrders: row.supports_custom_orders ?? true,
    supportsReadyMade: row.supports_ready_made ?? false,
  }
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
  const [filterSheet, setFilterSheet] = useState<'garment' | 'tier' | null>(null)
  const [results, setResults] = useState<TailorResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [fetchError, setFetchError] = useState(false)

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
        strictResults = ((strictData ?? []) as TailorResultRow[]).map(mapTailorResult)
      }

      let mappedResults = strictResults

      if (mappedResults.length === 0) {
        const { data, error } = await query.order('ranking_score', { ascending: false }).limit(30)
        if (error) throw error

        mappedResults = ((data ?? []) as TailorResultRow[]).map(mapTailorResult)
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
    setFilterSheet(null)
  }

  function selectTier(nextTier: string) {
    setTier(nextTier)
    search(query, garment, nextTier)
    setFilterSheet(null)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Find a tailor</Text>
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

        <View style={styles.filterPanel}>
          <TouchableOpacity
            style={styles.filterSelectRow}
            onPress={() => setFilterSheet('garment')}
            accessibilityRole="button"
            accessibilityLabel="Choose garment filter"
          >
            <View>
              <Text style={styles.filterSelectLabel}>Garment</Text>
              <Text style={styles.filterSelectValue}>{garment}</Text>
            </View>
            <Feather name="chevron-right" size={20} color={Colors.inkLight} />
          </TouchableOpacity>
          <View style={styles.filterDivider} />
          <TouchableOpacity
            style={styles.filterSelectRow}
            onPress={() => setFilterSheet('tier')}
            accessibilityRole="button"
            accessibilityLabel="Choose tailor tier filter"
          >
            <View>
              <Text style={styles.filterSelectLabel}>Tier</Text>
              <Text style={styles.filterSelectValue}>{tier === 'All' ? 'All tiers' : tier}</Text>
            </View>
            <Feather name="chevron-right" size={20} color={Colors.inkLight} />
          </TouchableOpacity>
        </View>
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
                    <TierBadgeChip tier={toTierBadge(item.tier)} />
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

      <FilterPickerSheet
        visible={filterSheet !== null}
        title={filterSheet === 'garment' ? 'Garment filter' : 'Tailor tier'}
        options={filterSheet === 'garment' ? GARMENT_FILTERS : TIER_FILTERS}
        selected={filterSheet === 'garment' ? garment : tier}
        labelForOption={(option) => option === 'All' && filterSheet === 'tier' ? 'All tiers' : option}
        onClose={() => setFilterSheet(null)}
        onSelect={(option) => {
          if (filterSheet === 'garment') {
            selectGarment(option)
          } else {
            selectTier(option)
          }
        }}
      />
    </SafeAreaView>
  )
}

function FilterPickerSheet({
  visible,
  title,
  options,
  selected,
  labelForOption,
  onSelect,
  onClose,
}: {
  visible: boolean
  title: string
  options: string[]
  selected: string
  labelForOption: (option: string) => string
  onSelect: (option: string) => void
  onClose: () => void
}) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close filter picker">
              <Feather name="x" size={20} color={Colors.ink} />
            </TouchableOpacity>
          </View>
          <View style={styles.sheetOptionList}>
            {options.map((option) => {
              const active = selected === option
              return (
                <TouchableOpacity
                  key={option}
                  style={styles.sheetOption}
                  onPress={() => onSelect(option)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.sheetOptionText, active && styles.sheetOptionTextActive]}>
                    {labelForOption(option)}
                  </Text>
                  {active ? <Feather name="check" size={20} color={Colors.needleGreen} /> : null}
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      </View>
    </Modal>
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
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
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
    fontFamily: Fonts.display,
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
  guideTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  guideText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 18 },
  searchInput: { marginBottom: 0 },
  filterPanel: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  filterSelectRow: {
    minHeight: 62,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  filterDivider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginLeft: Spacing.md },
  filterSelectLabel: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  filterSelectValue: { marginTop: 3, fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.semibold },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(26,26,24,0.35)' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 48,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.lightGrey,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: FontSize.lg, color: Colors.ink, fontWeight: FontWeight.bold, fontFamily: Fonts.display },
  sheetCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOptionList: { gap: 2 },
  sheetOption: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  sheetOptionText: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.medium },
  sheetOptionTextActive: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
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
  name: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
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
