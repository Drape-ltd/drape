import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView,
  TextInput, KeyboardAvoidingView, Platform, Image, ActivityIndicator, Linking,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useTailorProfile } from '@/lib/tailorProfile'
import { shareTailorProfile, inviteTailorColleague, inviteCustomerFromTailor } from '@/lib/invite'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

type TailorProfile = {
  id: string
  displayName: string
  location: string
  bio: string | null
  tier: string
  avgRating: number
  totalOrders: number
  totalReviews: number
  availability: string
  specialtyTags: string[]
  idVerificationStatus: string
  isLive: boolean
  profileCompleted: boolean
}

type ReviewRow = {
  id: string
  rating: number
  tags: string[]
  body: string | null
  reviewerName: string
  createdAt: string
  response: string | null
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
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [retryTrigger, setRetryTrigger] = useState(0)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [pendingQuoteCount, setPendingQuoteCount] = useState(0)
  const [replyOpen, setReplyOpen] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyWarning, setReplyWarning] = useState(false)
  const [replySubmitting, setReplySubmitting] = useState(false)

  const displayName = user?.user_metadata?.display_name ?? ''
  const initials = displayName
    .split(' ')
    .map((p: string) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

  useFocusEffect(useCallback(() => {
    async function load() {
      setFetchError(false)
      try {
      // V1.1 TODO: replace Promise.all with independent fetches so a single query failure
      // (e.g. reviews) doesn't block the entire profile from rendering.
      const [profileRes, reviewsRes, pendingRes] = await Promise.all([
        supabase
          .from('tailor_profiles')
          .select('id, display_name, location, bio, tier, avg_rating, total_reviews, total_orders, availability, specialty_tags, id_verification_status, is_live, avatar_url, profile_completed')
          .eq('user_id', user?.id)
          .maybeSingle(),
        supabase
          .from('reviews')
          .select('id, rating, tags, body, reviewer_name, created_at, tailor_response')
          .eq('tailor_id', user?.id)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('tailor_id', user?.id)
          .eq('stage', 'PENDING_QUOTE'),
      ])

      if (profileRes.data) {
        const d = profileRes.data as any
        setProfile({
          id: d.id,
          displayName: d.display_name,
          location: d.location,
          bio: d.bio,
          tier: d.tier,
          avgRating: d.avg_rating,
          totalOrders: d.total_orders,
          totalReviews: d.total_reviews ?? 0,
          availability: d.availability,
          specialtyTags: d.specialty_tags ?? [],
          idVerificationStatus: d.id_verification_status ?? 'NOT_SUBMITTED',
          isLive: d.is_live,
          profileCompleted: d.profile_completed ?? false,
        })
        if (d.avatar_url) setAvatarUrl(d.avatar_url)
      }

      setReviews(
        ((reviewsRes.data ?? []) as any[]).map((r) => ({
          id: r.id,
          rating: r.rating,
          tags: r.tags ?? [],
          body: r.body,
          reviewerName: r.reviewer_name ?? 'Customer',
          createdAt: r.created_at,
          response: r.tailor_response ?? null,
        }))
      )

      setPendingQuoteCount(pendingRes.count ?? 0)
      setLoading(false)
      } catch {
        setFetchError(true)
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

      await supabase
        .from('tailor_profiles')
        .update({ avatar_url: bustUrl })
        .eq('user_id', user!.id)

      setAvatarUrl(bustUrl)
    } catch (err) {
      console.error('[avatar upload]', err)
      Alert.alert('Upload failed', 'Could not update your photo. Please try again.')
    } finally {
      setUploadingAvatar(false)
    }
  }

  function openReply(reviewId: string, existing: string | null) {
    setReplyOpen(reviewId)
    setReplyText(existing ?? '')
    setReplyWarning(false)
  }

  function onReplyChange(text: string) {
    const filtered = filterContactInfo(text)
    setReplyWarning(filtered !== text)
    setReplyText(filtered)
  }

  async function submitReply(reviewId: string) {
    if (!replyText.trim()) return
    setReplySubmitting(true)
    const { error } = await supabase
      .from('reviews')
      .update({
        tailor_response: replyText.trim(),
        tailor_responded_at: new Date().toISOString(),
      })
      .eq('id', reviewId)
    setReplySubmitting(false)
    if (error) {
      Alert.alert('Error', 'Could not save your response. Please try again.')
      return
    }
    setReviews((prev) =>
      prev.map((r) => r.id === reviewId ? { ...r, response: replyText.trim() } : r)
    )
    setReplyOpen(null)
  }

  function handleSignOut() {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: signOut },
    ])
  }

  const idStatus = profile?.idVerificationStatus ?? 'NOT_SUBMITTED'

  // Live status badge config
  const liveBadgeKey = profile?.isLive ? 'LIVE' : (idStatus in LIVE_BADGE ? idStatus : 'NOT_SUBMITTED')
  const liveBadge = LIVE_BADGE[liveBadgeKey]

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.lg, padding: Spacing.xl }}>
          <Text style={{ fontSize: FontSize.md, color: Colors.inkLight }}>Couldn't load your profile.</Text>
          <TouchableOpacity
            style={{ backgroundColor: Colors.needleGreen, borderRadius: Radius.full, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xxxl }}
            onPress={() => { setFetchError(false); setLoading(true); setRetryTrigger((n) => n + 1) }}
          >
            <Text style={{ color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.sm }}>Try again</Text>
          </TouchableOpacity>
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
        <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />
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
          {profile && (
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
              {profile.isLive && (
                <Text style={styles.statusSub}>Your profile is live — customers can find and book you.</Text>
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
              />
              <StatPill label="Reviews" value={String(profile.totalReviews)} />
              <StatPill label="Orders" value={String(profile.totalOrders)} />
            </View>
          )}

          {/* ── Reviews ── */}
          {reviews.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Reviews</Text>
                {profile && profile.avgRating > 0 && (
                  <Text style={styles.ratingSummary}>★ {profile.avgRating.toFixed(1)}</Text>
                )}
              </View>
              <View style={styles.reviewList}>
                {reviews.map((review) => (
                  <View key={review.id} style={styles.reviewCard}>
                    <View style={styles.reviewHeader}>
                      <View style={styles.reviewAvatar}>
                        <Text style={styles.reviewInitial}>
                          {review.reviewerName.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reviewerName}>{review.reviewerName}</Text>
                        <Text style={styles.reviewDate}>
                          {new Date(review.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                        </Text>
                      </View>
                      <Text style={styles.reviewStars}>
                        {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
                      </Text>
                    </View>

                    {review.tags.length > 0 && (
                      <View style={styles.reviewTags}>
                        {review.tags.map((tag) => (
                          <View key={tag} style={styles.reviewTag}>
                            <Text style={styles.reviewTagText}>{tag}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {review.body ? <Text style={styles.reviewBody}>{review.body}</Text> : null}

                    {review.response && replyOpen !== review.id && (
                      <View style={styles.responseWrap}>
                        <Text style={styles.responseLabel}>Your response</Text>
                        <Text style={styles.responseText}>{review.response}</Text>
                        <TouchableOpacity onPress={() => openReply(review.id, review.response)}>
                          <Text style={styles.editResponseLink}>Edit</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {replyOpen === review.id ? (
                      <View style={styles.replyForm}>
                        {replyWarning && (
                          <View style={styles.replyWarning}>
                            <Text style={styles.replyWarningText}>Contact details removed — keep responses within Drape.</Text>
                          </View>
                        )}
                        <TextInput
                          style={styles.replyInput}
                          value={replyText}
                          onChangeText={onReplyChange}
                          placeholder="Thank the customer or address their feedback…"
                          placeholderTextColor={Colors.midGrey}
                          multiline
                          maxLength={300}
                          textAlignVertical="top"
                          autoFocus
                        />
                        <Text style={styles.replyCount}>{replyText.length}/300</Text>
                        <View style={styles.replyActions}>
                          <TouchableOpacity onPress={() => setReplyOpen(null)}>
                            <Text style={styles.replyCancelText}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.replySubmit, (!replyText.trim() || replySubmitting) && { opacity: 0.5 }]}
                            onPress={() => submitReply(review.id)}
                            disabled={!replyText.trim() || replySubmitting}
                          >
                            <Text style={styles.replySubmitText}>{replySubmitting ? 'Saving…' : 'Save response'}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : !review.response ? (
                      <TouchableOpacity onPress={() => openReply(review.id, null)}>
                        <Text style={styles.replyLink}>Reply to this review</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ))}
              </View>
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
                label="Share my profile"
                onPress={() => shareTailorProfile(profile.id, profile.displayName)}
              />
            )}
            <FlatRow
              icon="user-plus"
              label="Invite a customer"
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
                label="View public profile"
                onPress={() => router.push(`/(tailor)/profile/public` as any)}
              />
            )}
            <FlatRow
              icon="file-text"
              label="Legal"
              last
              onPress={() => Linking.openURL('https://drapeon.co/legal')}
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

function StatPill({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.statPill}>
      <View style={styles.statValueRow}>
        <Text style={styles.statValue}>{value}</Text>
        {sub && <Text style={styles.statSub}>{sub}</Text>}
      </View>
      <Text style={styles.statLabel}>{label}</Text>
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
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  ratingSummary: { fontSize: FontSize.md, color: Colors.needleGreen, fontWeight: FontWeight.semibold },

  // Reviews
  reviewList: { gap: Spacing.md },
  reviewCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm,
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  reviewAvatar: {
    width: 38, height: 38, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center',
  },
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
