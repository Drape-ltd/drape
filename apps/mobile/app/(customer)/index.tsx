import { useCallback, useState, useRef, useEffect } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Image, TextInput, ActivityIndicator,
  Keyboard, FlatList, useWindowDimensions,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Feather } from '@expo/vector-icons'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { TierBadgeChip, StarRating } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'

const RECENTLY_VIEWED_KEY  = 'drape_recently_viewed_tailors'
const RECENT_SEARCHES_KEY  = 'drape_recent_searches'
const LAST_SEARCH_KEY      = 'drape_last_search'
const DISCOVER_GUIDE_KEY   = 'drape_customer_discover_best_use_dismissed'
const MAX_RECENTLY_VIEWED  = 10
const MAX_RECENT_SEARCHES  = 5
const PAGE_SIZE            = 20

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_PILL_COLOR: Partial<Record<OrderStage, { bg: string; text: string }>> = {
  PENDING_QUOTE:   { bg: '#FFF3CD', text: '#856404' },
  CONSULTATION:    { bg: '#FFF3CD', text: '#856404' },
  QUOTE_SENT:      { bg: '#D1ECF1', text: '#0C5460' },
  PAYMENT_PENDING: { bg: '#D1ECF1', text: '#0C5460' },
  IN_DISPUTE:      { bg: '#F8D7DA', text: '#721C24' },
}

// Ordered by broadest appeal first. Globally understandable.
// Future: replace with dynamic categories derived from search frequency or personalisation.
const BROWSE_STYLES = ['Suits', 'Bridal', 'Casual', 'Traditional', 'Bespoke']

type AvailFilter = 'ALL' | 'OPEN' | 'LIMITED'

// ─── Types ────────────────────────────────────────────────────────────────────

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
  sellerType: 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP'
  specialtyTags: string[]
  avgRating: number
  totalReviews: number
  tier: string
  priceRangeMin: number | null
  priceRangeMax: number | null
  portfolioPhoto: string | null
  availability: string
  supportsCustomOrders: boolean
  supportsReadyMade: boolean
  avgResponseHours?: number | null
  rankingScore: number
}

type LastSearch = {
  query: string
  count: number
  thumbnail: string | null
}

function orderPriority(stage: OrderStage): number {
  switch (stage) {
    case 'QUOTE_SENT':
      return 0
    case 'READY_FOR_COLLECTION':
      return 1
    case 'DELIVERED':
    case 'COLLECTED':
      return 2
    case 'IN_DISPUTE':
      return 3
    case 'SHIPPED':
      return 4
    default:
      return 5
  }
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function availabilityHint(tailor: TailorCard): string | null {
  if (tailor.availability === 'LIMITED') return 'Taking a limited number of orders'
  if (tailor.avgResponseHours != null) return `Usually replies in about ${Math.round(tailor.avgResponseHours)}h`
  return null
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function storageKey(base: string, userId: string | undefined) {
  return `${base}:${userId ?? 'guest'}`
}

async function saveRecentlyViewed(userId: string | undefined, tailor: TailorCard) {
  try {
    const raw = await AsyncStorage.getItem(storageKey(RECENTLY_VIEWED_KEY, userId))
    const existing: TailorCard[] = raw ? JSON.parse(raw) : []
    const updated = [tailor, ...existing.filter((t) => t.id !== tailor.id)].slice(0, MAX_RECENTLY_VIEWED)
    await AsyncStorage.setItem(storageKey(RECENTLY_VIEWED_KEY, userId), JSON.stringify(updated))
  } catch {}
}

async function loadRecentlyViewed(userId: string | undefined): Promise<TailorCard[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(RECENTLY_VIEWED_KEY, userId))
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

async function saveRecentSearch(userId: string | undefined, q: string) {
  try {
    const raw = await AsyncStorage.getItem(storageKey(RECENT_SEARCHES_KEY, userId))
    const existing: string[] = raw ? JSON.parse(raw) : []
    const updated = [q, ...existing.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT_SEARCHES)
    await AsyncStorage.setItem(storageKey(RECENT_SEARCHES_KEY, userId), JSON.stringify(updated))
  } catch {}
}

async function loadRecentSearches(userId: string | undefined): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(RECENT_SEARCHES_KEY, userId))
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

async function clearRecentSearches(userId: string | undefined) {
  try { await AsyncStorage.removeItem(storageKey(RECENT_SEARCHES_KEY, userId)) } catch {}
}

async function saveLastSearch(userId: string | undefined, ls: LastSearch) {
  try { await AsyncStorage.setItem(storageKey(LAST_SEARCH_KEY, userId), JSON.stringify(ls)) } catch {}
}

async function loadLastSearch(userId: string | undefined): Promise<LastSearch | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(LAST_SEARCH_KEY, userId))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// ─── Query helpers ─────────────────────────────────────────────────────────────

