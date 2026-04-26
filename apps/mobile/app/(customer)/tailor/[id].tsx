import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  FlatList, ActivityIndicator, Alert, Dimensions, NativeSyntheticEvent, NativeScrollEvent, Modal,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image as ExpoImage } from 'expo-image'
import { Feather } from '@expo/vector-icons'
import { useRefreshOnFocus, useTailorPublic } from '@/lib/queries'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { useCurrency, formatAmount } from '@/lib/currency'
import { TierBadgeChip, StarRating, Tag, Button } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { AvatarImage } from '@/components/ui/AvatarImage'
import { goBackOrFallback } from '@/lib/navigation'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const HERO_HEIGHT = 264
const PORTFOLIO_COLS = 3
const PORTFOLIO_SIZE = (SCREEN_WIDTH - Spacing.lg * 2 - Spacing.sm * 2) / PORTFOLIO_COLS

type TailorProfile = {
  id: string
  displayName: string
  location: string
  tier: string
  sellerType: 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP'
  avgRating: number
  totalReviews: number
  totalOrders: number
  avgResponseHours: number | null
  availability: string
  bio: string | null
  specialtyTags: string[]
  languages: string[]
  priceRangeMin: number | null
  priceRangeMax: number | null
  portfolioPhotos: string[]
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
  createdAt: string
}

