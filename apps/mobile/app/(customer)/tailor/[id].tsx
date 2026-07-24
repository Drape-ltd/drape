import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  FlatList, Alert, Dimensions, NativeSyntheticEvent, NativeScrollEvent, Modal,
  Image as RNImage,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRefreshOnFocus, useTailorPublic, useWishlistCollections } from '@/lib/queries'
import { invokeFunction } from '@/lib/supabase'
import { useAuth, useUserRole } from '@/lib/auth'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { useCurrency, formatAmount, type CurrencyCode } from '@/lib/currency'
import {
  RemoteImage,
  TierBadgeChip,
  StarRating,
  Tag,
  Button,
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
  DrapeIconButton,
  SkeletonBlock,
  SaveToWishlistSheet,
  PortfolioVideoPreview,
} from '@/components/ui'
import type { TierBadge } from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { AvatarImage } from '@/components/ui/AvatarImage'
import { useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import { appendToHistory, goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { hapticLight } from '@/lib/haptics'
import { getTailorPriceMinMajor } from '@drape/shared/tailor-setup'
import { isVideoMediaUrl } from '@drape/shared/media-policy'
import {
  captureImageLoadFailure,
  resolveStorageImageUrl,
  type StorageImageBucket,
} from '@/lib/image-url'

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window')
const HERO_HEIGHT = Math.min(Math.max(Math.round(SCREEN_WIDTH * 0.72), 252), 320)
const PORTFOLIO_COLS = 3
const PORTFOLIO_TILE_RATIO = 1.18
const PORTFOLIO_SIZE = (SCREEN_WIDTH - Spacing.lg * 2 - Spacing.sm * 2) / PORTFOLIO_COLS
const PREVIEW_MEDIA_HEIGHT = Math.min(SCREEN_HEIGHT * 0.76, 680)

type TailorProfile = {
  id: string
  userId: string | null
  displayName: string
  location: string
  tier: string
  sellerType: 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP'
  avgRating: number
  totalReviews: number
  totalOrders: number
  avgResponseHours: number | null
  availability: string
  acceptsCustomOrdersNow: boolean
  shopPaused: boolean
  bio: string | null
  specialtyTags: string[]
  languages: string[]
  currency: string
  priceRangeMin: number | null
  priceRangeMax: number | null
  avatarUrl: string | null
  portfolioPhotos: string[]
  portfolioVideos: string[]
  supportsCustomOrders: boolean
  supportsReadyMade: boolean
  pickupAvailable: boolean
  deliveryAvailable: boolean
  shippingAvailable: boolean
}

type Review = {
  id: string
  rating: number
  body: string | null
  tags: string[]
  reviewerName: string
  reviewerAvatarUrl: string | null
  response: string | null
  mediaUrls: string[]
  createdAt: string
}

type ReviewSummary = {
  average: number
  count: number
}

type MediaPreviewItem = {
  uri: string
  bucket: StorageImageBucket
}

const AVAILABILITY_LABEL: Record<string, string> = {
  OPEN: 'Available now',
  LIMITED: 'Limited availability',
  FULLY_BOOKED: 'Fully booked',
}

const AVAILABILITY_COLOR: Record<string, string> = {
  OPEN: Colors.success,
  LIMITED: Colors.warning,
  FULLY_BOOKED: Colors.error,
}

function toTierBadge(tier: string | null | undefined): TierBadge | null {
  if (tier === 'VERIFIED' || tier === 'RISING' || tier === 'MASTER') return tier
  return null
}

function dedupeLocation(location: string): string {
  const parts = location.split(',').map((p) => p.trim()).filter(Boolean)
  const seen = new Set<string>()
  return parts.filter((p) => {
    const key = p.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).join(', ')
}

function createDraftSessionId() {
  return `${new Date().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export default function TailorProfileScreen() {
  const { id, returnTo, historyChain } = useLocalSearchParams<{
    id: string
    returnTo?: string
    historyChain?: string
  }>()
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const capsuleNavScroll = useDrapeCapsuleNavScroll()
  const { user } = useAuth()
  const role = useUserRole()
  const scrollRef = useRef<ScrollView | null>(null)
  const imagePreviewRef = useRef<FlatList<MediaPreviewItem> | null>(null)
  const [savedOverride, setSavedOverride] = useState<boolean | null>(null)
  const [savingHeart, setSavingHeart] = useState(false)
  const [carouselIndex, setCarouselIndex] = useState(0)
  const [failedHeroImages, setFailedHeroImages] = useState<string[]>([])
  const [imagePreviewItems, setImagePreviewItems] = useState<MediaPreviewItem[]>([])
  const [imagePreviewIndex, setImagePreviewIndex] = useState<number | null>(null)
  const [imageViewerIndex, setImageViewerIndex] = useState(0)
  const [failedPreviewImages, setFailedPreviewImages] = useState<string[]>([])
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null)
  const [showPortfolioModal, setShowPortfolioModal] = useState(false)
  const [showReviewsModal, setShowReviewsModal] = useState(false)
  const [showStylesModal, setShowStylesModal] = useState(false)
  const [wishlistPickerOpen, setWishlistPickerOpen] = useState(false)
  const [newWishlistName, setNewWishlistName] = useState('')
  const { currency, rates } = useCurrency()
  const {
    data,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useTailorPublic(role === 'CUSTOMER' ? id : undefined, role === 'CUSTOMER' ? user?.id : undefined)
  const { data: wishlistCollections = [], refetch: refetchWishlists } = useWishlistCollections(role === 'CUSTOMER' ? user?.id : undefined)
  const profile = (data?.profile ?? null) as TailorProfile | null
  const reviews = (data?.reviews ?? []) as Review[]
  const isSaved = savedOverride ?? data?.isSaved ?? false

  useRefreshOnFocus(() => { void refetch() }, 0)

  useEffect(() => {
    const timer = setTimeout(() => {
      setFailedHeroImages([])
    }, 0)
    return () => clearTimeout(timer)
  }, [id])

  useEffect(() => {
    const timer = setTimeout(() => {
      setSavedOverride(null)
    }, 0)
    return () => clearTimeout(timer)
  }, [id, data?.isSaved])

  async function saveToWishlist(input: { collectionId?: string; collectionName?: string }) {
    if (!user?.id || savingHeart) return
    setSavingHeart(true)
    try {
      const { error } = await invokeFunction('saved-tailor-action', {
        body: {
          action: 'save-tailor',
          tailorProfileId: id,
          collectionId: input.collectionId,
          collectionName: input.collectionName,
        },
      })
      if (error) throw error
      setSavedOverride(true)
      setWishlistPickerOpen(false)
      setNewWishlistName('')
      hapticLight()
      void refetchWishlists()
    } catch (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not update your wishlists yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not update your wishlists right now. Please try again in a moment.')
      Alert.alert('Wishlist not updated', message)
    } finally {
      setSavingHeart(false)
    }
  }

  async function toggleSave() {
    if (!user?.id || savingHeart) return
    if (isSaved) {
      setSavingHeart(true)
      try {
        const { error } = await invokeFunction('saved-tailor-action', {
          body: { action: 'unsave-by-profile', tailorProfileId: id },
        })
        if (error) throw error
        setSavedOverride(false)
        hapticLight()
        void refetchWishlists()
      } catch (error) {
        const message = isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not update your saved tailors yet. Retry when the signal improves.'
          : await readFunctionErrorMessage(error, 'Could not update your saved tailors right now. Please try again in a moment.')
        Alert.alert('Could not update wishlist', message)
      } finally {
        setSavingHeart(false)
      }
      return
    }

    if (wishlistCollections.length === 1) {
      await saveToWishlist({ collectionId: wishlistCollections[0].id })
      return
    }

    setWishlistPickerOpen(true)
  }

  function onCarouselScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH)
    setCarouselIndex(index)
  }

  function goBack() {
    goBackOrReturnTo(router, navigation, pickSafeReturnTo(historyChain, returnTo), '/(customer)')
  }

  useContextualBackHandler(goBack)

  function openPortfolio() {
    setShowPortfolioModal(true)
  }

  function openImagePreview(items: MediaPreviewItem[], index: number) {
    const validItems = items.filter((item) => item.uri.trim().length > 0)
    if (validItems.length === 0) return
    const safeIndex = Math.min(Math.max(index, 0), validItems.length - 1)
    setFailedPreviewImages([])
    validItems.forEach((item) => {
      const resolvedUri = resolveStorageImageUrl(item.uri, item.bucket)
      if (resolvedUri) void RNImage.prefetch(resolvedUri).catch(() => undefined)
    })
    setImagePreviewItems(validItems)
    setImageViewerIndex(safeIndex)
    setImagePreviewIndex(safeIndex)
  }

  function closeImagePreview() {
    setImagePreviewIndex(null)
    setImagePreviewItems([])
  }

  function openPortfolioPreview(items: MediaPreviewItem[], index: number) {
    openImagePreview(items, index)
    setShowPortfolioModal(false)
  }

  function openVideoPreview(url: string) {
    setShowPortfolioModal(false)
    setTimeout(() => setPreviewVideoUrl(url), 150)
  }

  if (isLoading && !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SkeletonBlock style={styles.skLoadHero} />
        <View style={styles.skLoadBody}>
          <View style={styles.skLoadIdentityCard}>
            <SkeletonBlock style={styles.skLoadAvatar} />
            <View style={styles.skLoadNameCol}>
              <SkeletonBlock style={styles.skLoadName} />
              <SkeletonBlock style={styles.skLoadLocationLine} />
            </View>
          </View>
          <View style={styles.skLoadStatsRow}>
            <SkeletonBlock style={styles.skLoadStat} />
            <SkeletonBlock style={styles.skLoadStat} />
            <SkeletonBlock style={styles.skLoadStat} />
            <SkeletonBlock style={styles.skLoadStat} />
          </View>
          <View style={styles.skLoadBioBlock}>
            <SkeletonBlock style={styles.skLoadBioLine1} />
            <SkeletonBlock style={styles.skLoadBioLine2} />
            <SkeletonBlock style={styles.skLoadBioLine3} />
          </View>
          <View style={styles.skLoadPortfolioRow}>
            <SkeletonBlock style={styles.skLoadPortfolioThumb} />
            <SkeletonBlock style={styles.skLoadPortfolioThumb} />
            <SkeletonBlock style={styles.skLoadPortfolioThumb} />
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (isError && !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Tailor profile</Text>
            <Text style={styles.stateTitle}>Couldn't load this profile.</Text>
            <Text style={styles.stateHint}>
              This page should help you judge whether this tailor feels right before you place an order.
            </Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Recovery</Text>
              <Text style={styles.stateGuideText}>
                Refresh here first. If it still fails, go back to discovery and compare a few other live profiles.
              </Text>
            </View>
            <Button label="Try again" onPress={() => { void refetch() }} variant="secondary" />
            <Button label="Explore tailors" onPress={() => router.replace('/(customer)')} variant="secondary" />
            <Button label="Go back" onPress={goBack} variant="ghost" />
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Tailor profile</Text>
            <Text style={styles.stateTitle}>Profile not found.</Text>
            <Text style={styles.stateHint}>
              This profile may have moved, or it may no longer be available to browse right now.
            </Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Recovery</Text>
              <Text style={styles.stateGuideText}>
                Head back to discovery and reopen a live tailor from there. If this was an older saved link, your wishlist or search results should point you to the current profile.
              </Text>
            </View>
            <Button label="Explore tailors" onPress={() => router.replace('/(customer)')} variant="secondary" />
            <Button label="Go back" onPress={goBack} variant="secondary" />
          </View>
        </View>
      </SafeAreaView>
    )
  }

  const portfolioImages = Array.from(new Set(profile.portfolioPhotos.filter((url) => typeof url === 'string' && url.length > 0)))
  const portfolioVideos = Array.from(new Set(profile.portfolioVideos.filter((url) => typeof url === 'string' && url.length > 0)))
  const heroSourceImages = portfolioImages.length > 0
    ? portfolioImages
    : (profile.avatarUrl ? [profile.avatarUrl] : [])
  const heroImages = heroSourceImages.filter((url) => !failedHeroImages.includes(url))
  const portfolioImageItems: MediaPreviewItem[] = portfolioImages.map((uri) => ({
    uri,
    bucket: 'portfolio-photos',
  }))
  const heroSlides: MediaPreviewItem[] = heroImages.map((uri) => ({
    uri,
    bucket: portfolioImages.includes(uri) ? 'portfolio-photos' : 'avatars',
  }))
  const pricingCurrency = (profile.currency ?? 'USD') as CurrencyCode
  const minimumUsefulPriceMinor = getTailorPriceMinMajor(pricingCurrency) * 100
  const priceRangeMin = profile.priceRangeMin
  const priceRangeMax = profile.priceRangeMax
  const hasUsefulPriceRange =
    priceRangeMin != null &&
    priceRangeMax != null &&
    priceRangeMin >= minimumUsefulPriceMinor &&
    priceRangeMax >= priceRangeMin
  const priceLabel = hasUsefulPriceRange
    ? `${formatAmount(priceRangeMin, pricingCurrency, currency, rates)} to ${formatAmount(priceRangeMax, pricingCurrency, currency, rates)}`
    : 'Custom quote after brief'
  const originalPriceLabel =
    hasUsefulPriceRange && pricingCurrency !== currency
      ? `${formatAmount(priceRangeMin, pricingCurrency, pricingCurrency, rates)} to ${formatAmount(priceRangeMax, pricingCurrency, pricingCurrency, rates)}`
      : null
  const customOrdersFullyBooked = profile.availability === 'FULLY_BOOKED'
  const customOrdersPaused = profile.acceptsCustomOrdersNow === false || customOrdersFullyBooked
  const portfolioCount = portfolioImages.length + portfolioVideos.length
  const heroHeight = heroSlides.length > 0 ? HERO_HEIGHT : 160
  const reviewSummary: ReviewSummary = {
    average: reviews.length > 0 ? reviews.reduce((sum, row) => sum + row.rating, 0) / reviews.length : profile.avgRating,
    count: reviews.length > 0 ? reviews.length : profile.totalReviews,
  }
  const reviewBreakdown = [5, 4, 3, 2, 1].map((rating) => {
    const count = reviews.filter((review) => review.rating === rating).length
    const percent = reviews.length > 0 ? count / reviews.length : 0
    return { rating, count, percent }
  })

  return (
      <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        {...capsuleNavScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Math.max(140, insets.bottom + 112) }}
      >
        {isFetching ? <Text style={styles.refreshingText}>Refreshing profile…</Text> : null}

        {/* Swipeable Hero Carousel */}
        <View style={[styles.heroContainer, { height: heroHeight }]}>
          {heroSlides.length > 0 ? (
            <>
              <FlatList
                data={heroSlides}
                keyExtractor={(item, i) => `${item.uri}-${i}`}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={onCarouselScroll}
                scrollEventThrottle={16}
                renderItem={({ item, index }) => (
                  <TouchableOpacity
                    activeOpacity={0.94}
                    onPress={() => openImagePreview(heroSlides, index)}
                    accessibilityRole="imagebutton"
                    accessibilityLabel="Open tailor photo"
                  >
                    <RemoteImage
                      uri={item.uri}
                      bucket={item.bucket}
                      style={styles.heroImage}
                      contentFit="cover"
                      contentPosition="top center"
                      transition={150}
                      surface="customer_tailor_profile_hero"
                      onLoadError={() => {
                        setFailedHeroImages((prev) => (prev.includes(item.uri) ? prev : [...prev, item.uri]))
                      }}
                      fallback={(
                        <View style={[styles.heroImage, styles.heroPlaceholder]}>
                          <Feather name="image" size={42} color={Colors.needleGreen} />
                        </View>
                      )}
                    />
                  </TouchableOpacity>
                )}
              />
              {/* Dot indicators */}
              {heroSlides.length > 1 && (
                <View style={styles.dotRow}>
                  {heroSlides.map((_, i) => (
                    <View key={i} style={[styles.dot, i === carouselIndex && styles.dotActive]} />
                  ))}
                </View>
              )}
            </>
          ) : (
            <View style={[styles.heroImage, styles.heroPlaceholder, { height: heroHeight }]}>
              <Feather name="image" size={36} color={Colors.needleGreen} style={{ opacity: 0.4 }} />
            </View>
          )}

          {/* Overlay controls */}
          <View style={styles.heroOverlay}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="Back to discovery"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="chevron-left" size={24} color={Colors.textInverse} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.heartBtn, isSaved && styles.heartBtnSaved]}
              onPress={(event) => {
                event.stopPropagation()
                void toggleSave()
              }}
              disabled={savingHeart}
              accessibilityRole="button"
              accessibilityLabel={isSaved ? 'Remove tailor from saved' : 'Save tailor'}
            >
              <Feather name="heart" size={19} color={isSaved ? Colors.textInverse : Colors.ink} />
            </TouchableOpacity>
          </View>

          {/* Photo count badge */}
          {heroSlides.length > 1 && (
            <View style={styles.photoCount}>
              <Feather name="image" size={12} color={Colors.textInverse} />
              <Text style={styles.photoCountText}>{carouselIndex + 1} of {heroSlides.length}</Text>
            </View>
          )}
        </View>

        {/* Profile body */}
        <View style={styles.body}>
          {/* Identity */}
          <View style={styles.identityRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{profile.displayName}</Text>
              <Text style={styles.location}>{dedupeLocation(profile.location)}</Text>
              <View style={styles.identityMetaRow}>
                <View style={styles.availabilityPill}>
                  <View style={[styles.availDot, { backgroundColor: AVAILABILITY_COLOR[profile.availability] ?? Colors.midGrey }]} />
                  <Text style={styles.availabilityPillText}>{AVAILABILITY_LABEL[profile.availability] ?? profile.availability}</Text>
                </View>
              </View>
            </View>
            <TierBadgeChip tier={toTierBadge(profile.tier)} size="lg" />
          </View>

          {profile.bio && (
            <View style={styles.aboutCard}>
              <Text style={styles.aboutLabel}>About</Text>
              <Text style={styles.bio}>{profile.bio}</Text>
            </View>
          )}

          {/* Stats row */}
          <View style={styles.statsRow}>
            <StatPill
              label="Reviews"
              value={reviewSummary.count > 0 ? reviewSummary.average.toFixed(1) : 'New'}
              subvalue={reviewSummary.count > 0 ? `${reviewSummary.count} review${reviewSummary.count === 1 ? '' : 's'}` : 'No reviews yet'}
              actionLabel={reviewSummary.count > 0 ? 'Read reviews' : undefined}
              onPress={() => setShowReviewsModal(true)}
            />
            <StatPill
              label="Orders"
              value={profile.totalOrders > 0 ? `${profile.totalOrders}+` : '0'}
              subvalue={profile.totalOrders > 0 ? 'Completed' : customOrdersPaused ? 'Unavailable' : 'No orders yet'}
            />
            <StatPill
              label="Photos"
              value={String(portfolioCount)}
              subvalue={portfolioCount > 0 ? 'Portfolio' : 'No uploads yet'}
              actionLabel={portfolioCount > 0 ? 'Open gallery' : undefined}
              onPress={openPortfolio}
            />
            <StatPill
              label="Styles"
              value={String(profile.specialtyTags.length)}
              subvalue={profile.specialtyTags.length > 0 ? 'Specialties' : 'No styles listed'}
              actionLabel={profile.specialtyTags.length > 0 ? 'View styles' : undefined}
              onPress={profile.specialtyTags.length > 0 ? () => setShowStylesModal(true) : undefined}
            />
          </View>

          {(priceLabel || profile.languages.length > 0) && (
            <View style={styles.detailGrid}>
              {priceLabel ? (
                <View style={styles.detailCard}>
                  <Text style={styles.detailLabel}>Typical price</Text>
                  <Text style={styles.detailValue}>{priceLabel}</Text>
                  {originalPriceLabel ? (
                    <Text style={styles.detailSubvalue}>Original range: {originalPriceLabel}</Text>
                  ) : null}
                </View>
              ) : null}
              {profile.languages.length > 0 ? (
                <View style={styles.detailCard}>
                  <Text style={styles.detailLabel}>Languages</Text>
                  <View style={styles.languageWrap}>
                    {profile.languages.slice(0, 4).map((language) => (
                      <View key={language} style={styles.languageChip}>
                        <Text style={styles.languageChipText}>{language}</Text>
                      </View>
                    ))}
                    {profile.languages.length > 4 ? (
                      <View style={styles.languageChip}>
                        <Text style={styles.languageChipText}>+{profile.languages.length - 4}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          )}

          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>Ways to order</Text>
            <View style={styles.languageWrap}>
              <View style={styles.languageChip}>
                <Text style={styles.languageChipText}>{profile.sellerType === 'BOUTIQUE' ? 'Boutique' : profile.sellerType === 'TAILOR_SHOP' ? 'Tailor shop' : 'Tailor'}</Text>
              </View>
              {profile.supportsCustomOrders ? (
                <View style={styles.languageChip}>
                  <Text style={styles.languageChipText}>Custom order</Text>
                </View>
              ) : null}
              {profile.supportsReadyMade ? (
                <View style={styles.languageChip}>
                  <Text style={styles.languageChipText}>Shop now</Text>
                </View>
              ) : null}
              {profile.pickupAvailable ? (
                <View style={styles.languageChip}>
                  <Text style={styles.languageChipText}>Pickup</Text>
                </View>
              ) : null}
              {profile.deliveryAvailable ? (
                <View style={styles.languageChip}>
                  <Text style={styles.languageChipText}>Delivery</Text>
                </View>
              ) : null}
              {profile.shippingAvailable ? (
                <View style={styles.languageChip}>
                  <Text style={styles.languageChipText}>Shipping</Text>
                </View>
              ) : null}
            </View>
          </View>

        </View>
      </ScrollView>

      <DrapeFloatingActionDock
        compactWidth={profile.supportsReadyMade && profile.supportsCustomOrders ? 132 : 76}
        compactOnScroll={!(profile.userId && user?.id && profile.userId === user.id)}
        testID="tailor-profile-actions"
      >
        {(compact) => profile.userId && user?.id && profile.userId === user.id ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 }}>
            <Text style={{ fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', fontFamily: Fonts.body }}>
              This is your tailor profile
            </Text>
          </View>
        ) : compact ? (
          <>
            {profile.supportsReadyMade ? (
              <DrapeIconButton
                icon="shopping-bag"
                accessibilityLabel="Shop now"
                tone="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/(customer)/tailor/shop/[id]',
                    params: {
                      id: profile.id,
                      returnTo: `/(customer)/tailor/${profile.id}`,
                      historyChain: appendToHistory(historyChain, `/(customer)/tailor/${profile.id}`),
                    },
                  })
                }
              />
            ) : null}
            {profile.supportsCustomOrders ? (
              <DrapeIconButton
                icon="scissors"
                accessibilityLabel={customOrdersPaused ? 'Custom orders paused' : 'Start custom order'}
                tone="primary"
                onPress={() => router.push({
                  pathname: '/(customer)/brief/[tailorId]',
                  params: {
                    tailorId: profile.id,
                    returnTo: `/(customer)/tailor/${profile.id}`,
                    historyChain: appendToHistory(historyChain, `/(customer)/tailor/${profile.id}`),
                    draftSession: createDraftSessionId(),
                    freshStart: '1',
                  },
                })}
                disabled={customOrdersPaused}
                testID="book-tailor-btn-compact"
              />
            ) : null}
          </>
        ) : (
          <>
            {profile.supportsReadyMade ? (
              <DrapeCapsuleButton
                label="Shop now"
                tone="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/(customer)/tailor/shop/[id]',
                    params: {
                      id: profile.id,
                      returnTo: `/(customer)/tailor/${profile.id}`,
                      historyChain: appendToHistory(historyChain, `/(customer)/tailor/${profile.id}`),
                    },
                  })
                }
                style={{ flex: 1 }}
              />
            ) : (
              <DrapeCapsuleButton
                label={customOrdersPaused ? 'Custom unavailable' : 'Message'}
                tone="secondary"
                onPress={() => {
                  if (customOrdersPaused) {
                    Alert.alert(
                      customOrdersFullyBooked ? 'Fully booked' : 'Custom orders paused',
                      customOrdersFullyBooked
                        ? `${profile.displayName} is fully booked for new custom briefs right now. You can still browse or check back later.`
                        : `${profile.displayName} is not taking new custom briefs right now. You can still browse or check back later.`
                    )
                    return
                  }

                  Alert.alert(
                    'Place an order first',
                    `Messages with ${profile.displayName} start once you place a custom order. Your order creates the conversation automatically.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Custom order',
                        onPress: () => router.push({
                          pathname: '/(customer)/brief/[tailorId]',
                          params: {
                            tailorId: profile.id,
                            returnTo: `/(customer)/tailor/${profile.id}`,
                            historyChain: appendToHistory(historyChain, `/(customer)/tailor/${profile.id}`),
                            draftSession: createDraftSessionId(),
                            freshStart: '1',
                          },
                        }),
                      },
                    ]
                  )
                }}
                style={{ flex: 1 }}
                disabled={customOrdersPaused}
              />
            )}
            {profile.supportsCustomOrders ? (
              <DrapeCapsuleButton
                label={customOrdersPaused ? 'Custom paused' : 'Custom order'}
                onPress={() => router.push({
                  pathname: '/(customer)/brief/[tailorId]',
                  params: {
                    tailorId: profile.id,
                    returnTo: `/(customer)/tailor/${profile.id}`,
                    historyChain: appendToHistory(historyChain, `/(customer)/tailor/${profile.id}`),
                    draftSession: createDraftSessionId(),
                    freshStart: '1',
                  },
                })}
                style={{ flex: profile.supportsReadyMade ? 1.35 : 1.6 }}
                disabled={customOrdersPaused}
                testID="book-tailor-btn"
              />
            ) : null}
          </>
        )}
      </DrapeFloatingActionDock>

      <WishlistPickerModal
        visible={wishlistPickerOpen}
        collections={wishlistCollections}
        newWishlistName={newWishlistName}
        saving={savingHeart}
        onChangeNewWishlistName={setNewWishlistName}
        onClose={() => {
          setWishlistPickerOpen(false)
          setNewWishlistName('')
        }}
        onSelect={(collectionId) => {
          void saveToWishlist({ collectionId })
        }}
        onCreate={() => {
          const name = newWishlistName.trim()
          if (!name) return
          void saveToWishlist({ collectionName: name })
        }}
      />

      <Modal
        visible={imagePreviewIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={closeImagePreview}
      >
        <View style={styles.previewBackdrop}>
          <TouchableOpacity style={styles.previewClose} onPress={closeImagePreview}>
            <Text style={styles.previewCloseText}>Close</Text>
          </TouchableOpacity>
          {imagePreviewIndex !== null && imagePreviewItems.length > 0 ? (
            <>
              <FlatList
                ref={imagePreviewRef}
                key={`image-preview-${imagePreviewIndex}`}
                data={imagePreviewItems}
                horizontal
                pagingEnabled
                initialScrollIndex={Math.min(imagePreviewIndex, Math.max(imagePreviewItems.length - 1, 0))}
                getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(event) => {
                  const nextIndex = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH)
                  setImageViewerIndex(nextIndex)
                }}
                initialNumToRender={imagePreviewItems.length}
                windowSize={Math.max(3, imagePreviewItems.length)}
                removeClippedSubviews={false}
                renderItem={({ item }) => {
                  const resolvedUri = resolveStorageImageUrl(item.uri, item.bucket)
                  const showFallback = !resolvedUri || failedPreviewImages.includes(resolvedUri)

                  return (
                    <View style={styles.previewSlide}>
                      {showFallback ? (
                        <View style={[styles.previewImage, styles.previewImageFallback]}>
                          <Feather name="image" size={34} color={Colors.needleGreen} />
                          <Text style={styles.previewImageFallbackText}>
                            This photo could not be loaded.
                          </Text>
                        </View>
                      ) : (
                        <RNImage
                          key={resolvedUri}
                          source={{ uri: resolvedUri }}
                          style={styles.previewImage}
                          resizeMode="contain"
                          onError={(error) => {
                            setFailedPreviewImages((current) =>
                              current.includes(resolvedUri) ? current : [...current, resolvedUri]
                            )
                            captureImageLoadFailure({
                              url: resolvedUri,
                              bucket: item.bucket,
                              surface: 'customer_tailor_portfolio_preview',
                              error,
                            })
                          }}
                        />
                      )}
                    </View>
                  )
                }}
              />
              {imagePreviewItems.length > 1 ? (
                <View style={styles.previewCount}>
                  <Text style={styles.previewCountText}>
                    {imageViewerIndex + 1} / {imagePreviewItems.length}
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </Modal>

      <Modal
        visible={!!previewVideoUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewVideoUrl(null)}
      >
        <View style={styles.previewBackdrop}>
          <TouchableOpacity style={styles.previewClose} onPress={() => setPreviewVideoUrl(null)}>
            <Text style={styles.previewCloseText}>Close</Text>
          </TouchableOpacity>
          {previewVideoUrl ? (
            <PortfolioVideoPreview
              uri={previewVideoUrl}
              style={styles.previewVideo}
              contentFit="contain"
              nativeControls
            />
          ) : null}
        </View>
      </Modal>

      <Modal visible={showPortfolioModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPortfolioModal(false)}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowPortfolioModal(false)}>
              <Text style={styles.modalClose}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Portfolio</Text>
            <View style={{ width: 48 }} />
          </View>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            {portfolioCount > 0 ? (
              <View style={styles.portfolioGrid}>
                {portfolioImageItems.map((item, index) => (
                  <TouchableOpacity
                    key={`${item.uri}`}
                    style={styles.portfolioTile}
                    activeOpacity={0.9}
                    onPress={() => openPortfolioPreview(portfolioImageItems, index)}
                  >
                    <RemoteImage
                      uri={item.uri}
                      bucket={item.bucket}
                      style={styles.portfolioTileImage}
                      contentFit="cover"
                      transition={120}
                      surface="customer_tailor_portfolio_grid"
                      fallback={(
                        <View style={[styles.portfolioTileImage, styles.heroPlaceholder]}>
                          <Feather name="image" size={22} color={Colors.midGrey} />
                        </View>
                      )}
                    />
                  </TouchableOpacity>
                ))}
                {portfolioVideos.map((url) => (
                  <TouchableOpacity
                    key={`${url}`}
                    style={[styles.portfolioTile, styles.portfolioVideoTile]}
                    activeOpacity={0.9}
                    onPress={() => openVideoPreview(url)}
                    accessibilityRole="button"
                    accessibilityLabel="Play portfolio video"
                  >
                    <PortfolioVideoPreview uri={url} style={styles.portfolioTileImage} autoplay={false} />
                    <View style={styles.portfolioVideoOverlay}>
                      <View style={styles.portfolioVideoIcon}>
                        <Feather name="play" size={20} color={Colors.textInverse} />
                      </View>
                      <Text style={styles.portfolioVideoText}>Video</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={styles.emptyReviewCard}>
                <Feather name="image" size={34} color={Colors.lightGrey} style={styles.emptyPortfolioIcon} />
                <Text style={styles.emptyReviewTitle}>No portfolio yet</Text>
                <Text style={styles.emptyReviewHint}>
                  This seller has not uploaded work samples yet. Check styles, reviews, and ways to order before deciding.
                </Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showStylesModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowStylesModal(false)}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowStylesModal(false)}>
              <Text style={styles.modalClose}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Styles</Text>
            <View style={{ width: 48 }} />
          </View>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.styleGrid}>
              {profile.specialtyTags.map((tag) => <Tag key={tag} label={tag} />)}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showReviewsModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowReviewsModal(false)}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowReviewsModal(false)}>
              <Text style={styles.modalClose}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Reviews</Text>
            <View style={{ width: 48 }} />
          </View>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            {reviews.length > 0 ? (
              <>
                <View style={styles.ratingBreakdownCard}>
                  <View>
                    <Text style={styles.ratingBreakdownValue}>{reviewSummary.average.toFixed(1)}</Text>
                    <StarRating rating={reviewSummary.average} count={reviewSummary.count} />
                  </View>
                  <View style={styles.ratingBreakdownRows}>
                    {reviewBreakdown.map((row) => (
                      <View key={row.rating} style={styles.ratingBreakdownRow}>
                        <Text style={styles.ratingBreakdownLabel}>{row.rating}</Text>
                        <View style={styles.ratingBreakdownTrack}>
                          <View style={[styles.ratingBreakdownFill, { width: `${Math.round(row.percent * 100)}%` }]} />
                        </View>
                        <Text style={styles.ratingBreakdownPercent}>{Math.round(row.percent * 100)}%</Text>
                      </View>
                    ))}
                  </View>
                </View>
                {reviews.map((r) => (
                  <ReviewCard
                    key={r.id}
                    review={r}
                    onOpenImages={(items, index) => openImagePreview(items, index)}
                    onOpenVideo={openVideoPreview}
                  />
                ))}
              </>
            ) : (
              <View style={styles.emptyReviewCard}>
                <Text style={styles.emptyReviewTitle}>No reviews yet</Text>
                <Text style={styles.emptyReviewHint}>
                  {profile.totalOrders > 0
                    ? 'This seller is still waiting on their first Drapeon review.'
                    : 'Be among the first customers to order from this seller on Drapeon.'}
                </Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

function StatPill({
  label,
  value,
  subvalue,
  actionLabel,
  onPress,
}: {
  label: string
  value: string
  subvalue?: string
  actionLabel?: string
  onPress?: () => void
}) {
  const content = (
    <View style={styles.statContent}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {subvalue ? <Text style={styles.statSubvalue}>{subvalue}</Text> : null}
      {actionLabel ? (
        <View style={styles.statActionBadge}>
          <Text style={styles.statActionText}>{actionLabel}</Text>
        </View>
      ) : null}
    </View>
  )

  if (onPress) {
    return (
      <TouchableOpacity
        style={[styles.statPill, styles.statPillInteractive]}
        onPress={onPress}
        activeOpacity={0.82}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={actionLabel ? `${actionLabel} ${label.toLowerCase()}` : label}
      >
        {content}
      </TouchableOpacity>
    )
  }

  return <View style={styles.statPill}>{content}</View>
}

function ReviewCard({
  review,
  onOpenImages,
  onOpenVideo,
}: {
  review: Review
  onOpenImages: (items: MediaPreviewItem[], index: number) => void
  onOpenVideo: (url: string) => void
}) {
  const name = review.reviewerName
  const initial = name.split(' ').map((p) => p[0]).slice(0, 2).join('')
  const date = new Date(review.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  const imageItems = review.mediaUrls
    .filter((url) => !isVideoMediaUrl(url))
    .map((url) => ({ uri: url, bucket: 'review-media' as const }))

  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        {review.reviewerAvatarUrl ? (
          <AvatarImage
            uri={review.reviewerAvatarUrl}
            initials={initial}
            size={40}
            style={styles.reviewAvatarImage}
          />
        ) : (
          <View style={styles.reviewAvatar}>
            <Text style={styles.reviewInitial}>{initial}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.reviewerName}>{name}</Text>
          <Text style={styles.reviewDate}>{date}</Text>
        </View>
        <StarRating rating={review.rating} />
      </View>
      {review.body && <Text style={styles.reviewBody}>{review.body}</Text>}
      {review.mediaUrls.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reviewMediaRow}>
          {review.mediaUrls.map((url) => {
            const isVideo = isVideoMediaUrl(url)
            const resolvedUri = resolveStorageImageUrl(url, 'review-media') ?? url
            const imageIndex = imageItems.findIndex((item) => item.uri === url)
            return (
              <TouchableOpacity
                key={url}
                style={styles.reviewMediaThumbWrap}
                activeOpacity={0.84}
                onPress={() => {
                  if (isVideo) onOpenVideo(url)
                  else onOpenImages(imageItems, Math.max(imageIndex, 0))
                }}
              >
                {isVideo ? (
                  <>
                    <PortfolioVideoPreview uri={resolvedUri} style={styles.reviewMediaThumb} autoplay={false} />
                    <View style={styles.reviewVideoBadge}>
                      <Feather name="play" size={12} color={Colors.textInverse} />
                    </View>
                  </>
                ) : (
                  <RNImage source={{ uri: resolvedUri }} style={styles.reviewMediaThumb} resizeMode="cover" />
                )}
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      ) : null}
      {review.tags.length > 0 && (
        <View style={styles.reviewTags}>
          {review.tags.map((t) => <Tag key={t} label={t} />)}
        </View>
      )}
      {review.response ? (
        <View style={styles.responseWrap}>
          <Text style={styles.responseLabel}>Tailor response</Text>
          <Text style={styles.responseText}>{review.response}</Text>
        </View>
      ) : null}
    </View>
  )
}

function WishlistPickerModal({
  visible,
  collections,
  newWishlistName,
  saving,
  onChangeNewWishlistName,
  onClose,
  onSelect,
  onCreate,
}: {
  visible: boolean
  collections: Array<{ id: string; name: string; itemCount: number }>
  newWishlistName: string
  saving: boolean
  onChangeNewWishlistName: (value: string) => void
  onClose: () => void
  onSelect: (collectionId: string) => void
  onCreate: () => void
}) {
  return (
    <SaveToWishlistSheet
      visible={visible}
      collections={collections}
      newWishlistName={newWishlistName}
      saving={saving}
      createPlaceholder="e.g. December Wedding"
      onChangeNewWishlistName={onChangeNewWishlistName}
      onClose={onClose}
      onSelect={onSelect}
      onCreate={onCreate}
    />
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    gap: Spacing.md,
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
  skLoadHero: {
    width: SCREEN_WIDTH,
    height: HERO_HEIGHT,
    borderRadius: 0,
  },
  skLoadBody: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  skLoadIdentityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.md,
    ...Shadow.md,
  },
  skLoadAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  skLoadNameCol: {
    flex: 1,
    gap: 8,
  },
  skLoadName: {
    width: '60%',
    height: 20,
  },
  skLoadLocationLine: {
    width: '38%',
    height: 13,
  },
  skLoadStatsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  skLoadStat: {
    flex: 1,
    height: 58,
  },
  skLoadBioBlock: {
    gap: Spacing.xs,
    paddingTop: Spacing.xs,
  },
  skLoadBioLine1: {
    width: '90%',
    height: 14,
  },
  skLoadBioLine2: {
    width: '76%',
    height: 14,
  },
  skLoadBioLine3: {
    width: '54%',
    height: 14,
  },
  skLoadPortfolioRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingTop: Spacing.xs,
  },
  skLoadPortfolioThumb: {
    flex: 1,
    height: PORTFOLIO_SIZE * PORTFOLIO_TILE_RATIO,
    borderRadius: Radius.sm,
  },
  stateGuideCard: {
    alignSelf: 'stretch',
    backgroundColor: Colors.bone,
    borderRadius: Radius.md,
    padding: 14,
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
  scroll: { flex: 1 },
  modalSafe: { flex: 1, backgroundColor: Colors.bone },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
  },
  modalClose: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  modalTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  modalScroll: { flex: 1 },
  modalContent: { padding: Spacing.lg, gap: Spacing.xs, paddingBottom: Spacing.xl },
  portfolioGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  portfolioTile: {
    width: PORTFOLIO_SIZE,
    height: PORTFOLIO_SIZE * PORTFOLIO_TILE_RATIO,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.lightGrey,
  },
  portfolioTileImage: { width: '100%', height: '100%' },
  portfolioVideoTile: {
    backgroundColor: Colors.ink,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  portfolioVideoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  portfolioVideoIcon: {
    width: 46,
    height: 46,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portfolioVideoText: {
    fontSize: FontSize.xs,
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  // Hero carousel
  heroContainer: { width: SCREEN_WIDTH, height: HERO_HEIGHT, position: 'relative' },
  heroImage: { width: SCREEN_WIDTH, height: HERO_HEIGHT },
  heroPlaceholder: { backgroundColor: Colors.boneDeep, alignItems: 'center', justifyContent: 'center' },
  heroOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingTop: Spacing.md, paddingHorizontal: Spacing.lg,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.needleGreen,
    alignItems: 'center', justifyContent: 'center',
  },
  heartBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  heartBtnSaved: {
    backgroundColor: Colors.needleGreen,
  },
  dotRow: {
    position: 'absolute', bottom: 12, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive: { backgroundColor: Colors.white, width: 18 },
  photoCount: {
    position: 'absolute', bottom: 12, right: Spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  photoCountText: { fontSize: FontSize.xs, color: Colors.textInverse, fontWeight: FontWeight.semibold },

  body: { padding: Spacing.lg, gap: Spacing.md, marginTop: -Spacing.md },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    ...Shadow.md,
  },
  name: { fontSize: 24, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display, lineHeight: 28 },
  location: { fontSize: FontSize.sm, color: Colors.midGrey, marginTop: 2 },
  identityMetaRow: { marginTop: Spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  availDot: { width: 8, height: 8, borderRadius: 4 },
  availabilityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.bone,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  availabilityPillText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },

  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 8,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  statPill: {
    width: '50%',
    backgroundColor: 'transparent',
    borderRadius: Radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'stretch',
    gap: 2,
  },
  statContent: {
    width: '100%',
    minHeight: 50,
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 2,
  },
  statPillInteractive: {
    backgroundColor: 'transparent',
  },
  statValue: { fontSize: 16, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'left' },
  statSubvalue: { fontSize: 11, color: Colors.midGrey, fontWeight: FontWeight.medium, textAlign: 'left' },
  statLabel: { fontSize: 11, color: Colors.ink, fontWeight: FontWeight.semibold, textAlign: 'left' },
  statActionBadge: {
    marginTop: 1,
    borderRadius: Radius.full,
    paddingVertical: 0,
    backgroundColor: 'transparent',
  },
  statActionText: {
    fontSize: 11,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0,
  },

  styleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    ...Shadow.sm,
  },
  detailGrid: { gap: Spacing.sm },
  detailCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  detailLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  detailValue: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.semibold },
  detailSubvalue: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  languageWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  languageChip: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  languageChipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },

  bio: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 19 },
  aboutCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  aboutLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  reviewCard: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: 12, gap: Spacing.xs, ...Shadow.sm,
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  reviewAvatar: {
    width: 40, height: 40, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center',
  },
  reviewAvatarImage: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.lightGrey },
  reviewInitial: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  reviewerName: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  reviewDate: { fontSize: FontSize.xs, color: Colors.midGrey },
  reviewBody: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  reviewTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reviewMediaRow: { gap: Spacing.sm, paddingTop: Spacing.sm, paddingRight: Spacing.md },
  reviewMediaThumbWrap: { width: 84, height: 84, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: Colors.boneDeep },
  reviewMediaThumb: { width: '100%', height: '100%' },
  reviewVideoBadge: { position: 'absolute', right: 6, bottom: 6, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.58)' },
  ratingBreakdownCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  ratingBreakdownValue: { fontSize: 34, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  ratingBreakdownRows: { gap: 6 },
  ratingBreakdownRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ratingBreakdownLabel: { width: 14, fontSize: FontSize.xs, color: Colors.ink, fontWeight: FontWeight.semibold },
  ratingBreakdownTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: Colors.boneDeep, overflow: 'hidden' },
  ratingBreakdownFill: { height: '100%', borderRadius: 4, backgroundColor: Colors.needleGreen },
  ratingBreakdownPercent: { width: 36, textAlign: 'right', fontSize: FontSize.xs, color: Colors.midGrey },
  responseWrap: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '35',
    gap: 4,
  },
  responseLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  responseText: { fontSize: FontSize.sm, color: Colors.ink, lineHeight: 20 },
  emptyReviewCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  emptyPortfolioIcon: { marginBottom: Spacing.sm },
  emptyReviewTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyReviewHint: { fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 20 },

  cta: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 8,
    backgroundColor: Colors.white, paddingHorizontal: Spacing.lg, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: Colors.lightGrey,
    paddingBottom: 8,
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewSlide: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: 96,
    paddingBottom: 96,
  },
  previewImage: {
    width: SCREEN_WIDTH - Spacing.lg * 2,
    height: PREVIEW_MEDIA_HEIGHT,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  previewImageFallback: {
    backgroundColor: Colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.lg,
  },
  previewImageFallbackText: {
    color: Colors.ink,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },
  previewVideo: {
    width: SCREEN_WIDTH - Spacing.lg * 2,
    height: PREVIEW_MEDIA_HEIGHT,
  },
  refreshingText: { fontSize: FontSize.xs, color: Colors.midGrey, paddingHorizontal: Spacing.xl, marginBottom: Spacing.sm },
  previewClose: {
    position: 'absolute',
    top: 56,
    right: Spacing.lg,
    zIndex: 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  previewCloseText: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  previewCount: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  previewCountText: { color: Colors.textInverse, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
})