function mapTailor(t: any): TailorCard {
  const portfolioPhotos = asStringList(t.portfolio_photo_urls)

  return {
    id: t.id,
    displayName: t.display_name,
    location: t.location,
    sellerType: t.seller_type ?? 'TAILOR',
    specialtyTags: asStringList(t.specialty_tags),
    avgRating: t.avg_rating,
    totalReviews: t.total_reviews,
    tier: t.tier,
    priceRangeMin: t.price_range_min ?? null,
    priceRangeMax: t.price_range_max ?? null,
    portfolioPhoto: portfolioPhotos[0] ?? null,
    availability: t.availability,
    supportsCustomOrders: t.supports_custom_orders ?? true,
    supportsReadyMade: t.supports_ready_made ?? false,
    avgResponseHours: t.avg_response_hours ?? null,
    rankingScore: t.ranking_score ?? 0,
  }
}

/**
 * Natural language query parser.
 * "Suits in Lagos"    → { specialty: "Suits",  location: "Lagos" }
 * "Sellers in London" → { specialty: "",        location: "London" }
 * "Bridal"            → { specialty: "Bridal",  location: "" }
 */
function parseQuery(input: string): { specialty: string; location: string; general: string } {
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

/** Apply location boost for NLP-parsed location queries: re-ranks without excluding non-matching tailors. */
function applyLocationBoost(tailors: TailorCard[], location: string): TailorCard[] {
  if (!location) return tailors
  const loc = location.toLowerCase()
  return tailors
    .map((t) => ({ t, score: t.rankingScore + (t.location.toLowerCase().includes(loc) ? 15 : 0) }))
    .sort((a, b) => b.score - a.score)
    .map(({ t }) => t)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CustomerHomeScreen() {
  const router = useRouter()
  const { user } = useAuth()

  // Browse data
  const [activeOrders, setActiveOrders]     = useState<ActiveOrder[]>([])
  const [hasOrderHistory, setHasOrderHistory] = useState(false)
  const [allTailors, setAllTailors]         = useState<TailorCard[]>([])
  const [recentlyViewed, setRecentlyViewed] = useState<TailorCard[]>([])
  const [refreshing, setRefreshing]         = useState(false)
  const [fetchError, setFetchError]         = useState(false)

  // Search state
  const [query, setQuery]                   = useState('')
  const [searchFocused, setSearchFocused]   = useState(false)
  const [searchResults, setSearchResults]   = useState<TailorCard[]>([])
  const [searching, setSearching]           = useState(false)
  const [searchPending, setSearchPending]   = useState(false)
  const [loadingMore, setLoadingMore]       = useState(false)
  const [searchFetchError, setSearchFetchError] = useState(false)
  const [hasMore, setHasMore]               = useState(false)
  const [resultOffset, setResultOffset]     = useState(0)
  const [availFilter, setAvailFilter]       = useState<AvailFilter>('ALL')
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [lastSearch, setLastSearch]         = useState<LastSearch | null>(null)
  const [showGuide, setShowGuide]           = useState(true)

  // In-memory result cache: query key → first-page results
  const resultCacheRef = useRef<Map<string, TailorCard[]>>(new Map())
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef       = useRef<TextInput>(null)

  const isSearchActive  = query.trim().length > 0
  const showSuggestions = searchFocused && !isSearchActive

  // Filtered results by availability (client-side, no extra round trip)
  const filteredResults = availFilter === 'ALL'
    ? searchResults
    : searchResults.filter((t) => t.availability === availFilter)

  // ── Persistence load on focus ─────────────────────────────────────────────

  useFocusEffect(useCallback(() => {
    Promise.all([
      loadRecentlyViewed(user?.id),
      loadRecentSearches(user?.id),
      loadLastSearch(user?.id),
      AsyncStorage.getItem(storageKey(DISCOVER_GUIDE_KEY, user?.id)).catch(() => null),
    ]).then(([rv, rs, ls, guideValue]) => {
      setRecentlyViewed(rv)
      setRecentSearches(rs)
      setLastSearch(ls)
      setShowGuide(guideValue !== '1')
    })
  }, [user?.id]))

  async function dismissGuide() {
    setShowGuide(false)
    try {
      await AsyncStorage.setItem(storageKey(DISCOVER_GUIDE_KEY, user?.id), '1')
    } catch {}
  }

  useFocusEffect(useCallback(() => {
    if (!user?.id) return
    fetchData()
  }, [user?.id]))

  // ── Debounced live search — resets pagination on new query ─────────────────

  useEffect(() => {
    if (!isSearchActive) {
      setSearchResults([])
      setSearchFetchError(false)
      setHasMore(false)
      setResultOffset(0)
      setSearchPending(false)
      return
    }
    setSearchPending(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      runSearch(query, 0)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  // ── Data fetching ──────────────────────────────────────────────────────────

  async function fetchData() {
    setFetchError(false)
    try {
      const [ordersRes, historyRes, tailorsRes] = await Promise.allSettled([
        supabase
          .from('orders')
          .select(`
            id, reference, garment_type, stage,
            tailor_profiles!tailor_profile_id(display_name),
            quoted_completion_date
          `)
          .eq('customer_id', user?.id)
          .not('stage', 'in', '("COMPLETE","DECLINED","EXPIRED","REFUNDED","CANCELLED")')
          .order('created_at', { ascending: false })
          .limit(3),
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', user?.id),
        supabase
          .from('tailor_profiles')
          .select('id, display_name, location, seller_type, specialty_tags, avg_rating, total_reviews, tier, price_range_min, price_range_max, portfolio_photo_urls, availability, avg_response_hours, supports_custom_orders, supports_ready_made, ranking_score')
          .eq('is_live', true)
          .order('ranking_score', { ascending: false })
          .limit(30),
      ])

      const ordersFailed =
        ordersRes.status === 'rejected' ||
        (ordersRes.status === 'fulfilled' && !!ordersRes.value.error)
      const tailorsFailed =
        tailorsRes.status === 'rejected' ||
        (tailorsRes.status === 'fulfilled' && !!tailorsRes.value.error)

      if (ordersFailed && tailorsFailed) {
        setFetchError(true)
        setActiveOrders([])
        setHasOrderHistory(false)
        setAllTailors([])
        return
      }

      const orderRows =
        ordersRes.status === 'fulfilled' && !ordersRes.value.error
          ? ((ordersRes.value.data ?? []) as any[])
          : []
      const historyCount =
        historyRes.status === 'fulfilled' && !historyRes.value.error
          ? (historyRes.value.count ?? 0)
          : 0
      const tailorRows =
        tailorsRes.status === 'fulfilled' && !tailorsRes.value.error
          ? ((tailorsRes.value.data ?? []) as any[])
          : []

      setActiveOrders(
        orderRows
          .map((o: any) => ({
            id: o.id,
            reference: o.reference,
            garmentType: o.garment_type,
            stage: o.stage,
            tailorName: o.tailor_profiles?.display_name ?? '',
            estimatedDate: o.quoted_completion_date,
          }))
          .sort((a, b) => orderPriority(a.stage) - orderPriority(b.stage))
      )
      setHasOrderHistory(historyCount > 0)

      setAllTailors(tailorRows.map(mapTailor))
    } catch {
      setFetchError(true)
    }
  }

  /**
   * runSearch — handles both fresh searches (offset=0) and pagination.
   * offset=0: show cached results immediately, fetch fresh in parallel.
   * offset>0: append results to existing list.
   */
  async function runSearch(q: string, offset: number) {
    const { specialty, location, general } = parseQuery(q)

    // For fresh searches, show cached results instantly while fetching fresh
    if (offset === 0) {
      const cached = resultCacheRef.current.get(q)
      if (cached) setSearchResults(cached)
      setSearching(true)
      setSearchPending(false)
      setSearchFetchError(false)
      setResultOffset(0)
    } else {
      setLoadingMore(true)
    }
    try {
      const baseQuery = supabase
        .from('tailor_profiles')
        .select('id, display_name, location, seller_type, specialty_tags, avg_rating, total_reviews, tier, price_range_min, price_range_max, portfolio_photo_urls, availability, avg_response_hours, supports_custom_orders, supports_ready_made, ranking_score')
        .eq('is_live', true)

      let sq = baseQuery

      // Apply content filter — no hard location filter (location is a boost, not a gate)
      if (specialty) {
        sq = sq.or(`display_name.ilike.%${specialty}%,specialty_tags.cs.{${specialty}}`)
      } else if (general) {
        sq = sq.or(`display_name.ilike.%${general}%,location.ilike.%${general}%,specialty_tags.cs.{${general}}`)
      }
      // "Sellers in London" or location-only: try strict location matches first.

      const fetchSize = location ? PAGE_SIZE * 3 : PAGE_SIZE

      let strictPage: TailorCard[] = []
      if (location) {
        let strictQuery = baseQuery.ilike('location', `%${location}%`)
        if (specialty) {
          strictQuery = strictQuery.or(`display_name.ilike.%${specialty}%,specialty_tags.cs.{${specialty}}`)
        }

        const { data: strictData, error: strictError } = await strictQuery
          .order('ranking_score', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1)

        if (strictError) throw strictError
        strictPage = (strictData ?? []).map(mapTailor)
      }

      let page = strictPage

      if (page.length === 0) {
        const { data, error } = await sq
          .order('ranking_score', { ascending: false })
          .range(offset, offset + fetchSize - 1)

        if (error) throw error

        page = (data ?? []).map(mapTailor)

        if (location) {
          page = applyLocationBoost(page, location).slice(0, PAGE_SIZE)
        }
      }

      if (offset === 0) {
        setSearchResults(page)
        if (resultCacheRef.current.size >= 30) {
          const firstKey = resultCacheRef.current.keys().next().value
          if (firstKey) resultCacheRef.current.delete(firstKey)
        }
        resultCacheRef.current.set(q, page)
        setResultOffset(page.length)

        const ls: LastSearch = { query: q, count: page.length, thumbnail: page[0]?.portfolioPhoto ?? null }
        saveRecentSearch(user?.id, q)
        saveLastSearch(user?.id, ls)
        setLastSearch(ls)
        loadRecentSearches(user?.id).then(setRecentSearches)
      } else {
        setSearchResults((prev) => [...prev, ...page])
        setResultOffset((prev) => prev + page.length)
      }

      setHasMore(page.length === PAGE_SIZE)
    } catch {
      setSearchFetchError(true)
      if (offset === 0) {
        setSearchResults([])
        setHasMore(false)
      }
    } finally {
      if (offset === 0) {
        setSearching(false)
        setSearchPending(false)
      } else {
        setLoadingMore(false)
      }
    }
  }

  function loadMoreResults() {
    if (!hasMore || loadingMore || searching) return
    runSearch(query, resultOffset)
  }

  async function onRefresh() {
    setRefreshing(true)
    await fetchData()
    const [rv, rs, ls] = await Promise.all([
      loadRecentlyViewed(user?.id),
      loadRecentSearches(user?.id),
      loadLastSearch(user?.id),
    ])
    setRecentlyViewed(rv)
    setRecentSearches(rs)
    setLastSearch(ls)
    setRefreshing(false)
  }

  function navigateToTailor(tailor: TailorCard) {
    saveRecentlyViewed(user?.id, tailor)
    router.navigate(`/(customer)/tailor/${tailor.id}`)
  }

  function applyQuery(q: string) {
    setQuery(q)
    Keyboard.dismiss()
    setSearchFocused(false)
  }

  function cancelSearch() {
    setQuery('')
    setSearchFocused(false)
    setAvailFilter('ALL')
    Keyboard.dismiss()
  }

  function handleBlur() {
    setTimeout(() => setSearchFocused(false), 150)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>

      {/* ── Sticky header ── */}
      <View style={styles.stickyHeader}>
        {/* Search row */}
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              ref={inputRef}
              style={styles.searchInput}
              placeholder="Search sellers, styles, or locations"
              placeholderTextColor={Colors.midGrey}
              value={query}
              onChangeText={setQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={handleBlur}
              returnKeyType="search"
              onSubmitEditing={() => {
                if (query.trim()) { setSearchFocused(false); runSearch(query, 0) }
              }}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.clearBtn}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
          {(searchFocused || isSearchActive) && (
            <TouchableOpacity onPress={cancelSearch} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>

      </View>

      {/* ── Suggestions panel (focused, no query) ── */}
      {showSuggestions ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.suggestionsContent}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
        >
          {recentSearches.length > 0 && (
            <View style={styles.suggestSection}>
              <View style={styles.suggestHeader}>
                <Text style={styles.suggestTitle}>Recent searches</Text>
                <TouchableOpacity onPress={() => { clearRecentSearches(user?.id); setRecentSearches([]) }}>
                  <Text style={styles.suggestClear}>Clear</Text>
                </TouchableOpacity>
              </View>
              {recentSearches.map((s, i) => (
                <TouchableOpacity key={i} style={styles.recentSearchRow} onPress={() => applyQuery(s)}>
                  <Text style={styles.recentSearchIcon}>🕐</Text>
                  <Text style={styles.recentSearchText}>{s}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      const updated = recentSearches.filter((_, j) => j !== i)
                      setRecentSearches(updated)
                      AsyncStorage.setItem(storageKey(RECENT_SEARCHES_KEY, user?.id), JSON.stringify(updated))
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.recentSearchRemove}>✕</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <View style={styles.suggestSection}>
            <Text style={styles.suggestTitle}>Try searching</Text>
            <View style={styles.suggestChips}>
              {[
                'Suits in Lagos',
                'Sellers in London',
                'Bridal',
                'Casual wear',
                'Traditional',
                'Bespoke suits',
              ].map((s) => (
                <TouchableOpacity key={s} style={styles.suggestChip} onPress={() => applyQuery(s)}>
                  <Text style={styles.suggestChipText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>

      ) : isSearchActive ? (
        // ── Search results — FlatList for lazy load ──
        <FlatList
          data={filteredResults}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.resultsList}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMoreResults}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={
            <View style={styles.resultsHeader}>
              {searching || searchPending ? (
                <ActivityIndicator color={Colors.needleGreen} style={{ marginVertical: Spacing.lg }} />
              ) : (
                <>
                  <Text style={styles.resultsCount}>
                    {filteredResults.length} {filteredResults.length === 1 ? 'seller' : 'sellers'} found
                  </Text>
                  {/* Availability filter chips */}
                  <View style={styles.availRow}>
                    {([
                      { key: 'ALL',     label: 'All' },
                      { key: 'OPEN',    label: 'Available' },
                      { key: 'LIMITED', label: 'Limited' },
                    ] as { key: AvailFilter; label: string }[]).map(({ key, label }) => (
                      <TouchableOpacity
                        key={key}
                        style={[styles.availChip, availFilter === key && styles.availChipActive]}
                        onPress={() => setAvailFilter(key)}
                      >
                        <Text style={[styles.availLabel, availFilter === key && styles.availLabelActive]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </View>
          }
          ListEmptyComponent={
            !(searching || searchPending) ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyStateBadge}>
                  <Text style={styles.emptyStateBadgeText}>Search</Text>
                </View>
                <Text style={styles.emptyStateEmoji}>{searchFetchError ? '⚠️' : '🔎'}</Text>
                <Text style={styles.emptyStateTitle}>{searchFetchError ? "Couldn't load search results" : 'No sellers found'}</Text>
                <Text style={styles.emptyStateHint}>
                  {searchFetchError ? 'Try again in a moment or adjust your search.' : 'Try a different name, style, or location'}
                </Text>
                {searchFetchError && (
                  <>
                    <TouchableOpacity style={styles.searchRetryBtn} onPress={() => runSearch(query, 0)}>
                      <Text style={styles.searchRetryBtnText}>Try again</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.searchSecondaryBtn}
                      onPress={() => {
                        setSearchFocused(false)
                        setQuery('')
                      }}
                    >
                      <Text style={styles.searchSecondaryBtnText}>Back to browsing</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ) : null
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={Colors.needleGreen} style={styles.loadMoreSpinner} /> : null
          }
          renderItem={({ item }) => (
            <SearchResultCard tailor={item} onPress={() => navigateToTailor(item)} />
          )}
        />

      ) : (
        // ── Default browse ──
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Network error banner */}
          {fetchError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>Couldn't load sellers. Pull down to retry, or open Orders while discovery catches up.</Text>
            </View>
          )}

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
              <Text style={styles.guideTitle}>Start with a short shortlist, then place one clear brief.</Text>
            </View>
          )}

          {/* Continue searching card */}
          {lastSearch && (
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.continueCard}
                onPress={() => applyQuery(lastSearch.query)}
                activeOpacity={0.88}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.continueLabel}>Continue searching</Text>
                  <Text style={styles.continueQuery} numberOfLines={1}>"{lastSearch.query}"</Text>
                  <Text style={styles.continueMeta}>
                    {lastSearch.count} {lastSearch.count === 1 ? 'seller' : 'sellers'} found  ›
                  </Text>
                </View>
                {lastSearch.thumbnail ? (
                  <Image source={{ uri: lastSearch.thumbnail }} style={styles.continueThumbnail} resizeMode="cover" />
                ) : (
                  <View style={[styles.continueThumbnail, styles.continueThumbnailPlaceholder]}>
                    <Text style={{ fontSize: 22 }}>🧵</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Recently Viewed */}
          {recentlyViewed.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Recently viewed</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recentScroll}>
                <View style={styles.recentRow}>
                  {recentlyViewed.slice(0, 8).map((t) => (
                    <RecentCard key={t.id} tailor={t} onPress={() => navigateToTailor(t)} />
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Active orders */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Your orders</Text>
              <TouchableOpacity onPress={() => router.navigate('/(customer)/orders')}>
                <Text style={styles.sectionLink}>See all  →</Text>
              </TouchableOpacity>
            </View>
            {activeOrders.length > 0 ? (
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
            ) : (
              <TouchableOpacity
                style={styles.firstOrderCard}
                onPress={() => inputRef.current?.focus()}
                activeOpacity={0.85}
              >
                <View style={styles.firstOrderIcon}>
                  <Text style={styles.firstOrderIconText}>✂️</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.firstOrderTitle}>{hasOrderHistory ? 'No active orders right now' : 'Start your first order'}</Text>
                  <Text style={styles.firstOrderHint}>
                    {hasOrderHistory
                      ? 'Search again when you are ready to place another order.'
                      : 'Search by style, location, or seller name to find someone you trust.'}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          {/* Browse styles */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Browse styles</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.trendingScroll}>
              <View style={styles.trendingRow}>
                {BROWSE_STYLES.map((label) => (
                  <TouchableOpacity key={label} style={styles.trendingChip} onPress={() => applyQuery(label)}>
                    <Text style={styles.trendingLabel}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* Top tailors grid */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Trusted sellers to explore</Text>
            </View>
            {allTailors.length > 0 ? (
              <View style={styles.cardsGrid}>
                {allTailors.map((tailor) => (
                  <GridCard key={tailor.id} tailor={tailor} onPress={() => navigateToTailor(tailor)} />
                ))}
              </View>
            ) : (
              <View style={styles.emptyBrowseCard}>
                <View style={styles.emptyBrowseBadge}>
                  <Text style={styles.emptyBrowseBadgeText}>Discovery</Text>
                </View>
                <Text style={styles.emptyBrowseTitle}>No live sellers to browse yet</Text>
                <Text style={styles.emptyBrowseHint}>
                  As soon as live sellers are available, they will appear here for customers to explore.
                </Text>
                <TouchableOpacity
                  style={styles.emptyBrowseCta}
                  onPress={() => router.push('/(customer)/search')}
                >
                  <Text style={styles.emptyBrowseCtaText}>Search by specialty</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

// ─── Grid card ────────────────────────────────────────────────────────────────

function GridCard({ tailor, onPress }: { tailor: TailorCard; onPress: () => void }) {
  const { width: screenWidth } = useWindowDimensions()
  const CARD_WIDTH = (screenWidth - Spacing.xl * 2 - Spacing.md) / 2
  const [imageFailed, setImageFailed] = useState(false)
  return (
    <TouchableOpacity style={[styles.gridCard, { width: CARD_WIDTH }]} onPress={onPress} activeOpacity={0.88}>
      <View style={styles.gridImageWrap}>
        {tailor.portfolioPhoto && !imageFailed ? (
          <Image
            source={{ uri: tailor.portfolioPhoto }}
            style={styles.gridImage}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={[styles.gridImage, styles.gridImagePlaceholder]}>
            <Text style={{ fontSize: 36 }}>🧵</Text>
          </View>
        )}
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
      <View style={styles.gridInfo}>
        <View style={styles.gridTopRow}>
          <Text style={styles.gridName} numberOfLines={1}>{tailor.displayName}</Text>
          <TierBadgeChip tier={tailor.tier as any} />
        </View>
        <Text style={styles.gridLocation} numberOfLines={1}>{tailor.location}</Text>
        <StarRating rating={tailor.avgRating} count={tailor.totalReviews} />
        {tailor.specialtyTags.length > 0 && (
          <Text style={styles.gridTags} numberOfLines={1}>
            {tailor.specialtyTags.slice(0, 2).join(' · ')}
          </Text>
        )}
        <View style={styles.capabilityRow}>
          {tailor.supportsCustomOrders ? (
            <View style={styles.capabilityChip}>
              <Text style={styles.capabilityText}>Custom</Text>
            </View>
          ) : null}
          {tailor.supportsReadyMade ? (
            <View style={styles.capabilityChip}>
              <Text style={styles.capabilityText}>Shop now</Text>
            </View>
          ) : null}
        </View>
        {availabilityHint(tailor) && (
          <Text style={styles.gridHint} numberOfLines={1}>{availabilityHint(tailor)}</Text>
        )}
      </View>
    </TouchableOpacity>
  )
}

// ─── Search result card ───────────────────────────────────────────────────────

function SearchResultCard({ tailor, onPress }: { tailor: TailorCard; onPress: () => void }) {
  const [imageFailed, setImageFailed] = useState(false)
  return (
    <TouchableOpacity style={styles.resultCard} onPress={onPress} activeOpacity={0.88}>
      <View style={styles.resultThumb}>
        {tailor.portfolioPhoto && !imageFailed ? (
          <Image
            source={{ uri: tailor.portfolioPhoto }}
            style={styles.resultThumbImg}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={[styles.resultThumbImg, styles.resultThumbPlaceholder]}>
            <Text style={{ fontSize: 24 }}>🧵</Text>
          </View>
        )}
      </View>
      <View style={styles.resultInfo}>
        <View style={styles.resultNameRow}>
          <Text style={styles.resultName} numberOfLines={1}>{tailor.displayName}</Text>
          <TierBadgeChip tier={tailor.tier as any} />
        </View>
        <Text style={styles.resultLocation} numberOfLines={1}>{tailor.location}</Text>
        <StarRating rating={tailor.avgRating} count={tailor.totalReviews} />
        {tailor.specialtyTags.length > 0 && (
          <Text style={styles.resultTags} numberOfLines={1}>
            {tailor.specialtyTags.slice(0, 2).join(' · ')}
          </Text>
        )}
        <View style={styles.capabilityRow}>
          {tailor.supportsCustomOrders ? (
            <View style={styles.capabilityChip}>
              <Text style={styles.capabilityText}>Custom</Text>
            </View>
          ) : null}
          {tailor.supportsReadyMade ? (
            <View style={styles.capabilityChip}>
              <Text style={styles.capabilityText}>Shop now</Text>
            </View>
          ) : null}
        </View>
        {availabilityHint(tailor) && (
          <Text style={styles.resultHint} numberOfLines={1}>{availabilityHint(tailor)}</Text>
        )}
        {tailor.availability === 'LIMITED' && (
          <View style={styles.limitedBadge}>
            <Text style={styles.limitedText}>Limited availability</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  )
}

// ─── Recently viewed card ─────────────────────────────────────────────────────

function RecentCard({ tailor, onPress }: { tailor: TailorCard; onPress: () => void }) {
  const [imageFailed, setImageFailed] = useState(false)
  return (
    <TouchableOpacity style={styles.recentCard} onPress={onPress} activeOpacity={0.88}>
      <View style={styles.recentImageWrap}>
        {tailor.portfolioPhoto && !imageFailed ? (
          <Image
            source={{ uri: tailor.portfolioPhoto }}
            style={styles.recentImage}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={[styles.recentImage, styles.recentImagePlaceholder]}>
            <Text style={{ fontSize: 20 }}>🧵</Text>
          </View>
        )}
      </View>
      <Text style={styles.recentName} numberOfLines={1}>{tailor.displayName}</Text>
      <Text style={styles.recentLocation} numberOfLines={1}>{tailor.location}</Text>
    </TouchableOpacity>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },

  // Sticky header
  stickyHeader: {
    backgroundColor: Colors.bone,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.full,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg, ...Shadow.md,
  },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, fontSize: FontSize.sm, color: Colors.ink, padding: 0 },
  clearBtn: { fontSize: 14, color: Colors.midGrey },
  cancelBtn: { paddingVertical: Spacing.sm },
  cancelText: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  // Scroll areas
  scroll: { flex: 1 },
  content: { paddingBottom: 100 },
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
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.lg,
    marginBottom: Spacing.lg,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
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
  guideTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  errorBanner: {
    marginHorizontal: Spacing.xl, marginTop: Spacing.lg,
    backgroundColor: Colors.kanteRustLight, borderRadius: Radius.md,
    padding: Spacing.md, borderLeftWidth: 3, borderLeftColor: Colors.kanteRust,
  },
  errorBannerText: { fontSize: FontSize.sm, color: Colors.kanteRust },

  // Suggestions panel
  suggestionsContent: { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: 60 },
  suggestSection: { gap: Spacing.md },
  suggestHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  suggestTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  suggestClear: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  recentSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey,
  },
  recentSearchIcon: { fontSize: 16 },
  recentSearchText: { flex: 1, fontSize: FontSize.sm, color: Colors.ink },
  recentSearchRemove: { fontSize: 13, color: Colors.midGrey },
  suggestChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  suggestChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.lightGrey,
  },
  suggestChipText: { fontSize: FontSize.sm, color: Colors.ink },

  // Search results (FlatList)
  resultsList: { padding: Spacing.xl, gap: Spacing.md, paddingBottom: 100 },
  resultsHeader: { gap: Spacing.md, marginBottom: Spacing.sm },
  resultsCount: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  availRow: { flexDirection: 'row', gap: Spacing.sm },
  availChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderRadius: Radius.full, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.lightGrey,
  },
  availChipActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  availLabel: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
  availLabelActive: { color: Colors.white },
  loadMoreSpinner: { marginVertical: Spacing.lg },

  // Result card
  resultCard: {
    flexDirection: 'row', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.md, ...Shadow.sm,
  },
  resultThumb: { width: 88, height: 96, borderRadius: Radius.md, overflow: 'hidden' },
  resultThumbImg: { width: '100%', height: '100%' },
  resultThumbPlaceholder: { backgroundColor: Colors.boneDeep, alignItems: 'center', justifyContent: 'center' },
  resultInfo: { flex: 1, gap: 3, justifyContent: 'center' },
  resultNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultName: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, flex: 1, marginRight: 4 },
  resultLocation: { fontSize: FontSize.xs, color: Colors.midGrey },
  resultTags: { fontSize: FontSize.xs, color: Colors.inkLight },
  resultHint: { fontSize: FontSize.xs, color: Colors.needleGreen, marginTop: 4, fontWeight: FontWeight.medium },
  capabilityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: 2 },
  capabilityChip: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  capabilityText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
  limitedBadge: {
    backgroundColor: '#FEF3C7', paddingHorizontal: Spacing.sm,
    paddingVertical: 2, borderRadius: Radius.full, alignSelf: 'flex-start', marginTop: 2,
  },
  limitedText: { fontSize: 10, color: '#92400E', fontWeight: FontWeight.medium },

  // Section
  section: { paddingTop: Spacing.lg },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl, marginBottom: Spacing.md,
  },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  sectionLink: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  // Continue searching card
  continueCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.xl, backgroundColor: Colors.white,
    borderRadius: Radius.lg, padding: Spacing.lg, ...Shadow.sm,
  },
  continueLabel: { fontSize: FontSize.xs, color: Colors.midGrey, fontWeight: FontWeight.medium },
  continueQuery: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  continueMeta: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  continueThumbnail: { width: 64, height: 64, borderRadius: Radius.md, overflow: 'hidden' },
  continueThumbnailPlaceholder: { backgroundColor: Colors.boneDeep, alignItems: 'center', justifyContent: 'center' },

  // Recently viewed
  recentScroll: { marginLeft: Spacing.xl },
  recentRow: { flexDirection: 'row', gap: Spacing.md, paddingRight: Spacing.xl },
  recentCard: { width: 100, gap: 4 },
  recentImageWrap: { width: 100, height: 110, borderRadius: Radius.md, overflow: 'hidden' },
  recentImage: { width: '100%', height: '100%' },
  recentImagePlaceholder: { backgroundColor: Colors.boneDeep, alignItems: 'center', justifyContent: 'center' },
  recentName: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.ink },
  recentLocation: { fontSize: 10, color: Colors.midGrey },

  // Orders
  ordersScroll: { marginLeft: Spacing.xl },
  ordersRow: { flexDirection: 'row', gap: Spacing.md, paddingRight: Spacing.xl },
  orderCard: {
    width: 140, backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.xs, ...Shadow.sm,
  },
  orderStagePill: {
    alignSelf: 'flex-start', paddingHorizontal: Spacing.sm,
    paddingVertical: 3, borderRadius: Radius.full, marginBottom: Spacing.xs,
  },
  orderStageText: { fontSize: 10, fontWeight: FontWeight.bold },
  orderGarment: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  orderTailor: { fontSize: FontSize.xs, color: Colors.midGrey },
  orderEta: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  firstOrderCard: {
    marginHorizontal: Spacing.xl,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    ...Shadow.sm,
  },
  firstOrderIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  firstOrderIconText: { fontSize: 22 },
  firstOrderTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  firstOrderHint: { fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 20, marginTop: 2 },

  // Browse styles
  trendingScroll: { marginLeft: Spacing.xl },
  trendingRow: { flexDirection: 'row', gap: Spacing.sm, paddingRight: Spacing.xl },
  trendingChip: {
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderRadius: Radius.full, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.lightGrey, ...Shadow.sm,
  },
  trendingLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink },

  // Tailor grid
  cardsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  gridCard: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  gridImageWrap: { width: '100%', aspectRatio: 0.9, position: 'relative' },
  gridImage: { width: '100%', height: '100%' },
  gridImagePlaceholder: { backgroundColor: Colors.boneDeep, alignItems: 'center', justifyContent: 'center' },
  availBadge: {
    position: 'absolute', bottom: 8, left: 8,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: Radius.full,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  availBadgeFull: { backgroundColor: 'rgba(0,0,0,0.55)' },
  availDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.success },
  availText: { fontSize: 10, fontWeight: FontWeight.semibold, color: Colors.ink },
  availTextFull: { color: Colors.white },
  gridInfo: { padding: Spacing.md, gap: 4 },
  gridTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gridName: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, flex: 1, marginRight: 4 },
  gridLocation: { fontSize: FontSize.xs, color: Colors.midGrey },
  gridTags: { fontSize: FontSize.xs, color: Colors.inkLight, marginTop: 2 },
  gridHint: { fontSize: FontSize.xs, color: Colors.needleGreen, marginTop: 4, fontWeight: FontWeight.medium },

  // Empty state
  emptyState: { alignItems: 'center', gap: Spacing.sm, paddingVertical: 60, paddingHorizontal: Spacing.xl },
  emptyStateBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  emptyStateBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  emptyStateEmoji: { fontSize: 40 },
  emptyStateTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  emptyStateHint: { fontSize: FontSize.sm, color: Colors.midGrey },
  searchRetryBtn: {
    marginTop: Spacing.md,
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  searchRetryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
  searchSecondaryBtn: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  searchSecondaryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyBrowseCard: {
    marginHorizontal: Spacing.xl,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  emptyBrowseBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  emptyBrowseBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  emptyBrowseTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyBrowseHint: { fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 20 },
  emptyBrowseCta: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  emptyBrowseCtaText: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
})
