import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  Animated, ActivityIndicator, Linking, Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Feather } from '@expo/vector-icons'
import * as ImageManipulator from 'expo-image-manipulator'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useCustomerProfile } from '@/lib/customerProfile'
import { pickAvatarImageUri, type AvatarImageSource } from '@/lib/avatar-picker'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { useCustomerProfileOverview, useRefreshOnFocus } from '@/lib/queries'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import { shareCustomerReferral, shareDiscoverTailors } from '@/lib/invite'
import { Sentry } from '@/lib/sentry'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'
import { AvatarImage } from '@/components/ui/AvatarImage'

const CUSTOMER_PROFILE_GUIDE_KEY = 'drape_customer_profile_best_use_dismissed'

// ─── Types ───────────────────────────────────────────────────────────────────

type MeasurementProfile = {
  chest: number | null
  waist: number | null
  hips: number | null
  shoulderWidth: number | null
  inseam: number | null
  sleeveLength: number | null
  neckCircumference: number | null
  underBust?: number | null
  height: number | null
  backLength?: number | null
  outseam?: number | null
  thighCircumference?: number | null
  kneeCircumference?: number | null
  bicepCircumference?: number | null
  wristCircumference?: number | null
  headCircumference?: number | null
  hatBandLine?: number | null
  headLength?: number | null
  headWidth?: number | null
  earToEarOverCrown?: number | null
  frontToBackOverCrown?: number | null
  filaHeight?: number | null
  torsoLength?: number | null
  unit: 'in' | 'cm'
}

type RecentOrder = {
  id: string
  reference: string
  garmentType: string
  stage: OrderStage
  tailorName: string
  createdAt: string
}

const MEASUREMENT_KEYS: Array<keyof MeasurementProfile> = [
  'chest', 'waist', 'hips', 'shoulderWidth', 'inseam', 'sleeveLength', 'neckCircumference', 'height',
  'underBust', 'backLength', 'outseam', 'thighCircumference', 'kneeCircumference', 'bicepCircumference',
  'wristCircumference', 'headCircumference', 'hatBandLine', 'headLength', 'headWidth', 'earToEarOverCrown',
  'frontToBackOverCrown', 'filaHeight', 'torsoLength',
]

const STAGE_COLOR: Partial<Record<OrderStage, string>> = {
  PENDING_QUOTE: Colors.warning, CONSULTATION: Colors.warning, QUOTE_SENT: Colors.warning,
  PAYMENT_FAILED: Colors.kanteRust,
  CONFIRMED: Colors.needleGreen, DESIGNING: Colors.needleGreen, SOURCING: Colors.needleGreen,
  CUTTING: Colors.needleGreen, SEWING: Colors.needleGreen,
  FINISHING: Colors.needleGreen, SHIPPED: Colors.needleGreen, READY_FOR_COLLECTION: Colors.needleGreen,
  IN_DISPUTE: Colors.kanteRust,
  COMPLETE: Colors.midGrey, DELIVERED: Colors.needleGreen, COLLECTED: Colors.needleGreen,
  DECLINED: Colors.midGrey, CANCELLED: Colors.midGrey, EXPIRED: Colors.midGrey, REFUNDED: Colors.midGrey,
}

