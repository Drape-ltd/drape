import { useCallback, useState, useRef, useEffect } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, TextInput, ActivityIndicator,
  Keyboard, FlatList, useWindowDimensions,
  Modal, KeyboardAvoidingView, Platform,
  type StyleProp, type ViewStyle,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Feather } from '@expo/vector-icons'
import { useAuth } from '@/lib/auth'
import { customerOrderStageLabel } from '@/lib/customer-order-copy'
import { supabase } from '@/lib/supabase'
import { RemoteImage, TierBadgeChip, StarRating } from '@/components/ui'
import { DRAPE_VISION_ROUTE } from '@/constants/drapeVision'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { OrderStage } from '@drape/shared/order-machine'
import type { StorageImageBucket } from '@/lib/image-url'

const RECENTLY_VIEWED_KEY  = 'drape_recently_viewed_tailors'
const RECENT_SEARCHES_KEY  = 'drape_recent_searches'
const LAST_SEARCH_KEY      = 'drape_last_search'
const DISCOVER_GUIDE_KEY   = 'drape_customer_discover_best_use_dismissed'
const CUSTOMER_ONBOARDING_KEY = 'drape_customer_onboarding_seen'
const MAX_RECENTLY_VIEWED  = 10
const MAX_RECENT_SEARCHES  = 5
const PAGE_SIZE            = 20
const HOME_BG = Colors.bone
const PRIMARY_GREEN = Colors.needleGreen
const CHARCOAL = Colors.ink
const MUTED_GREY = Colors.midGrey

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_PILL_COLOR: Partial<Record<OrderStage, { bg: string; text: string }>> = {
  PENDING_QUOTE:   { bg: Colors.boneDeep, text: PRIMARY_GREEN },
  CONSULTATION:    { bg: Colors.boneDeep, text: PRIMARY_GREEN },
  QUOTE_SENT:      { bg: Colors.needleGreenLight, text: PRIMARY_GREEN },
  PAYMENT_PENDING: { bg: Colors.needleGreenLight, text: PRIMARY_GREEN },
  PAYMENT_FAILED:  { bg: Colors.kanteRustLight, text: Colors.kanteRust },
  IN_DISPUTE:      { bg: Colors.kanteRustLight, text: Colors.kanteRust },
}

// Ordered by broadest appeal first. Globally understandable.
// Future: replace with dynamic categories derived from search frequency or personalisation.
const BROWSE_STYLES = ['Suits', 'Bridal', 'Casual', 'Traditional', 'Bespoke']
const FILTER_SPECIALTIES = ['Agbada', 'Ankara', 'Suits', 'Saree', 'Kaftan', 'Trousers', 'Dresses', 'Gele', 'Other']

type AvailFilter = 'ALL' | 'OPEN' | 'LIMITED'
type MinRatingFilter = null | 4 | 4.5 | 5

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveOrder = {
  id: string
  reference: string
  garmentType: string
  orderKind: 'CUSTOM' | 'READY_MADE'
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
  avatarUrl: string | null
  portfolioPhoto: string | null
  exploreImageBucket: StorageImageBucket | null
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
  thumbnailBucket?: StorageImageBucket | null
}

type TailorDiscoveryRow = {
  id: string
  display_name?: string | null
  location?: string | null
  seller_type?: 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP' | null
  specialty_tags?: unknown
  avg_rating?: number | null
  total_reviews?: number | null
  tier?: string | null
  price_range_min?: number | null
  price_range_max?: number | null
  avatar_url?: string | null
  portfolio_photo_urls?: unknown
  availability?: string | null
  supports_custom_orders?: boolean | null
  supports_ready_made?: boolean | null
  avg_response_hours?: number | null
  ranking_score?: number | null
}

type PortfolioCoverRow = {
  tailor_profile_id?: string | null
  image_url?: string | null
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
    case 'PAYMENT_FAILED':
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

function resolveFallbackExploreImage(t: TailorDiscoveryRow): { uri: string | null; bucket: StorageImageBucket | null } {
  const avatarUrl = typeof t.avatar_url === 'string' && t.avatar_url.trim().length > 0 ? t.avatar_url : null
  if (avatarUrl) return { uri: avatarUrl, bucket: 'avatars' }

  const portfolioPhotos = asStringList(t.portfolio_photo_urls)
  return { uri: portfolioPhotos[0] ?? null, bucket: portfolioPhotos[0] ? 'portfolio-photos' : null }
}

function availabilityHint(tailor: TailorCard): string | null {
  if (tailor.availability === 'LIMITED') return 'Taking a limited number of orders'
  if (tailor.avgResponseHours != null) return `Usually replies in about ${Math.round(tailor.avgResponseHours)}h`
  return null
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'D'
}

function ExploreMediaPlaceholder({
  style,
  name,
  size = 24,
}: {
  style: StyleProp<ViewStyle>
  name: string
  size?: number
}) {
  return (
    <View style={[style, styles.exploreMediaPlaceholder]}>
      <View style={styles.exploreMediaIcon}>
        <Feather name="image" size={size} color={Colors.needleGreen} />
      </View>
      <Text style={styles.exploreMediaInitials}>{initials(name)}</Text>
    </View>
  )
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

async function clearLastSearch(userId: string | undefined) {
  try { await AsyncStorage.removeItem(storageKey(LAST_SEARCH_KEY, userId)) } catch {}
}

async function loadLastSearch(userId: string | undefined): Promise<LastSearch | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(LAST_SEARCH_KEY, userId))
    const parsed = raw ? JSON.parse(raw) as LastSearch : null
    if (!parsed?.query?.trim() || parsed.count <= 0) {
      await clearLastSearch(userId)
      return null
    }
    return parsed
  } catch { return null }
}

