import { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as ImageManipulator from 'expo-image-manipulator'
import { invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { pickAvatarImageUri, type AvatarImageSource } from '@/lib/avatar-picker'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { deriveTailorReadiness } from '@/lib/tailor-readiness'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import { useTailorDashboard, useTailorPublic, useTailorNotifCount } from '@/lib/queries'
import { useTailorProfile } from '@/lib/tailorProfile'
import { shareTailorProfile, inviteTailorColleague, inviteCustomerFromTailor } from '@/lib/invite'
import { appendToHistory, resetTo } from '@/lib/navigation'
import { Sentry } from '@/lib/sentry'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { AvatarImage } from '@/components/ui/AvatarImage'
import { useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'

type TailorProfile = {
  id: string
  displayName: string
  location: string
  bio: string | null
  sellerType: 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP'
  tier: string
  avgRating: number
  totalOrders: number
  totalReviews: number
  availability: string
  specialtyTags: string[]
  supportsCustomOrders: boolean
  supportsReadyMade: boolean
  acceptsCustomOrdersNow: boolean
  shopPaused: boolean
  pickupAvailable: boolean
  deliveryAvailable: boolean
  shippingAvailable: boolean
  shipsInternationally: boolean
  idVerificationStatus: string
  isLive: boolean
  profileCompleted: boolean
  stripeAccountId: string | null
  paystackAccountId: string | null
  payoutCurrency: string | null
  payoutProvider: string | null
  payoutReverificationRequired: boolean | null
  payoutAccountVerified: boolean | null
  payoutAccountType: 'PAYSTACK' | 'STRIPE_CONNECT' | null
}

const AVAIL_LABEL: Record<string, string> = {
  OPEN: 'Available',
  LIMITED: 'Limited',
  FULLY_BOOKED: 'Fully booked',
}
const AVAIL_COLOR: Record<string, string> = {
  OPEN: Colors.success,
  LIMITED: Colors.warning,
  FULLY_BOOKED: Colors.error,
}

const LIVE_BADGE: Record<string, { label: string; color: string; bg: string; dot: boolean }> = {
  LIVE: { label: 'Live', color: Colors.success, bg: Colors.success + '25', dot: true },
  PENDING: { label: 'In review', color: Colors.warning, bg: Colors.warning + '22', dot: false },
  REJECTED: { label: 'Action needed', color: Colors.error, bg: Colors.error + '18', dot: false },
  NOT_SUBMITTED: { label: 'Setup needed', color: Colors.midGrey, bg: Colors.lightGrey, dot: false },
}

export default function TailorProfileScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const capsuleNavScroll = useDrapeCapsuleNavScroll()
  const { user, signOut, switchRole } = useAuth()
  const { avatarUrl, setAvatarUrl } = useTailorProfile()
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [switchingRole, setSwitchingRole] = useState(false)
  const userId = user?.id
  const displayName = user?.user_metadata?.display_name ?? ''
  const dashboardQuery = useTailorDashboard(userId, displayName)
  const dashboardStats = dashboardQuery.data?.stats ?? null
  const profileId = dashboardStats?.profileId ?? undefined
  const publicProfileQuery = useTailorPublic(profileId, userId)
  const publicProfile = publicProfileQuery.data?.profile ?? null

  const profile = useMemo<TailorProfile | null>(() => {
    if (!dashboardStats?.profileId && !publicProfile?.id) return null
    return {
      id: dashboardStats?.profileId ?? publicProfile!.id,
      displayName: publicProfile?.displayName ?? dashboardStats?.displayName ?? displayName,
      location: publicProfile?.location ?? '',
      bio: publicProfile?.bio ?? null,
      sellerType: publicProfile?.sellerType ?? 'TAILOR',
      tier: publicProfile?.tier ?? dashboardStats?.tier ?? 'VERIFIED',
      avgRating: publicProfile?.avgRating ?? dashboardStats?.avgRating ?? 0,
      totalOrders: publicProfile?.totalOrders ?? dashboardStats?.completedOrders ?? 0,
      totalReviews: publicProfile?.totalReviews ?? 0,
      availability: publicProfile?.availability ?? dashboardStats?.availability ?? 'OPEN',
      specialtyTags: publicProfile?.specialtyTags ?? [],
      supportsCustomOrders: publicProfile?.supportsCustomOrders ?? true,
      supportsReadyMade: publicProfile?.supportsReadyMade ?? false,
      acceptsCustomOrdersNow: publicProfile?.acceptsCustomOrdersNow ?? true,
      shopPaused: publicProfile?.shopPaused ?? false,
      pickupAvailable: publicProfile?.pickupAvailable ?? false,
      deliveryAvailable: publicProfile?.deliveryAvailable ?? false,
      shippingAvailable: publicProfile?.shippingAvailable ?? false,
      shipsInternationally: false,
      idVerificationStatus: dashboardStats?.idVerificationStatus ?? 'NOT_SUBMITTED',
      isLive: dashboardStats?.isLive ?? false,
      profileCompleted: dashboardStats?.profileCompleted ?? false,
      stripeAccountId: null,
      paystackAccountId: null,
      payoutCurrency: dashboardStats?.payoutCurrency ?? null,
      payoutProvider: dashboardStats?.payoutProvider ?? null,
      payoutReverificationRequired: dashboardStats?.payoutReverificationRequired ?? null,
      payoutAccountVerified: dashboardStats?.payoutAccountVerified ?? null,
      payoutAccountType: dashboardStats?.payoutAccountType ?? null,
    }
  }, [dashboardStats, displayName, publicProfile])

  const loading =
    dashboardQuery.isLoading ||
    (!!profileId && publicProfileQuery.isLoading && !publicProfile && !profile)
  const fetchErrorMessage =
    !loading && dashboardQuery.error
      ? isLikelyConnectivityIssue(dashboardQuery.error)
        ? 'Connection looks weak. Your storefront details should still be there once the signal stabilizes, so retry when it improves.'
        : 'Your profile is where customers judge trust, portfolio, and reviews. Please try again in a moment.'
      : ''
  const lastTailorNotifCheck =
    user?.user_metadata?.last_tailor_notif_check ?? new Date(0).toISOString()
  const { data: tailorNotifCount = 0 } = useTailorNotifCount(userId, lastTailorNotifCheck)

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

  const initials =
    displayName
      .split(' ')
      .map((p: string) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'

  useEffect(() => {
    if (publicProfile?.avatarUrl) setAvatarUrl(publicProfile.avatarUrl)
  }, [publicProfile?.avatarUrl, setAvatarUrl])

  // ── Avatar upload ────────────────────────────────────────────────────────────

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

      const bustUrl = `${publicUrl}?t=${Date.now()}`

      const { error: profileError } = await invokeFunction('tailor-profile-action', {
        body: { action: 'update-avatar', avatarUrl: bustUrl },
      })
      if (profileError) throw profileError

      setAvatarUrl(bustUrl)
    } catch (err) {
      Sentry.captureException(err, { extra: { context: 'tailor_avatar_upload', userId: user?.id } })
      Alert.alert(
        'Upload failed',
        isLikelyConnectivityIssue(err)
          ? 'Connection looks weak. We could not update your photo yet. Retry when the signal improves.'
          : 'Could not update your photo right now. Please try again in a moment.'
      )
    } finally {
      setUploadingAvatar(false)
    }
  }

  function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void signOut().catch(() => {
            Alert.alert(
              'Unable to sign out',
              'Please try again in a moment. Your storefront settings are still here, so you can keep working and sign out later.'
            )
          })
        },
      },
    ])
  }

  function switchToCustomerMode() {
    if (switchingRole) return
    Alert.alert(
      'Use Drapeon as a customer',
      'Your tailor workspace stays intact. We will open the customer side so you can browse, order, and manage your own fit profile.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () => {
            setSwitchingRole(true)
            void switchRole('CUSTOMER')
              .then(({ error }) => {
                if (error) {
                  Alert.alert('Could not switch modes', error)
                  return
                }
                resetTo(router, '/(customer)')
              })
              .finally(() => setSwitchingRole(false))
          },
        },
      ]
    )
  }

  const idStatus = profile?.idVerificationStatus ?? 'NOT_SUBMITTED'
  const readiness = deriveTailorReadiness(profile)

  // Live status badge config
  const liveBadgeKey = profile?.isLive
    ? 'LIVE'
    : idStatus in LIVE_BADGE
      ? idStatus
      : 'NOT_SUBMITTED'
  const liveBadge = LIVE_BADGE[liveBadgeKey]

  if (fetchErrorMessage && !userId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Tailor profile</Text>
            <Text style={styles.stateTitle}>Couldn't load your profile.</Text>
            <Text style={styles.stateHint}>{fetchErrorMessage}</Text>
            <TouchableOpacity
              style={styles.statePrimaryBtn}
              onPress={() => {
                void dashboardQuery.refetch()
                if (profileId) void publicProfileQuery.refetch()
              }}
            >
              <Text style={styles.statePrimaryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.stateSecondaryBtn}
              onPress={() => router.replace('/(tailor)')}
            >
              <Text style={styles.stateSecondaryBtnText}>Open dashboard</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.profileHeader}>
          <Text style={styles.profileHeaderTitle}>Profile</Text>
        </View>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Tailor profile</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your profile…</Text>
            <Text style={styles.stateHint}>
              We’re pulling together your live profile, reviews, and profile status.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          style={styles.scroll}
          {...capsuleNavScroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 112, 140) },
          ]}
        >
          {/* ── Profile header strip ── */}
          <View style={styles.profileHeader}>
            <Text style={styles.profileHeaderTitle}>Profile</Text>
            <TouchableOpacity
              style={styles.bellBtn}
              onPress={() => router.push('/(tailor)/profile/notifications')}
              activeOpacity={0.7}
            >
              <Feather name="bell" size={20} color={Colors.ink} />
              {tailorNotifCount > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>
                    {tailorNotifCount > 9 ? '9+' : String(tailorNotifCount)}
                  </Text>
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
                  size={76}
                  style={styles.avatarImage}
                  shadow
                />
              )}
              <View style={styles.cameraBadge}>
                <Feather name="camera" size={11} color={Colors.textInverse} />
              </View>
              {profile && (
                <View
                  style={[
                    styles.liveIndicator,
                    { backgroundColor: profile.isLive ? Colors.success : Colors.midGrey },
                  ]}
                />
              )}
            </TouchableOpacity>

            <View style={styles.heroTextBlock}>
              <Text style={styles.heroName} numberOfLines={1}>
                {profile?.displayName ?? displayName}
              </Text>

              {profile?.location ? (
                <View style={styles.heroLocationRow}>
                  <Feather name="map-pin" size={12} color={Colors.inkLight} />
                  <Text style={styles.heroLocation} numberOfLines={1}>{profile.location}</Text>
                </View>
              ) : null}

              {profile && (
                <View style={styles.pillRow}>
                  <View style={styles.availPill}>
                    <View
                      style={[
                        styles.availDot,
                        { backgroundColor: AVAIL_COLOR[profile.availability] ?? Colors.midGrey },
                      ]}
                    />
                    <Text style={styles.availText}>
                      {AVAIL_LABEL[profile.availability] ?? profile.availability}
                    </Text>
                  </View>
                  <View style={styles.liveBadge}>
                    {liveBadge.dot && (
                      <View style={[styles.liveDot, { backgroundColor: liveBadge.color }]} />
                    )}
                    <Text style={styles.liveBadgeText}>{liveBadge.label}</Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          <View style={styles.body}>
            {profile && (
              <View style={styles.capabilityCard}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.capabilityTitle}>Selling setup</Text>
                  <TouchableOpacity onPress={() => router.push('/(tailor)/profile/edit')}>
                    <Text style={styles.cardHeaderAction}>Edit</Text>
                  </TouchableOpacity>
                </View>
                <CapabilityRow
                  icon="briefcase"
                  label="Storefront"
                  value={
                    profile.sellerType === 'BOUTIQUE'
                      ? 'Boutique'
                      : profile.sellerType === 'TAILOR_SHOP'
                        ? 'Tailor shop'
                        : 'Independent tailor'
                  }
                />
                <CapabilityRow
                  icon="shopping-bag"
                  label="Offers"
                  value={[
                    profile.supportsCustomOrders ? 'Custom orders' : null,
                    profile.supportsReadyMade ? 'Ready-made shop' : null,
                  ].filter(Boolean).join(' + ') || 'No offers enabled'}
                />
                <CapabilityRow
                  icon="clock"
                  label="Order status"
                  value={[
                    profile.supportsCustomOrders ? profile.acceptsCustomOrdersNow ? 'Custom open' : 'Custom paused' : null,
                    profile.supportsReadyMade ? profile.shopPaused ? 'Shop paused' : 'Shop open' : null,
                  ].filter(Boolean).join(' · ') || 'No order switches enabled'}
                />
                <CapabilityRow
                  icon="map-pin"
                  label="Fulfillment"
                  value={[
                    profile.pickupAvailable ? 'Pickup' : null,
                    profile.deliveryAvailable ? 'Delivery' : null,
                    profile.shippingAvailable ? 'Shipping' : null,
                  ].filter(Boolean).join(' · ') || 'Not configured'}
                  last={!profile.shipsInternationally}
                />
                {profile.shipsInternationally ? (
                  <CapabilityRow icon="globe" label="International" value="Shipping enabled" last />
                ) : null}
              </View>
            )}

            {profile ? (
              <TouchableOpacity
                style={styles.trustStatusRow}
                onPress={() => router.push('/(tailor)/profile/trust-access' as never)}
                activeOpacity={0.75}
              >
                <View style={styles.trustStatusIcon}>
                  <Feather
                    name={readiness.tone === 'success' ? 'shield' : 'alert-circle'}
                    size={15}
                    color={readiness.tone === 'warning' ? Colors.warning : Colors.needleGreen}
                  />
                </View>
                <View style={styles.trustStatusCopy}>
                  <Text style={styles.trustStatusTitle}>Trust & access</Text>
                  <Text style={styles.trustStatusMeta} numberOfLines={1}>
                    {readiness.payoutProviderLabel
                      ? `${readiness.title} · ${readiness.payoutProviderLabel}`
                      : readiness.title}
                  </Text>
                </View>
                <Text style={styles.trustStatusAction}>{readiness.actionLabel ? 'Fix' : 'View'}</Text>
                <Feather name="chevron-right" size={16} color={Colors.midGrey} />
              </TouchableOpacity>
            ) : null}

            {/* ── No profile CTA ── */}
            {(!profile || !profile.profileCompleted) && (
              <TouchableOpacity
                style={styles.setupCard}
                onPress={() => router.push('/(tailor)/profile/setup')}
                activeOpacity={0.7}
              >
                <View style={styles.setupIconWrap}>
                  <Feather name="user-check" size={22} color={Colors.needleGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.setupTitle}>Complete your profile</Text>
                  <Text style={styles.setupHint}>Add bio, portfolio, and ID to go live</Text>
                </View>
                <Feather name="chevron-right" size={18} color={Colors.midGrey} />
              </TouchableOpacity>
            )}

            {/* ── Stats ── */}
            {profile && (
              <View style={styles.statsRow}>
                <StatPill
                  label="Rating"
                  value={profile.avgRating > 0 ? profile.avgRating.toFixed(1) : 'No rating'}
                  sub={profile.avgRating > 0 ? '★' : undefined}
                  onPress={() => router.push('/(tailor)/profile/reviews')}
                />
                <StatPill
                  label="Reviews"
                  value={String(profile.totalReviews)}
                  onPress={() => router.push('/(tailor)/profile/reviews')}
                />
                <StatPill
                  label="Orders"
                  value={String(profile.totalOrders)}
                  onPress={() =>
                    router.push({
                      pathname: '/(tailor)/orders',
                      params: {
                        tab: 'completed',
                        historyChain: appendToHistory(undefined, '/(tailor)/profile'),
                      },
                    })
                  }
                />
              </View>
            )}

            {/* ── Profile actions ── */}
            <View style={styles.flatList}>
              <FlatRow
                icon="book-open"
                label="Drapeon guide & help"
                accent
                onPress={() => router.push('/(tailor)/profile/help')}
              />
              {profile?.isLive && (
                <FlatRow
                  icon="share-2"
                  label="Share my live profile"
                  onPress={() => shareTailorProfile(profile.id, profile.displayName)}
                />
              )}
              {profile?.supportsReadyMade && (
                <FlatRow
                  icon="shopping-bag"
                  label="Manage shop items"
                  onPress={() => router.push('/(tailor)/shop')}
                />
              )}
              <FlatRow
                icon="user-plus"
                label="Invite a client"
                onPress={() =>
                  inviteCustomerFromTailor(profile?.id ?? '', profile?.displayName ?? displayName)
                }
              />
              <FlatRow
                icon="scissors"
                label="Invite a fellow tailor"
                last
                onPress={() => inviteTailorColleague(user?.id ?? '', displayName)}
              />
            </View>

            {/* ── Account ── */}
            <View style={styles.flatList}>
              <FlatRow
                icon="shopping-bag"
                label={switchingRole ? 'Opening customer mode...' : 'Use Drapeon as a customer'}
                onPress={switchToCustomerMode}
              />
              <FlatRow
                icon="settings"
                label="Account settings"
                onPress={() => router.push('/(tailor)/profile/account-settings')}
              />
              <FlatRow
                icon="file-text"
                label="Legal"
                last
                onPress={() => {
                  void openExternalUrl(
                    'https://drapeon.co/legal',
                    'Please visit https://drapeon.co/legal manually.'
                  )
                }}
              />
            </View>

            {/* ── Sign out ── */}
            <TouchableOpacity
              style={styles.logOutRow}
              onPress={handleSignOut}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
            >
              <Feather name="log-out" size={18} color={Colors.error} />
              <Text style={styles.logOutText}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  )
}