function recentOrderHint(stage: OrderStage): string {
  switch (stage) {
    case 'PENDING_QUOTE':
      return 'Waiting for quote'
    case 'CONSULTATION':
      return 'Consultation requested'
    case 'QUOTE_SENT':
      return 'Review quote'
    case 'PAYMENT_FAILED':
      return 'Retry payment'
    case 'READY_FOR_COLLECTION':
      return 'Bring your collection code'
    case 'SHIPPED':
      return 'Track delivery'
    case 'DELIVERED':
      return 'Finish and review'
    case 'COLLECTED':
      return 'Finish and review'
    case 'IN_DISPUTE':
      return 'Concern under review'
    case 'COMPLETE':
      return 'Order complete'
    default:
      return STAGE_LABELS[stage] ?? stage
  }
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonBox({ width, height, style }: { width?: number | string; height: number; style?: object }) {
  const anim = useRef(new Animated.Value(0.4)).current
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    )
    animation.start()
    return () => animation.stop()
  }, [anim])
  return (
    <Animated.View style={[{ width, height, borderRadius: Radius.sm, backgroundColor: Colors.lightGrey, opacity: anim }, style]} />
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CustomerProfileScreen() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { avatarUrl, setAvatarUrl } = useCustomerProfile()
  const [showGuide, setShowGuide] = useState(true)

  async function openExternalUrl(url: string, fallbackMessage: string) {
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert('Unable to open link', fallbackMessage)
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Unable to open link', fallbackMessage)
    }
  }
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const lastNotifCheck = user?.user_metadata?.last_notif_check ?? new Date(0).toISOString()
  const {
    data: overview,
    isError,
    error: overviewError,
    refetch,
  } = useCustomerProfileOverview(user?.id, lastNotifCheck)

  const measurements = (overview?.measurements ?? null) as MeasurementProfile | null
  const measurementMeta = (overview?.measurements ?? null) as Record<string, unknown> | null
  const recentOrders = (overview?.recentOrders ?? []) as RecentOrder[]
  const reviewCount = overview?.reviewCount ?? 0
  const averageRating = overview?.averageRating ?? null
  const createdAt = overview?.createdAt ?? null
  const notifCount = overview?.notifCount ?? 0

  useEffect(() => {
    AsyncStorage.getItem(`${CUSTOMER_PROFILE_GUIDE_KEY}:${user?.id ?? 'guest'}`)
      .then((value) => setShowGuide(value !== '1'))
      .catch(() => {})
  }, [user?.id])

  useEffect(() => {
    if (overview?.avatarUrl && !avatarUrl) {
      setAvatarUrl(overview.avatarUrl)
    }
  }, [overview?.avatarUrl, avatarUrl, setAvatarUrl])

  useRefreshOnFocus(() => { void refetch() })

  async function dismissGuide() {
    setShowGuide(false)
    try {
      await AsyncStorage.setItem(`${CUSTOMER_PROFILE_GUIDE_KEY}:${user?.id ?? 'guest'}`, '1')
    } catch {}
  }

  const displayName =
    String(user?.user_metadata?.display_name ?? '').trim()
    || user?.email?.split('@')[0]?.replace(/[._-]+/gu, ' ').trim()
    || 'Drape customer'
  const initials = displayName
    .split(' ')
    .map((p: string) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

  const filledCount = measurements
    ? MEASUREMENT_KEYS.filter((k) => measurements[k] !== null && measurements[k] !== undefined).length
    : 0
  const measurementProgressLabel = filledCount > 0
    ? `${filledCount} saved`
    : 'Set up'
  const guidedFitStatus =
    measurementMeta?.latestMeasurementScanStatus === 'TAILOR_REVIEW_REQUIRED'
      ? 'Tailor review pending'
      : measurementMeta?.latestMeasurementScanStatus === 'TAILOR_REVIEWED'
        ? 'Tailor reviewed'
        : measurementMeta?.latestMeasurementScanStatus === 'CAPTURED'
          ? 'Ready for orders'
          : 'Add guided fit notes'

  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : null
  const profileLoadErrorMessage = isLikelyConnectivityIssue(overviewError)
    ? 'Connection looks weak. Your fit profile and account tools are still here once the signal stabilizes, so retry when it improves.'
    : 'This is where your fit profile, recent orders, and account tools stay organised. Please try again in a moment.'

  // ── Photo upload ────────────────────────────────────────────────────────────

  function handleAvatarPress() {
    Alert.alert('Profile photo', 'Take a new photo or choose one from your library.', [
      { text: 'Take photo', onPress: () => void updateAvatarFromSource('camera') },
      { text: 'Choose from library', onPress: () => void updateAvatarFromSource('library') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function updateAvatarFromSource(source: AvatarImageSource) {
    const imageUri = await pickAvatarImageUri(source)
    if (!imageUri) return

    setUploadingAvatar(true)
    try {
      // Compress to 800×800 JPEG — keeps avatars small
      const compressed = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 800, height: 800 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      )

      const fileName = `${user!.id}/avatar.jpg`
      const publicUrl = await uploadPublicStorageImage({
        bucket: 'avatars',
        path: fileName,
        uri: compressed.uri,
        contentType: 'image/jpeg',
        maxBytes: 5 * 1024 * 1024,
        upsert: true,
      })

      // Cache-bust so the new image replaces the old one immediately
      const bustUrl = `${publicUrl}?t=${Date.now()}`

      const { error: profileError } = await supabase
        .from('customer_profiles')
        .update({ avatar_url: bustUrl })
        .eq('user_id', user!.id)
      if (profileError) throw profileError

      setAvatarUrl(bustUrl)
    } catch (err) {
      Sentry.captureException(err, { extra: { context: 'customer_avatar_upload', userId: user?.id } })
      Alert.alert(
        'Upload failed',
        isLikelyConnectivityIssue(err)
          ? 'Connection looks weak. We could not update your photo yet. Retry when the signal improves.'
          : 'Could not update your photo right now. Please try again in a moment.',
      )
    } finally {
      setUploadingAvatar(false)
    }
  }

  // ── Sign out ────────────────────────────────────────────────────────────────

  async function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void signOut().catch(() => {
            Alert.alert('Unable to sign out', 'Please try again in a moment. You can keep using your profile and come back to sign out later.')
          })
        },
      },
    ])
  }

  if (isError && !overview) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Customer profile</Text>
            <Text style={styles.stateTitle}>Couldn't load your profile.</Text>
            <Text style={styles.stateHint}>{profileLoadErrorMessage}</Text>
            <TouchableOpacity
              style={styles.statePrimaryBtn}
              onPress={() => { void refetch() }}
            >
              <Text style={styles.statePrimaryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.stateSecondaryBtn}
              onPress={() => router.replace('/(customer)')}
            >
              <Text style={styles.stateSecondaryBtnText}>Open home</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: Spacing.xxxl }}>

        {/* ── Profile header strip ── */}
        <View style={styles.profileHeader}>
          <Text style={styles.profileHeaderTitle}>Profile</Text>
          <TouchableOpacity
            style={styles.bellBtn}
            onPress={() => router.push('/(customer)/profile/notifications')}
            activeOpacity={0.7}
          >
            <Feather name="bell" size={20} color={Colors.textInverse} />
            {notifCount > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{notifCount > 9 ? '9+' : String(notifCount)}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Hero ── */}
        <View style={styles.hero}>
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={handleAvatarPress}
            disabled={uploadingAvatar}
            activeOpacity={0.8}
          >
            {uploadingAvatar ? (
              <View style={[styles.avatar, styles.avatarLoading]}>
                <ActivityIndicator color={Colors.textInverse} />
              </View>
            ) : (
              <AvatarImage
                uri={avatarUrl}
                initials={initials}
                size={96}
                style={styles.avatarImage}
                shadow
              />
            )}
            {/* Camera badge */}
            <View style={styles.cameraBadge}>
              <Feather name="camera" size={11} color={Colors.textInverse} />
            </View>
          </TouchableOpacity>

          <Text style={styles.heroName}>{displayName}</Text>
          {memberSince && <Text style={styles.heroMeta}>Member since {memberSince}</Text>}
        </View>

        <View style={styles.body}>
          {showGuide && (
            <View style={styles.workspaceCard}>
              <View style={styles.workspaceHeader}>
                <Text style={styles.workspaceEyebrow}>Best use</Text>
                <TouchableOpacity onPress={() => void dismissGuide()} style={styles.workspaceClose}>
                  <Feather name="x" size={16} color={Colors.midGrey} />
                </TouchableOpacity>
              </View>
              <Text style={styles.workspaceText}>
                Keep your measurements current and use this page to revisit finished orders and keep your fit profile sharp.
              </Text>
            </View>
          )}

          <View style={styles.quickLinksRow}>
            <TouchableOpacity
              style={styles.quickLinkCard}
              onPress={() => router.push('/(customer)/profile/measurements')}
              activeOpacity={0.75}
            >
              <Text style={styles.quickLinkValue}>{measurementProgressLabel}</Text>
              <Text style={styles.quickLinkLabel}>Fit profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickLinkCard}
              onPress={() => router.push('/(customer)/profile/reviews')}
              activeOpacity={0.75}
            >
              <Text style={styles.quickLinkValue}>
                {averageRating ? averageRating.toFixed(1) : 'No rating'}
              </Text>
              <Text style={styles.quickLinkLabel}>
                {reviewCount > 0 ? `${reviewCount} review${reviewCount === 1 ? '' : 's'}` : 'Ratings'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickLinkCard}
              onPress={() => router.navigate({ pathname: '/(customer)/orders', params: { tab: 'completed' } })}
              activeOpacity={0.75}
            >
              <Text style={styles.quickLinkValue}>{recentOrders.length}</Text>
              <Text style={styles.quickLinkLabel}>Order history</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.workspaceCard}
            onPress={() => router.push('/(customer)/profile/guided-fit')}
            activeOpacity={0.8}
          >
            <View style={styles.workspaceHeader}>
              <Text style={styles.workspaceEyebrow}>Guided fit intake</Text>
              <Feather name="chevron-right" size={16} color={Colors.midGrey} />
            </View>
            <Text style={styles.workspaceText}>
              Save fit intent, stretch, posture, and symmetry cues so the next tailor has a cleaner pre-cutting brief.
            </Text>
            <Text style={styles.workspaceStatus}>{guidedFitStatus}</Text>
          </TouchableOpacity>

          {/* ── Become a tailor ── */}
          <TouchableOpacity
            style={styles.becomeCard}
            onPress={() => { void openExternalUrl('https://drapeon.co/tailors', 'Please visit https://drapeon.co/tailors manually.') }}
            activeOpacity={0.8}
          >
            <View style={styles.becomeIcon}>
              <Feather name="scissors" size={20} color={Colors.needleGreen} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.becomeTitle}>Are you a tailor?</Text>
              <Text style={styles.becomeSub}>Join Drape to offer custom work, consultations, or ready-made pieces.</Text>
            </View>
            <Feather name="chevron-right" size={18} color={Colors.inkLight} />
          </TouchableOpacity>

          {/* ── Main action list ── */}
          <View style={styles.flatList}>
            <FlatRow icon="credit-card" label="Payment history" onPress={() => router.push('/(customer)/profile/payments' as never)} />
            <View style={styles.flatDivider} />
            <FlatRow icon="settings" label="Account settings" onPress={() => router.push('/(customer)/profile/account-settings')} />
            <FlatRow icon="help-circle" label="Get help" onPress={() => router.push('/(customer)/profile/help')} />
            <FlatRow icon="user" label="View profile" onPress={() => router.push('/(customer)/profile/view-profile')} />
            <FlatRow icon="shield" label="Privacy" last onPress={() => router.push('/(customer)/profile/privacy')} />
          </View>

          {/* ── Refer & share ── */}
          <View style={styles.flatList}>
            <FlatRow
              icon="user-plus"
              label="Invite a friend to Drape"
              onPress={() => shareCustomerReferral(user?.id ?? '', displayName)}
            />
            <FlatRow
              icon="scissors"
              label="Share tailor discovery"
              onPress={() => shareDiscoverTailors(user?.id ?? '')}
            />
            <FlatRow
              icon="file-text"
              label="Legal"
              last
              onPress={() => { void openExternalUrl('https://drapeon.co/legal', 'Please visit https://drapeon.co/legal manually.') }}
            />
          </View>

          {/* ── Sign out ── */}
          <TouchableOpacity style={styles.logOutRow} onPress={handleSignOut} activeOpacity={0.6} accessibilityRole="button" accessibilityLabel="Sign out">
            <Feather name="log-out" size={18} color={Colors.error} />
            <Text style={styles.logOutText}>Sign out</Text>
          </TouchableOpacity>

        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── FlatRow ─────────────────────────────────────────────────────────────────