type ReviewSummary = {
  average: number
  count: number
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

export default function TailorProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const scrollRef = useRef<ScrollView | null>(null)
  const portfolioPreviewRef = useRef<FlatList<string> | null>(null)
  const [savedOverride, setSavedOverride] = useState<boolean | null>(null)
  const [savingHeart, setSavingHeart] = useState(false)
  const [carouselIndex, setCarouselIndex] = useState(0)
  const [failedHeroImages, setFailedHeroImages] = useState<string[]>([])
  const [portfolioPreviewIndex, setPortfolioPreviewIndex] = useState<number | null>(null)
  const [portfolioViewerIndex, setPortfolioViewerIndex] = useState(0)
  const [showPortfolioModal, setShowPortfolioModal] = useState(false)
  const [showReviewsModal, setShowReviewsModal] = useState(false)
  const [showStylesModal, setShowStylesModal] = useState(false)
  const { currency, rates } = useCurrency()
  const {
    data,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useTailorPublic(id, user?.id)
  const profile = (data?.profile ?? null) as TailorProfile | null
  const reviews = (data?.reviews ?? []) as Review[]
  const isSaved = savedOverride ?? data?.isSaved ?? false

  useRefreshOnFocus(() => { void refetch() }, 60_000)

  useEffect(() => {
    setFailedHeroImages([])
  }, [id])

  useEffect(() => {
    setSavedOverride(null)
  }, [id, data?.isSaved])

  async function toggleSave() {
    if (!user?.id || savingHeart) return
    setSavingHeart(true)
    try {
      if (isSaved) {
        const { error } = await invokeFunction('saved-tailor-action', {
          body: { action: 'unsave-by-profile', tailorProfileId: id },
        })
        if (error) throw error
        setSavedOverride(false)
      } else {
        const { error } = await invokeFunction('saved-tailor-action', {
          body: { action: 'save', tailorProfileId: id },
        })
        if (error) throw error
        setSavedOverride(true)
      }
    } catch (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not update your saved tailors yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not update your saved tailors right now. Please try again in a moment.')
      Alert.alert('Error', message)
    } finally {
      setSavingHeart(false)
    }
  }

  function onCarouselScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH)
    setCarouselIndex(index)
  }

  function goBack() {
    goBackOrFallback(router, navigation, '/(customer)')
  }

  function openPortfolio() {
    setShowPortfolioModal(true)
  }

  function openPortfolioPreview(index: number) {
    setShowPortfolioModal(false)
    setPortfolioViewerIndex(index)
    setTimeout(() => setPortfolioPreviewIndex(index), 150)
  }

  if (isLoading && !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Seller profile</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading this profile…</Text>
            <Text style={styles.stateHint}>
              We’re pulling together the profile, portfolio, and trust signals so you can decide clearly.
            </Text>
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
            <Text style={styles.stateEyebrow}>Seller profile</Text>
            <Text style={styles.stateTitle}>Couldn't load this profile.</Text>
            <Text style={styles.stateHint}>
              This page should help you judge whether this seller feels right before you place an order.
            </Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Best recovery move</Text>
              <Text style={styles.stateGuideText}>
                Refresh here first. If it still fails, go back to discovery and compare a few other live profiles.
              </Text>
            </View>
            <Button label="Try again" onPress={() => { void refetch() }} variant="secondary" />
            <Button label="Explore sellers" onPress={() => router.replace('/(customer)')} variant="secondary" />
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
            <Text style={styles.stateEyebrow}>Seller profile</Text>
            <Text style={styles.stateTitle}>Profile not found.</Text>
            <Text style={styles.stateHint}>
              This profile may have moved, or it may no longer be available to browse right now.
            </Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Best recovery move</Text>
              <Text style={styles.stateGuideText}>
                Head back to discovery and reopen a live seller from there. If this was an older saved link, your wishlist or search results should point you to the current profile.
              </Text>
            </View>
            <Button label="Explore sellers" onPress={() => router.replace('/(customer)')} variant="secondary" />
            <Button label="Go back" onPress={goBack} variant="secondary" />
          </View>
        </View>
      </SafeAreaView>
    )
  }

  const portfolioImages = Array.from(new Set(profile.portfolioPhotos.filter((url) => typeof url === 'string' && url.length > 0)))
  const heroImages = portfolioImages.filter((url) => !failedHeroImages.includes(url))
  const priceLabel = (profile.priceRangeMin && profile.priceRangeMax)
    ? `${formatAmount(profile.priceRangeMin, 'USD', currency, rates)} to ${formatAmount(profile.priceRangeMax, 'USD', currency, rates)}`
    : null
  const isFullyBooked = profile.availability === 'FULLY_BOOKED'
  const portfolioCount = profile.portfolioPhotos.length
  const reviewSummary: ReviewSummary = {
    average: reviews.length > 0 ? reviews.reduce((sum, row) => sum + row.rating, 0) / reviews.length : profile.avgRating,
    count: reviews.length > 0 ? reviews.length : profile.totalReviews,
  }

  return (
      <SafeAreaView style={styles.safe} edges={[]}>
      <ScrollView ref={scrollRef} style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {isFetching ? <Text style={styles.refreshingText}>Refreshing profile…</Text> : null}

        {/* Swipeable Hero Carousel */}
        <View style={styles.heroContainer}>
          {heroImages.length > 0 ? (
            <>
              <FlatList
                data={heroImages}
                keyExtractor={(_, i) => String(i)}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={onCarouselScroll}
                scrollEventThrottle={16}
                renderItem={({ item }) => (
                  <ExpoImage
                    source={item}
                    style={styles.heroImage}
                    contentFit="cover"
                    transition={150}
                    onError={() => {
                      setFailedHeroImages((prev) => (prev.includes(item) ? prev : [...prev, item]))
                    }}
                  />
                )}
              />
              {/* Dot indicators */}
              {heroImages.length > 1 && (
                <View style={styles.dotRow}>
                  {heroImages.map((_, i) => (
                    <View key={i} style={[styles.dot, i === carouselIndex && styles.dotActive]} />
                  ))}
                </View>
              )}
            </>
          ) : (
            <View style={[styles.heroImage, styles.heroPlaceholder]}>
              <Text style={styles.heroEmoji}>🧵</Text>
            </View>
          )}

          {/* Overlay controls */}
          <View style={styles.heroOverlay}>
            <TouchableOpacity style={styles.backBtn} onPress={goBack}>
              <Text style={styles.backBtnText}>←</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.heartBtn}
              onPress={(event) => {
                event.stopPropagation()
                void toggleSave()
              }}
              disabled={savingHeart}
            >
              <Text style={styles.heartBtnText}>{isSaved ? '❤️' : '🤍'}</Text>
            </TouchableOpacity>
          </View>

          {/* Photo count badge */}
          {heroImages.length > 1 && (
            <View style={styles.photoCount}>
              <Text style={styles.photoCountText}>{carouselIndex + 1} / {heroImages.length}</Text>
            </View>
          )}
        </View>

        {/* Profile body */}
        <View style={styles.body}>
          {/* Identity */}
          <View style={styles.identityRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{profile.displayName}</Text>
              <Text style={styles.location}>{profile.location}</Text>
              <View style={styles.identityMetaRow}>
                <View style={styles.availabilityPill}>
                  <View style={[styles.availDot, { backgroundColor: AVAILABILITY_COLOR[profile.availability] ?? Colors.midGrey }]} />
                  <Text style={styles.availabilityPillText}>{AVAILABILITY_LABEL[profile.availability] ?? profile.availability}</Text>
                </View>
              </View>
            </View>
            <TierBadgeChip tier={profile.tier as any} size="lg" />
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
              label={reviewSummary.count > 0 ? `${reviewSummary.count} review${reviewSummary.count === 1 ? '' : 's'}` : 'No reviews yet'}
              value={reviewSummary.count > 0 ? reviewSummary.average.toFixed(1) : 'No rating'}
              subvalue={reviewSummary.count > 0 ? '★'.repeat(Math.round(reviewSummary.average)).padEnd(5, '☆') : '☆☆☆☆☆'}
              onPress={() => setShowReviewsModal(true)}
            />
            <StatPill
              label="Orders"
              value={`${profile.totalOrders}+`}
              subvalue={isFullyBooked ? 'Fully booked' : (AVAILABILITY_LABEL[profile.availability] ?? profile.availability)}
            />
            <StatPill
              label="Portfolio"
              value={String(portfolioCount)}
              subvalue={portfolioCount > 0 ? 'View work' : 'No uploads yet'}
              onPress={openPortfolio}
            />
            <StatPill
              label="Styles"
              value={String(profile.specialtyTags.length)}
              subvalue={profile.specialtyTags.length > 0 ? 'What they make' : 'No styles listed'}
              onPress={profile.specialtyTags.length > 0 ? () => setShowStylesModal(true) : undefined}
            />
          </View>

          {(priceLabel || profile.languages.length > 0) && (
            <View style={styles.detailGrid}>
              {priceLabel ? (
                <View style={styles.detailCard}>
                  <Text style={styles.detailLabel}>Typical price</Text>
                  <Text style={styles.detailValue}>{priceLabel}</Text>
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

      {/* Sticky CTA */}
      <View style={styles.cta}>
        {profile.supportsReadyMade ? (
          <Button
            label="Shop now"
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: '/(customer)/tailor/shop/[id]',
                params: { id: profile.id, returnTo: `/(customer)/tailor/${profile.id}` },
              })
            }
            style={{ flex: 1 }}
          />
        ) : (
          <Button
            label={isFullyBooked ? 'Currently unavailable' : 'Message'}
            variant="secondary"
            onPress={() => {
              if (isFullyBooked) {
                Alert.alert(
                  'Currently unavailable',
                  `${profile.displayName} is fully booked right now. Please check back later or explore other sellers.`
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
                      pathname: `/(customer)/brief/${profile.id}` as any,
                      params: { returnTo: `/(customer)/tailor/${profile.id}` },
                    }),
                  },
                ]
              )
            }}
            style={{ flex: 1 }}
            disabled={isFullyBooked}
          />
        )}
        {profile.supportsCustomOrders ? (
          <Button
            label={isFullyBooked ? 'Fully booked' : 'Custom order'}
            onPress={() => router.push({
              pathname: `/(customer)/brief/${profile.id}` as any,
              params: { returnTo: `/(customer)/tailor/${profile.id}` },
            })}
            style={{ flex: profile.supportsReadyMade ? 1.35 : 1.6 }}
            disabled={isFullyBooked}
            testID="book-tailor-btn"
          />
        ) : null}
      </View>

      <Modal
        visible={portfolioPreviewIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPortfolioPreviewIndex(null)}
      >
        <View style={styles.previewBackdrop}>
          <TouchableOpacity style={styles.previewClose} onPress={() => setPortfolioPreviewIndex(null)}>
            <Text style={styles.previewCloseText}>Close</Text>
          </TouchableOpacity>
          {portfolioPreviewIndex !== null && portfolioImages.length > 0 ? (
            <>
              <FlatList
                ref={portfolioPreviewRef}
                key={`portfolio-preview-${portfolioPreviewIndex}`}
                data={portfolioImages}
                horizontal
                pagingEnabled
                initialScrollIndex={Math.min(portfolioPreviewIndex, Math.max(portfolioImages.length - 1, 0))}
                getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(event) => {
                  const nextIndex = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH)
                  setPortfolioViewerIndex(nextIndex)
                }}
                renderItem={({ item }) => (
                  <View style={styles.previewSlide}>
                    <ExpoImage source={item} style={styles.previewImage} contentFit="contain" transition={150} />
                  </View>
                )}
              />
              {portfolioImages.length > 1 ? (
                <View style={styles.previewCount}>
                  <Text style={styles.previewCountText}>
                    {portfolioViewerIndex + 1} / {portfolioImages.length}
                  </Text>
                </View>
              ) : null}
            </>
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
            {portfolioImages.length > 0 ? (
              <View style={styles.portfolioGrid}>
                {portfolioImages.map((url) => (
                  <TouchableOpacity
                    key={`${url}`}
                    style={styles.portfolioTile}
                    activeOpacity={0.9}
                    onPress={() => openPortfolioPreview(portfolioImages.indexOf(url))}
                  >
                    <ExpoImage source={url} style={styles.portfolioTileImage} contentFit="cover" transition={120} />
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
              reviews.map((r) => <ReviewCard key={r.id} review={r} />)
            ) : (
              <View style={styles.emptyReviewCard}>
                <Text style={styles.emptyReviewTitle}>No reviews yet</Text>
                <Text style={styles.emptyReviewHint}>
                  {profile.totalOrders > 0
                    ? 'This seller is still waiting on their first Drape review.'
                    : 'Be among the first customers to order from this seller on Drape.'}
                </Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

function StatPill({ label, value, subvalue, onPress }: { label: string; value: string; subvalue?: string; onPress?: () => void }) {
  const content = (
    <View style={styles.statContent}>
      {onPress ? (
        <View style={styles.statTapHintWrap}>
          <Text style={styles.statTapHint}>Open</Text>
        </View>
      ) : null}
      <Text style={styles.statValue}>{value}</Text>
      {subvalue ? <Text style={styles.statSubvalue}>{subvalue}</Text> : null}
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )

  if (onPress) {
    return (
      <TouchableOpacity
        style={[styles.statPill, styles.statPillInteractive]}
        onPress={onPress}
        activeOpacity={0.82}
        hitSlop={8}
      >
        {content}
      </TouchableOpacity>
    )
  }

  return <View style={styles.statPill}>{content}</View>
}

function ReviewCard({ review }: { review: Review }) {
  const name = review.reviewerName
  const initial = name.split(' ').map((p) => p[0]).slice(0, 2).join('')
  const date = new Date(review.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

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
  modalTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  modalScroll: { flex: 1 },
  modalContent: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  portfolioGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  portfolioTile: {
    width: PORTFOLIO_SIZE,
    height: PORTFOLIO_SIZE,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.lightGrey,
  },
  portfolioTileImage: { width: '100%', height: '100%' },
  decisionGuideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  decisionGuideTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  decisionGuideText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },

  // Hero carousel
  heroContainer: { width: SCREEN_WIDTH, height: HERO_HEIGHT, position: 'relative' },
  heroImage: { width: SCREEN_WIDTH, height: HERO_HEIGHT },
  heroPlaceholder: { backgroundColor: Colors.boneDeep, alignItems: 'center', justifyContent: 'center' },
  heroEmoji: { fontSize: 64 },
  heroOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingTop: 52, paddingHorizontal: Spacing.lg,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  backBtnText: { fontSize: 18, color: Colors.ink },
  heartBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  heartBtnText: { fontSize: 18 },
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
  },
  photoCountText: { fontSize: FontSize.xs, color: Colors.white, fontWeight: FontWeight.semibold },

  body: { padding: Spacing.lg, gap: Spacing.lg, marginTop: -Spacing.lg },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 16,
    ...Shadow.md,
  },
  name: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },
  location: { fontSize: FontSize.sm, color: Colors.midGrey, marginTop: 2 },
  identityMetaRow: { marginTop: Spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  availRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: -Spacing.md, marginBottom: -Spacing.sm },
  availDot: { width: 8, height: 8, borderRadius: 4 },
  availText: { fontSize: FontSize.sm, color: Colors.inkLight },
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

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statPill: {
    width: '48%',
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  statContent: {
    width: '100%',
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  statPillInteractive: {
    borderColor: Colors.needleGreen,
  },
  statPillPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: Colors.needleGreenLight,
  },
  statTapHintWrap: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statTapHint: {
    fontSize: 10,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statValue: { fontSize: 15, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  statSubvalue: { fontSize: FontSize.xs, color: Colors.warning, fontWeight: FontWeight.semibold, textAlign: 'center' },
  statLabel: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'center' },

  section: { gap: Spacing.sm },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  styleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    ...Shadow.sm,
  },
  detailGrid: { gap: Spacing.sm },
  detailCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
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
  languageWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  languageChip: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  languageChipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },

  bio: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  aboutCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 16,
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
    padding: 14, gap: Spacing.sm, ...Shadow.sm,
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
  responseWrap: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.md,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: Colors.needleGreen,
    gap: 4,
  },
  responseLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  responseText: { fontSize: FontSize.sm, color: Colors.ink, lineHeight: 20 },
  emptyReviewCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  emptyReviewBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  emptyReviewBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  emptyPortfolioIcon: { marginBottom: Spacing.sm },
  emptyReviewTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyReviewHint: { fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 20 },

  cta: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 8,
    backgroundColor: Colors.white, paddingHorizontal: Spacing.lg, paddingTop: 12,
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  previewImage: { width: SCREEN_WIDTH - Spacing.lg * 2, height: '82%' },
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
  previewCloseText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  previewCount: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  previewCountText: { color: Colors.white, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
})
