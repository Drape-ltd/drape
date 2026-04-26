import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue, readFunctionErrorMessage, readFunctionErrorPayload } from '@/lib/function-errors'
import { Button, Input } from '@/components/ui'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { goBackOrReturnTo } from '@/lib/navigation'

const REVIEW_TAGS = [
  'Clear communication',
  'Responsive',
  'Respectful',
  'Prepared',
  'Easy to work with',
]
const REVIEW_WINDOW_DAYS = 14

function reviewWindowClosed(stageUpdatedAt: string | null) {
  if (!stageUpdatedAt) return false
  const reviewClock = new Date(stageUpdatedAt).getTime()
  if (Number.isNaN(reviewClock)) return false
  return Date.now() - reviewClock > REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000
}

export default function TailorCustomerReviewScreen() {
  const { orderId, returnTo } = useLocalSearchParams<{ orderId: string; returnTo?: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [customerName, setCustomerName] = useState('Customer')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [rating, setRating] = useState(0)
  const [body, setBody] = useState('')
  const [bodyError, setBodyError] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function goBack() {
    goBackOrReturnTo(router, navigation, returnTo, '/(tailor)/clients')
  }

  function readPayloadString(payload: Record<string, unknown> | null, key: string) {
    const value = payload?.[key]
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }

  async function resolveReviewFailure(error: Error | null) {
    const payload = error ? await readFunctionErrorPayload(error) : null
    const code = readPayloadString(payload, 'code')
    const payloadMessage = readPayloadString(payload, 'error')

    if (code === 'UNAUTHORIZED') {
      return { message: payloadMessage ?? 'Please sign in again before saving this review.', bodyError: '', showAlert: true }
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
        message: payloadMessage ?? 'This customer review is not available right now. Reopen the order and try again.',
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
      message: await readFunctionErrorMessage(error, 'Could not save this review right now. Please try again in a moment.'),
      bodyError: '',
      showAlert: true,
    }
  }

  async function load() {
    setLoading(true)
    setLoadError('')

    try {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('customer_id, stage, stage_updated_at, customer_profiles!customer_id(display_name)')
        .eq('id', orderId)
        .eq('tailor_id', user?.id)
        .maybeSingle()

      if (orderError) throw orderError
      if (!order) {
        setLoadError('This customer review is no longer available from this account.')
        setLoading(false)
        return
      }

      const row = order as any
      if (!['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(row.stage)) {
        setLoading(false)
        Alert.alert('Review unavailable', 'You can review a customer after the order is delivered or collected.')
        goBack()
        return
      }
      if (reviewWindowClosed(row.stage_updated_at ?? null)) {
        setLoadError(`This review window has closed. Reviews can only be added within ${REVIEW_WINDOW_DAYS} days of delivery, collection, or completion.`)
        setLoading(false)
        return
      }

      setCustomerId(row.customer_id)
      setCustomerName(row.customer_profiles?.display_name ?? 'Customer')

      const { data: existing } = await supabase
        .from('customer_reviews')
        .select('rating, body, tags')
        .eq('order_id', orderId)
        .maybeSingle()

      if (existing) {
        setRating((existing as any).rating ?? 0)
        setBody((existing as any).body ?? '')
        setTags(Array.isArray((existing as any).tags) ? (existing as any).tags : [])
      }
    } catch (error) {
      setLoadError(
        isLikelyConnectivityIssue(error)
          ? 'Connection is weak. We could not load this customer review yet. Retry when the signal improves.'
          : 'We could not load this client review right now.'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [orderId, user?.id])

  function validateBody(text: string) {
    const result = filterContactInfo(text)
    if (result.blocked) {
      setBodyError(result.userMessage)
      return false
    }
    setBodyError('')
    return true
  }

  function toggleTag(tag: string) {
    setTags((prev) => prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag])
  }

  async function submit() {
    if (submitting || !customerId) return
    if (rating === 0) {
      Alert.alert('Rating required', 'Please select a star rating.')
      return
    }
    if (body.trim() && !validateBody(body)) return

    setSubmitError('')
    setSubmitting(true)

    const reviewerName = user?.user_metadata?.display_name
      ?? user?.user_metadata?.full_name
      ?? user?.user_metadata?.name
      ?? 'Tailor'

    const { error } = await invokeFunction('review-action', {
      body: {
        action: 'upsert-customer-review',
        orderId,
        customerId,
        reviewerName,
        rating,
        body: body.trim() || undefined,
        tags,
      },
    })

    setSubmitting(false)

    if (error) {
      const failure = await resolveReviewFailure(error)
      if (failure.bodyError) setBodyError(failure.bodyError)
      setSubmitError(failure.message)
      if (failure.showAlert) {
        Alert.alert(failure.message.includes('sign in again') ? 'Session expired' : 'Review unavailable', failure.message)
      }
      return
    }

    goBack()
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <Text style={styles.stateTitle}>Preparing review…</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.headerCard}>
            <Text style={styles.eyebrow}>Customer review</Text>
            <Text style={styles.title}>Couldn't open this review.</Text>
            <Text style={styles.stateHint}>{loadError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => { void load() }}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={goBack}>
              <Text style={styles.secondaryBtnText}>Back to clients</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.headerCard}>
            <Text style={styles.eyebrow}>Customer review</Text>
            <Text style={styles.title}>Rate how it was working with {customerName}.</Text>
            <Text style={styles.stateHint}>
              This note is for Drape’s internal trust record, not public profile feedback. Keep it factual and respectful, and submit it within {REVIEW_WINDOW_DAYS} days of delivery or collection.
            </Text>
          </View>

          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <TouchableOpacity key={star} onPress={() => setRating(star)}>
                <Text style={[styles.star, star <= rating && styles.starActive]}>★</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.tagsWrap}>
            {REVIEW_TAGS.map((tag) => {
              const active = tags.includes(tag)
              return (
                <TouchableOpacity
                  key={tag}
                  style={[styles.tag, active && styles.tagActive]}
                  onPress={() => toggleTag(tag)}
                >
                  <Text style={[styles.tagText, active && styles.tagTextActive]}>{tag}</Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <Input
            label="Written review"
            placeholder="Helpful context for future tailoring decisions"
            value={body}
            onChangeText={(value) => {
              setBody(value)
              if (bodyError) validateBody(value)
            }}
            onBlur={() => validateBody(body)}
            error={bodyError}
            multiline
            numberOfLines={4}
            maxLength={300}
            filterContact
            hint="Optional. No contact details."
          />
        </ScrollView>

        <View style={styles.cta}>
          {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}
          <Button label="Save review" onPress={submit} loading={submitting} disabled={submitting} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  content: { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: 120 },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  headerCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  eyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, lineHeight: 32 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.md },
  star: { fontSize: 42, color: Colors.lightGrey },
  starActive: { color: Colors.warning },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tag: {
    borderWidth: 2,
    borderColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.white,
  },
  tagActive: { backgroundColor: Colors.needleGreenLight },
  tagText: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  tagTextActive: { fontWeight: FontWeight.semibold },
  cta: {
    padding: Spacing.xl,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
    gap: Spacing.md,
  },
  submitError: { fontSize: FontSize.sm, color: Colors.error, textAlign: 'center' },
  retryBtn: {
    backgroundColor: Colors.needleGreen,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  retryBtnText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  secondaryBtn: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderWidth: 1,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  secondaryBtnText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
})
