import { useCallback, useMemo, useState, useRef, useEffect } from 'react'
import {
  Animated,
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  ActivityIndicator,
  Keyboard,
  FlatList,
  useWindowDimensions,
  Modal,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Feather } from '@expo/vector-icons'
import { useAuth } from '@/lib/auth'
import { customerOrderStageLabel } from '@/lib/customer-order-copy'
import { supabase } from '@/lib/supabase'
import { fetchReadGateway } from '@/lib/read-gateway'
import {
  loadRecentlyViewedTailors,
  saveRecentlyViewedTailor,
  type RecentlyViewedTailor,
} from '@/lib/recently-viewed-tailors'
import { RemoteImage, TierBadgeChip, StarRating } from '@/components/ui'
import { DRAPE_VISION_ROUTE } from '@/constants/drapeVision'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { TierBadge } from '@/components/ui'
import type { OrderStage } from '@drape/shared/order-machine'
import type { StorageImageBucket } from '@/lib/image-url'

const RECENT_SEARCHES_KEY = 'drape_recent_searches'
const LAST_SEARCH_KEY = 'drape_last_search'
const CUSTOMER_ONBOARDING_KEY = 'drape_customer_onboarding_seen'
const VISION_FAB_POSITION_KEY = 'drape_customer_vision_fab_position'
const MAX_RECENT_SEARCHES = 5
const PAGE_SIZE = 20
const EXPLORE_FOCUS_REFRESH_MS = 60_000
const EXPLORE_CARD_IMAGE_RATIO = 1.04
const VISION_FAB_SIZE = 56
const VISION_FAB_MARGIN = Spacing.md
const VISION_FAB_DRAG_THRESHOLD = 6
const HOME_BG = Colors.bone
const PRIMARY_GREEN = Colors.needleGreen
const CHARCOAL = Colors.ink
const MUTED_GREY = Colors.midGrey

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_PILL_COLOR: Partial<Record<OrderStage, { bg: string; text: string }>> = {
  PENDING_QUOTE: { bg: Colors.boneDeep, text: PRIMARY_GREEN },
  CONSULTATION: { bg: Colors.boneDeep, text: PRIMARY_GREEN },
  QUOTE_SENT: { bg: Colors.needleGreenLight, text: PRIMARY_GREEN },
  PAYMENT_PENDING: { bg: Colors.needleGreenLight, text: PRIMARY_GREEN },
  PAYMENT_FAILED: { bg: Colors.kanteRustLight, text: Colors.kanteRust },
  IN_DISPUTE: { bg: Colors.kanteRustLight, text: Colors.kanteRust },
}

const FILTER_SPECIALTIES = [
  'Agbada',
  'Ankara',
  'Suits',
  'Saree',
  'Kaftan',
  'Trousers',
  'Dresses',
  'Gele',
  'Other',
]

type AvailFilter = 'ALL' | 'OPEN' | 'LIMITED'
type MinRatingFilter = null | 4 | 4.5 | 5
type VisionFabPosition = { x: number; y: number }

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

type ActiveOrderRow = {
  id: string
  reference: string
  garment_type: string
  order_kind?: 'CUSTOM' | 'READY_MADE' | null
  stage: OrderStage
  quoted_completion_date: string | null
  tailor_profiles?: { display_name?: string | null } | null
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

type TailorCardWithRecent = TailorCard & RecentlyViewedTailor

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
  explore_image_url?: string | null
  explore_image_bucket?: StorageImageBucket | null
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
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function resolveFallbackExploreImage(t: TailorDiscoveryRow): {
  uri: string | null
  bucket: StorageImageBucket | null
} {
  const gatewayCover =
    typeof t.explore_image_url === 'string' && t.explore_image_url.trim().length > 0
      ? t.explore_image_url
      : null
  if (gatewayCover) return { uri: gatewayCover, bucket: t.explore_image_bucket ?? 'portfolio-photos' }

  const avatarUrl =
    typeof t.avatar_url === 'string' && t.avatar_url.trim().length > 0 ? t.avatar_url : null
  if (avatarUrl) return { uri: avatarUrl, bucket: 'avatars' }

  const portfolioPhotos = asStringList(t.portfolio_photo_urls)
  return { uri: portfolioPhotos[0] ?? null, bucket: portfolioPhotos[0] ? 'portfolio-photos' : null }
}

function availabilityHint(tailor: TailorCard): string | null {
  if (tailor.availability === 'LIMITED') return 'Taking a limited number of orders'
  if (tailor.avgResponseHours != null)
    return `Usually replies in about ${Math.round(tailor.avgResponseHours)}h`
  return null
}

function serviceLabel(tailor: TailorCard): string | null {
  const services = [
    tailor.supportsCustomOrders ? 'Custom orders' : null,
    tailor.supportsReadyMade ? 'Ready-made shop' : null,
  ].filter(Boolean)
  return services.length > 0 ? services.join(' · ') : null
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'D'
  )
}

function toTierBadge(tier: string): TierBadge | null {
  if (tier === 'VERIFIED' || tier === 'RISING' || tier === 'MASTER') return tier
  return null
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

function parseStoredVisionFabPosition(raw: string | null): VisionFabPosition | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<VisionFabPosition>
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null
    return { x: Number(parsed.x), y: Number(parsed.y) }
  } catch {
    return null
  }
}

