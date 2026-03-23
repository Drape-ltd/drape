import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, FlatList, ActivityIndicator, Alert, Dimensions, NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useCurrency, formatAmount } from '@/lib/currency'
import { TierBadgeChip, StarRating, Tag, Button } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const HERO_HEIGHT = 320
const PORTFOLIO_COLS = 3
const PORTFOLIO_SIZE = (SCREEN_WIDTH - Spacing.xl * 2 - Spacing.sm * 2) / PORTFOLIO_COLS

type TailorProfile = {
  id: string
  displayName: string
  location: string
  tier: string
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
}

type Review = {
  id: string
  rating: number
  body: string | null
  tags: string[]
  reviewerName: string
  createdAt: string
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
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
  const { user } = useAuth()
  const [profile, setProfile] = useState<TailorProfile | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [savingHeart, setSavingHeart] = useState(false)
  const [carouselIndex, setCarouselIndex] = useState(0)
  const [failedHeroImages, setFailedHeroImages] = useState<string[]>([])
  const { currency, rates } = useCurrency()

  async function load() {
    setFetchError(false)
    setLoading(true)
    setProfile(null)
    setReviews([])
    setIsSaved(false)
    setFailedHeroImages([])
    try {
      const [profileRes, reviewsRes, savedRes] = await Promise.allSettled([
        supabase
          .from('tailor_profiles')
          .select('id, display_name, location, tier, avg_rating, total_reviews, total_orders, avg_response_hours, availability, bio, specialty_tags, languages, price_range_min, price_range_max, portfolio_photo_urls')
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('reviews')
          .select('id, rating, body, tags, created_at, reviewer_name')
          .eq('tailor_id', id)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('saved_tailors')
          .select('id')
          .eq('user_id', user?.id)
          .eq('tailor_profile_id', id)
          .maybeSingle(),
      ])

      const profileData =
        profileRes.status === 'fulfilled' && !profileRes.value.error
          ? (profileRes.value.data as any)
          : null
      const profileError =
        profileRes.status === 'fulfilled'
          ? profileRes.value.error
          : profileRes.reason
      const reviewsData =
        reviewsRes.status === 'fulfilled' && !reviewsRes.value.error
          ? ((reviewsRes.value.data ?? []) as any[])
          : []
      const savedData =
        savedRes.status === 'fulfilled' && !savedRes.value.error
          ? savedRes.value.data
          : null

      if (profileError) {
        setProfile(null)
        setFetchError(true)
      } else if (profileData) {
        const d = profileData
        setProfile({
          id: d.id,
          displayName: d.display_name,
          location: d.location,
          tier: d.tier,
          avgRating: d.avg_rating,
          totalReviews: d.total_reviews,
          totalOrders: d.total_orders,
          avgResponseHours: d.avg_response_hours,
          availability: d.availability,
          bio: d.bio,
          specialtyTags: asStringList(d.specialty_tags),
          languages: asStringList(d.languages),
          priceRangeMin: d.price_range_min,
          priceRangeMax: d.price_range_max,
          portfolioPhotos: asStringList(d.portfolio_photo_urls),
        })
      } else {
        setProfile(null)
      }

      setReviews(
        reviewsData.map((r: any) => ({
          id: r.id,
          rating: r.rating,
          body: r.body,
          tags: asStringList(r.tags),
          reviewerName: r.reviewer_name ?? 'Customer',
          createdAt: r.created_at,
        }))
      )

      setIsSaved(!!savedData)
      setLoading(false)
    } catch {
      setFetchError(true)
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [id, user?.id])

  async function toggleSave() {
    if (!user?.id || savingHeart) return
    setSavingHeart(true)
    try {
      if (isSaved) {
        const { error } = await supabase
          .from('saved_tailors')
          .delete()
          .eq('user_id', user.id)
          .eq('tailor_profile_id', id)
        if (error) throw error
        setIsSaved(false)
      } else {
        const { error } = await supabase
          .from('saved_tailors')
          .insert({ user_id: user.id, tailor_profile_id: id })
        if (error) throw error
        setIsSaved(true)
      }
    } catch {
      Alert.alert('Error', 'Could not update your saved tailors. Please try again.')
    } finally {
      setSavingHeart(false)
    }
  }

  function onCarouselScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH)
    setCarouselIndex(index)
  }

  function goBack() {
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace('/(customer)')
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Tailor profile</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading this tailor…</Text>
            <Text style={styles.stateHint}>
              We’re pulling together the profile, portfolio, and trust signals so you can decide with confidence.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Tailor profile</Text>
            <Text style={styles.stateTitle}>Couldn't load this profile.</Text>
            <Text style={styles.stateHint}>
              This page should help you judge whether this tailor feels right before you start an order.
            </Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Best recovery move</Text>
              <Text style={styles.stateGuideText}>
                Refresh here first. If it still fails, go back to discovery and compare a few other live profiles so you do not lose momentum.
              </Text>
            </View>
            <Button label="Try again" onPress={load} variant="secondary" />
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
            <Text style={styles.stateTitle}>Tailor not found.</Text>
            <Text style={styles.stateHint}>
              This profile may have moved, or it may no longer be available to browse right now.
            </Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Best recovery move</Text>
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

  const heroImages = profile.portfolioPhotos.filter((url) => !failedHeroImages.includes(url))
  const priceLabel = (profile.priceRangeMin && profile.priceRangeMax)
    ? `${formatAmount(profile.priceRangeMin, 'USD', currency, rates)} – ${formatAmount(profile.priceRangeMax, 'USD', currency, rates)}`
    : null
  const isFullyBooked = profile.availability === 'FULLY_BOOKED'

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>

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
                  <Image
                    source={{ uri: item }}
                    style={styles.heroImage}
                    resizeMode="cover"
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
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Tailor profile</Text>
          </View>

          {/* Identity */}
          <View style={styles.identityRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{profile.displayName}</Text>
              <Text style={styles.location}>{profile.location}</Text>
            </View>
            <TierBadgeChip tier={profile.tier as any} size="lg" />
          </View>

          {/* Availability */}
          <View style={styles.availRow}>
            <View style={[styles.availDot, { backgroundColor: AVAILABILITY_COLOR[profile.availability] ?? Colors.midGrey }]} />
            <Text style={styles.availText}>{AVAILABILITY_LABEL[profile.availability] ?? profile.availability}</Text>
          </View>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <StatPill label="Rating" value={`${profile.avgRating.toFixed(1)} ★`} />
            <StatPill label="Reviews" value={String(profile.totalReviews)} />
            <StatPill label="Orders" value={`${profile.totalOrders}+`} />
            {profile.avgResponseHours != null && (
              <StatPill label="Response" value={`~${Math.round(profile.avgResponseHours)}h`} />
            )}
          </View>

          {/* Specialties */}
          {profile.specialtyTags.length > 0 && (
            <View style={styles.section}>
              <View style={styles.tagWrap}>
                {profile.specialtyTags.map((t) => <Tag key={t} label={t} />)}
              </View>
            </View>
          )}

          {/* Price & languages */}
          <View style={styles.metaRow}>
            {priceLabel && <Text style={styles.metaText}>Typical price: {priceLabel}</Text>}
            {profile.languages.length > 0 && (
              <Text style={styles.metaText}>Languages: {profile.languages.join(', ')}</Text>
            )}
          </View>

          {/* About */}
          {profile.bio && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.bio}>{profile.bio}</Text>
            </View>
          )}

          {/* Reviews */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Reviews  {reviews.length > 0 ? <Text style={styles.ratingHeading}>★ {profile.avgRating.toFixed(1)}</Text> : null}
            </Text>
            {reviews.length > 0 ? (
              reviews.map((r) => (
                <ReviewCard key={r.id} review={r} />
              ))
            ) : (
              <View style={styles.emptyReviewCard}>
                <View style={styles.emptyReviewBadge}>
                  <Text style={styles.emptyReviewBadgeText}>Reviews</Text>
                </View>
                <Text style={styles.emptyReviewTitle}>No reviews yet</Text>
                <Text style={styles.emptyReviewHint}>
                  {profile.totalOrders > 0
                    ? 'This tailor is still waiting on their first Drape review.'
                    : 'Be among the first customers to book this tailor on Drape.'}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.decisionGuideCard}>
            <Text style={styles.decisionGuideTitle}>Best way to decide</Text>
            <Text style={styles.decisionGuideText}>
              Check the specialties, portfolio, and reviews together. If the work feels close to what you want, send a clear brief and use the order flow to compare the quote properly.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Sticky CTA */}
      <View style={styles.cta}>
        <Button
          label={isFullyBooked ? 'Currently unavailable' : (profile.avgResponseHours ? `Message · ~${Math.round(profile.avgResponseHours)}h reply` : 'Message')}
          variant="secondary"
          onPress={() => {
            if (isFullyBooked) {
              Alert.alert(
                'Currently unavailable',
                `${profile.displayName} is fully booked right now. Please check back later or explore other tailors.`
              )
              return
            }

            Alert.alert(
              'Place an order first',
              `Messages with ${profile.displayName} start once you submit a brief. Your order will create the conversation automatically, and you'll be able to chat about quotes, consultations, and progress there.`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Book this tailor', onPress: () => router.push(`/(customer)/brief/${profile.id}`) },
              ]
            )
          }}
          style={{ flex: 1 }}
          disabled={isFullyBooked}
        />
        <Button
          label={isFullyBooked ? 'Fully booked' : 'Book this tailor'}
          onPress={() => router.push(`/(customer)/brief/${profile.id}`)}
          style={{ flex: 1.6 }}
          disabled={isFullyBooked}
          testID="book-tailor-btn"
        />
      </View>
    </SafeAreaView>
  )
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

