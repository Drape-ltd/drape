import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, FlatList, ActivityIndicator, Dimensions,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { TierBadgeChip, StarRating, Tag, Button } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const { width } = Dimensions.get('window')
const PORTFOLIO_COLS = 3
const PORTFOLIO_SIZE = (width - Spacing.xl * 2 - Spacing.sm * 2) / PORTFOLIO_COLS

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

const AVAILABILITY_LABEL: Record<string, string> = {
  OPEN: 'Available',
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

  useEffect(() => {
    async function fetch() {
      const [profileRes, reviewsRes] = await Promise.all([
        supabase
          .from('tailor_profiles')
          .select('id, display_name, location, tier, avg_rating, total_reviews, total_orders, avg_response_hours, availability, bio, specialty_tags, languages, price_range_min, price_range_max, portfolio_photo_urls')
          .eq('id', id)
          .single(),
        supabase
          .from('reviews')
          .select('id, rating, body, tags, created_at, reviewer_name')
          .eq('tailor_id', id)
          .order('created_at', { ascending: false })
          .limit(10),
      ])

      if (profileRes.data) {
        const d = profileRes.data as any
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
          specialtyTags: d.specialty_tags ?? [],
          languages: d.languages ?? [],
          priceRangeMin: d.price_range_min,
          priceRangeMax: d.price_range_max,
          portfolioPhotos: d.portfolio_photo_urls ?? [],
        })
      }

      if (reviewsRes.data) {
        setReviews(
          reviewsRes.data.map((r: any) => ({
            id: r.id,
            rating: r.rating,
            body: r.body,
            tags: r.tags ?? [],
            reviewerName: r.reviewer_name ?? 'Customer',
            createdAt: r.created_at,
          }))
        )
      }

      setLoading(false)
    }
    fetch()
  }, [id])

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />
      </SafeAreaView>
    )
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>Tailor not found.</Text>
          <Button label="Go back" onPress={() => router.back()} variant="secondary" />
        </View>
      </SafeAreaView>
    )
  }

  const priceLabel = profile.priceRangeMin
    ? '£'.repeat(Math.min(3, Math.ceil(profile.priceRangeMin / 5000)))
    : null

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Back button */}
      <TouchableOpacity style={styles.back} onPress={() => router.back()} testID="tailor-back-btn">
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>

        {/* Hero — first portfolio photo or placeholder */}
        <View style={styles.hero}>
          {profile.portfolioPhotos[0] ? (
            <Image source={{ uri: profile.portfolioPhotos[0] }} style={styles.heroImage} resizeMode="cover" />
          ) : (
            <View style={[styles.heroImage, styles.heroPlaceholder]}>
              <Text style={styles.heroEmoji}>🧵</Text>
            </View>
          )}
        </View>

        <View style={styles.body}>
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
            {profile.avgResponseHours && (
              <StatPill label="Response" value={`~${Math.round(profile.avgResponseHours)}h`} />
            )}
          </View>

          {/* Specialties */}
          {profile.specialtyTags.length > 0 && (
            <View style={styles.section}>
              <View style={styles.tagWrap}>
                {(profile.specialtyTags ?? []).map((t) => <Tag key={t} label={t} />)}
              </View>
            </View>
          )}

          {/* Price & languages */}
          <View style={styles.metaRow}>
            {priceLabel && <Text style={styles.metaText}>Pricing: {priceLabel}–{priceLabel}{'£'.repeat(Math.min(5, (priceLabel.length || 1) + 2))}</Text>}
            {profile.languages.length > 0 && (
              <Text style={styles.metaText}>Languages: {(profile.languages ?? []).join(', ')}</Text>
            )}
          </View>

          {/* Portfolio */}
          {profile.portfolioPhotos.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Portfolio</Text>
              <View style={styles.portfolioGrid}>
                {profile.portfolioPhotos.map((url, i) => (
                  <Image key={i} source={{ uri: url }} style={styles.portfolioThumb} resizeMode="cover" />
                ))}
              </View>
            </View>
          )}

          {/* About */}
          {profile.bio && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.bio}>{profile.bio}</Text>
            </View>
          )}

          {/* Reviews */}
          {reviews.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Reviews  <Text style={styles.ratingHeading}>★ {profile.avgRating.toFixed(1)}</Text></Text>
              {reviews.map((r) => (
                <ReviewCard key={r.id} review={r} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky CTA */}
      <View style={styles.cta}>
        <Button
          label="Message"
          variant="secondary"
          onPress={() => router.push(`/(customer)/messages/${profile.id}`)}
          style={{ flex: 1 }}
        />
        <Button
          label="Book this tailor"
          onPress={() => router.push(`/(customer)/brief/${profile.id}`)}
          style={{ flex: 1.6 }}
          disabled={profile.availability === 'FULLY_BOOKED'}
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
  back: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, position: 'absolute', top: 48, left: 0, zIndex: 10 },
  backText: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  scroll: { flex: 1 },

  hero: { width: '100%', height: 280 },
  heroImage: { width: '100%', height: '100%' },
  heroPlaceholder: { backgroundColor: Colors.boneDeep, alignItems: 'center', justifyContent: 'center' },
  heroEmoji: { fontSize: 64 },

  body: { padding: Spacing.xl, gap: Spacing.xl },

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

  portfolioGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  portfolioThumb: {
    width: PORTFOLIO_SIZE, height: PORTFOLIO_SIZE,
    borderRadius: Radius.sm, backgroundColor: Colors.boneDeep,
  },

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

  cta: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: Spacing.md,
    backgroundColor: Colors.white, padding: Spacing.xl,
    borderTopWidth: 1, borderTopColor: Colors.lightGrey,
    paddingBottom: Spacing.xxxl,
  },

  notFound: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.lg, padding: Spacing.xl },
  notFoundText: { fontSize: FontSize.lg, color: Colors.inkLight },
})