// ─── StatPill ─────────────────────────────────────────────────────────────────

function StatPill({
  label,
  value,
  sub,
  onPress,
}: {
  label: string
  value: string
  sub?: string
  onPress?: () => void
}) {
  const content = (
    <>
      <View style={styles.statValueRow}>
        <Text style={styles.statValue}>{value}</Text>
        {sub && <Text style={styles.statSub}>{sub}</Text>}
      </View>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  )

  if (onPress) {
    return (
      <TouchableOpacity style={styles.statPill} onPress={onPress} activeOpacity={0.75}>
        {content}
      </TouchableOpacity>
    )
  }

  return <View style={styles.statPill}>{content}</View>
}

function CapabilityRow({
  icon,
  label,
  value,
  last,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  value: string
  last?: boolean
}) {
  return (
    <View style={[styles.capabilityRow, last && styles.capabilityRowLast]}>
      <View style={styles.capabilityIcon}>
        <Feather name={icon} size={15} color={Colors.needleGreen} />
      </View>
      <Text style={styles.capabilityRowLabel}>{label}</Text>
      <Text style={styles.capabilityRowValue} numberOfLines={2}>{value}</Text>
    </View>
  )
}

// ─── FlatRow ──────────────────────────────────────────────────────────────────

function FlatRow({
  icon,
  label,
  last,
  accent,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  last?: boolean
  accent?: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.flatRow, accent && styles.flatRowAccent, last && styles.rowLast]}
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather
        name={icon}
        size={20}
        color={accent ? Colors.textInverse : Colors.inkLight}
        style={{ width: 24 }}
      />
      <Text style={[styles.flatRowLabel, accent && styles.flatRowLabelAccent]}>{label}</Text>
      <Feather name="chevron-right" size={16} color={accent ? Colors.textInverse : Colors.midGrey} />
    </TouchableOpacity>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  scrollContent: {},
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
    letterSpacing: 0,
  },
  stateTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
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
  statePrimaryBtnText: {
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
    fontSize: FontSize.sm,
  },
  stateSecondaryBtn: {
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  stateSecondaryBtnText: {
    color: Colors.ink,
    fontWeight: FontWeight.medium,
    fontSize: FontSize.sm,
  },

  // Profile header strip
  profileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.bone,
  },
  profileHeaderTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  bellBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.sm,
  },
  bellBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.kanteRust,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: Colors.white,
  },
  bellBadgeText: { fontSize: 10, fontWeight: FontWeight.bold, color: Colors.textInverse },

  // Hero
  hero: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    ...Shadow.sm,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLoading: { opacity: 0.6 },
  avatarImage: {
    width: 76,
    height: 76,
    borderRadius: 38,
    overflow: 'hidden',
  },
  avatarText: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    borderWidth: 2,
    borderColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveIndicator: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.white,
  },
  heroTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    alignItems: 'flex-start',
  },
  heroName: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  heroLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroLocation: { flex: 1, fontSize: FontSize.xs, color: Colors.inkLight },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.xs, marginTop: 2 },
  availPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.bone,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  availDot: { width: 6, height: 6, borderRadius: 3 },
  availText: { fontSize: FontSize.xs, color: Colors.ink, fontWeight: FontWeight.medium },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveBadgeText: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  body: {
    backgroundColor: Colors.bone,
    paddingTop: 0,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  workspaceCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 14,
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
    letterSpacing: 0,
  },
  workspaceText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 19,
  },
  capabilityCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 14,
    gap: 0,
    ...Shadow.sm,
  },
  capabilityTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.sm,
  },
  cardHeaderAction: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  capabilityRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
    paddingVertical: Spacing.sm,
  },
  capabilityRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  capabilityIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capabilityRowLabel: {
    width: 88,
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.medium,
  },
  capabilityRowValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: FontSize.xs,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
    lineHeight: 18,
  },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  guideText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },

  // Setup CTA
  setupCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '30',
    ...Shadow.sm,
  },
  setupIconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setupTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  setupHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },

  // Trust status
  trustStatusRow: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  trustStatusIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustStatusCopy: { flex: 1, gap: 2 },
  trustStatusTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  trustStatusMeta: { fontSize: FontSize.xs, color: Colors.midGrey },
  trustStatusAction: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  // Stats
  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  statPill: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 12,
    alignItems: 'center',
    gap: 4,
    ...Shadow.sm,
  },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  statValue: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink },
  statSub: { fontSize: FontSize.sm, color: Colors.warning, fontWeight: FontWeight.bold },
  statLabel: { fontSize: FontSize.xs, color: Colors.midGrey },

  // Sections
  section: { gap: Spacing.sm },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  ratingSummary: {
    fontSize: FontSize.md,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  sectionLink: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  // Reviews
  reviewList: { gap: Spacing.md },
  emptySectionCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 14,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  emptySectionBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  emptySectionBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  emptySectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptySectionHint: { fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 20 },
  emptySectionCta: {
    marginTop: Spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  emptySectionCtaText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
  reviewCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 14,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  reviewAvatar: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.lightGrey,
  },
  reviewInitial: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  reviewerName: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  reviewDate: { fontSize: FontSize.xs, color: Colors.midGrey },
  reviewStars: { fontSize: FontSize.sm, color: Colors.warning, letterSpacing: 1 },
  reviewTags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  reviewTag: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 3,
  },
  reviewTagText: { fontSize: 11, color: Colors.inkLight },
  reviewBody: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 18 },

  responseWrap: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '35',
  },
  responseLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
  },
  responseText: { fontSize: FontSize.sm, color: Colors.ink, lineHeight: 20 },
  editResponseLink: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    textDecorationLine: 'underline',
    marginTop: 4,
  },
  replyLink: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  replyForm: { gap: Spacing.sm },
  replyWarning: {
    backgroundColor: Colors.kanteRust + '15',
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.kanteRust + '40',
  },
  replyWarningText: { fontSize: FontSize.xs, color: Colors.kanteRust },
  replyInput: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: FontSize.sm,
    color: Colors.ink,
    minHeight: 80,
    lineHeight: 20,
  },
  replyCount: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'right' },
  replyActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  replyCancelText: { fontSize: FontSize.sm, color: Colors.midGrey },
  replySubmit: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  replySubmitText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },

  // Flat action list
  flatList: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  flatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  flatRowAccent: { backgroundColor: Colors.needleGreen },
  rowLast: { borderBottomWidth: 0 },
  flatRowLabel: { flex: 1, fontSize: FontSize.sm, color: Colors.ink },
  flatRowLabelAccent: { color: Colors.textInverse, fontWeight: FontWeight.semibold },

  // Log out
  logOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  logOutText: { fontSize: FontSize.md, color: Colors.error, fontWeight: FontWeight.medium },
})