// ─── Query helpers ─────────────────────────────────────────────────────────────

function mapTailor(t: TailorDiscoveryRow): TailorCard {
  const fallbackImage = resolveFallbackExploreImage(t)

  return {
    id: t.id,
    displayName: t.display_name ?? 'Drape tailor',
    location: t.location ?? 'Location not listed',
    sellerType: t.seller_type ?? 'TAILOR',
    specialtyTags: asStringList(t.specialty_tags),
    avgRating: t.avg_rating ?? 0,
    totalReviews: t.total_reviews ?? 0,
    tier: t.tier ?? 'BRONZE',
    priceRangeMin: t.price_range_min ?? null,
    priceRangeMax: t.price_range_max ?? null,
    avatarUrl: t.avatar_url ?? null,
    portfolioPhoto: fallbackImage.uri,
    exploreImageBucket: fallbackImage.bucket,
    availability: t.availability ?? 'OPEN',
    supportsCustomOrders: t.supports_custom_orders ?? true,
    supportsReadyMade: t.supports_ready_made ?? false,
    avgResponseHours: t.avg_response_hours ?? null,
    rankingScore: t.ranking_score ?? 0,
  }
}

async function hydrateTailorCardsWithExploreCovers(tailors: TailorCard[]): Promise<TailorCard[]> {
  const ids = tailors.map((tailor) => tailor.id)
  if (ids.length === 0) return tailors

  const { data, error } = await supabase
    .from('portfolio_items')
    .select('tailor_profile_id, image_url, sort_order')
    .in('tailor_profile_id', ids)
    .order('sort_order', { ascending: true })

  if (error) return tailors

  const coverByTailor = new Map<string, string>()
  for (const row of (data ?? []) as PortfolioCoverRow[]) {
    const tailorId = typeof row.tailor_profile_id === 'string' ? row.tailor_profile_id : null
    const imageUrl = typeof row.image_url === 'string' && row.image_url.trim().length > 0 ? row.image_url : null
    if (!tailorId || !imageUrl || coverByTailor.has(tailorId)) continue
    coverByTailor.set(tailorId, imageUrl)
  }

  if (coverByTailor.size === 0) return tailors

  return tailors.map((tailor) => {
    const cover = coverByTailor.get(tailor.id)
    if (!cover) return tailor
    return {
      ...tailor,
      portfolioPhoto: cover,
      exploreImageBucket: 'portfolio-photos',
    }
  })
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
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [specialtyFilters, setSpecialtyFilters] = useState<string[]>([])
  const [locationFilter, setLocationFilter] = useState('')
  const [minRatingFilter, setMinRatingFilter] = useState<MinRatingFilter>(null)
  const [priceMaxFilter, setPriceMaxFilter] = useState('')
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [lastSearch, setLastSearch]         = useState<LastSearch | null>(null)
  const [showGuide, setShowGuide]           = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState(0)

  // In-memory result cache: query key → first-page results
  const resultCacheRef = useRef<Map<string, TailorCard[]>>(new Map())
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef       = useRef<TextInput>(null)

  const isSearchActive  = query.trim().length > 0
  const showSuggestions = searchFocused && !isSearchActive

  const activeFilterCount =
    (availFilter !== 'ALL' ? 1 : 0) +
    specialtyFilters.length +
    (locationFilter.trim() ? 1 : 0) +
    (minRatingFilter ? 1 : 0) +
    (priceMaxFilter.trim() ? 1 : 0)

  // Filtered results by local UI filters (client-side, no extra round trip).
  const filteredResults = searchResults.filter((tailor) => {
    if (availFilter !== 'ALL' && tailor.availability !== availFilter) return false
    if (specialtyFilters.length > 0) {
      const tags = tailor.specialtyTags.map((tag) => tag.toLowerCase())
      const matchesSpecialty = specialtyFilters.some((specialty) => {
        const lower = specialty.toLowerCase()
        return tags.some((tag) => tag.includes(lower)) || tailor.displayName.toLowerCase().includes(lower)
      })
      if (!matchesSpecialty) return false
    }
    const locationText = locationFilter.trim().toLowerCase()
    if (locationText && !tailor.location.toLowerCase().includes(locationText)) return false
    if (minRatingFilter && tailor.avgRating < minRatingFilter) return false
    const priceMax = Number(priceMaxFilter.trim())
    if (Number.isFinite(priceMax) && priceMax > 0) {
      const candidate = tailor.priceRangeMin ?? tailor.priceRangeMax
      if (candidate != null && candidate > priceMax) return false
    }
    return true
  })

  // ── Persistence load on focus ─────────────────────────────────────────────

  useFocusEffect(useCallback(() => {
    Promise.all([
      loadRecentlyViewed(user?.id),
      loadRecentSearches(user?.id),
      loadLastSearch(user?.id),
      AsyncStorage.getItem(storageKey(DISCOVER_GUIDE_KEY, user?.id)).catch(() => null),
      AsyncStorage.getItem(storageKey(CUSTOMER_ONBOARDING_KEY, user?.id)).catch(() => null),
    ]).then(([rv, rs, ls, guideValue, onboardingValue]) => {
      setRecentlyViewed(rv)
      setRecentSearches(rs)
      setLastSearch(ls)
      setShowGuide(guideValue !== '1')
      setShowOnboarding(onboardingValue !== '1')
    })
  }, [user?.id]))

  async function dismissGuide() {
    setShowGuide(false)
    try {
      await AsyncStorage.setItem(storageKey(DISCOVER_GUIDE_KEY, user?.id), '1')
    } catch {}
  }

  async function dismissOnboarding() {
    setShowOnboarding(false)
    setOnboardingStep(0)
    try {
      await AsyncStorage.setItem(storageKey(CUSTOMER_ONBOARDING_KEY, user?.id), '1')
    } catch {}
  }

  useFocusEffect(useCallback(() => {
    if (!user?.id) return undefined
    void fetchData()
    return undefined
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
            id, reference, garment_type, order_kind, stage,
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
          .select('id, display_name, location, seller_type, specialty_tags, avg_rating, total_reviews, tier, price_range_min, price_range_max, avatar_url, portfolio_photo_urls, availability, avg_response_hours, supports_custom_orders, supports_ready_made, ranking_score')
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
          : null

      setActiveOrders(
        orderRows
          .map((o: any) => ({
            id: o.id,
            reference: o.reference,
            garmentType: o.garment_type,
            orderKind: o.order_kind ?? 'CUSTOM',
            stage: o.stage,
            tailorName: o.tailor_profiles?.display_name ?? '',
            estimatedDate: o.quoted_completion_date,
          }))
          .sort((a, b) => orderPriority(a.stage) - orderPriority(b.stage))
      )
      setHasOrderHistory(historyCount > 0)

      if (tailorRows) {
        setAllTailors(await hydrateTailorCardsWithExploreCovers(tailorRows.map(mapTailor)))
      } else {
        setFetchError(true)
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
      setSearchPending(false)
      setSearchFetchError(false)
      setResultOffset(0)
    } else {
      setLoadingMore(true)
    }
    try {
      const baseQuery = supabase
        .from('tailor_profiles')
        .select('id, display_name, location, seller_type, specialty_tags, avg_rating, total_reviews, tier, price_range_min, price_range_max, avatar_url, portfolio_photo_urls, availability, avg_response_hours, supports_custom_orders, supports_ready_made, ranking_score')
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

      page = await hydrateTailorCardsWithExploreCovers(page)

      if (offset === 0) {
        setSearchResults(page)
        if (resultCacheRef.current.size >= 30) {
          const firstKey = resultCacheRef.current.keys().next().value
          if (firstKey) resultCacheRef.current.delete(firstKey)
        }
        resultCacheRef.current.set(q, page)
        setResultOffset(page.length)

        saveRecentSearch(user?.id, q)
        if (page.length > 0) {
          const ls: LastSearch = {
            query: q,
            count: page.length,
            thumbnail: page[0]?.portfolioPhoto ?? null,
            thumbnailBucket: page[0]?.exploreImageBucket ?? null,
          }
          saveLastSearch(user?.id, ls)
          setLastSearch(ls)
        } else {
          clearLastSearch(user?.id)
          setLastSearch(null)
        }
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

  function openDrapeVision() {
    router.push({
      pathname: DRAPE_VISION_ROUTE,
      params: { mode: 'customer_scan', returnTo: '/(customer)' },
    } as never)
  }

  function handleBlur() {
    setTimeout(() => setSearchFocused(false), 150)
  }

  function toggleSpecialtyFilter(specialty: string) {
    setSpecialtyFilters((current) =>
      current.includes(specialty)
        ? current.filter((item) => item !== specialty)
        : [...current, specialty]
    )
  }

  function clearAllFilters() {
    setAvailFilter('ALL')
    setSpecialtyFilters([])
    setLocationFilter('')
    setMinRatingFilter(null)
    setPriceMaxFilter('')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <CustomerOnboardingModal
        visible={showOnboarding}
        step={onboardingStep}
        onStepChange={setOnboardingStep}
        onDone={() => void dismissOnboarding()}
      />

      {/* ── Sticky header ── */}
      <View style={styles.stickyHeader}>
        {/* Search row */}
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Feather name="search" size={16} color={MUTED_GREY} />
            <TextInput
              ref={inputRef}
              style={styles.searchInput}
              placeholder="Search tailors, styles, or locations"
              placeholderTextColor={Colors.midGrey}
              accessibilityLabel="Search tailors, styles, or locations"
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
              <TouchableOpacity
                onPress={() => setQuery('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.clearBtn}
              >
                <Feather name="x" size={14} color={MUTED_GREY} />
              </TouchableOpacity>
            )}
          </View>
          {isSearchActive && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Open search filters"
              onPress={() => setFilterSheetOpen(true)}
              style={styles.filterIconBtn}
            >
              <Feather name="sliders" size={17} color={PRIMARY_GREEN} />
              {activeFilterCount > 0 ? (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          )}
          {(searchFocused || isSearchActive) && (
            <TouchableOpacity onPress={cancelSearch} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          )}
          {!searchFocused && !isSearchActive && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Open Drape Vision"
              onPress={openDrapeVision}
              style={styles.visionIconBtn}
            >
              <Feather name="aperture" size={18} color={PRIMARY_GREEN} />
              <View style={styles.visionStatusDot} />
            </TouchableOpacity>
          )}
        </View>

      </View>

      <SearchFilterSheet
        visible={filterSheetOpen}
        specialtyFilters={specialtyFilters}
        locationFilter={locationFilter}
        minRatingFilter={minRatingFilter}
        priceMaxFilter={priceMaxFilter}
        availFilter={availFilter}
        activeFilterCount={activeFilterCount}
        onClose={() => setFilterSheetOpen(false)}
        onToggleSpecialty={toggleSpecialtyFilter}
        onChangeLocation={setLocationFilter}
        onChangeMinRating={setMinRatingFilter}
        onChangePriceMax={setPriceMaxFilter}
        onChangeAvailability={setAvailFilter}
        onClear={clearAllFilters}
      />

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
                  <Feather name="clock" size={16} color={Colors.midGrey} />
                  <Text style={styles.recentSearchText}>{s}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      const updated = recentSearches.filter((_, j) => j !== i)
                      setRecentSearches(updated)
                      AsyncStorage.setItem(storageKey(RECENT_SEARCHES_KEY, user?.id), JSON.stringify(updated))
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${s} from recent searches`}
                  >
                    <Feather name="x" size={14} color={Colors.midGrey} />
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
              {searching || searchPending ? (
                <ActivityIndicator color={Colors.needleGreen} style={{ marginVertical: Spacing.lg }} />
              ) : (
                <>
                  <Text style={styles.resultsCount}>
                    {filteredResults.length} {filteredResults.length === 1 ? 'tailor' : 'tailors'}
                  </Text>
                  {activeFilterCount > 0 ? (
                    <TouchableOpacity style={styles.clearFiltersRow} onPress={clearAllFilters}>
                      <Feather name="x-circle" size={15} color={PRIMARY_GREEN} />
                      <Text style={styles.clearFiltersText}>Clear all filters</Text>
                    </TouchableOpacity>
                  ) : null}
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
                <View style={[styles.emptyStateIcon, searchFetchError && styles.emptyStateIconError]}>
                  <Feather
                    name={searchFetchError ? 'alert-circle' : 'search'}
                    size={26}
                    color={searchFetchError ? Colors.kanteRust : Colors.needleGreen}
                  />
                </View>
                <Text style={styles.emptyStateTitle}>
                  {searchFetchError ? "Couldn't load search results" : 'No tailors match your search'}
                </Text>
                <Text style={styles.emptyStateHint}>
                  {searchFetchError
                    ? 'Try again in a moment or adjust your search.'
                    : 'Try different filters or browse all tailors.'}
                </Text>
                <TouchableOpacity
                  style={styles.searchRetryBtn}
                  onPress={() => {
                    if (searchFetchError) {
                      runSearch(query, 0)
                      return
                    }
                    setQuery('')
                    setAvailFilter('ALL')
                    setSearchFocused(false)
                    Keyboard.dismiss()
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={searchFetchError ? 'Try search again' : 'Clear search filters'}
                >
                  <Text style={styles.searchRetryBtnText}>{searchFetchError ? 'Try again' : 'Clear filters'}</Text>
                </TouchableOpacity>
                {searchFetchError && (
                  <TouchableOpacity
                    style={styles.searchSecondaryBtn}
                    onPress={() => {
                      setSearchFocused(false)
                      setQuery('')
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Back to browsing tailors"
                  >
                    <Text style={styles.searchSecondaryBtnText}>Back to browsing</Text>
                  </TouchableOpacity>
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
              <Text style={styles.errorBannerText}>Couldn't load tailors. Pull down to retry, or open Orders while discovery catches up.</Text>
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
          {lastSearch && lastSearch.count > 0 && (
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
                  <RemoteImage
                    uri={lastSearch.thumbnail}
                    bucket={lastSearch.thumbnailBucket ?? 'portfolio-photos'}
                    style={styles.continueThumbnail}
                    contentFit="cover"
                    transition={120}
                    surface="customer_continue_search"
                    fallback={(
                      <ExploreMediaPlaceholder style={styles.continueThumbnail} name={lastSearch.query} size={18} />
                    )}
                  />
                ) : (
                  <ExploreMediaPlaceholder style={styles.continueThumbnail} name={lastSearch.query} size={18} />
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
                        onPress={() => router.push({
                          pathname: '/(customer)/orders/[id]',
                          params: { id: order.id, returnTo: '/(customer)' },
                        })}
                      >
                        <View style={[styles.orderStagePill, { backgroundColor: c?.bg ?? Colors.needleGreenLight }]}>
                          <Text style={[styles.orderStageText, { color: c?.text ?? Colors.needleGreen }]}>
                            {customerOrderStageLabel(order.stage as OrderStage, order.orderKind)}
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
                  <Feather name="search" size={20} color={Colors.needleGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.firstOrderTitle}>{hasOrderHistory ? 'No active orders right now' : 'Start your first order'}</Text>
                  <Text style={styles.firstOrderHint}>
                    {hasOrderHistory
                      ? 'Search again when you are ready to place another order.'
                      : 'Search by style, location, or tailor name to find someone you trust.'}
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
              <Text style={styles.sectionTitle}>Trusted tailors to explore</Text>
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
                <Text style={styles.emptyBrowseTitle}>Verified tailors are being refreshed</Text>
                <Text style={styles.emptyBrowseHint}>
                  Pull down to refresh, search by specialty, or check back shortly as vetted profiles go live.
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
  return (
    <TouchableOpacity style={[styles.gridCard, { width: CARD_WIDTH }]} onPress={onPress} activeOpacity={0.88}>
      <View style={styles.gridImageWrap}>
        {tailor.portfolioPhoto ? (
          <RemoteImage
            uri={tailor.portfolioPhoto}
            bucket={tailor.exploreImageBucket ?? 'portfolio-photos'}
            style={styles.gridImage}
            contentFit="cover"
            transition={120}
            surface="customer_explore_grid"
            fallback={(
              <ExploreMediaPlaceholder style={styles.gridImage} name={tailor.displayName} size={28} />
            )}
          />
        ) : (
          <ExploreMediaPlaceholder style={styles.gridImage} name={tailor.displayName} size={28} />
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
  return (
    <TouchableOpacity style={styles.resultCard} onPress={onPress} activeOpacity={0.88}>
      <View style={styles.resultThumb}>
        {tailor.portfolioPhoto ? (
          <RemoteImage
            uri={tailor.portfolioPhoto}
            bucket={tailor.exploreImageBucket ?? 'portfolio-photos'}
            style={styles.resultThumbImg}
            contentFit="cover"
            transition={120}
            surface="customer_search_result"
            fallback={(
              <ExploreMediaPlaceholder style={styles.resultThumbImg} name={tailor.displayName} size={20} />
            )}
          />
        ) : (
          <ExploreMediaPlaceholder style={styles.resultThumbImg} name={tailor.displayName} size={20} />
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
  return (
    <TouchableOpacity style={styles.recentCard} onPress={onPress} activeOpacity={0.88}>
      <View style={styles.recentImageWrap}>
        {tailor.portfolioPhoto ? (
          <RemoteImage
            uri={tailor.portfolioPhoto}
            bucket={tailor.exploreImageBucket ?? 'portfolio-photos'}
            style={styles.recentImage}
            contentFit="cover"
            transition={120}
            surface="customer_recent_tailor"
            fallback={(
              <ExploreMediaPlaceholder style={styles.recentImage} name={tailor.displayName} size={18} />
            )}
          />
        ) : (
          <ExploreMediaPlaceholder style={styles.recentImage} name={tailor.displayName} size={18} />
        )}
      </View>
      <Text style={styles.recentName} numberOfLines={1}>{tailor.displayName}</Text>
      <Text style={styles.recentLocation} numberOfLines={1}>{tailor.location}</Text>
    </TouchableOpacity>
  )
}

function SearchFilterSheet({
  visible,
  specialtyFilters,
  locationFilter,
  minRatingFilter,
  priceMaxFilter,
  availFilter,
  activeFilterCount,
  onClose,
  onToggleSpecialty,
  onChangeLocation,
  onChangeMinRating,
  onChangePriceMax,
  onChangeAvailability,
  onClear,
}: {
  visible: boolean
  specialtyFilters: string[]
  locationFilter: string
  minRatingFilter: MinRatingFilter
  priceMaxFilter: string
  availFilter: AvailFilter
  activeFilterCount: number
  onClose: () => void
  onToggleSpecialty: (specialty: string) => void
  onChangeLocation: (value: string) => void
  onChangeMinRating: (value: MinRatingFilter) => void
  onChangePriceMax: (value: string) => void
  onChangeAvailability: (value: AvailFilter) => void
  onClear: () => void
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.filterSheetOverlay}>
        <TouchableOpacity style={styles.filterSheetScrim} activeOpacity={1} onPress={onClose} />
        <View style={styles.filterSheet}>
          <View style={styles.filterSheetHandle} />
          <View style={styles.filterSheetHeader}>
            <Text style={styles.filterSheetTitle}>Filters</Text>
            {activeFilterCount > 0 ? (
              <TouchableOpacity onPress={onClear} accessibilityRole="button" accessibilityLabel="Clear all filters">
                <Text style={styles.filterSheetClear}>Clear all</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <Text style={styles.filterSectionTitle}>Specialty</Text>
          <View style={styles.filterChipWrap}>
            {FILTER_SPECIALTIES.map((specialty) => {
              const selected = specialtyFilters.includes(specialty)
              return (
                <TouchableOpacity
                  key={specialty}
                  style={[styles.filterSheetChip, selected && styles.filterSheetChipActive]}
                  onPress={() => onToggleSpecialty(specialty)}
                >
                  <Text style={[styles.filterSheetChipText, selected && styles.filterSheetChipTextActive]}>{specialty}</Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <Text style={styles.filterSectionTitle}>Location</Text>
          <TextInput
            value={locationFilter}
            onChangeText={onChangeLocation}
            placeholder="City or country"
            placeholderTextColor={Colors.midGrey}
            style={styles.filterInput}
            returnKeyType="done"
          />

          <Text style={styles.filterSectionTitle}>Rating</Text>
          <View style={styles.filterChipWrap}>
            {([null, 4, 4.5, 5] as MinRatingFilter[]).map((rating) => {
              const selected = minRatingFilter === rating
              return (
                <TouchableOpacity
                  key={rating ?? 'any'}
                  style={[styles.filterSheetChip, selected && styles.filterSheetChipActive]}
                  onPress={() => onChangeMinRating(rating)}
                >
                  <Text style={[styles.filterSheetChipText, selected && styles.filterSheetChipTextActive]}>
                    {rating == null ? 'Any' : `${rating}+`}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <Text style={styles.filterSectionTitle}>Availability</Text>
          <View style={styles.filterChipWrap}>
            {([
              { key: 'ALL', label: 'All' },
              { key: 'OPEN', label: 'Available now' },
              { key: 'LIMITED', label: 'Limited' },
            ] as { key: AvailFilter; label: string }[]).map((option) => {
              const selected = availFilter === option.key
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.filterSheetChip, selected && styles.filterSheetChipActive]}
                  onPress={() => onChangeAvailability(option.key)}
                >
                  <Text style={[styles.filterSheetChipText, selected && styles.filterSheetChipTextActive]}>{option.label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <Text style={styles.filterSectionTitle}>Price ceiling</Text>
          <TextInput
            value={priceMaxFilter}
            onChangeText={onChangePriceMax}
            placeholder="Max starting price"
            placeholderTextColor={Colors.midGrey}
            style={styles.filterInput}
            keyboardType="decimal-pad"
            returnKeyType="done"
          />

          <TouchableOpacity style={styles.filterApplyButton} onPress={onClose}>
            <Text style={styles.filterApplyButtonText}>Show results</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const CUSTOMER_ONBOARDING_SLIDES = [
  {
    icon: 'search' as const,
    title: 'Find your tailor',
    body: 'Browse trusted tailors by style, location, rating, and availability.',
  },
  {
    icon: 'user-check' as const,
    title: 'Your measurements, stored once',
    body: 'Save your fit profile once, then reuse it whenever you place an order.',
  },
  {
    icon: 'scissors' as const,
    title: 'Track every stitch',
    body: 'Follow quotes, production stages, messages, delivery, and reviews in one place.',
  },
]

function CustomerOnboardingModal({
  visible,
  step,
  onStepChange,
  onDone,
}: {
  visible: boolean
  step: number
  onStepChange: (step: number) => void
  onDone: () => void
}) {
  const slide = CUSTOMER_ONBOARDING_SLIDES[step] ?? CUSTOMER_ONBOARDING_SLIDES[0]
  const isLast = step === CUSTOMER_ONBOARDING_SLIDES.length - 1

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone}>
      <View style={styles.onboardingOverlay}>
        <View style={styles.onboardingCard}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Skip customer walkthrough"
            onPress={onDone}
            style={styles.onboardingSkip}
          >
            <Text style={styles.onboardingSkipText}>Skip</Text>
          </TouchableOpacity>

          <View style={styles.onboardingIcon}>
            <Feather name={slide.icon} size={30} color={PRIMARY_GREEN} />
          </View>
          <Text style={styles.onboardingTitle}>{slide.title}</Text>
          <Text style={styles.onboardingBody}>{slide.body}</Text>

          <View style={styles.onboardingDots}>
            {CUSTOMER_ONBOARDING_SLIDES.map((_, index) => (
              <View
                key={index}
                style={[styles.onboardingDot, index === step && styles.onboardingDotActive]}
              />
            ))}
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={isLast ? 'Finish customer walkthrough' : 'Continue customer walkthrough'}
            onPress={() => {
              if (isLast) {
                onDone()
                return
              }
              onStepChange(step + 1)
            }}
            style={styles.onboardingButton}
          >
            <Text style={styles.onboardingButtonText}>{isLast ? 'Get Started' : 'Continue'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: HOME_BG },

  // Sticky header
  stickyHeader: {
    backgroundColor: HOME_BG,
    paddingHorizontal: Spacing.lg,
    paddingTop: 4,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.white, borderRadius: Radius.full,
    minHeight: 44, paddingVertical: 8, paddingHorizontal: 12, ...Shadow.sm,
  },
  searchInput: { flex: 1, fontSize: 14, color: CHARCOAL, padding: 0 },
  clearBtn: { minWidth: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  filterIconBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    position: 'relative',
    ...Shadow.sm,
  },
  filterBadge: {
    position: 'absolute',
    right: 5,
    top: 5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.kanteRust,
    borderWidth: 1.5,
    borderColor: Colors.white,
  },
  filterBadgeText: { fontSize: 10, fontWeight: FontWeight.bold, color: Colors.textInverse },
  cancelBtn: { paddingVertical: 8, minHeight: 44, justifyContent: 'center' },
  cancelText: { fontSize: 14, color: PRIMARY_GREEN, fontWeight: FontWeight.medium },
  visionIconBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    position: 'relative',
    ...Shadow.sm,
  },
  visionStatusDot: {
    position: 'absolute',
    right: 9,
    top: 9,
    width: 8,
    height: 8,
    borderRadius: Radius.full,
    backgroundColor: PRIMARY_GREEN,
    borderWidth: 1.5,
    borderColor: Colors.white,
  },

  // Scroll areas
  scroll: { flex: 1 },
  content: { paddingBottom: 24 },
  heroBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  heroBadgeText: {
    fontSize: 11,
    fontWeight: FontWeight.semibold,
    color: PRIMARY_GREEN,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  guideCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
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
  guideTitle: { fontSize: 13, fontWeight: FontWeight.semibold, color: CHARCOAL, lineHeight: 17 },
  errorBanner: {
    marginHorizontal: Spacing.lg, marginTop: Spacing.md,
    backgroundColor: Colors.kanteRustLight, borderRadius: Radius.md,
    padding: 12, borderLeftWidth: 3, borderLeftColor: Colors.kanteRust,
  },
  errorBannerText: { fontSize: 13, color: Colors.kanteRust, lineHeight: 18 },

  // Suggestions panel
  suggestionsContent: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: 28 },
  suggestSection: { gap: Spacing.sm },
  suggestHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  suggestTitle: { fontSize: 15, fontWeight: FontWeight.semibold, color: CHARCOAL },
  suggestClear: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.medium },
  recentSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey,
  },
  recentSearchText: { flex: 1, fontSize: 14, color: CHARCOAL },
  suggestChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  suggestChip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: Radius.full, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.lightGrey,
  },
  suggestChipText: { fontSize: 13, color: CHARCOAL },

  // Search results (FlatList)
  resultsList: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: 28 },
  resultsHeader: { gap: Spacing.sm, marginBottom: 6 },
  resultsCount: { fontSize: 16, fontWeight: FontWeight.semibold, color: CHARCOAL },
  clearFiltersRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: 32 },
  clearFiltersText: { fontSize: FontSize.sm, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  availRow: { flexDirection: 'row', gap: Spacing.sm },
  availChip: {
    minHeight: 44,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: Radius.full, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.lightGrey,
    justifyContent: 'center',
  },
  availChipActive: { backgroundColor: CHARCOAL, borderColor: CHARCOAL },
  availLabel: { fontSize: 12, color: MUTED_GREY, fontWeight: FontWeight.medium },
  availLabelActive: { color: Colors.textInverse },
  loadMoreSpinner: { marginVertical: Spacing.lg },

  // Result card
  resultCard: {
    flexDirection: 'row', gap: Spacing.sm,
    backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: 10, ...Shadow.sm,
  },
  resultThumb: { width: 76, height: 86, borderRadius: Radius.md, overflow: 'hidden' },
  resultThumbImg: { width: '100%', height: '100%' },
  resultThumbPlaceholder: { backgroundColor: Colors.boneDeep, alignItems: 'center', justifyContent: 'center' },
  exploreMediaPlaceholder: {
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  exploreMediaIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.needleGreen,
  },
  exploreMediaInitials: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.8,
  },
  resultInfo: { flex: 1, gap: 3, justifyContent: 'center' },
  resultNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultName: { fontSize: 14, fontWeight: FontWeight.semibold, color: CHARCOAL, flex: 1, marginRight: 4, fontFamily: 'Georgia' },
  resultLocation: { fontSize: 12, color: MUTED_GREY },
  resultTags: { fontSize: 12, color: Colors.inkLight },
  resultHint: { fontSize: 12, color: PRIMARY_GREEN, marginTop: 3, fontWeight: FontWeight.medium },
  capabilityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: 2 },
  capabilityChip: {
    backgroundColor: HOME_BG,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    minHeight: 24,
    justifyContent: 'center',
  },
  capabilityText: { fontSize: 11, color: Colors.inkLight, fontWeight: FontWeight.medium },
  limitedBadge: {
    backgroundColor: Colors.statusPendingBg, paddingHorizontal: Spacing.sm,
    paddingVertical: 2, borderRadius: Radius.full, alignSelf: 'flex-start', marginTop: 2,
  },
  limitedText: { fontSize: 10, color: Colors.statusPending, fontWeight: FontWeight.medium },
  filterSheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  filterSheetScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  filterSheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  filterSheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: Colors.lightGrey },
  filterSheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  filterSheetTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
  filterSheetClear: { fontSize: FontSize.sm, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
  filterSectionTitle: { marginTop: Spacing.sm, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  filterChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  filterSheetChip: {
    minHeight: 40,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  filterSheetChipActive: { backgroundColor: Colors.needleGreen, borderColor: Colors.needleGreen },
  filterSheetChipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
  filterSheetChipTextActive: { color: Colors.textInverse },
  filterInput: {
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    paddingHorizontal: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.ink,
    backgroundColor: Colors.bone,
  },
  filterApplyButton: {
    marginTop: Spacing.md,
    minHeight: 52,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
  },
  filterApplyButtonText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  onboardingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(26,26,24,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  onboardingCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
    ...Shadow.lg,
  },
  onboardingSkip: {
    alignSelf: 'flex-end',
    minHeight: 44,
    paddingHorizontal: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardingSkipText: { fontSize: FontSize.sm, color: Colors.midGrey, fontWeight: FontWeight.medium },
  onboardingIcon: {
    width: 72,
    height: 72,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardingTitle: {
    fontFamily: 'Georgia',
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  onboardingBody: {
    fontSize: FontSize.md,
    color: Colors.inkLight,
    lineHeight: 23,
    textAlign: 'center',
  },
  onboardingDots: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.xs },
  onboardingDot: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.lightGrey,
  },
  onboardingDotActive: { width: 24, backgroundColor: Colors.needleGreen },
  onboardingButton: {
    width: '100%',
    minHeight: 52,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardingButtonText: {
    fontSize: FontSize.md,
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
  },

  // Section
  section: { paddingTop: Spacing.md },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, marginBottom: Spacing.sm,
  },
  sectionTitle: { fontSize: 16, fontWeight: FontWeight.semibold, color: CHARCOAL, fontFamily: 'Georgia' },
  sectionLink: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.medium },

  // Continue searching card
  continueCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.lg, backgroundColor: Colors.white,
    borderRadius: Radius.md, padding: 12, ...Shadow.sm,
  },
  continueLabel: { fontSize: 11, color: MUTED_GREY, fontWeight: FontWeight.medium },
  continueQuery: { fontSize: 15, fontWeight: FontWeight.semibold, color: CHARCOAL, fontFamily: 'Georgia' },
  continueMeta: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.medium },
  continueThumbnail: { width: 52, height: 52, borderRadius: Radius.md, overflow: 'hidden' },

  // Recently viewed
  recentScroll: { marginLeft: Spacing.lg },
  recentRow: { flexDirection: 'row', gap: Spacing.sm, paddingRight: Spacing.lg },
  recentCard: { width: 88, gap: 4 },
  recentImageWrap: { width: 88, height: 98, borderRadius: Radius.md, overflow: 'hidden' },
  recentImage: { width: '100%', height: '100%' },
  recentImagePlaceholder: { backgroundColor: Colors.boneDeep, alignItems: 'center', justifyContent: 'center' },
  recentName: { fontSize: 12, fontWeight: FontWeight.semibold, color: CHARCOAL },
  recentLocation: { fontSize: 10, color: Colors.midGrey },

  // Orders
  ordersScroll: { marginLeft: Spacing.lg },
  ordersRow: { flexDirection: 'row', gap: Spacing.sm, paddingRight: Spacing.lg },
  orderCard: {
    width: 126, backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: 10, gap: 4, ...Shadow.sm,
  },
  orderStagePill: {
    alignSelf: 'flex-start', paddingHorizontal: Spacing.sm,
    paddingVertical: 3, borderRadius: Radius.full, marginBottom: Spacing.xs,
  },
  orderStageText: { fontSize: 10, fontWeight: FontWeight.bold },
  orderGarment: { fontSize: 14, fontWeight: FontWeight.semibold, color: CHARCOAL, fontFamily: 'Georgia' },
  orderTailor: { fontSize: 12, color: MUTED_GREY },
  orderEta: { fontSize: 12, color: PRIMARY_GREEN, fontWeight: FontWeight.medium },
  firstOrderCard: {
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.sm,
    minHeight: 88,
  },
  firstOrderIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  firstOrderTitle: { fontSize: 15, fontWeight: FontWeight.semibold, color: CHARCOAL, fontFamily: 'Georgia' },
  firstOrderHint: { fontSize: 13, color: MUTED_GREY, lineHeight: 18, marginTop: 2 },

  // Browse styles
  trendingScroll: { marginLeft: Spacing.lg },
  trendingRow: { flexDirection: 'row', gap: Spacing.sm, paddingRight: Spacing.lg },
  trendingChip: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: Radius.full, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.lightGrey, ...Shadow.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  trendingLabel: { fontSize: 13, fontWeight: FontWeight.medium, color: CHARCOAL },

  // Tailor grid
  cardsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: Spacing.lg },
  gridCard: { backgroundColor: Colors.white, borderRadius: Radius.md, overflow: 'hidden', ...Shadow.sm },
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
  availTextFull: { color: Colors.textInverse },
  gridInfo: { padding: 10, gap: 4 },
  gridTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gridName: { fontSize: 14, fontWeight: FontWeight.semibold, color: CHARCOAL, flex: 1, marginRight: 4, fontFamily: 'Georgia' },
  gridLocation: { fontSize: 12, color: MUTED_GREY },
  gridTags: { fontSize: 12, color: Colors.inkLight, marginTop: 2 },
  gridHint: { fontSize: 12, color: PRIMARY_GREEN, marginTop: 3, fontWeight: FontWeight.medium },

  // Empty state
  emptyState: { alignItems: 'center', gap: Spacing.sm, paddingVertical: 48, paddingHorizontal: Spacing.lg },
  emptyStateBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  emptyStateBadgeText: {
    fontSize: 11,
    fontWeight: FontWeight.semibold,
    color: PRIMARY_GREEN,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  emptyStateIcon: {
    width: 58,
    height: 58,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateIconError: {
    backgroundColor: Colors.kanteRustLight,
  },
  emptyStateTitle: { fontSize: 15, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  emptyStateHint: { fontSize: 13, color: MUTED_GREY, textAlign: 'center' },
  searchRetryBtn: {
    marginTop: Spacing.md,
    backgroundColor: PRIMARY_GREEN,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  searchRetryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  searchSecondaryBtn: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  searchSecondaryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: CHARCOAL },
  emptyBrowseCard: {
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  emptyBrowseBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  emptyBrowseBadgeText: {
    fontSize: 11,
    fontWeight: FontWeight.semibold,
    color: PRIMARY_GREEN,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  emptyBrowseTitle: { fontSize: 15, fontWeight: FontWeight.semibold, color: CHARCOAL },
  emptyBrowseHint: { fontSize: 13, color: MUTED_GREY, lineHeight: 18 },
  emptyBrowseCta: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  emptyBrowseCtaText: { fontSize: FontSize.sm, color: PRIMARY_GREEN, fontWeight: FontWeight.semibold },
})