function FlatRow({
  icon, label, last, onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  last?: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.flatRow, last && styles.rowLast]}
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name={icon} size={20} color={Colors.inkLight} style={{ width: 24 }} />
      <Text style={styles.flatRowLabel}>{label}</Text>
      <Feather name="chevron-right" size={16} color={Colors.midGrey} />
    </TouchableOpacity>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
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
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  stateTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
    fontFamily: 'Georgia',
  },
  stateHint: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    textAlign: 'center',
    lineHeight: 21,
  },
  statePrimaryBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  statePrimaryBtnText: { color: Colors.textInverse, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  stateSecondaryBtn: {
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  stateSecondaryBtnText: { color: Colors.ink, fontWeight: FontWeight.medium, fontSize: FontSize.sm },

  // Profile header strip
  profileHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
    backgroundColor: Colors.needleGreen,
  },
  profileHeaderTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textInverse, fontFamily: 'Georgia' },
  bellBtn: {
    width: 38, height: 38, borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  bellBadge: {
    position: 'absolute', top: -2, right: -2,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: Colors.kanteRust,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2, borderColor: Colors.needleGreen,
  },
  bellBadgeText: { fontSize: 10, fontWeight: FontWeight.bold, color: Colors.textInverse },

  // Hero
  hero: {
    backgroundColor: Colors.needleGreen,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xl,
  },
  avatarWrap: { position: 'relative', marginBottom: Spacing.sm },
  avatar: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLoading: { opacity: 0.6 },
  avatarImage: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.45)',
    overflow: 'hidden',
  },
  avatarText: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.textInverse },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenDark,
    borderWidth: 2, borderColor: Colors.needleGreen,
    alignItems: 'center', justifyContent: 'center',
  },
  heroName: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textInverse, fontFamily: 'Georgia' },
  heroMeta: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.75)' },

  body: {
    marginTop: -(Spacing.xl + 4),
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: Colors.bone,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  workspaceCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  workspaceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  workspaceClose: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workspaceEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  workspaceText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
  },
  workspaceStatus: {
    marginTop: Spacing.xs,
    fontSize: FontSize.sm,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  quickLinksRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  quickLinkCard: {
    width: '48%',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 82,
    gap: 6,
    ...Shadow.sm,
  },
  quickLinkValue: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: 'Georgia' },
  quickLinkLabel: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'center', lineHeight: 16 },

  // Sections
  section: { gap: Spacing.sm },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  sectionLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  sectionLinkText: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  // Cards
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.md, gap: Spacing.sm, ...Shadow.sm,
  },

  emptyRow: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, ...Shadow.sm,
  },
  emptyRowIcon: {
    width: 42, height: 42, borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center',
  },
  emptyRowTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  emptyRowHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },

  // Completeness bar
  completenessRow: { gap: 6 },
  completenessLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  bar: { height: 4, backgroundColor: Colors.lightGrey, borderRadius: 2 },
  barFill: { height: '100%', backgroundColor: Colors.needleGreen, borderRadius: 2 },

  // Measure grid
  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  measureCell: {
    width: '47%', backgroundColor: Colors.bone, borderRadius: Radius.sm,
    padding: Spacing.md, gap: 2,
  },
  measureLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  measureValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  measureEmpty: { color: Colors.lightGrey },

  privacyNote: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'center' },

  // Recent orders
  menuList: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  orderRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey,
  },
  orderTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  orderSub: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },
  orderHint: { fontSize: FontSize.xs, color: Colors.needleGreen, marginTop: 4, fontWeight: FontWeight.medium },
  stagePill: {
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
    borderRadius: Radius.full,
  },
  stageText: { fontSize: 11, fontWeight: FontWeight.semibold },

  // Become a tailor
  becomeCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    ...Shadow.sm,
  },
  becomeIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  becomeTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: 'Georgia' },
  becomeSub: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2, lineHeight: 16 },

  // Flat action list (Airbnb style)
  flatList: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm,
  },
  flatDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.lightGrey,
    marginLeft: Spacing.lg + 24,
  },
  flatRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.lg,
    paddingHorizontal: Spacing.lg, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey,
  },
  rowLast: { borderBottomWidth: 0 },
  flatRowLabel: { flex: 1, fontSize: FontSize.md, color: Colors.ink },

  // Log out
  logOutRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  logOutText: { fontSize: FontSize.md, color: Colors.error, fontWeight: FontWeight.medium },
})
