import { useCallback, useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView,
  TextInput, KeyboardAvoidingView, Platform, Image, ActivityIndicator,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

type ReviewRow = {
  id: string
  rating: number
  tags: string[]
  body: string | null
  reviewerName: string
  reviewerAvatarUrl: string | null
  createdAt: string
  response: string | null
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

export default function TailorReviewsScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [replyOpen, setReplyOpen] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyWarning, setReplyWarning] = useState(false)
  const [replySubmitting, setReplySubmitting] = useState(false)

  useFocusEffect(useCallback(() => {
    async function load() {
      setLoading(true)
      setFetchError(false)
      const { data, error } = await supabase
        .from('reviews')
        .select('id, rating, tags, body, reviewer_name, created_at, tailor_response, orders!order_id(customer_profiles!customer_id(avatar_url))')
        .eq('tailor_id', user?.id)
        .order('created_at', { ascending: false })

      if (error) {
        setFetchError(true)
        setReviews([])
        setLoading(false)
        return
      }

      setReviews(
        ((data ?? []) as any[]).map((r) => ({
          id: r.id,
          rating: r.rating,
          tags: asStringList(r.tags),
          body: r.body,
          reviewerName: r.reviewer_name ?? 'Customer',
          reviewerAvatarUrl: r.orders?.customer_profiles?.avatar_url ?? null,
          createdAt: r.created_at,
          response: r.tailor_response ?? null,
        }))
      )
      setLoading(false)
    }

    void load()
  }, [user?.id]))

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
    setReviews((prev) => prev.map((r) => r.id === reviewId ? { ...r, response: replyText.trim() } : r))
    setReplyOpen(null)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/(tailor)/profile')} style={styles.backBtn}>
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
          <Text style={styles.stateTitle}>Couldn’t load reviews.</Text>
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {reviews.length > 0 ? reviews.map((review) => (
              <View key={review.id} style={styles.reviewCard}>
                <View style={styles.reviewHeader}>
                  {review.reviewerAvatarUrl ? (
                    <Image source={{ uri: review.reviewerAvatarUrl }} style={styles.reviewAvatarImage} />
                  ) : (
                    <View style={styles.reviewAvatar}>
                      <Text style={styles.reviewInitial}>
                        {review.reviewerName.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewerName}>{review.reviewerName}</Text>
                    <Text style={styles.reviewDate}>
                      {new Date(review.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                    </Text>
                  </View>
                  <Text style={styles.reviewStars}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</Text>
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

                {review.response && replyOpen !== review.id ? (
                  <View style={styles.responseWrap}>
                    <Text style={styles.responseLabel}>Your response</Text>
                    <Text style={styles.responseText}>{review.response}</Text>
                    <TouchableOpacity onPress={() => openReply(review.id, review.response)}>
                      <Text style={styles.editResponseLink}>Edit</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {replyOpen === review.id ? (
                  <View style={styles.replyForm}>
                    {replyWarning ? (
                      <View style={styles.replyWarning}>
                        <Text style={styles.replyWarningText}>Contact details removed — keep responses within Drape.</Text>
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
                    <Text style={styles.replyLink}>Reply to this review</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )) : (
              <View style={styles.stateWrap}>
                <Text style={styles.stateTitle}>No reviews yet.</Text>
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
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  content: { padding: Spacing.xl, gap: Spacing.md },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  reviewCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm,
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  reviewAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center',
  },
  reviewAvatarImage: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.lightGrey },
  reviewInitial: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  reviewerName: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  reviewDate: { fontSize: FontSize.xs, color: Colors.midGrey },
  reviewStars: { fontSize: FontSize.sm, color: Colors.warning },
  reviewTags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  reviewTag: {
    backgroundColor: Colors.bone,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  reviewTagText: { fontSize: FontSize.xs, color: Colors.inkLight },
  reviewBody: { fontSize: FontSize.sm, color: Colors.ink, lineHeight: 20 },
  responseWrap: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.needleGreen,
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
  replySubmitText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
})
