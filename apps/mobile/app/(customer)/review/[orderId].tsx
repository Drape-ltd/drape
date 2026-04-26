import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { Sentry } from '@/lib/sentry'
import { referToTailor } from '@/lib/invite'
import { isLikelyConnectivityIssue, readFunctionErrorMessage, readFunctionErrorPayload } from '@/lib/function-errors'
import { Button, Input } from '@/components/ui'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const REVIEW_TAGS = [
  'Perfect fit',
  'Great communication',
  'Delivered on time',
  'Exceeded expectations',
  'Quality craftsmanship',
]
const REVIEW_WINDOW_DAYS = 14

function reviewWindowClosed(stageUpdatedAt: string | null) {
  if (!stageUpdatedAt) return false
  const reviewClock = new Date(stageUpdatedAt).getTime()
  if (Number.isNaN(reviewClock)) return false
  return Date.now() - reviewClock > REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000
}

export default function ReviewScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const [orderSummary, setOrderSummary] = useState<{
    stage: string
    stageUpdatedAt: string | null
    garmentType: string
    tailorId: string
    tailorProfileId: string | null
    tailorName: string
  } | null>(null)
  const [loadingOrder, setLoadingOrder] = useState(true)
  const [orderErrorMessage, setOrderErrorMessage] = useState('')

  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [body, setBody] = useState('')
  const [bodyError, setBodyError] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function goToCompletedOrders() {
    router.replace({ pathname: '/(customer)/orders', params: { tab: 'completed' } })
  }

  function readPayloadString(payload: Record<string, unknown> | null, key: string) {
    const value = payload?.[key]
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }

  async function resolveReviewSubmitFailure(error: Error | null) {
    const payload = error ? await readFunctionErrorPayload(error) : null
    const code = readPayloadString(payload, 'code')
    const payloadMessage = readPayloadString(payload, 'error')

    if (code === 'UNAUTHORIZED') {
      return { message: payloadMessage ?? 'Please sign in again before submitting your review.', bodyError: '', showAlert: true }
    }

    if (code === 'BLOCKED_CONTACT' || code === 'THREATENING_LANGUAGE') {
      return {
        message: payloadMessage ?? "That review can't be submitted yet.",
        bodyError: payloadMessage ?? "That review can't be submitted yet.",
        showAlert: false,
      }
    }

    if (code === 'RATE_LIMITED') {
      return {
        message: payloadMessage ?? 'Too many review attempts right now. Please wait a moment before trying again.',
        bodyError: '',
        showAlert: true,
      }
    }

    if (code === 'ORDER_NOT_READY_FOR_REVIEW' || code === 'ORDER_NOT_FOUND' || code === 'FORBIDDEN') {
      return {
        message: payloadMessage ?? 'This review is not available right now. Reopen the order and try again.',
        bodyError: '',
        showAlert: true,
      }
    }

    if (code === 'REVIEW_WINDOW_CLOSED') {
      return {
        message: payloadMessage ?? `This review window has closed. Reviews can only be added within ${REVIEW_WINDOW_DAYS} days of delivery or collection.`,
        bodyError: '',
        showAlert: true,
      }
    }

    if (isLikelyConnectivityIssue(error)) {
      return {
        message: 'Your connection looks weak. Your review is still here, so retry when the signal improves.',
        bodyError: '',
        showAlert: false,
      }
    }

    return {
      message: await readFunctionErrorMessage(error, 'Could not submit this review right now. Please try again in a moment.'),
      bodyError: '',
      showAlert: true,
    }
  }

  async function loadOrderSummary() {
    setLoadingOrder(true)
    setOrderErrorMessage('')
    setOrderSummary(null)

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('stage, stage_updated_at, garment_type, tailor_id, tailor_profile_id, tailor_profiles!tailor_profile_id(display_name)')
        .eq('id', orderId)
        .eq('customer_id', user?.id)
        .maybeSingle()

      if (error) throw error
      if (!data) {
        setOrderErrorMessage('This finished order review is no longer available from this account.')
        setLoadingOrder(false)
        return
      }

      const order = data as any
      if (!['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage)) {
        setOrderSummary(null)
        setLoadingOrder(false)
        Alert.alert('Review unavailable', 'This order is not ready for review yet.')
        router.replace(`/(customer)/orders/${orderId}`)
        return
      }
      if (reviewWindowClosed(order.stage_updated_at ?? null)) {
        setOrderErrorMessage(`This review window has closed. Reviews can only be added within ${REVIEW_WINDOW_DAYS} days of delivery, collection, or completion.`)
        setLoadingOrder(false)
        return
      }

      setOrderSummary({
        stage: order.stage,
        stageUpdatedAt: order.stage_updated_at ?? null,
        garmentType: order.garment_type,
        tailorId: order.tailor_id,
        tailorProfileId: order.tailor_profile_id ?? null,
        tailorName: order.tailor_profiles?.display_name ?? 'your tailor',
      })
    } catch (error) {
      setOrderErrorMessage(
        isLikelyConnectivityIssue(error)
          ? 'Connection is weak. We could not load this review yet. Retry when the signal improves.'
          : 'We could not open this review right now.'
      )
    } finally {
      setLoadingOrder(false)
    }
  }

  useEffect(() => {
    void loadOrderSummary()
  }, [orderId, user?.id])

  function validateBody(text: string) {
    const res = filterContactInfo(text)
    if (res.blocked) { setBodyError(res.userMessage); return false }
    setBodyError(''); return true
  }

  function toggleTag(tag: string) {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])
  }

  async function submit() {
    if (submitting || skipping) return
    if (!orderSummary) return
    if (rating === 0) { Alert.alert('Rating required', 'Please select a star rating.'); return }
    if (body.trim() && !validateBody(body)) return

    setSubmitError('')
    setSubmitting(true)

    const displayName: string = user?.user_metadata?.display_name ?? ''
    // Show first name + last initial for privacy: "Ade O."
    const parts = displayName.trim().split(' ')
    const reviewerName = parts.length > 1
      ? `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`
      : parts[0] || 'Customer'

    const { data, error } = await invokeFunction<{ ok?: boolean; publicationStatus?: 'published' | 'held' }>('review-action', {
      body: {
        action: 'submit-tailor-review',
        orderId,
        reviewerName,
        rating,
        body: body.trim() || undefined,
        tags,
      },
    })

    if (error) {
      console.error('review submit failed', {
        orderId,
        orderSummary,
        rating,
        tags,
        bodyLength: body.trim().length,
        error,
      })
      Sentry.captureException(error, { extra: { context: 'review_submit', orderId } })
      setSubmitting(false)
      const failure = await resolveReviewSubmitFailure(error)
      if (failure.bodyError) setBodyError(failure.bodyError)
      setSubmitError(failure.message)
      if (failure.showAlert) {
        Alert.alert(failure.message.includes('sign in again') ? 'Session expired' : 'Review unavailable', failure.message)
      }
      return
    }

    // Move order to COMPLETE via Edge Function (stage column is service-role only).
    // avg_rating, total_reviews, total_orders are updated automatically by DB triggers.
    if (orderSummary.stage !== 'COMPLETE') {
      const { error: completeError } = await invokeFunction('customer-order-action', {
        body: { orderId, action: 'complete-order' },
      })
      if (completeError) {
        Sentry.captureException(completeError, { extra: { context: 'complete_order_after_review', orderId } })
        setSubmitting(false)
        const completeMessage = isLikelyConnectivityIssue(completeError)
          ? 'Your review was saved, but the order could not finish on this connection yet. Reopen the order when the signal improves.'
          : 'Your review was saved, but we could not finalize the order yet. Please reopen the order and try again.'
        setSubmitError(completeMessage)
        Alert.alert('Review saved', completeMessage)
        router.replace(`/(customer)/orders/${orderId}`)
        return
      }
    }

    capture('review_submitted', {
      rating,
      tag_count: tags.length,
      has_body: !!body.trim(),
      tags,
    })

    setSubmitting(false)

    const publicationStatus = data?.publicationStatus ?? 'published'

    // After a 4 or 5 star review, prompt to refer the tailor to a friend
    const tailorName = orderSummary.tailorName
    const tailorProfileId = orderSummary.tailorProfileId
    if (publicationStatus === 'held') {
      Alert.alert(
        'Review received',
        'Your review was saved. It may take a little longer to appear publicly while Drape checks the order context.',
      )
      goToCompletedOrders()
    } else if (rating >= 4 && tailorProfileId) {
      Alert.alert(
        'Glad it went well!',
        `Know someone who could use a great tailor? Share ${tailorName}'s profile with them.`,
        [
          {
            text: 'Share',
            onPress: () => {
              referToTailor(tailorProfileId, tailorName, user?.id ?? '')
              goToCompletedOrders()
            },
          },
          { text: 'Maybe later', onPress: goToCompletedOrders },
        ]
      )
    } else {
      goToCompletedOrders()
    }
  }

  async function skip() {
    if (submitting || skipping) return
    if (!orderSummary) return
    setSubmitError('')
    setSkipping(true)
    try {
      if (orderSummary.stage !== 'COMPLETE') {
        const { error: skipCompleteError } = await invokeFunction('customer-order-action', {
          body: { orderId, action: 'complete-order' },
        })
        if (skipCompleteError) {
          Sentry.captureException(skipCompleteError, { extra: { context: 'complete_order_skip', orderId } })
          setSkipping(false)
          const message = isLikelyConnectivityIssue(skipCompleteError)
            ? 'Connection looks weak. We could not complete this order yet. Retry when the signal improves.'
            : 'We could not complete this order right now. Please try again.'
          setSubmitError(message)
          Alert.alert('Error', message)
          return
        }
      }
    } catch (error) {
      Sentry.captureException(error, { extra: { context: 'load_order_before_skip_review', orderId } })
      setSkipping(false)
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not complete this order yet. Retry when the signal improves.'
        : 'We could not complete this order right now. Please try again.'
      setSubmitError(message)
      Alert.alert('Error', message)
      return
    }
    setSkipping(false)
    goToCompletedOrders()
  }

  const displayRating = hovered || rating

  if (loadingOrder) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order review</Text>
            <Text style={styles.stateTitle}>Preparing your review…</Text>
            <Text style={styles.stateHint}>
              We’re loading the finished order details first so you can review the right job with confidence.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (orderErrorMessage || !orderSummary) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order review</Text>
            <Text style={styles.stateTitle}>Couldn't open this review.</Text>
            <Text style={styles.stateHint}>
              {orderErrorMessage || 'This screen should help you close the loop on a finished order and leave useful feedback for future customers.'}
            </Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => void loadOrderSummary()}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={goToCompletedOrders}>
              <Text style={styles.secondaryBtnText}>Open completed orders</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
          <View style={styles.content}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.heading}>How was your order?</Text>
              <Text style={styles.sub}>
                {orderSummary.garmentType} with {orderSummary.tailorName}.
              </Text>
            </View>

            <View style={styles.noteCard}>
              <Text style={styles.noteText}>
                Review is optional. You can skip it and still complete the order. If something is still wrong with the garment, reopen the order and raise a concern instead of using the review screen.
              </Text>
            </View>

            <View style={styles.noteCard}>
              <Text style={styles.noteText}>
                Reviews stay open for {REVIEW_WINDOW_DAYS} days after delivery, collection, or completion. Most go public quickly, but Drape may hold a review a little longer if there is policy or dispute context to check.
              </Text>
            </View>

            {/* Star rating */}
            <View style={styles.starsSection}>
              <Text style={styles.starsLabel}>
                {displayRating === 0 ? 'Tap to rate' : RATING_LABELS[displayRating]}
              </Text>
              <View style={styles.stars}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity
                    key={star}
                    onPress={() => setRating(star)}
                    onPressIn={() => setHovered(star)}
                    onPressOut={() => setHovered(0)}
                    style={styles.starBtn}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.star, displayRating >= star && styles.starFilled]}>★</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Tags */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>What stood out? (optional)</Text>
              <View style={styles.tagWrap}>
                {REVIEW_TAGS.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    style={[styles.tag, tags.includes(tag) && styles.tagActive]}
                    onPress={() => toggleTag(tag)}
                  >
                    <Text style={[styles.tagText, tags.includes(tag) && styles.tagTextActive]}>
                      {tags.includes(tag) ? '✓ ' : ''}{tag}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Written review */}
            <Input
              label="Written review (optional)"
              placeholder="Describe your experience: the fit, the communication, the quality..."
              value={body}
              onChangeText={(v) => { setBody(v); if (bodyError) validateBody(v) }}
              onBlur={() => validateBody(body)}
              error={bodyError}
              multiline
              numberOfLines={5}
              maxLength={300}
              filterContact
              hint={`${body.length}/300`}
            />

            {/* Reviewer note */}
            <View style={styles.noteCard}>
              <Text style={styles.noteText}>
                {(() => {
                  const displayName = (user?.user_metadata?.display_name ?? '').trim()
                  const parts = displayName ? displayName.split(' ') : []
                  const publicName = parts.length > 1
                    ? `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`
                    : parts[0] || 'Customer'
                  return `Your review appears publicly as "${publicName}". First name and last initial only.`
                })()}
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* CTAs */}
        <View style={styles.cta}>
          {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}
          <Button
            label="Submit review"
            onPress={submit}
            loading={submitting}
            disabled={rating === 0 || skipping}
          />
          <TouchableOpacity style={styles.skipBtn} onPress={skip} disabled={submitting || skipping}>
            <Text style={[styles.skipText, (submitting || skipping) && styles.skipTextDisabled]}>
              {skipping ? 'Completing order...' : 'Skip and complete order without reviewing'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const RATING_LABELS: Record<number, string> = {
  1: 'Poor', 2: 'Below average', 3: 'Good', 4: 'Great', 5: 'Excellent',
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl },

  header: { gap: Spacing.sm },
  heading: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
  sub: { fontSize: FontSize.md, color: Colors.inkLight, lineHeight: 22 },

  starsSection: { alignItems: 'center', gap: Spacing.md },
  starsLabel: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink, minHeight: 26 },
  stars: { flexDirection: 'row', gap: Spacing.sm },
  starBtn: { padding: Spacing.xs },
  star: { fontSize: 44, color: Colors.lightGrey },
  starFilled: { color: '#F59E0B' },

  section: { gap: Spacing.md },
  sectionLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tag: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  tagActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  tagText: { fontSize: FontSize.sm, color: Colors.inkLight, fontWeight: FontWeight.medium },
  tagTextActive: { color: Colors.needleGreen },

  noteCard: {
    backgroundColor: Colors.boneDeep, borderRadius: Radius.md, padding: Spacing.md,
    borderLeftWidth: 3, borderLeftColor: Colors.needleGreen,
  },
  noteText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
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
  stateTitle: { fontSize: FontSize.lg, color: Colors.ink, fontWeight: FontWeight.semibold, textAlign: 'center' },
  stateHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    backgroundColor: Colors.needleGreen,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
  },
  retryBtnText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  secondaryBtn: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderWidth: 1,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
  },
  secondaryBtnText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },

  cta: {
    padding: Spacing.xl, gap: Spacing.md, backgroundColor: Colors.white,
    borderTopWidth: 1, borderTopColor: Colors.lightGrey,
  },
  submitError: { fontSize: FontSize.sm, color: Colors.error, textAlign: 'center' },
  skipBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  skipText: { fontSize: FontSize.sm, color: Colors.midGrey },
  skipTextDisabled: { opacity: 0.6 },
})
