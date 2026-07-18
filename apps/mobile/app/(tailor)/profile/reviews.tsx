import { useCallback, useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import { useNavigation, useRouter, useFocusEffect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { AvatarImage } from '@/components/ui/AvatarImage'
import { goBackOrFallback } from '@/lib/navigation'

type ReviewRow = {
  id: string
  rating: number
  tags: string[]
  body: string | null
  reviewerName: string
  reviewerAvatarUrl: string | null
  createdAt: string
  response: string | null
  publishedAt: string | null
  flagged: boolean
}

type CustomerProfileJoinRow = {
  display_name: string | null
  avatar_url: string | null
}

type ReviewOrderJoinRow = {
  customer_profiles: CustomerProfileJoinRow | CustomerProfileJoinRow[] | null
}

type ReviewQueryRow = {
  id: string
  rating: number | null
  tags: string[] | null
  body: string | null
  reviewer_name: string | null
  created_at: string
  tailor_response: string | null
  published_at: string | null
  flagged: boolean | null
  orders: ReviewOrderJoinRow | ReviewOrderJoinRow[] | null
}

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function reviewVisibilityMeta(review: ReviewRow) {
  if (review.publishedAt) {
    return {
      label: 'Public',
      tone: 'public' as const,
      description: 'Visible on your profile now.',
    }
  }

  if (review.flagged) {
    return {
      label: 'Held for review',
      tone: 'held' as const,
      description: 'This review is saved, but it is waiting on a trust or moderation check before it can go public.',
    }
  }

  return {
    label: 'Not public yet',
    tone: 'pending' as const,
    description: 'This review is saved, but it is not visible on your public profile yet.',
  }
}

export default function TailorReviewsScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [replyOpen, setReplyOpen] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyWarning, setReplyWarning] = useState(false)
  const [replySubmitting, setReplySubmitting] = useState(false)

  const load = useCallback(async () => {
    if (!userId) {
      setReviews([])
      setFetchError(false)
      setLoading(false)
      return
    }
    setLoading(true)
    setFetchError(false)
    const { data, error } = await supabase
      .from('reviews')
      .select('id, rating, tags, body, reviewer_name, created_at, tailor_response, published_at, flagged, orders!order_id(customer_profiles!customer_id(display_name, avatar_url))')
      .eq('tailor_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      setFetchError(true)
      setReviews([])
      setLoading(false)
      return
    }

    setReviews(
      ((data ?? []) as ReviewQueryRow[]).map((r) => {
        const order = firstJoinedRow(r.orders)
        const customerProfile = firstJoinedRow(order?.customer_profiles)
        return {
          id: r.id,
          rating: r.rating ?? 0,
          tags: asStringList(r.tags),
          body: r.body,
          reviewerName: customerProfile?.display_name ?? r.reviewer_name ?? 'Customer',
          reviewerAvatarUrl: customerProfile?.avatar_url ?? null,
          createdAt: r.created_at,
          response: r.tailor_response ?? null,
          publishedAt: r.published_at ?? null,
          flagged: !!r.flagged,
        }
      })
    )
    setLoading(false)
  }, [userId])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  function openReply(reviewId: string, existing: string | null) {
    setReplyOpen(reviewId)
    setReplyText(existing ?? '')
    setReplyWarning(false)
  }

  function onReplyChange(text: string) {
    const result = filterContactInfo(text)
    setReplyWarning(result.blocked)
    setReplyText(text)
  }

  async function submitReply(reviewId: string) {
    if (!replyText.trim() || replyWarning) return
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
      Alert.alert(
        'Error',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not save your response yet. Your reply is still here, so retry when the signal improves.'
          : 'Could not save your response right now. Please try again in a moment.',
      )
      return
    }
    setReviews((prev) => prev.map((r) => r.id === reviewId ? { ...r, response: replyText.trim() } : r))
    setReplyOpen(null)
  }

  function goBack() {
    goBackOrFallback(router, navigation, '/(tailor)/profile')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Reviews</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={Colors.needleGreen} />
        </View>
      ) : fetchError ? (
        <View style={styles.stateWrap}>
          <Text style={styles.stateTitle}>Couldn't load reviews.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { void load() }}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {reviews.length > 0 ? reviews.map((review) => {
              const visibility = reviewVisibilityMeta(review)
              return (
              <View key={review.id} style={styles.reviewCard}>
                <View style={styles.reviewHeader}>
                  <AvatarImage
                    uri={review.reviewerAvatarUrl}
                    initials={review.reviewerName}
                    size={40}
                    style={styles.reviewAvatarImage}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewerName}>{review.reviewerName}</Text>
                    <Text style={styles.reviewDate}>
                      {new Date(review.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                    </Text>
                  </View>
                  <Text style={styles.reviewStars}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</Text>
                </View>

                <View
                  style={[
                    styles.visibilityPill,
                    visibility.tone === 'public'
                      ? styles.visibilityPillPublic
                      : visibility.tone === 'held'
                        ? styles.visibilityPillHeld
                        : styles.visibilityPillPending,
                  ]}
                >
                  <Text
                    style={[
                      styles.visibilityPillText,
                      visibility.tone === 'public'
                        ? styles.visibilityPillTextPublic
                        : visibility.tone === 'held'
                          ? styles.visibilityPillTextHeld
                          : styles.visibilityPillTextPending,
                    ]}
                  >
                    {visibility.label}
                  </Text>
                </View>

                {review.tags.length > 0 ? (
                  <View style={styles.reviewTags}>
                    {review.tags.map((tag) => (
                      <View key={tag} style={styles.reviewTag}>
                        <Text style={styles.reviewTagText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {review.body ? <Text style={styles.reviewBody}>{review.body}</Text> : null}
                <Text style={styles.reviewVisibilityText}>{visibility.description}</Text>

                {review.response && replyOpen !== review.id ? (
                  <View style={styles.responseWrap}>
                    <Text style={styles.responseLabel}>Public response</Text>
                    <Text style={styles.responseText}>{review.response}</Text>
                    <TouchableOpacity onPress={() => openReply(review.id, review.response)}>
                      <Text style={styles.editResponseLink}>Edit response</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {replyOpen === review.id ? (
                  <View style={styles.replyForm}>
                    {replyWarning ? (
                      <View style={styles.replyWarning}>
                        <Text style={styles.replyWarningText}>Contact details removed — keep responses within Drapeon.</Text>
                      </View>
                    ) : null}
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
                    <Text style={styles.replyLink}>Respond publicly</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              )
            }) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No customer reviews yet.</Text>
                <Text style={styles.emptyText}>Completed orders with reviews will appear here with their visibility state and your response history.</Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  content: { padding: Spacing.lg, gap: Spacing.md },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl, gap: Spacing.md },
  stateTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display, textAlign: 'center' },
  retryBtn: {
    backgroundColor: Colors.needleGreen,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
  },
  retryBtnText: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  emptyCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 16,
    gap: 6,
    ...Shadow.sm,
  },
  emptyTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  emptyText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 18 },
  reviewCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm,
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  reviewAvatarImage: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.lightGrey },
  reviewerName: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  reviewDate: { fontSize: FontSize.xs, color: Colors.midGrey },
  reviewStars: { fontSize: FontSize.sm, color: Colors.warning },
  visibilityPill: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  visibilityPillPublic: { backgroundColor: Colors.needleGreenLight },
  visibilityPillHeld: { backgroundColor: Colors.errorLight },
  visibilityPillPending: { backgroundColor: Colors.bone },
  visibilityPillText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  visibilityPillTextPublic: { color: Colors.needleGreen },
  visibilityPillTextHeld: { color: Colors.kanteRust },
  visibilityPillTextPending: { color: Colors.inkLight },
  reviewTags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  reviewTag: {
    backgroundColor: Colors.bone,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  reviewTagText: { fontSize: FontSize.xs, color: Colors.inkLight },
  reviewBody: { fontSize: FontSize.sm, color: Colors.ink, lineHeight: 20 },
  reviewVisibilityText: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  responseWrap: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '35',
    gap: 4,
  },
  responseLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  responseText: { fontSize: FontSize.sm, color: Colors.ink, lineHeight: 20 },
  editResponseLink: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  replyLink: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  replyForm: { gap: Spacing.sm },
  replyWarning: {
    backgroundColor: Colors.errorLight,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  replyWarningText: { fontSize: FontSize.xs, color: Colors.kanteRust },
  replyInput: {
    minHeight: 92,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.sm,
    color: Colors.ink,
  },
  replyCount: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'right' },
  replyActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.lg },
  replyCancelText: { fontSize: FontSize.sm, color: Colors.midGrey },
  replySubmit: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  replySubmitText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
})