async function saveRecentSearch(userId: string | undefined, q: string) {
  try {
    const raw = await AsyncStorage.getItem(storageKey(RECENT_SEARCHES_KEY, userId))
    const existing: string[] = raw ? JSON.parse(raw) : []
    const updated = [q, ...existing.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(
      0,
      MAX_RECENT_SEARCHES
    )
    await AsyncStorage.setItem(storageKey(RECENT_SEARCHES_KEY, userId), JSON.stringify(updated))
  } catch {
    // Recent searches are a local convenience cache; never block Explore on it.
  }
}

async function loadRecentSearches(userId: string | undefined): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(RECENT_SEARCHES_KEY, userId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

async function clearRecentSearches(userId: string | undefined) {
  try {
    await AsyncStorage.removeItem(storageKey(RECENT_SEARCHES_KEY, userId))
  } catch {
    // Non-critical local cache cleanup.
  }
}

async function saveLastSearch(userId: string | undefined, ls: LastSearch) {
  try {
    await AsyncStorage.setItem(storageKey(LAST_SEARCH_KEY, userId), JSON.stringify(ls))
  } catch {
    // Non-critical local cache write.
  }
}

async function clearLastSearch(userId: string | undefined) {
  try {
    await AsyncStorage.removeItem(storageKey(LAST_SEARCH_KEY, userId))
  } catch {
    // Non-critical local cache cleanup.
  }
}

async function loadLastSearch(userId: string | undefined): Promise<LastSearch | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(LAST_SEARCH_KEY, userId))
    const parsed = raw ? (JSON.parse(raw) as LastSearch) : null
    if (!parsed?.query?.trim() || parsed.count <= 0) {
      await clearLastSearch(userId)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

// ─── Query helpers ─────────────────────────────────────────────────────────────

function mapTailor(t: TailorDiscoveryRow): TailorCard {
  const fallbackImage = resolveFallbackExploreImage(t)

  return {
    id: t.id,
    displayName: t.display_name ?? 'Drapeon tailor',
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
  const insets = useSafeAreaInsets()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const userId = user?.id

  // Browse data
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([])
  const [allTailors, setAllTailors] = useState<TailorCard[]>([])
  const [recentlyViewed, setRecentlyViewed] = useState<TailorCard[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState(false)

  // Search state
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchResults, setSearchResults] = useState<TailorCard[]>([])
  const [searching, setSearching] = useState(false)
  const [searchPending, setSearchPending] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchFetchError, setSearchFetchError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [resultOffset, setResultOffset] = useState(0)
  const [availFilter, setAvailFilter] = useState<AvailFilter>('ALL')
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [specialtyFilters, setSpecialtyFilters] = useState<string[]>([])
  const [locationFilter, setLocationFilter] = useState('')
  const [minRatingFilter, setMinRatingFilter] = useState<MinRatingFilter>(null)
  const [priceMaxFilter, setPriceMaxFilter] = useState('')
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [, setLastSearch] = useState<LastSearch | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState(0)

  // In-memory result cache: query key → first-page results
  const resultCacheRef = useRef<Map<string, TailorCard[]>>(new Map())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<TextInput>(null)
  const lastBrowseFetchAtRef = useRef(0)
  const visionFabPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current
  const visionFabCurrentRef = useRef<VisionFabPosition>({ x: 0, y: 0 })
  const visionFabDragStartRef = useRef<VisionFabPosition>({ x: 0, y: 0 })
  const visionFabDraggedRef = useRef(false)
  const [visionFabReady, setVisionFabReady] = useState(false)

  const isSearchActive = query.trim().length > 0
  const showSuggestions = searchFocused && !isSearchActive

  const activeFilterCount =
    (availFilter !== 'ALL' ? 1 : 0) +
    specialtyFilters.length +
    (locationFilter.trim() ? 1 : 0) +
    (minRatingFilter ? 1 : 0) +
    (priceMaxFilter.trim() ? 1 : 0)

  const visionFabStorageKey = useMemo(() => storageKey(VISION_FAB_POSITION_KEY, userId), [userId])

  const getVisionFabBounds = useCallback(() => {
    const bottomClearance = Math.max(insets.bottom + 92, 112)
    const minX = VISION_FAB_MARGIN
    const maxX = Math.max(minX, windowWidth - VISION_FAB_SIZE - VISION_FAB_MARGIN)
    const minY = VISION_FAB_MARGIN
    const maxY = Math.max(
      minY,
      windowHeight - VISION_FAB_SIZE - bottomClearance
    )

    return { minX, maxX, minY, maxY }
  }, [insets.bottom, windowHeight, windowWidth])

  const clampVisionFabPosition = useCallback(
    (position: VisionFabPosition): VisionFabPosition => {
      const bounds = getVisionFabBounds()
      return {
        x: Math.min(Math.max(position.x, bounds.minX), bounds.maxX),
        y: Math.min(Math.max(position.y, bounds.minY), bounds.maxY),
      }
    },
    [getVisionFabBounds]
  )

  const getDefaultVisionFabPosition = useCallback((): VisionFabPosition => {
    const bounds = getVisionFabBounds()
    return { x: bounds.maxX, y: bounds.maxY }
  }, [getVisionFabBounds])

  const applyVisionFabPosition = useCallback(
    (position: VisionFabPosition) => {
      const nextPosition = clampVisionFabPosition(position)
      visionFabCurrentRef.current = nextPosition
      visionFabPosition.setValue(nextPosition)
    },
    [clampVisionFabPosition, visionFabPosition]
  )

  const persistVisionFabPosition = useCallback(
    (position: VisionFabPosition) => {
      AsyncStorage.setItem(visionFabStorageKey, JSON.stringify(position)).catch(() => {
        // Local UI preference only; never block Explore if it cannot be saved.
      })
    },
    [visionFabStorageKey]
  )

  useEffect(() => {
    let cancelled = false

    AsyncStorage.getItem(visionFabStorageKey)
      .then((raw) => parseStoredVisionFabPosition(raw) ?? getDefaultVisionFabPosition())
      .then((position) => {
        if (cancelled) return
        applyVisionFabPosition(position)
        setVisionFabReady(true)
      })
      .catch(() => {
        if (cancelled) return
        applyVisionFabPosition(getDefaultVisionFabPosition())
        setVisionFabReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [applyVisionFabPosition, getDefaultVisionFabPosition, visionFabStorageKey])

  useEffect(() => {
    if (!visionFabReady) return
    applyVisionFabPosition(visionFabCurrentRef.current)
  }, [applyVisionFabPosition, visionFabReady])

  // Filtered results by local UI filters (client-side, no extra round trip).
  const filteredResults = searchResults.filter((tailor) => {
    if (availFilter !== 'ALL' && tailor.availability !== availFilter) return false
    if (specialtyFilters.length > 0) {
      const tags = tailor.specialtyTags.map((tag) => tag.toLowerCase())
      const matchesSpecialty = specialtyFilters.some((specialty) => {
        const lower = specialty.toLowerCase()
        return (
          tags.some((tag) => tag.includes(lower)) ||
          tailor.displayName.toLowerCase().includes(lower)
        )
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
  const recentlyViewedIds = useMemo(
    () => new Set(recentlyViewed.map((tailor) => tailor.id)),
    [recentlyViewed],
  )

  // ── Persistence load on focus ─────────────────────────────────────────────

  useFocusEffect(
    useCallback(() => {
      Promise.all([
        loadRecentlyViewedTailors<TailorCardWithRecent>(user?.id),
        loadRecentSearches(user?.id),
        loadLastSearch(user?.id),
        AsyncStorage.getItem(storageKey(CUSTOMER_ONBOARDING_KEY, user?.id)).catch(() => null),
      ]).then(([rv, rs, ls, onboardingValue]) => {
        setRecentlyViewed(rv)
        setRecentSearches(rs)
        setLastSearch(ls)
        setShowOnboarding(onboardingValue !== '1')
      })
    }, [user?.id])
  )

  async function dismissOnboarding() {
    setShowOnboarding(false)
    setOnboardingStep(0)
    try {
      await AsyncStorage.setItem(storageKey(CUSTOMER_ONBOARDING_KEY, user?.id), '1')
    } catch {
      // Onboarding dismissal is local preference only.
    }
  }

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setFetchError(false)
    try {
      const [ordersRes, tailorsRes] = await Promise.allSettled([
        supabase
          .from('orders')
          .select(
            `
            id, reference, garment_type, order_kind, stage,
            tailor_profiles!tailor_profile_id(display_name),
            quoted_completion_date
          `
          )
          .eq('customer_id', userId)
          .not('stage', 'in', '("COMPLETE","DECLINED","EXPIRED","REFUNDED","CANCELLED")')
          .order('created_at', { ascending: false })
          .limit(3),
        fetchReadGateway<TailorDiscoveryRow[]>({ action: 'explore-tailors', limit: 30 }),
      ])

      const ordersFailed =
        ordersRes.status === 'rejected' ||
        (ordersRes.status === 'fulfilled' && !!ordersRes.value.error)
      const tailorsFailed =
        tailorsRes.status === 'rejected'

      if (ordersFailed && tailorsFailed) {
        setFetchError(true)
        lastBrowseFetchAtRef.current = 0
        setActiveOrders([])
        setAllTailors([])
        return
      }

      const orderRows: ActiveOrderRow[] =
        ordersRes.status === 'fulfilled' && !ordersRes.value.error
          ? ((ordersRes.value.data ?? []) as ActiveOrderRow[])
          : []
      const tailorRows: TailorDiscoveryRow[] | null =
        tailorsRes.status === 'fulfilled'
          ? tailorsRes.value
          : null

      setActiveOrders(
        orderRows
          .map((o) => ({
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

      if (tailorRows) {
        setAllTailors(tailorRows.map(mapTailor))
      } else {
        setFetchError(true)
        lastBrowseFetchAtRef.current = 0
      }
    } catch {
      setFetchError(true)
      lastBrowseFetchAtRef.current = 0
    }
  }, [userId])

  useFocusEffect(
    useCallback(() => {
      if (!userId) return undefined
      const now = Date.now()
      const shouldRefresh =
        lastBrowseFetchAtRef.current === 0 ||
        now - lastBrowseFetchAtRef.current > EXPLORE_FOCUS_REFRESH_MS
      if (shouldRefresh) {
        lastBrowseFetchAtRef.current = now
        void fetchData()
      }
      return undefined
    }, [fetchData, userId])
  )

  /**
   * runSearch — handles both fresh searches (offset=0) and pagination.
   * offset=0: show cached results immediately, fetch fresh in parallel.
   * offset>0: append results to existing list.
   */
  const runSearch = useCallback(async (q: string, offset: number) => {
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
      const fetchSize = location ? PAGE_SIZE * 3 : PAGE_SIZE

      let strictPage: TailorCard[] = []
      if (location) {
        const strictData = await fetchReadGateway<TailorDiscoveryRow[]>({
          action: 'explore-tailors',
          limit: PAGE_SIZE,
          offset,
          specialty,
          location,
          strictLocation: true,
        })
        strictPage = strictData.map(mapTailor)
      }

      let page = strictPage

      if (page.length === 0) {
        const data = await fetchReadGateway<TailorDiscoveryRow[]>({
          action: 'explore-tailors',
          limit: fetchSize,
          offset,
          specialty,
          general,
        })

        page = data.map(mapTailor)

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

        saveRecentSearch(userId, q)
        if (page.length > 0) {
          const ls: LastSearch = {
            query: q,
            count: page.length,
            thumbnail: page[0]?.portfolioPhoto ?? null,
            thumbnailBucket: page[0]?.exploreImageBucket ?? null,
          }
          saveLastSearch(userId, ls)
          setLastSearch(ls)
        } else {
          clearLastSearch(userId)
          setLastSearch(null)
        }
        loadRecentSearches(userId).then(setRecentSearches)
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
  }, [userId])

  // ── Debounced live search — resets pagination on new query ─────────────────

  useEffect(() => {
    if (!isSearchActive) {
      const resetTimer = setTimeout(() => {
        setSearchResults([])
        setSearchFetchError(false)
        setHasMore(false)
        setResultOffset(0)
        setSearchPending(false)
      }, 0)
      return () => clearTimeout(resetTimer)
    }
    const pendingTimer = setTimeout(() => {
      setSearchPending(true)
    }, 0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void runSearch(query, 0)
    }, 300)
    return () => {
      clearTimeout(pendingTimer)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [isSearchActive, query, runSearch])

  function loadMoreResults() {
    if (!hasMore || loadingMore || searching) return
    void runSearch(query, resultOffset)
  }

  async function onRefresh() {
    setRefreshing(true)
    await fetchData()
    lastBrowseFetchAtRef.current = Date.now()
    const [rv, rs, ls] = await Promise.all([
      loadRecentlyViewedTailors<TailorCardWithRecent>(user?.id),
      loadRecentSearches(user?.id),
      loadLastSearch(user?.id),
    ])
    setRecentlyViewed(rv)
    setRecentSearches(rs)
    setLastSearch(ls)
    setRefreshing(false)
  }

  function navigateToTailor(tailor: TailorCard) {
    saveRecentlyViewedTailor(user?.id, tailor)
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

  const openDrapeVision = useCallback(() => {
    router.push({
      pathname: DRAPE_VISION_ROUTE,
      params: {
        mode: 'customer_scan',
        returnTo: '/(customer)',
      },
    } as never)
  }, [router])

  const visionFabPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !showOnboarding,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dx) > 3 || Math.abs(gestureState.dy) > 3,
        onPanResponderGrant: () => {
          visionFabDragStartRef.current = visionFabCurrentRef.current
          visionFabDraggedRef.current = false
        },
        onPanResponderMove: (_, gestureState) => {
          const hasDragged =
            Math.abs(gestureState.dx) > VISION_FAB_DRAG_THRESHOLD ||
            Math.abs(gestureState.dy) > VISION_FAB_DRAG_THRESHOLD
          visionFabDraggedRef.current = visionFabDraggedRef.current || hasDragged

          if (!visionFabDraggedRef.current) return

          applyVisionFabPosition({
            x: visionFabDragStartRef.current.x + gestureState.dx,
            y: visionFabDragStartRef.current.y + gestureState.dy,
          })
        },
        onPanResponderRelease: (_, gestureState) => {
          const wasDragged =
            visionFabDraggedRef.current ||
            Math.abs(gestureState.dx) > VISION_FAB_DRAG_THRESHOLD ||
            Math.abs(gestureState.dy) > VISION_FAB_DRAG_THRESHOLD

          if (!wasDragged) {
            applyVisionFabPosition(visionFabDragStartRef.current)
            openDrapeVision()
            return
          }

          const nextPosition = clampVisionFabPosition({
            x: visionFabDragStartRef.current.x + gestureState.dx,
            y: visionFabDragStartRef.current.y + gestureState.dy,
          })
          applyVisionFabPosition(nextPosition)
          persistVisionFabPosition(nextPosition)
        },
        onPanResponderTerminate: () => {
          const nextPosition = clampVisionFabPosition(visionFabCurrentRef.current)
          applyVisionFabPosition(nextPosition)
          persistVisionFabPosition(nextPosition)
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [
      applyVisionFabPosition,
      clampVisionFabPosition,
      openDrapeVision,
      persistVisionFabPosition,
      showOnboarding,
    ]
  )

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
        {!searchFocused && !isSearchActive ? (
          <View style={styles.exploreHeader}>
            <Text style={styles.exploreTitle}>Find your tailor</Text>
          </View>
        ) : null}
        {/* Search row */}
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Feather name="search" size={16} color={MUTED_GREY} />
            <TextInput
              ref={inputRef}
              style={styles.searchInput}
              placeholder="Search by style, location, tailor"
              placeholderTextColor={Colors.midGrey}
              accessibilityLabel="Search by style, location, tailor"
              value={query}
              onChangeText={setQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={handleBlur}
              returnKeyType="search"
              onSubmitEditing={() => {
                if (query.trim()) {
                  setSearchFocused(false)
                  runSearch(query, 0)
                }
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
          contentContainerStyle={[
            styles.suggestionsContent,
            { paddingBottom: Math.max(insets.bottom + 104, 140) },
          ]}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
        >
          {recentSearches.length > 0 && (
            <View style={styles.suggestSection}>
              <View style={styles.suggestHeader}>
                <Text style={styles.suggestTitle}>Recent searches</Text>
                <TouchableOpacity
                  onPress={() => {
                    clearRecentSearches(user?.id)
                    setRecentSearches([])
                  }}
                >
                  <Text style={styles.suggestClear}>Clear</Text>
                </TouchableOpacity>
              </View>
              {recentSearches.map((s, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.recentSearchRow}
                  onPress={() => applyQuery(s)}
                >
                  <Feather name="clock" size={16} color={Colors.midGrey} />
                  <Text style={styles.recentSearchText}>{s}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      const updated = recentSearches.filter((_, j) => j !== i)
                      setRecentSearches(updated)
                      AsyncStorage.setItem(
                        storageKey(RECENT_SEARCHES_KEY, user?.id),
                        JSON.stringify(updated)
                      )
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
            <View style={styles.suggestRows}>
              {[
                'Suits in Lagos',
                'Tailors in London',
                'Bridal',
                'Casual wear',
                'Traditional',
                'Bespoke suits',
              ].map((s) => (
                <TouchableOpacity key={s} style={styles.suggestRow} onPress={() => applyQuery(s)} activeOpacity={0.76}>
                  <Feather name="search" size={15} color={Colors.midGrey} />
                  <Text style={styles.suggestRowText}>{s}</Text>
                  <Feather name="chevron-right" size={17} color={Colors.midGrey} />
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
          contentContainerStyle={[
            styles.resultsList,
            { paddingBottom: Math.max(insets.bottom + 104, 140) },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMoreResults}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={
            <View style={styles.resultsHeader}>
              {searching || searchPending ? (
                <ActivityIndicator
                  color={Colors.needleGreen}
                  style={{ marginVertical: Spacing.lg }}
                />
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
                <View
                  style={[styles.emptyStateIcon, searchFetchError && styles.emptyStateIconError]}
                >
                  <Feather
                    name={searchFetchError ? 'alert-circle' : 'search'}
                    size={26}
                    color={searchFetchError ? Colors.kanteRust : Colors.needleGreen}
                  />
                </View>
                <Text style={styles.emptyStateTitle}>
                  {searchFetchError
                    ? "Couldn't load search results"
                    : 'No tailors match your search'}
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
                  accessibilityLabel={
                    searchFetchError ? 'Try search again' : 'Clear search filters'
                  }
                >
                  <Text style={styles.searchRetryBtnText}>
                    {searchFetchError ? 'Try again' : 'Clear filters'}
                  </Text>
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
            loadingMore ? (
              <ActivityIndicator color={Colors.needleGreen} style={styles.loadMoreSpinner} />
            ) : null
          }
          renderItem={({ item }) => (
            <SearchResultCard tailor={item} onPress={() => navigateToTailor(item)} />
          )}
        />
      ) : (
        // ── Default browse ──
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom + 104, 140) },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.needleGreen}
            />
          }
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Network error banner */}
          {fetchError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>
                Couldn't load tailors. Pull down to retry, or open Orders while discovery catches
                up.
              </Text>
            </View>
          )}

          {/* Active orders */}
          {activeOrders.length > 0 ? (
            <View style={styles.continueSection}>
              <View style={styles.continueSectionHeader}>
                <View style={styles.sectionTitleBlock}>
                  <Text style={styles.sectionEyebrow}>Continue</Text>
                  <Text style={styles.sectionTitle}>
                    {activeOrders.length === 1 ? 'Your active order' : 'Your active orders'}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => router.navigate('/(customer)/orders')}>
                  <Text style={styles.sectionLink}>See all →</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.ordersScroll}
                contentContainerStyle={styles.ordersRow}
              >
                {activeOrders.map((order) => {
                  const c = STAGE_PILL_COLOR[order.stage as OrderStage]
                  return (
                    <TouchableOpacity
                      key={order.id}
                      style={styles.orderCard}
                      onPress={() =>
                        router.push({
                          pathname: '/(customer)/orders/[id]',
                          params: { id: order.id, returnTo: '/(customer)' },
                        })
                      }
                    >
                      <View
                        style={[
                          styles.orderStagePill,
                          { backgroundColor: c?.bg ?? Colors.needleGreenLight },
                        ]}
                      >
                        <Text
                          style={[
                            styles.orderStageText,
                            { color: c?.text ?? Colors.needleGreen },
                          ]}
                        >
                          {customerOrderStageLabel(order.stage as OrderStage, order.orderKind)}
                        </Text>
                      </View>
                      <Text style={styles.orderGarment} numberOfLines={1}>
                        {order.garmentType}
                      </Text>
                      <Text style={styles.orderTailor} numberOfLines={1}>
                        {order.tailorName}
                      </Text>
                      {order.estimatedDate && (
                        <Text style={styles.orderEta}>
                          Ready{' '}
                          {new Date(order.estimatedDate).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>
            </View>
          ) : null}

          {/* Top tailors grid */}
          <View style={[styles.section, activeOrders.length > 0 && styles.tailorGridSection]}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleBlock}>
                <Text style={styles.sectionEyebrow}>Explore</Text>
                <Text style={styles.sectionTitle}>Recommended tailors</Text>
              </View>
              {recentlyViewed.length > 0 ? (
                <View style={styles.recentLegend}>
                  <Feather name="clock" size={12} color={PRIMARY_GREEN} />
                  <Text style={styles.recentLegendText}>Recently viewed</Text>
                </View>
              ) : null}
            </View>
            {allTailors.length > 0 ? (
              <View style={styles.cardsGrid}>
                {allTailors.map((tailor) => (
                  <GridCard
                    key={tailor.id}
                    tailor={tailor}
                    recentlyViewed={recentlyViewedIds.has(tailor.id)}
                    onPress={() => navigateToTailor(tailor)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.emptyBrowseCard}>
                <View style={styles.emptyBrowseBadge}>
                  <Text style={styles.emptyBrowseBadgeText}>Discovery</Text>
                </View>
                <Text style={styles.emptyBrowseTitle}>Verified tailors are being refreshed</Text>
                <Text style={styles.emptyBrowseHint}>
                  Pull down to refresh, search by specialty, or check back shortly as vetted
                  profiles go live.
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
      {!showOnboarding && visionFabReady ? (
        <Animated.View
          {...visionFabPanResponder.panHandlers}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Open Drapeon Vision"
          accessibilityHint="Double tap to open. Drag to move this shortcut."
          style={[
            styles.visionFloatingOrb,
            { transform: visionFabPosition.getTranslateTransform() },
          ]}
        >
          <View style={styles.visionFloatingOrbInner}>
            <Feather name="aperture" size={24} color={Colors.textInverse} />
          </View>
        </Animated.View>
      ) : null}
    </SafeAreaView>
  )
}

// ─── Grid card ────────────────────────────────────────────────────────────────

function GridCard({
  tailor,
  onPress,
  recentlyViewed,
}: {
  tailor: TailorCard
  onPress: () => void
  recentlyViewed?: boolean
}) {
  const { width: screenWidth } = useWindowDimensions()
  const cardWidth = Math.min(156, Math.floor((screenWidth - Spacing.lg * 2 - 18) / 2))
  const cardImageHeight = Math.round(cardWidth * EXPLORE_CARD_IMAGE_RATIO)
  const specialty = tailor.specialtyTags[0]
  const metaParts = [
    tailor.avgRating > 0 ? tailor.avgRating.toFixed(1) : null,
    specialty,
    tailor.location,
  ].filter(Boolean)

  return (
    <TouchableOpacity
      style={[styles.gridCard, { width: cardWidth }]}
      onPress={onPress}
      activeOpacity={0.88}
    >
      <View style={[styles.gridImageWrap, { height: cardImageHeight }]}>
        {tailor.portfolioPhoto ? (
          <RemoteImage
            uri={tailor.portfolioPhoto}
            bucket={tailor.exploreImageBucket ?? 'portfolio-photos'}
            style={styles.gridImage}
            contentFit="cover"
            contentPosition="top center"
            transition={120}
            surface="customer_explore_grid"
            fallback={
              <ExploreMediaPlaceholder
                style={styles.gridImage}
                name={tailor.displayName}
                size={28}
              />
            }
          />
        ) : (
          <ExploreMediaPlaceholder style={styles.gridImage} name={tailor.displayName} size={28} />
        )}
        {recentlyViewed ? (
          <View style={styles.recentBadge}>
            <Feather name="clock" size={11} color={Colors.textInverse} />
          </View>
        ) : null}
      </View>
      <View style={styles.gridInfo}>
        <Text style={styles.gridName} numberOfLines={1}>
          {tailor.displayName}
        </Text>
        <Text style={styles.gridLocation} numberOfLines={1}>
          {metaParts.join(' • ')}
        </Text>
        {tailor.availability === 'FULLY_BOOKED' ? (
          <Text style={styles.gridUnavailableText} numberOfLines={1}>
            Fully booked
          </Text>
        ) : null}
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
            fallback={
              <ExploreMediaPlaceholder
                style={styles.resultThumbImg}
                name={tailor.displayName}
                size={20}
              />
            }
          />
        ) : (
          <ExploreMediaPlaceholder
            style={styles.resultThumbImg}
            name={tailor.displayName}
            size={20}
          />
        )}
      </View>
      <View style={styles.resultInfo}>
        <View style={styles.resultNameRow}>
          <Text style={styles.resultName} numberOfLines={1}>
            {tailor.displayName}
          </Text>
          <TierBadgeChip tier={toTierBadge(tailor.tier)} />
        </View>
        <Text style={styles.resultLocation} numberOfLines={1}>
          {tailor.location}
        </Text>
        <StarRating rating={tailor.avgRating} count={tailor.totalReviews} />
        {tailor.specialtyTags.length > 0 && (
          <Text style={styles.resultTags} numberOfLines={1}>
            {tailor.specialtyTags.slice(0, 2).join(' · ')}
          </Text>
        )}
        {serviceLabel(tailor) ? (
          <Text style={styles.resultServiceText} numberOfLines={1}>
            {serviceLabel(tailor)}
          </Text>
        ) : null}
        {availabilityHint(tailor) && (
          <Text style={styles.resultHint} numberOfLines={1}>
            {availabilityHint(tailor)}
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
  const [specialtyOpen, setSpecialtyOpen] = useState(false)
  const specialtySummary =
    specialtyFilters.length === 0
      ? 'Any specialty'
      : specialtyFilters.length <= 2
        ? specialtyFilters.join(' · ')
        : `${specialtyFilters.slice(0, 2).join(' · ')} +${specialtyFilters.length - 2} more`
  const ratingOptions: { value: MinRatingFilter; title: string; subtitle: string }[] = [
    { value: null, title: 'Any rating', subtitle: 'Show every vetted profile' },
    { value: 4, title: '4.0 and up', subtitle: 'Strong customer feedback' },
    { value: 4.5, title: '4.5 and up', subtitle: 'Highly rated work' },
    { value: 5, title: '5.0 only', subtitle: 'Perfect rating so far' },
  ]
  const availabilityOptions: { value: AvailFilter; title: string; subtitle: string }[] = [
    { value: 'ALL', title: 'All tailors', subtitle: 'Include every live profile' },
    { value: 'OPEN', title: 'Available now', subtitle: 'Accepting new order requests' },
    { value: 'LIMITED', title: 'Limited availability', subtitle: 'Taking fewer orders' },
  ]

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.filterSheetOverlay}
      >
        <TouchableOpacity style={styles.filterSheetScrim} activeOpacity={1} onPress={onClose} />
        <View style={styles.filterSheet}>
          <View style={styles.filterSheetHandle} />
          <View style={styles.filterSheetHeader}>
            <Text style={styles.filterSheetTitle}>Filters</Text>
            <View style={styles.filterSheetActions}>
              {activeFilterCount > 0 ? (
                <TouchableOpacity
                  onPress={onClear}
                  accessibilityRole="button"
                  accessibilityLabel="Clear all filters"
                  style={styles.filterSheetClearButton}
                >
                  <Text style={styles.filterSheetClear}>Clear all</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close filters"
                style={styles.filterSheetClose}
              >
                <Feather name="x" size={20} color={Colors.ink} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            style={styles.filterSheetBody}
            contentContainerStyle={styles.filterSheetBodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.filterSectionTitle}>Specialty</Text>
            <TouchableOpacity
              style={styles.filterSelectRow}
              onPress={() => setSpecialtyOpen((open) => !open)}
              activeOpacity={0.82}
            >
              <View style={styles.filterOptionCopy}>
                <Text style={styles.filterOptionTitle}>Choose specialties</Text>
                <Text style={styles.filterOptionMeta} numberOfLines={1}>
                  {specialtySummary}
                </Text>
              </View>
              <Feather
                name={specialtyOpen ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={Colors.inkLight}
              />
            </TouchableOpacity>
            {specialtyOpen ? (
              <View style={styles.filterOptionCard}>
                {FILTER_SPECIALTIES.map((specialty, index) => {
                  const selected = specialtyFilters.includes(specialty)
                  return (
                    <TouchableOpacity
                      key={specialty}
                      style={[
                        styles.filterOptionRow,
                        index === FILTER_SPECIALTIES.length - 1 && styles.filterOptionRowLast,
                      ]}
                      onPress={() => onToggleSpecialty(specialty)}
                      activeOpacity={0.82}
                    >
                      <View
                        style={[
                          styles.filterOptionCheck,
                          selected && styles.filterOptionCheckActive,
                        ]}
                      >
                        {selected ? (
                          <Feather name="check" size={14} color={Colors.textInverse} />
                        ) : null}
                      </View>
                      <Text style={styles.filterOptionTitle}>{specialty}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            ) : null}

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
            <View style={styles.filterOptionCard}>
              {ratingOptions.map((option, index) => {
                const selected = minRatingFilter === option.value
                return (
                  <TouchableOpacity
                    key={option.title}
                    style={[
                      styles.filterOptionRow,
                      selected && styles.filterOptionRowActive,
                      index === ratingOptions.length - 1 && styles.filterOptionRowLast,
                    ]}
                    onPress={() => onChangeMinRating(option.value)}
                    activeOpacity={0.82}
                  >
                    <View
                      style={[
                        styles.filterOptionRadio,
                        selected && styles.filterOptionRadioActive,
                      ]}
                    >
                      {selected ? <View style={styles.filterOptionRadioDot} /> : null}
                    </View>
                    <View style={styles.filterOptionCopy}>
                      <Text style={styles.filterOptionTitle}>{option.title}</Text>
                      <Text style={styles.filterOptionMeta}>{option.subtitle}</Text>
                    </View>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={styles.filterSectionTitle}>Availability</Text>
            <View style={styles.filterOptionCard}>
              {availabilityOptions.map((option, index) => {
                const selected = availFilter === option.value
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.filterOptionRow,
                      selected && styles.filterOptionRowActive,
                      index === availabilityOptions.length - 1 && styles.filterOptionRowLast,
                    ]}
                    onPress={() => onChangeAvailability(option.value)}
                    activeOpacity={0.82}
                  >
                    <View
                      style={[
                        styles.filterOptionRadio,
                        selected && styles.filterOptionRadioActive,
                      ]}
                    >
                      {selected ? <View style={styles.filterOptionRadioDot} /> : null}
                    </View>
                    <View style={styles.filterOptionCopy}>
                      <Text style={styles.filterOptionTitle}>{option.title}</Text>
                      <Text style={styles.filterOptionMeta}>{option.subtitle}</Text>
                    </View>
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
          </ScrollView>

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
            accessibilityLabel={
              isLast ? 'Finish customer walkthrough' : 'Continue customer walkthrough'
            }
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
    paddingTop: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
    gap: 14,
  },
  exploreHeader: {
    marginTop: 0,
  },
  exploreTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: FontWeight.bold,
    color: CHARCOAL,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    minHeight: 52,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
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
  visionFloatingOrb: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: VISION_FAB_SIZE,
    height: VISION_FAB_SIZE,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
    ...Shadow.lg,
  },
  visionFloatingOrbInner: {
    width: VISION_FAB_SIZE,
    height: VISION_FAB_SIZE,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.78)',
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
  errorBanner: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: Colors.kanteRustLight,
    borderRadius: Radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.kanteRust + '35',
  },
  errorBannerText: { fontSize: 13, color: Colors.kanteRust, lineHeight: 18 },

  // Suggestions panel
  suggestionsContent: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: 28 },
  suggestSection: { gap: Spacing.sm },
  suggestHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  suggestTitle: { fontSize: 15, fontWeight: FontWeight.semibold, color: CHARCOAL },
  suggestClear: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.medium },
  recentSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
  },
  recentSearchText: { flex: 1, fontSize: 14, color: CHARCOAL },
  suggestRows: { gap: Spacing.sm },
  suggestRow: {
    minHeight: 50,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  suggestRowText: { flex: 1, fontSize: 14, color: CHARCOAL, fontWeight: FontWeight.medium },

  // Search results (FlatList)
  resultsList: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: 28 },
  resultsHeader: { gap: Spacing.sm, marginBottom: 6 },
  resultsCount: { fontSize: 16, fontWeight: FontWeight.semibold, color: CHARCOAL },
  clearFiltersRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: 32 },
  clearFiltersText: {
    fontSize: FontSize.sm,
    color: PRIMARY_GREEN,
    fontWeight: FontWeight.semibold,
  },
  availRow: { flexDirection: 'row', gap: Spacing.sm },
  availChip: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    justifyContent: 'center',
  },
  availChipActive: { backgroundColor: CHARCOAL, borderColor: CHARCOAL },
  availLabel: { fontSize: 12, color: MUTED_GREY, fontWeight: FontWeight.medium },
  availLabelActive: { color: Colors.textInverse },
  loadMoreSpinner: { marginVertical: Spacing.lg },

  // Result card
  resultCard: {
    flexDirection: 'row',
    gap: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 10,
    ...Shadow.sm,
  },
  resultThumb: { width: 76, height: 86, borderRadius: Radius.md, overflow: 'hidden' },
  resultThumbImg: { width: '100%', height: '100%' },
  resultThumbPlaceholder: {
    backgroundColor: Colors.boneDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  resultName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
    flex: 1,
    marginRight: 4,
  },
  resultLocation: { fontSize: 12, color: MUTED_GREY },
  resultTags: { fontSize: 12, color: Colors.inkLight },
  resultServiceText: {
    fontSize: 11,
    lineHeight: 16,
    color: Colors.inkLight,
    marginTop: 1,
  },
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
    backgroundColor: Colors.statusPendingBg,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
    alignSelf: 'flex-start',
    marginTop: 2,
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
    maxHeight: '88%',
  },
  filterSheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.lightGrey,
  },
  filterSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filterSheetTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  filterSheetClear: {
    fontSize: FontSize.sm,
    color: PRIMARY_GREEN,
    fontWeight: FontWeight.semibold,
  },
  filterSheetActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  filterSheetClearButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  filterSheetClose: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  filterSectionTitle: {
    marginTop: Spacing.sm,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  filterSheetBody: { flexGrow: 0 },
  filterSheetBodyContent: { gap: Spacing.sm, paddingBottom: Spacing.xs },
  filterSelectRow: {
    minHeight: 62,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.bone,
    gap: Spacing.md,
  },
  filterOptionCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    overflow: 'hidden',
  },
  filterOptionRow: {
    minHeight: 58,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
  },
  filterOptionRowActive: { backgroundColor: Colors.needleGreenLight },
  filterOptionRowLast: { borderBottomWidth: 0 },
  filterOptionCopy: { flex: 1, gap: 2 },
  filterOptionTitle: {
    fontSize: FontSize.xs,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  filterOptionMeta: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    lineHeight: 17,
  },
  filterOptionCheck: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  filterOptionCheckActive: {
    backgroundColor: Colors.needleGreen,
    borderColor: Colors.needleGreen,
  },
  filterOptionRadio: {
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  filterOptionRadioActive: { borderColor: Colors.needleGreen },
  filterOptionRadioDot: {
    width: 10,
    height: 10,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
  },
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
  filterApplyButtonText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
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
  onboardingSkipText: {
    fontSize: FontSize.sm,
    color: Colors.midGrey,
    fontWeight: FontWeight.medium,
  },
  onboardingIcon: {
    width: 72,
    height: 72,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardingTitle: {
    fontFamily: Fonts.display,
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
  tailorGridSection: { paddingTop: Spacing.lg },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  sectionTitleBlock: {
    flex: 1,
    gap: 2,
  },
  sectionTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
  },
  sectionEyebrow: {
    fontSize: 11,
    lineHeight: 14,
    color: MUTED_GREY,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
  },
  sectionLink: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.medium },
  recentLegend: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  recentLegendText: {
    fontSize: 11,
    color: PRIMARY_GREEN,
    fontWeight: FontWeight.semibold,
  },

  // Continue searching card
  continueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    ...Shadow.sm,
  },
  continueLabel: { fontSize: 11, color: MUTED_GREY, fontWeight: FontWeight.medium },
  continueQuery: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
  },
  continueMeta: { fontSize: 13, color: PRIMARY_GREEN, fontWeight: FontWeight.medium },
  continueThumbnail: { width: 52, height: 52, borderRadius: Radius.md, overflow: 'hidden' },

  // Orders
  continueSection: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  continueSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  ordersScroll: {},
  ordersRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  orderCard: {
    width: 154,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    padding: 10,
    gap: 4,
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
  orderGarment: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
  },
  orderTailor: { fontSize: 12, color: MUTED_GREY },
  orderEta: { fontSize: 12, color: PRIMARY_GREEN, fontWeight: FontWeight.medium },
  // Tailor grid
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
    paddingHorizontal: Spacing.lg,
  },
  gridCard: {
    minHeight: 220,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  gridImageWrap: { width: '100%', position: 'relative', padding: 10 },
  gridImage: { width: '100%', height: '100%' },
  gridImagePlaceholder: {
    backgroundColor: Colors.boneDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    backgroundColor: 'rgba(26,26,24,0.72)',
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  recentBadgeText: {
    fontSize: 10,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
  gridInfo: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 14, gap: 4 },
  gridName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
  },
  gridLocation: { fontSize: 12, lineHeight: 17, color: MUTED_GREY },
  gridTags: { fontSize: 12, color: Colors.inkLight, marginTop: 2 },
  gridServiceText: {
    fontSize: 11,
    lineHeight: 16,
    color: Colors.inkLight,
    marginTop: 1,
  },
  gridHint: { fontSize: 12, color: PRIMARY_GREEN, marginTop: 3, fontWeight: FontWeight.medium },
  gridUnavailableText: {
    fontSize: 11,
    lineHeight: 16,
    color: Colors.kanteRust,
    fontWeight: FontWeight.semibold,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 48,
    paddingHorizontal: Spacing.lg,
  },
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
  searchRetryBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
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
  searchSecondaryBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: CHARCOAL,
  },
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
  emptyBrowseCtaText: {
    fontSize: FontSize.sm,
    color: PRIMARY_GREEN,
    fontWeight: FontWeight.semibold,
  },
})
