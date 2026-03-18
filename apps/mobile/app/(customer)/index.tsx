import { useCallback, useState, useRef, useEffect } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Image, TextInput, ActivityIndicator,
  Keyboard, FlatList, useWindowDimensions,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { TierBadgeChip, StarRating } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'

const RECENTLY_VIEWED_KEY  = 'drape_recently_viewed_tailors'
const RECENT_SEARCHES_KEY  = 'drape_recent_searches'
const LAST_SEARCH_KEY      = 'drape_last_search'
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
  specialtyTags: string[]
  avgRating: number
  totalReviews: number
  tier: string
  priceRangeMin: number | null
  priceRangeMax: number | null
  portfolioPhoto: string | null
  availability: string
  avgResponseHours?: number | null
  rankingScore: number
}

type LastSearch = {
  query: string
  count: number
  thumbnail: string | null
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function saveRecentlyViewed(tailor: TailorCard) {
  try {
    const raw = await AsyncStorage.getItem(RECENTLY_VIEWED_KEY)
    const existing: TailorCard[] = raw ? JSON.parse(raw) : []
    const updated = [tailor, ...existing.filter((t) => t.id !== tailor.id)].slice(0, MAX_RECENTLY_VIEWED)
    await AsyncStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(updated))
  } catch {}
}

async function loadRecentlyViewed(): Promise<TailorCard[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENTLY_VIEWED_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

async function saveRecentSearch(q: string) {
  try {
    const raw = await AsyncStorage.getItem(RECENT_SEARCHES_KEY)
    const existing: string[] = raw ? JSON.parse(raw) : []
    const updated = [q, ...existing.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT_SEARCHES)
    await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
  } catch {}
}

async function loadRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_SEARCHES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

async function clearRecentSearches() {
  try { await AsyncStorage.removeItem(RECENT_SEARCHES_KEY) } catch {}
}

async function saveLastSearch(ls: LastSearch) {
  try { await AsyncStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(ls)) } catch {}
}

async function loadLastSearch(): Promise<LastSearch | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SEARCH_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// ─── Query helpers ─────────────────────────────────────────────────────────────

function mapTailor(t: any): TailorCard {
  return {
    id: t.id,
    displayName: t.display_name,
    location: t.location,
    specialtyTags: t.specialty_tags ?? [],
    avgRating: t.avg_rating,
    totalReviews: t.total_reviews,
    tier: t.tier,
    priceRangeMin: t.price_range_min ?? null,
    priceRangeMax: t.price_range_max ?? null,
    portfolioPhoto: (t.portfolio_photo_urls ?? [])[0] ?? null,
    availability: t.availability,
    avgResponseHours: t.avg_response_hours ?? null,
    rankingScore: t.ranking_score ?? 0,
  }
}

/**
 * Natural language query parser.
 * "Suits in Lagos"    → { specialty: "Suits",  location: "Lagos" }
 * "Tailors in London" → { specialty: "",        location: "London" }
 * "Bridal"            → { specialty: "Bridal",  location: "" }
 */