function ReviewCard({ review }: { review: Review }) {
  const name = review.reviewerName
  const initial = name.split(' ').map((p) => p[0]).slice(0, 2).join('')
  const date = new Date(review.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        <View style={styles.reviewAvatar}>
          <Text style={styles.reviewInitial}>{initial}</Text>
        </View>
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
  scroll: { flex: 1 },
  decisionGuideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
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
    paddingTop: 52, paddingHorizontal: Spacing.xl,
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
    position: 'absolute', bottom: 12, right: Spacing.xl,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  photoCountText: { fontSize: FontSize.xs, color: Colors.white, fontWeight: FontWeight.semibold },

  body: { padding: Spacing.xl, gap: Spacing.xl },
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

  identityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  name: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
  location: { fontSize: FontSize.sm, color: Colors.midGrey, marginTop: 2 },

  availRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: -Spacing.md },
  availDot: { width: 8, height: 8, borderRadius: 4 },
  availText: { fontSize: FontSize.sm, color: Colors.inkLight },

  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  statPill: {
    flex: 1, backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingVertical: Spacing.md, alignItems: 'center', gap: 2, ...Shadow.sm,
  },
  statValue: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink },
  statLabel: { fontSize: FontSize.xs, color: Colors.midGrey },

  section: { gap: Spacing.md },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  ratingHeading: { color: Colors.needleGreen },

  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  metaRow: { gap: Spacing.xs, marginTop: -Spacing.md },
  metaText: { fontSize: FontSize.sm, color: Colors.inkLight },

  bio: { fontSize: FontSize.md, color: Colors.inkLight, lineHeight: 24 },

  reviewCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm,
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  reviewAvatar: {
    width: 40, height: 40, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center',
  },
  reviewInitial: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  reviewerName: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  reviewDate: { fontSize: FontSize.xs, color: Colors.midGrey },
  reviewBody: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  reviewTags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  emptyReviewCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
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
  emptyReviewTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyReviewHint: { fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 20 },

  cta: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: Spacing.md,
    backgroundColor: Colors.white, padding: Spacing.xl,
    borderTopWidth: 1, borderTopColor: Colors.lightGrey,
    paddingBottom: Spacing.xxxl,
  },
})
