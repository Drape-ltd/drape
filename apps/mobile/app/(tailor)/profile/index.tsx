import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView,
  KeyboardAvoidingView, Platform, Image, ActivityIndicator, Linking,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { deriveTailorReadiness } from '@/lib/tailor-readiness'
import { useTailorProfile } from '@/lib/tailorProfile'
import { shareTailorProfile, inviteTailorColleague, inviteCustomerFromTailor } from '@/lib/invite'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

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
  pickupAvailable: boolean
  deliveryAvailable: boolean
  shippingAvailable: boolean
  shipsInternationally: boolean
  idVerificationStatus: string
  isLive: boolean
  profileCompleted: boolean
  stripeAccountId: string | null
  paystackAccountId: string | null
}

const TAILOR_STOREFRONT_GUIDE_KEY = 'drape_tailor_storefront_best_use_dismissed'

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

const AVAIL_LABEL: Record<string, string> = { OPEN: 'Available', LIMITED: 'Limited', FULLY_BOOKED: 'Fully booked' }
const AVAIL_COLOR: Record<string, string> = { OPEN: Colors.success, LIMITED: Colors.warning, FULLY_BOOKED: Colors.error }

const ID_STATUS_LABEL: Record<string, string> = {
  NOT_SUBMITTED: 'Verification Required',
  PENDING: 'ID Verification In Review',
  APPROVED: 'Identity Verified',
  REJECTED: 'Verification Failed — Action Required',
}
const ID_STATUS_COLOR: Record<string, string> = {
  NOT_SUBMITTED: Colors.midGrey,
  PENDING: Colors.warning,
  APPROVED: Colors.success,
  REJECTED: Colors.error,
}
const ID_STATUS_BG: Record<string, string> = {
  NOT_SUBMITTED: Colors.bone,
  PENDING: '#FFFBEB',
  APPROVED: '#F0FDF4',
  REJECTED: Colors.errorLight,
}

const LIVE_BADGE: Record<string, { label: string; color: string; bg: string; dot: boolean }> = {
  LIVE:          { label: 'Live',          color: Colors.success, bg: Colors.success + '25',  dot: true },
  PENDING:       { label: 'In review',     color: Colors.warning, bg: Colors.warning + '22',  dot: false },
  REJECTED:      { label: 'Action needed', color: Colors.error,   bg: Colors.error + '18',    dot: false },
  NOT_SUBMITTED: { label: 'Setup needed',  color: Colors.midGrey, bg: Colors.lightGrey,       dot: false },
}

