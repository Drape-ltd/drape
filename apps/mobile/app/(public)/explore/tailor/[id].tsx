import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fetchReadGateway } from '@/lib/read-gateway'
import {
  DrapeMediaMosaic,
  DrapeMediaViewer,
  type DrapeMediaMosaicItem,
  type DrapeMediaViewerItem,
} from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

type PublicProfile = {
  id: string
  displayName: string
  location: string
  bio?: string | null
  specialtyTags?: string[]
  languages?: string[]
  avgRating?: number
  totalReviews?: number
  avatarUrl?: string | null
  portfolioPhotos?: string[]
  portfolioVideos?: string[]
  media?: Array<{ id: string; kind: 'IMAGE' | 'VIDEO'; url: string }>
  supportsCustomOrders?: boolean
  supportsReadyMade?: boolean
  pickupAvailable?: boolean
  deliveryAvailable?: boolean
  shippingAvailable?: boolean
}

type ProfileResponse = { profile?: PublicProfile | null }

export default function PublicTailorProfileScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeMediaIndex, setActiveMediaIndex] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    void fetchReadGateway<ProfileResponse | null>({ action: 'tailor-profile', tailorId: id })
      .then((data) => {
        if (!active) return
        setProfile(data?.profile ?? null)
        setError(data?.profile ? '' : 'This public profile is no longer available.')
      })
      .catch(() => {
        if (active) setError('We could not load this public profile right now.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [id])

  const continueToAccount = () => {
    router.push({
      pathname: '/(auth)/welcome',
      params: { reason: 'order', publicTailorId: id },
    })
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={Colors.needleGreen} />
      </SafeAreaView>
    )
  }

  if (!profile || error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorTitle}>Profile unavailable</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryButtonText}>Back to Explore</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  const services = [
    profile.supportsCustomOrders ? 'Custom orders' : null,
    profile.supportsReadyMade ? 'Ready-made' : null,
    profile.pickupAvailable ? 'Pickup' : null,
    profile.deliveryAvailable ? 'Local delivery' : null,
    profile.shippingAvailable ? 'Shipping' : null,
  ].filter(Boolean)
  const canonicalMedia = (profile.media ?? []).filter((item) => Boolean(item.url))
  const fallbackMedia = [
    ...(profile.portfolioPhotos ?? []).map((url, index) => ({
      id: `photo-${index}-${url}`,
      kind: 'IMAGE' as const,
      url,
    })),
    ...(profile.portfolioVideos ?? []).map((url, index) => ({
      id: `video-${index}-${url}`,
      kind: 'VIDEO' as const,
      url,
    })),
  ]
  const portfolioMedia = canonicalMedia.length > 0 ? canonicalMedia : fallbackMedia
  const displayedMedia =
    portfolioMedia.length > 0
      ? portfolioMedia
      : profile.avatarUrl
        ? [{ id: `avatar-${profile.id}`, kind: 'IMAGE' as const, url: profile.avatarUrl }]
        : []
  const mosaicItems: DrapeMediaMosaicItem[] = displayedMedia.map((item, index) => ({
    id: item.id,
    uri: item.url,
    kind: item.kind === 'VIDEO' ? 'video' : 'photo',
    label: `${profile.displayName} portfolio ${item.kind === 'VIDEO' ? 'video' : 'photo'} ${index + 1} of ${displayedMedia.length}`,
    bucket: portfolioMedia.length > 0 ? 'portfolio-photos' : 'avatars',
  }))
  const viewerItems: DrapeMediaViewerItem[] = mosaicItems.map((item) => ({
    uri: item.uri ?? '',
    label: item.label,
    kind: item.kind,
    bucket: item.bucket,
  }))

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to Explore"
        >
          <Feather name="arrow-left" size={21} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Public profile</Text>
        <View style={styles.iconSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {mosaicItems.length > 0 ? (
          <View style={styles.portfolioCard}>
            <View style={styles.portfolioHeader}>
              <View>
                <Text style={styles.portfolioEyebrow}>Public portfolio</Text>
                <Text style={styles.portfolioTitle}>Complete portfolio</Text>
              </View>
              <Text style={styles.portfolioCount}>
                {portfolioMedia.length || 1} piece{(portfolioMedia.length || 1) === 1 ? '' : 's'}
              </Text>
            </View>
            <DrapeMediaMosaic
              items={mosaicItems}
              onPressItem={(_, index) => setActiveMediaIndex(index)}
              testID="public-tailor-portfolio"
            />
            <Text style={styles.portfolioHint}>
              Tap any piece to inspect photos and play videos.
            </Text>
          </View>
        ) : null}
        <View style={styles.profileCard}>
          <Text style={styles.title}>{profile.displayName}</Text>
          <Text style={styles.location}>{profile.location}</Text>
          <Text style={styles.rating}>
            ★ {(profile.avgRating ?? 0).toFixed(1)} · {profile.totalReviews ?? 0} reviews
          </Text>
          {profile.bio ? <Text style={styles.body}>{profile.bio}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What they make</Text>
          <View style={styles.chips}>
            {(profile.specialtyTags ?? []).map((tag) => (
              <Text key={tag} style={styles.chip}>
                {tag}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Available services</Text>
          <Text style={styles.body}>
            {services.join(' · ') || 'Ask about current availability after signing in.'}
          </Text>
        </View>

        <View style={styles.accountCard}>
          <Text style={styles.accountTitle}>Ready to work with {profile.displayName}?</Text>
          <Text style={styles.accountBody}>
            Continue to Drapeon to save this profile, message the tailor, or start an order.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={continueToAccount}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Continue to Drapeon</Text>
            <Feather name="arrow-right" size={18} color={Colors.textInverse} />
          </TouchableOpacity>
        </View>
      </ScrollView>
      <DrapeMediaViewer
        items={viewerItems}
        activeIndex={activeMediaIndex}
        onDismiss={() => setActiveMediaIndex(null)}
        testID="public-tailor-portfolio-viewer"
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  center: {
    flex: 1,
    backgroundColor: Colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  header: {
    minHeight: 58,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  iconSpacer: { width: 44 },
  headerTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.lg },
  portfolioCard: {
    overflow: 'hidden',
    borderRadius: Radius.xl,
    backgroundColor: Colors.white,
    padding: Spacing.md,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  portfolioHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  portfolioEyebrow: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  portfolioTitle: { marginTop: 3, fontFamily: Fonts.display, fontSize: 24, color: Colors.ink },
  portfolioCount: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.inkLight,
  },
  portfolioHint: {
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    lineHeight: 18,
    color: Colors.inkLight,
  },
  profileCard: {
    backgroundColor: Colors.white,
    padding: Spacing.xl,
    borderRadius: Radius.xl,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  location: { fontFamily: Fonts.body, fontSize: FontSize.md, color: Colors.inkLight },
  rating: { fontFamily: Fonts.bodySemiBold, fontWeight: FontWeight.semibold, color: Colors.ink },
  body: { fontFamily: Fonts.body, fontSize: FontSize.sm, lineHeight: 22, color: Colors.inkLight },
  section: {
    backgroundColor: Colors.white,
    padding: Spacing.lg,
    borderRadius: Radius.xl,
    gap: Spacing.md,
  },
  sectionTitle: { fontFamily: Fonts.display, fontSize: 23, color: Colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    overflow: 'hidden',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.bone,
    color: Colors.ink,
  },
  accountCard: {
    padding: Spacing.lg,
    borderRadius: Radius.xl,
    backgroundColor: Colors.needleGreenLight,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    gap: Spacing.sm,
  },
  accountTitle: {
    fontFamily: Fonts.display,
    fontSize: 22,
    lineHeight: 27,
    color: Colors.ink,
  },
  accountBody: { fontFamily: Fonts.body, fontSize: FontSize.sm, lineHeight: 20, color: Colors.inkLight },
  primaryButton: {
    minHeight: 46,
    marginTop: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  primaryButtonText: { color: Colors.textInverse, fontWeight: FontWeight.semibold },
  errorTitle: { fontFamily: Fonts.display, fontSize: 30, color: Colors.ink },
  errorBody: { textAlign: 'center', color: Colors.inkLight, lineHeight: 22 },
  secondaryButton: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.full,
    backgroundColor: Colors.ink,
  },
  secondaryButtonText: { color: Colors.textInverse, fontWeight: FontWeight.semibold },
})