function parseQuery(input: string): { specialty: string; location: string; general: string } {
  const trimmed = input.trim()
  const lower = trimmed.toLowerCase()

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
  const [allTailors, setAllTailors]         = useState<TailorCard[]>([])
  const [recentlyViewed, setRecentlyViewed] = useState<TailorCard[]>([])
  const [refreshing, setRefreshing]         = useState(false)
  const [fetchError, setFetchError]         = useState(false)

  // Search state
  const [query, setQuery]                   = useState('')
  const [searchFocused, setSearchFocused]   = useState(false)
  const [searchResults, setSearchResults]   = useState<TailorCard[]>([])
  const [searching, setSearching]           = useState(false)
  const [loadingMore, setLoadingMore]       = useState(false)
  const [hasMore, setHasMore]               = useState(false)
  const [resultOffset, setResultOffset]     = useState(0)
  const [availFilter, setAvailFilter]       = useState<AvailFilter>('ALL')
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [lastSearch, setLastSearch]         = useState<LastSearch | null>(null)

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
      loadRecentlyViewed(),
      loadRecentSearches(),
      loadLastSearch(),
    ]).then(([rv, rs, ls]) => {
      setRecentlyViewed(rv)
      setRecentSearches(rs)
      setLastSearch(ls)
    })
  }, []))

  useFocusEffect(useCallback(() => {
    if (!user?.id) return
    fetchData()
  }, [user?.id]))

  // ── Debounced live search — resets pagination on new query ─────────────────

  useEffect(() => {
    if (!isSearchActive) {
      setSearchResults([])
      setHasMore(false)
      setResultOffset(0)
      return
    }
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
        .select('id, display_name, location, specialty_tags, avg_rating, total_reviews, tier, price_range_min, price_range_max, portfolio_photo_urls, availability, ranking_score')
        .eq('is_live', true)
        .order('ranking_score', { ascending: false })
        .limit(30),
    ])

    if (ordersRes.data) {
      setActiveOrders(ordersRes.data.map((o: any) => ({
        id: o.id,
        reference: o.reference,
        garmentType: o.garment_type,
        stage: o.stage,
        tailorName: o.tailor_profiles?.display_name ?? '',
        estimatedDate: o.quoted_completion_date,
      })))
    }
    if (tailorsRes.data) {
      setAllTailors(tailorsRes.data.map(mapTailor))
    }
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
      setResultOffset(0)
    } else {
      setLoadingMore(true)
    }

    let sq = supabase
      .from('tailor_profiles')
      .select('id, display_name, location, specialty_tags, avg_rating, total_reviews, tier, price_range_min, price_range_max, portfolio_photo_urls, availability, avg_response_hours, ranking_score')
      .eq('is_live', true)

    // Apply content filter — no hard location filter (location is a boost, not a gate)
    if (specialty) {
      sq = sq.or(`display_name.ilike.%${specialty}%,specialty_tags.cs.{${specialty}}`)
    } else if (general) {
      sq = sq.or(`display_name.ilike.%${general}%,location.ilike.%${general}%,specialty_tags.cs.{${general}}`)
    }
    // "Tailors in London" or location-only: fetch all, boost below

    // Fetch wider pool when NLP detected a location so we have enough candidates to boost.
    // V1.1 TODO: location-boosted pagination is unreliable on page 2+ — the DB offset is based on
    // raw (un-boosted) ranking, so boosted results on page 2 may overlap or gap with page 1.
    // Fix: server-side location scoring, or disable pagination for location queries.
    const fetchSize = location ? PAGE_SIZE * 3 : PAGE_SIZE

    const { data } = await sq
      .order('ranking_score', { ascending: false })
      .range(offset, offset + fetchSize - 1)

    let page = (data ?? []).map(mapTailor)

    if (location) {
      page = applyLocationBoost(page, location).slice(0, PAGE_SIZE)
    }

    if (offset === 0) {
      setSearchResults(page)
      if (resultCacheRef.current.size >= 30) {
        const firstKey = resultCacheRef.current.keys().next().value
        resultCacheRef.current.delete(firstKey)
      }
      resultCacheRef.current.set(q, page)
      setResultOffset(page.length)

      const ls: LastSearch = { query: q, count: page.length, thumbnail: page[0]?.portfolioPhoto ?? null }
      saveRecentSearch(q)
      saveLastSearch(ls)
      setLastSearch(ls)
      loadRecentSearches().then(setRecentSearches)
      setSearching(false)
    } else {
      setSearchResults((prev) => [...prev, ...page])
      setResultOffset((prev) => prev + page.length)
      setLoadingMore(false)
    }

    setHasMore(page.length === PAGE_SIZE)
  }

  function loadMoreResults() {
    if (!hasMore || loadingMore || searching) return
    runSearch(query, resultOffset)
  }

  async function onRefresh() {
    setRefreshing(true)
    await fetchData()
    const [rv, rs, ls] = await Promise.all([loadRecentlyViewed(), loadRecentSearches(), loadLastSearch()])
    setRecentlyViewed(rv)
    setRecentSearches(rs)
    setLastSearch(ls)
    setRefreshing(false)
  }

  function navigateToTailor(tailor: TailorCard) {
    saveRecentlyViewed(tailor)
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
              placeholder="Search tailors, styles, or locations"
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
                <TouchableOpacity onPress={() => { clearRecentSearches(); setRecentSearches([]) }}>
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
                      AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
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
                'Tailors in London',
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
              {searching ? (
                <ActivityIndicator color={Colors.needleGreen} style={{ marginVertical: Spacing.lg }} />
              ) : (
                <>
                  <Text style={styles.resultsCount}>
                    {filteredResults.length} {filteredResults.length === 1 ? 'tailor' : 'tailors'} found
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
            !searching ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateEmoji}>🔎</Text>
                <Text style={styles.emptyStateTitle}>No tailors found</Text>
                <Text style={styles.emptyStateHint}>Try a different name, style, or location</Text>
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
              <Text style={styles.errorBannerText}>Couldn't load tailors. Pull down to retry.</Text>
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
                    {lastSearch.count} {lastSearch.count === 1 ? 'tailor' : 'tailors'} found  ›
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
          {activeOrders.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Your orders</Text>
                <TouchableOpacity onPress={() => router.navigate('/(customer)/orders')}>
                  <Text style={styles.sectionLink}>See all  →</Text>
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
              <Text style={styles.sectionTitle}>Top tailors</Text>
            </View>
            <View style={styles.cardsGrid}>
              {allTailors.map((tailor) => (
                <GridCard key={tailor.id} tailor={tailor} onPress={() => navigateToTailor(tailor)} />
              ))}
            </View>
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
  return (
    <TouchableOpacity style={[styles.gridCard, { width: CARD_WIDTH }]} onPress={onPress} activeOpacity={0.88}>
      <View style={styles.gridImageWrap}>
        {tailor.portfolioPhoto ? (
          <Image source={{ uri: tailor.portfolioPhoto }} style={styles.gridImage} resizeMode="cover" />
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
      </View>
    </TouchableOpacity>
  )
}

// ─── Search result card ───────────────────────────────────────────────────────

function SearchResultCard({ tailor, onPress }: { tailor: TailorCard; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.resultCard} onPress={onPress} activeOpacity={0.88}>
      <View style={styles.resultThumb}>
        {tailor.portfolioPhoto ? (
          <Image source={{ uri: tailor.portfolioPhoto }} style={styles.resultThumbImg} resizeMode="cover" />
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
  return (
    <TouchableOpacity style={styles.recentCard} onPress={onPress} activeOpacity={0.88}>
      <View style={styles.recentImageWrap}>
        {tailor.portfolioPhoto ? (
          <Image source={{ uri: tailor.portfolioPhoto }} style={styles.recentImage} resizeMode="cover" />
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

  // Empty state
  emptyState: { alignItems: 'center', gap: Spacing.sm, paddingVertical: 60, paddingHorizontal: Spacing.xl },
  emptyStateEmoji: { fontSize: 40 },
  emptyStateTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  emptyStateHint: { fontSize: FontSize.sm, color: Colors.midGrey },
})
