import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, TextInput, KeyboardAvoidingView, Platform } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button, TierBadgeChip, Tag } from '@/components/ui'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

type TailorProfile = {
  displayName: string
  location: string
  bio: string | null
  tier: string
  avgRating: number
  totalOrders: number
  availability: string
  specialtyTags: string[]
  idVerificationStatus: string
  isLive: boolean
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

const AVAIL_LABEL: Record<string, string> = { OPEN: 'Open', LIMITED: 'Limited', FULLY_BOOKED: 'Fully booked' }
const AVAIL_COLOR: Record<string, string> = { OPEN: Colors.success, LIMITED: Colors.warning, FULLY_BOOKED: Colors.error }
const ID_STATUS_LABEL: Record<string, string> = {
  NOT_SUBMITTED: 'ID not submitted', PENDING: 'ID under review (24h)',
  APPROVED: 'ID verified ✓', REJECTED: 'ID rejected — re-upload needed',
}
const ID_STATUS_COLOR: Record<string, string> = {
  NOT_SUBMITTED: Colors.error, PENDING: Colors.warning,
  APPROVED: Colors.success, REJECTED: Colors.error,
}

export default function TailorProfileScreen() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [profile, setProfile] = useState<TailorProfile | null>(null)
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  // Review reply state: reviewId → { text, submitting, warning }
  const [replyOpen, setReplyOpen] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyWarning, setReplyWarning] = useState(false)
  const [replySubmitting, setReplySubmitting] = useState(false)

  const displayName = user?.user_metadata?.display_name ?? ''

  useFocusEffect(useCallback(() => {
    async function fetch() {
      const [profileRes, reviewsRes] = await Promise.all([
        supabase
          .from('tailor_profiles')
          .select('display_name, location, bio, tier, avg_rating, total_orders, availability, specialty_tags, id_verification_status, is_live')
          .eq('user_id', user?.id)
          .single(),
        supabase
          .from('reviews')
          .select('id, rating, tags, body, reviewer_name, created_at, tailor_response')
          .eq('tailor_id', user?.id)
          .order('created_at', { ascending: false })
          .limit(10),
      ])

      if (profileRes.data) {
        const d = profileRes.data as any
        setProfile({
          displayName: d.display_name, location: d.location, bio: d.bio,
          tier: d.tier, avgRating: d.avg_rating, totalOrders: d.total_orders,
          availability: d.availability, specialtyTags: d.specialty_tags ?? [],
          idVerificationStatus: d.id_verification_status ?? 'NOT_SUBMITTED',
          isLive: d.is_live,
        })
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

      setLoading(false)
    }
    fetch()
  }, [user?.id]))

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
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ])
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: Spacing.xxxl }}>
        <View style={styles.content}>
          {/* Identity */}
          <View style={styles.identityCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{profile?.displayName ?? displayName}</Text>
              <Text style={styles.email}>{user?.email}</Text>
              {profile && (
                <View style={styles.availRow}>
                  <View style={[styles.availDot, { backgroundColor: AVAIL_COLOR[profile.availability] ?? Colors.midGrey }]} />
                  <Text style={styles.availText}>{AVAIL_LABEL[profile.availability] ?? profile.availability}</Text>
                </View>
              )}
            </View>
            {profile && <TierBadgeChip tier={profile.tier as any} />}
          </View>

          {/* No profile yet — setup CTA */}
          {!loading && !profile && (
            <View style={styles.setupCard}>
              <Text style={styles.setupTitle}>Complete your profile to go live</Text>
              <Text style={styles.setupHint}>
                Add your bio, portfolio, and ID verification to start receiving orders.
              </Text>
              <Button label="Set up profile" onPress={() => router.push('/(tailor)/profile/setup')} />
            </View>
          )}

          {/* ID verification status */}
          {profile && (
            <View style={[styles.statusCard, { borderColor: ID_STATUS_COLOR[profile.idVerificationStatus] + '40' }]}>
              <Text style={[styles.statusText, { color: ID_STATUS_COLOR[profile.idVerificationStatus] }]}>
                {ID_STATUS_LABEL[profile.idVerificationStatus] ?? profile.idVerificationStatus}
              </Text>
              {!profile.isLive && profile.idVerificationStatus === 'APPROVED' && (
                <Text style={styles.statusSub}>Your profile is under final review before going live.</Text>
              )}
              {profile.isLive && (
                <Text style={styles.statusSub}>Your profile is live. Customers can find and book you.</Text>
              )}
              {(profile.idVerificationStatus === 'NOT_SUBMITTED' || profile.idVerificationStatus === 'REJECTED') && (
                <Button
                  label="Complete / re-submit profile"
                  size="sm"
                  onPress={() => router.push('/(tailor)/profile/setup')}
                />
              )}
            </View>
          )}

          {/* Stats */}
          {profile && (
            <View style={styles.statsRow}>
              <StatPill label="Rating" value={profile.avgRating > 0 ? `${profile.avgRating.toFixed(1)} ★` : '—'} />
              <StatPill label="Orders" value={String(profile.totalOrders)} />
            </View>
          )}

          {/* Specialties */}
          {profile && profile.specialtyTags.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Specialties</Text>
              <View style={styles.tagWrap}>
                {(profile.specialtyTags ?? []).map((t) => <Tag key={t} label={t} />)}
              </View>
            </View>
          )}

          {/* Bio */}
          {profile?.bio && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.bio}>{profile.bio}</Text>
            </View>
          )}

          {/* Reviews */}
          {reviews.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recent reviews</Text>
              <View style={styles.reviewList}>
                {reviews.map((review) => (
                  <View key={review.id} style={styles.reviewCard}>
                    {/* Reviewer + stars */}
                    <View style={styles.reviewHeader}>
                      <Text style={styles.reviewerName}>{review.reviewerName}</Text>
                      <Text style={styles.reviewDate}>
                        {new Date(review.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                    </View>
                    <Text style={styles.reviewStars}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</Text>

                    {/* Tags */}
                    {review.tags.length > 0 && (
                      <View style={styles.reviewTags}>
                        {review.tags.map((tag) => (
                          <View key={tag} style={styles.reviewTag}>
                            <Text style={styles.reviewTagText}>{tag}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Written review */}
                    {review.body ? <Text style={styles.reviewBody}>{review.body}</Text> : null}

                    {/* Existing response */}
                    {review.response && replyOpen !== review.id && (
                      <View style={styles.responseWrap}>
                        <Text style={styles.responseLabel}>Your response</Text>
                        <Text style={styles.responseText}>{review.response}</Text>
                        <TouchableOpacity onPress={() => openReply(review.id, review.response)}>
                          <Text style={styles.editResponseLink}>Edit response</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Reply form */}
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

          {/* Edit profile */}
          {profile && (
            <Button
              label="Edit profile"
              variant="secondary"
              onPress={() => router.push('/(tailor)/profile/setup')}
            />
          )}

          {/* Sign out */}
          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
    </KeyboardAvoidingView>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl },
  identityCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.lg,
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, ...Shadow.sm,
  },
  avatar: {
    width: 56, height: 56, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.white },
  name: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  email: { fontSize: FontSize.sm, color: Colors.midGrey, marginTop: 2 },
  availRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  availDot: { width: 7, height: 7, borderRadius: 4 },
  availText: { fontSize: FontSize.xs, color: Colors.inkLight },

  setupCard: {
    backgroundColor: Colors.needleGreenLight, borderRadius: Radius.lg,
    padding: Spacing.xl, gap: Spacing.md, borderWidth: 1, borderColor: Colors.needleGreen + '40',
  },
  setupTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink },
  setupHint: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  statusCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg,
    gap: Spacing.md, borderWidth: 1, ...Shadow.sm,
  },
  statusText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  statusSub: { fontSize: FontSize.sm, color: Colors.inkLight },

  statsRow: { flexDirection: 'row', gap: Spacing.md },
  statPill: {
    flex: 1, backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: Spacing.lg, alignItems: 'center', gap: 4, ...Shadow.sm,
  },
  statValue: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },
  statLabel: { fontSize: FontSize.xs, color: Colors.midGrey },

  section: { gap: Spacing.sm },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  bio: { fontSize: FontSize.md, color: Colors.inkLight, lineHeight: 24 },

  signOutBtn: { alignSelf: 'flex-start' },
  signOutText: { fontSize: FontSize.md, color: Colors.error, fontWeight: FontWeight.medium },

  // Reviews
  reviewList: { gap: Spacing.md },
  reviewCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm,
  },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewerName: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  reviewDate: { fontSize: FontSize.xs, color: Colors.midGrey },
  reviewStars: { fontSize: FontSize.md, color: Colors.warning, letterSpacing: 1 },
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
  replyLink: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium, textDecorationLine: 'underline' },

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
})