export default function TailorProfileScreen() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { avatarUrl, setAvatarUrl } = useTailorProfile()
  const [profile, setProfile] = useState<TailorProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchErrorMessage, setFetchErrorMessage] = useState('')
  const [retryTrigger, setRetryTrigger] = useState(0)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [pendingQuoteCount, setPendingQuoteCount] = useState(0)
  const [showStorefrontGuide, setShowStorefrontGuide] = useState(true)

  useEffect(() => {
    AsyncStorage.getItem(`${TAILOR_STOREFRONT_GUIDE_KEY}:${user?.id ?? 'guest'}`)
      .then((value) => setShowStorefrontGuide(value !== '1'))
      .catch(() => {})
  }, [user?.id])

  async function dismissStorefrontGuide() {
    setShowStorefrontGuide(false)
    try {
      await AsyncStorage.setItem(`${TAILOR_STOREFRONT_GUIDE_KEY}:${user?.id ?? 'guest'}`, '1')
    } catch {}
  }

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

  const displayName = user?.user_metadata?.display_name ?? ''
  const initials = displayName
    .split(' ')
    .map((p: string) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

  useFocusEffect(useCallback(() => {
    async function load() {
      setFetchErrorMessage('')
      setLoading(true)
      try {
      const [profileRes, pendingRes] = await Promise.allSettled([
        supabase
          .from('tailor_profiles')
          .select('id, display_name, location, bio, seller_type, tier, avg_rating, total_reviews, total_orders, availability, specialty_tags, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available, ships_internationally, id_verification_status, is_live, avatar_url, profile_completed, stripe_account_id, paystack_account_id')
          .eq('user_id', user?.id)
          .maybeSingle(),
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('tailor_id', user?.id)
          .eq('stage', 'PENDING_QUOTE'),
      ])

      const profileFailed =
        profileRes.status === 'rejected' ||
        (profileRes.status === 'fulfilled' && !!profileRes.value.error)
      const pendingFailed =
        pendingRes.status === 'rejected' ||
        (pendingRes.status === 'fulfilled' && !!pendingRes.value.error)

      if (profileFailed && pendingFailed) {
        const profileError =
          profileRes.status === 'fulfilled' ? profileRes.value.error : profileRes.reason
        const pendingError =
          pendingRes.status === 'fulfilled' ? pendingRes.value.error : pendingRes.reason
        const rootError = profileError ?? pendingError
        setFetchErrorMessage(
          isLikelyConnectivityIssue(rootError)
            ? 'Connection looks weak. Your storefront details should still be there once the signal stabilizes, so retry when it improves.'
            : 'Your profile is where customers judge trust, portfolio, and reviews. Please try again in a moment.',
        )
        setProfile(null)
        setPendingQuoteCount(0)
        setLoading(false)
        return
      }

      const profileData =
        profileRes.status === 'fulfilled' && !profileRes.value.error
          ? (profileRes.value.data as any)
          : null
      const pendingCount =
        pendingRes.status === 'fulfilled' && !pendingRes.value.error
          ? (pendingRes.value.count ?? 0)
          : 0

      if (profileData) {
        const d = profileData
        setProfile({
          id: d.id,
          displayName: d.display_name,
          location: d.location,
          bio: d.bio,
          sellerType: d.seller_type ?? 'TAILOR',
          tier: d.tier,
          avgRating: d.avg_rating,
          totalOrders: d.total_orders,
          totalReviews: d.total_reviews ?? 0,
          availability: d.availability,
          specialtyTags: asStringList(d.specialty_tags),
          supportsCustomOrders: d.supports_custom_orders ?? true,
          supportsReadyMade: d.supports_ready_made ?? false,
          pickupAvailable: d.pickup_available ?? false,
          deliveryAvailable: d.delivery_available ?? false,
          shippingAvailable: d.shipping_available ?? false,
          shipsInternationally: d.ships_internationally ?? false,
          idVerificationStatus: d.id_verification_status ?? 'NOT_SUBMITTED',
          isLive: d.is_live,
          profileCompleted: d.profile_completed ?? false,
          stripeAccountId: d.stripe_account_id ?? null,
          paystackAccountId: d.paystack_account_id ?? null,
        })
        if (d.avatar_url) setAvatarUrl(d.avatar_url)
      } else {
        setProfile(null)
      }

      setPendingQuoteCount(pendingCount)
      setLoading(false)
      } catch (error) {
        setFetchErrorMessage(
          isLikelyConnectivityIssue(error)
            ? 'Connection looks weak. Your storefront details should still be there once the signal stabilizes, so retry when it improves.'
            : 'Your profile is where customers judge trust, portfolio, and reviews. Please try again in a moment.',
        )
        setLoading(false)
      }
    }
    load()
  }, [user?.id, retryTrigger]))

  // ── Avatar upload ────────────────────────────────────────────────────────────

  async function handleAvatarPress() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to set a profile picture.')
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    })

    if (result.canceled || !result.assets[0]) return

    setUploadingAvatar(true)
    try {
      const compressed = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 800, height: 800 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      )

      const fileName = `${user!.id}/avatar.jpg`
      const response = await fetch(compressed.uri)
      const blob = await response.blob()

      if (blob.size > 5 * 1024 * 1024) {
        Alert.alert('Image too large', 'Please choose a photo under 5 MB.')
        return
      }

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName)

      const bustUrl = `${publicUrl}?t=${Date.now()}`

      const { error: profileError } = await supabase
        .from('tailor_profiles')
        .update({ avatar_url: bustUrl })
        .eq('user_id', user!.id)
      if (profileError) throw profileError

      setAvatarUrl(bustUrl)
    } catch (err) {
      console.error('[avatar upload]', err)
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

  function handleSignOut() {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => {
          void signOut().catch(() => {
            Alert.alert('Unable to log out', 'Please try again in a moment. Your storefront settings are still here, so you can keep working and log out later.')
          })
        },
      },
    ])
  }

  const idStatus = profile?.idVerificationStatus ?? 'NOT_SUBMITTED'
  const readiness = deriveTailorReadiness(profile)

  // Live status badge config
  const liveBadgeKey = profile?.isLive ? 'LIVE' : (idStatus in LIVE_BADGE ? idStatus : 'NOT_SUBMITTED')
  const liveBadge = LIVE_BADGE[liveBadgeKey]

  function handleReadinessAction() {
    if (readiness.actionLabel === 'Review payout status') {
      router.push('/(tailor)/earnings')
      return
    }
    if (readiness.actionLabel === 'Review live profile') {
      router.push('/(tailor)/profile/edit')
      return
    }
    router.push('/(tailor)/profile/setup')
  }

  if (fetchErrorMessage) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Tailor profile</Text>
            <Text style={styles.stateTitle}>Couldn't load your profile.</Text>
            <Text style={styles.stateHint}>{fetchErrorMessage}</Text>
            <TouchableOpacity
              style={styles.statePrimaryBtn}
              onPress={() => { setFetchErrorMessage(''); setLoading(true); setRetryTrigger((n) => n + 1) }}
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
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: Spacing.xxxl }}
      >

        {/* ── Profile header strip ── */}
        <View style={styles.profileHeader}>
          <Text style={styles.profileHeaderTitle}>Profile</Text>
          <TouchableOpacity
            style={styles.bellBtn}
            onPress={() => router.push('/(tailor)/profile/notifications')}
            activeOpacity={0.7}
          >
            <Feather name="bell" size={20} color={Colors.white} />
            {pendingQuoteCount > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{pendingQuoteCount > 9 ? '9+' : String(pendingQuoteCount)}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Hero ── */}
        <View style={styles.hero}>
          {/* Avatar with upload */}
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={handleAvatarPress}
            disabled={uploadingAvatar}
            activeOpacity={0.8}
          >
            {uploadingAvatar ? (
              <View style={[styles.avatar, styles.avatarLoading]}>
                <ActivityIndicator color={Colors.white} />
              </View>
            ) : avatarUrl ? (
              <Image
                source={{ uri: avatarUrl }}
                style={styles.avatarImage}
                resizeMode="cover"
                onError={() => setAvatarUrl(null)}
              />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
            )}
            {/* Camera badge */}
            <View style={styles.cameraBadge}>
              <Feather name="camera" size={11} color={Colors.white} />
            </View>
            {/* Live indicator dot */}
            {profile && (
              <View style={[
                styles.liveIndicator,
                { backgroundColor: profile.isLive ? Colors.success : Colors.midGrey },
              ]} />
            )}
          </TouchableOpacity>

          <Text style={styles.heroName}>{profile?.displayName ?? displayName}</Text>

          {profile?.location ? (
            <View style={styles.heroLocationRow}>
              <Feather name="map-pin" size={12} color="rgba(255,255,255,0.7)" />
              <Text style={styles.heroLocation}>{profile.location}</Text>
            </View>
          ) : null}

          {profile && (
            <View style={styles.pillRow}>
              <View style={styles.availPill}>
                <View style={[styles.availDot, { backgroundColor: AVAIL_COLOR[profile.availability] ?? Colors.midGrey }]} />
                <Text style={styles.availText}>{AVAIL_LABEL[profile.availability] ?? profile.availability}</Text>
              </View>
              <View style={[styles.liveBadge, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                {liveBadge.dot && <View style={[styles.liveDot, { backgroundColor: liveBadge.color }]} />}
                <Text style={styles.liveBadgeText}>{liveBadge.label}</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.body}>
          {showStorefrontGuide && (
            <View style={styles.workspaceCard}>
              <View style={styles.workspaceHeader}>
                <Text style={styles.workspaceEyebrow}>Best use</Text>
                <TouchableOpacity onPress={() => void dismissStorefrontGuide()} style={styles.workspaceClose}>
                  <Feather name="x" size={16} color={Colors.midGrey} />
                </TouchableOpacity>
              </View>
              <Text style={styles.workspaceText}>
                Keep your photo, availability, and reviews sharp here. This is the page customers judge before they book.
              </Text>
            </View>
          )}

          {profile && (
            <View style={styles.capabilityCard}>
              <Text style={styles.capabilityTitle}>How customers can buy from you</Text>
              <View style={styles.capabilityWrap}>
                <CapabilityChip label={profile.sellerType === 'BOUTIQUE' ? 'Boutique' : profile.sellerType === 'TAILOR_SHOP' ? 'Tailor shop' : 'Tailor'} />
                {profile.supportsCustomOrders ? <CapabilityChip label="Custom orders" /> : null}
                {profile.supportsReadyMade ? <CapabilityChip label="Shop now" /> : null}
                {profile.pickupAvailable ? <CapabilityChip label="Pickup" /> : null}
                {profile.deliveryAvailable ? <CapabilityChip label="Delivery" /> : null}
                {profile.shippingAvailable ? <CapabilityChip label="Shipping" /> : null}
                {profile.shipsInternationally ? <CapabilityChip label="International shipping" /> : null}
              </View>
            </View>
          )}

          {profile ? (
            <View
              style={[
                styles.readinessCard,
                readiness.tone === 'success'
                  ? styles.readinessCardSuccess
                  : readiness.tone === 'warning'
                    ? styles.readinessCardWarning
                    : null,
              ]}
            >
              <Text style={styles.readinessTitle}>{readiness.title}</Text>
              <Text style={styles.readinessBody}>{readiness.body}</Text>
              {readiness.payoutProviderLabel ? (
                <Text style={styles.readinessMeta}>Payout path detected: {readiness.payoutProviderLabel}</Text>
              ) : null}
              {readiness.actionLabel ? (
                <TouchableOpacity style={styles.readinessCta} onPress={handleReadinessAction}>
                  <Text style={styles.readinessCtaText}>{readiness.actionLabel}</Text>
                  <Feather name="arrow-right" size={14} color={Colors.needleGreen} />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.readinessSecondaryCta} onPress={() => router.push('/(tailor)/profile/trust-access' as never)}>
                <Text style={styles.readinessSecondaryCtaText}>See trust & access</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* ── No profile CTA ── */}
          {!loading && (!profile || !profile.profileCompleted) && (
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

          {/* ── ID verification status ── */}
          {profile && !profile.isLive && (
            <View style={[styles.statusCard, { backgroundColor: ID_STATUS_BG[idStatus] }]}>
              <View style={styles.statusHeader}>
                <View style={[styles.statusDot, { backgroundColor: ID_STATUS_COLOR[idStatus] }]} />
                <Text style={[styles.statusText, { color: ID_STATUS_COLOR[idStatus] }]}>
                  {ID_STATUS_LABEL[idStatus] ?? idStatus}
                </Text>
              </View>
              {idStatus === 'PENDING' && (
                <Text style={styles.statusSub}>Your profile is under review. You'll be verified within 24 hours.</Text>
              )}
              {!profile.isLive && idStatus === 'APPROVED' && (
                <Text style={styles.statusSub}>Profile under final review before going live.</Text>
              )}
              {(idStatus === 'NOT_SUBMITTED' || idStatus === 'REJECTED') && (
                <TouchableOpacity
                  style={styles.statusCta}
                  onPress={() => router.push('/(tailor)/profile/setup')}
                >
                  <Text style={styles.statusCtaText}>
                    {idStatus === 'REJECTED' ? 'Re-submit profile' : 'Complete profile'}
                  </Text>
                  <Feather name="arrow-right" size={14} color={Colors.needleGreen} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ── Stats ── */}
          {profile && (
            <View style={styles.statsRow}>
              <StatPill
                label="Rating"
                value={profile.avgRating > 0 ? profile.avgRating.toFixed(1) : '—'}
                sub={profile.avgRating > 0 ? '★' : undefined}
                onPress={() => router.push('/(tailor)/profile/reviews')}
              />
              <StatPill label="Reviews" value={String(profile.totalReviews)} onPress={() => router.push('/(tailor)/profile/reviews')} />
              <StatPill label="Orders" value={String(profile.totalOrders)} onPress={() => router.push('/(tailor)/orders')} />
            </View>
          )}

          {/* ── Profile actions ── */}
          <View style={styles.flatList}>
            <FlatRow
              icon="edit-2"
              label="Edit profile"
              onPress={() => router.push('/(tailor)/profile/edit')}
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
              onPress={() => inviteCustomerFromTailor(profile?.id ?? '', profile?.displayName ?? displayName)}
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
              icon="settings"
              label="Account settings"
              onPress={() => router.push('/(tailor)/profile/account-settings')}
            />
            <FlatRow
              icon="help-circle"
              label="Get help"
              onPress={() => router.push('/(tailor)/profile/help')}
            />
            {profile?.isLive && (
              <FlatRow
                icon="eye"
                label="Share public profile"
                onPress={() => shareTailorProfile(profile.id, profile.displayName)}
              />
            )}
            <FlatRow
              icon="file-text"
              label="Legal"
              last
              onPress={() => { void openExternalUrl('https://drapeon.co/legal', 'Please visit https://drapeon.co/legal manually.') }}
            />
          </View>

          {/* ── Log out ── */}
          <TouchableOpacity style={styles.logOutRow} onPress={handleSignOut} activeOpacity={0.6}>
            <Feather name="log-out" size={18} color={Colors.error} />
            <Text style={styles.logOutText}>Log out</Text>
          </TouchableOpacity>

        </View>
      </ScrollView>
    </SafeAreaView>
    </KeyboardAvoidingView>
  )
}

// ─── StatPill ─────────────────────────────────────────────────────────────────

function StatPill({ label, value, sub, onPress }: { label: string; value: string; sub?: string; onPress?: () => void }) {
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

function CapabilityChip({ label }: { label: string }) {
  return (
    <View style={styles.capabilityChip}>
      <Text style={styles.capabilityChipText}>{label}</Text>
    </View>
  )
}

// ─── FlatRow ──────────────────────────────────────────────────────────────────

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
  statePrimaryBtnText: { color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
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
  profileHeaderTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.white },
  bellBtn: {
    width: 38, height: 38, borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  bellBadge: {
    position: 'absolute', top: -2, right: -2,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: Colors.kanteRust,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2, borderColor: Colors.needleGreen,
  },
  bellBadgeText: { fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white },

  // Hero
  hero: {
    backgroundColor: Colors.needleGreen,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    gap: 6,
  },
  avatarWrap: { position: 'relative', marginBottom: 2 },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLoading: { opacity: 0.6 },
  avatarImage: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.45)',
    overflow: 'hidden',
  },
  avatarText: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.white },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 22, height: 22, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenDark,
    borderWidth: 2, borderColor: Colors.needleGreen,
    alignItems: 'center', justifyContent: 'center',
  },
  liveIndicator: {
    position: 'absolute', top: 2, left: 2,
    width: 12, height: 12, borderRadius: 6,
    borderWidth: 2, borderColor: Colors.needleGreen,
  },
  heroName: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.white },
  heroLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroLocation: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.7)' },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  availPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: Spacing.md, paddingVertical: 4,
    borderRadius: Radius.full,
  },
  availDot: { width: 6, height: 6, borderRadius: 3 },
  availText: { fontSize: FontSize.xs, color: Colors.white, fontWeight: FontWeight.medium },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: Spacing.md, paddingVertical: 4,
    borderRadius: Radius.full,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveBadgeText: { fontSize: FontSize.xs, color: Colors.white, fontWeight: FontWeight.medium },

  body: {
    marginTop: -(Spacing.xl + 4),
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: Colors.bone,
    paddingTop: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.xl,
  },
  workspaceCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
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
  capabilityCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  capabilityTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  capabilityWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  capabilityChip: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  capabilityChipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
  readinessCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  readinessCardWarning: {
    borderWidth: 1,
    borderColor: Colors.warning + '35',
  },
  readinessCardSuccess: {
    borderWidth: 1,
    borderColor: Colors.success + '30',
  },
  readinessTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  readinessBody: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  readinessMeta: { fontSize: FontSize.xs, color: Colors.midGrey },
  readinessCta: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  readinessCtaText: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  readinessSecondaryCta: { alignSelf: 'flex-start', paddingTop: 2 },
  readinessSecondaryCtaText: { fontSize: FontSize.xs, color: Colors.midGrey, fontWeight: FontWeight.medium },
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
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    borderWidth: 1, borderColor: Colors.needleGreen + '30', ...Shadow.sm,
  },
  setupIconWrap: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center',
  },
  setupTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  setupHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },

  // Status card
  statusCard: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm },
  statusHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  statusSub: { fontSize: FontSize.sm, color: Colors.inkLight },
  statusCta: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  statusCtaText: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  // Stats
  statsRow: { flexDirection: 'row', gap: Spacing.md },
  statPill: {
    flex: 1, backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: Spacing.lg, alignItems: 'center', gap: 4, ...Shadow.sm,
  },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  statValue: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },
  statSub: { fontSize: FontSize.sm, color: Colors.warning, fontWeight: FontWeight.bold },
  statLabel: { fontSize: FontSize.xs, color: Colors.midGrey },

  // Sections
  section: { gap: Spacing.md },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  ratingSummary: { fontSize: FontSize.md, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  sectionLink: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  // Reviews
  reviewList: { gap: Spacing.md },
  emptySectionCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
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
    letterSpacing: 0.6,
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
  emptySectionCtaText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
  reviewCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm,
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  reviewAvatar: {
    width: 38, height: 38, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center',
  },
  reviewAvatarImage: { width: 38, height: 38, borderRadius: Radius.full, backgroundColor: Colors.lightGrey },
  reviewInitial: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  reviewerName: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  reviewDate: { fontSize: FontSize.xs, color: Colors.midGrey },
  reviewStars: { fontSize: FontSize.sm, color: Colors.warning, letterSpacing: 1 },
  reviewTags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  reviewTag: {
    backgroundColor: Colors.bone, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 3,
  },
  reviewTagText: { fontSize: 11, color: Colors.inkLight },
  reviewBody: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  responseWrap: {
    backgroundColor: Colors.needleGreenLight, borderRadius: Radius.md,
    padding: Spacing.md, gap: 4,
    borderLeftWidth: 3, borderLeftColor: Colors.needleGreen,
  },
  responseLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  responseText: { fontSize: FontSize.sm, color: Colors.ink, lineHeight: 20 },
  editResponseLink: { fontSize: FontSize.xs, color: Colors.needleGreen, textDecorationLine: 'underline', marginTop: 4 },
  replyLink: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  replyForm: { gap: Spacing.sm },
  replyWarning: {
    backgroundColor: Colors.kanteRust + '15', borderRadius: Radius.sm,
    padding: Spacing.sm, borderWidth: 1, borderColor: Colors.kanteRust + '40',
  },
  replyWarningText: { fontSize: FontSize.xs, color: Colors.kanteRust },
  replyInput: {
    backgroundColor: Colors.bone, borderRadius: Radius.md,
    padding: Spacing.md, fontSize: FontSize.sm, color: Colors.ink,
    minHeight: 80, lineHeight: 20,
  },
  replyCount: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'right' },
  replyActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.lg },
  replyCancelText: { fontSize: FontSize.sm, color: Colors.midGrey },
  replySubmit: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  replySubmitText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },

  // Flat action list
  flatList: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  flatRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.lg,
    paddingHorizontal: Spacing.lg, paddingVertical: 18,
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
