import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  KeyboardAvoidingView, Platform, Image as RNImage,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { promptProductFeedback } from '@/lib/productFeedback'
import { Sentry } from '@/lib/sentry'
import { referToTailor } from '@/lib/invite'
import { isLikelyConnectivityIssue, isMachineErrorCodeMessage, readFunctionErrorMessage, readFunctionErrorPayload } from '@/lib/function-errors'
import { Button, Input, PortfolioVideoPreview } from '@/components/ui'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import { stripExif } from '@/lib/stripExif'
import { launchImagePickerSafely, preferCompatibleVideoRepresentation } from '@/lib/image-picker-safe'
import { goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import {
  isVideoPickerAsset,
  pickerVideoContentType,
  pickerVideoExtension,
  validateVideoPickerAsset,
} from '@/lib/video-asset'
import {
  ALLOWED_REVIEW_MEDIA_CONTENT_TYPES,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  VIDEO_DURATION_LIMIT_MESSAGE,
} from '@drape/shared/media-policy'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const REVIEW_TAGS = [
  'Perfect fit',
  'Great communication',
  'Delivered on time',
  'Exceeded expectations',
  'Quality craftsmanship',
]
const REVIEW_WINDOW_DAYS = 14
const MAX_REVIEW_MEDIA = 6
const REVIEW_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.reviewVideo
const REVIEW_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.reviewVideo

type TailorProfileJoinRow = {
  display_name: string | null
}

type ReviewMediaDraft = {
  id: string
  uri: string
  type: 'image' | 'video'
  asset: ImagePicker.ImagePickerAsset
}

type ReviewOrderSummaryRow = {
  stage: string | null
  stage_updated_at: string | null
  garment_type: string | null
  tailor_id: string
  tailor_profile_id: string | null
  tailor_profiles: TailorProfileJoinRow | TailorProfileJoinRow[] | null
}

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function reviewWindowClosed(stageUpdatedAt: string | null) {
  if (!stageUpdatedAt) return false
  const reviewClock = new Date(stageUpdatedAt).getTime()
  if (Number.isNaN(reviewClock)) return false
  return Date.now() - reviewClock > REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000
}


function validateReviewMediaAsset(asset: ImagePicker.ImagePickerAsset) {
  if (isVideoPickerAsset(asset)) {
    return validateVideoPickerAsset(asset, {
      maxBytes: REVIEW_VIDEO_MAX_BYTES,
      maxSeconds: REVIEW_VIDEO_MAX_SECONDS,
      maxBytesMessage: `Choose review videos under ${Math.round(REVIEW_VIDEO_MAX_BYTES / (1024 * 1024))} MB.`,
      durationMessage: VIDEO_DURATION_LIMIT_MESSAGE,
    })
  }

  if (typeof asset.fileSize === 'number' && asset.fileSize > MEDIA_LIMITS_BYTES.image) {
    return 'Choose photos under 10 MB.'
  }
  return null
}

export default function ReviewScreen() {
  const { orderId, returnTo, historyChain } = useLocalSearchParams<{
    orderId: string
    returnTo?: string
    historyChain?: string
  }>()
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const userId = user?.id ?? null
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
  const [reviewMedia, setReviewMedia] = useState<ReviewMediaDraft[]>([])
  const feedbackPromptedRef = useRef(false)

  const goBack = useCallback(() => {
    goBackOrReturnTo(
      router,
      navigation,
      pickSafeReturnTo(historyChain, returnTo),
      {
        pathname: '/(customer)/orders/[id]',
        params: { id: orderId },
      },
    )
  }, [historyChain, navigation, orderId, returnTo, router])

  useContextualBackHandler(goBack, !submitting && !skipping)

  function promptOrderCompletionFeedbackOnce(reason: 'review_submitted' | 'review_skipped') {
    if (userId && !feedbackPromptedRef.current) {
      feedbackPromptedRef.current = true
      setTimeout(() => {
        promptProductFeedback({
          userId,
          context: 'order_completed',
          title: 'How was Drapeon?',
          message: 'Quick TestFlight check: did completing this order feel clear?',
          orderId,
          metadata: {
            reason,
            tailor_review_rating: rating || null,
            skipped_tailor_review: reason === 'review_skipped',
            tag_count: tags.length,
          },
        })
      }, 450)
    }
  }

  function goToCompletedOrders(reason?: 'review_submitted' | 'review_skipped') {
    if (reason) {
      promptOrderCompletionFeedbackOnce(reason)
    }
    router.replace({ pathname: '/(customer)/orders', params: { tab: 'completed' } })
  }

  function readPayloadString(payload: Record<string, unknown> | null, key: string) {
    const value = payload?.[key]
    if (typeof value !== 'string' || value.trim().length === 0) return null
    const trimmed = value.trim()
    return key === 'code' || !isMachineErrorCodeMessage(trimmed) ? trimmed : null
  }

  async function resolveReviewSubmitFailure(error: Error | null) {
    const payload = error ? await readFunctionErrorPayload(error) : null
    const code = readPayloadString(payload, 'code') ?? readPayloadString(payload, 'reason')
    const payloadMessage = readPayloadString(payload, 'message') ?? readPayloadString(payload, 'error')

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

    if (code === 'REVIEW_ALREADY_SUBMITTED') {
      return {
        message: payloadMessage ?? 'You already reviewed this order.',
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

  const loadOrderSummary = useCallback(async () => {
    setLoadingOrder(true)
    setOrderErrorMessage('')
    setOrderSummary(null)

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('stage, stage_updated_at, garment_type, tailor_id, tailor_profile_id, tailor_profiles!tailor_profile_id(display_name)')
        .eq('id', orderId)
        .eq('customer_id', userId)
        .maybeSingle()

      if (error) throw error
      if (!data) {
        setOrderErrorMessage('This finished order review is no longer available from this account.')
        setLoadingOrder(false)
        return
      }

      const order = data as ReviewOrderSummaryRow
      const currentStage = order.stage ?? ''
      if (!['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(currentStage)) {
        setOrderSummary(null)
        setLoadingOrder(false)
        Alert.alert('Review unavailable', 'This order is not ready for review yet.')
        goBack()
        return
      }
      if (reviewWindowClosed(order.stage_updated_at ?? null)) {
        setOrderErrorMessage(`This review window has closed. Reviews can only be added within ${REVIEW_WINDOW_DAYS} days of delivery, collection, or completion.`)
        setLoadingOrder(false)
        return
      }

      const { count: existingReviewCount, error: existingReviewError } = await supabase
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .eq('order_id', orderId)

      if (existingReviewError) throw existingReviewError
      if ((existingReviewCount ?? 0) > 0) {
        setOrderErrorMessage('You already reviewed this order. You can review the same tailor again after a future completed order.')
        setLoadingOrder(false)
        return
      }

      setOrderSummary({
        stage: currentStage,
        stageUpdatedAt: order.stage_updated_at ?? null,
        garmentType: order.garment_type ?? 'Order',
        tailorId: order.tailor_id,
        tailorProfileId: order.tailor_profile_id ?? null,
        tailorName: firstJoinedRow(order.tailor_profiles)?.display_name ?? 'your tailor',
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
  }, [goBack, orderId, userId])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadOrderSummary()
    }, 0)
    return () => clearTimeout(timer)
  }, [loadOrderSummary])

  function validateBody(text: string) {
    const res = filterContactInfo(text)
    if (res.blocked) { setBodyError(res.userMessage); return false }
    setBodyError(''); return true
  }

  function toggleTag(tag: string) {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])
  }

  async function pickReviewMedia() {
    if (reviewMedia.length >= MAX_REVIEW_MEDIA) {
      Alert.alert('Media limit reached', `You can add up to ${MAX_REVIEW_MEDIA} photos or videos to a review.`)
      return
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('Media access needed', 'Allow photo access to add review photos or videos.')
      return
    }

    const remainingSlots = MAX_REVIEW_MEDIA - reviewMedia.length
    const result = await launchImagePickerSafely(
      () => ImagePicker.launchImageLibraryAsync(
        preferCompatibleVideoRepresentation({
          mediaTypes: ['images', 'videos'],
          allowsMultipleSelection: true,
          selectionLimit: remainingSlots,
          quality: 0.9,
          videoMaxDuration: REVIEW_VIDEO_MAX_SECONDS,
        })
      ),
      {
        context: 'customer_review_media_picker',
        mediaLabel: 'review media file',
        extra: { orderId, userId },
      }
    )
    if (!result || result.canceled) return

    const accepted: ReviewMediaDraft[] = []
    const rejected: string[] = []
    for (const asset of result.assets.slice(0, remainingSlots)) {
      const error = validateReviewMediaAsset(asset)
      if (error) {
        rejected.push(error)
        continue
      }
      const type = isVideoPickerAsset(asset) ? 'video' : 'image'
      accepted.push({
        id: `${asset.assetId ?? asset.uri}:${Date.now()}:${accepted.length}`,
        uri: asset.uri,
        type,
        asset,
      })
    }

    if (accepted.length > 0) {
      setReviewMedia((current) => [...current, ...accepted].slice(0, MAX_REVIEW_MEDIA))
    }
    if (rejected.length > 0) {
      Alert.alert('Some media was skipped', Array.from(new Set(rejected)).join('\n'))
    }
  }

  function removeReviewMedia(id: string) {
    setReviewMedia((current) => current.filter((item) => item.id !== id))
  }

  async function uploadReviewMediaDrafts() {
    if (!userId || reviewMedia.length === 0) return []

    const uploadedUrls: string[] = []
    for (const [index, item] of reviewMedia.entries()) {
      const isVideo = item.type === 'video'
      const contentType = isVideo ? pickerVideoContentType(item.asset) : 'image/jpeg'
      const extension = isVideo ? pickerVideoExtension(item.asset) : 'jpg'
      const uri = isVideo ? item.uri : await stripExif(item.uri, { maxWidth: 1800, compress: 0.88 })
      const publicUrl = await uploadPublicStorageImage({
        bucket: 'review-media',
        path: `reviews/${orderId}/${userId}/${Date.now()}-${index}.${extension}`,
        uri,
        contentType,
        maxBytes: isVideo ? REVIEW_VIDEO_MAX_BYTES : MEDIA_LIMITS_BYTES.image,
        allowedContentTypes: ALLOWED_REVIEW_MEDIA_CONTENT_TYPES,
        purpose: 'REVIEW_MEDIA',
      })
      uploadedUrls.push(publicUrl)
    }
    return uploadedUrls
  }
  async function submit() {
    if (submitting || skipping) return
    if (!orderSummary) return
    if (rating === 0) { Alert.alert('Rating required', 'Please select a star rating.'); return }
    if (!validateBody(body)) return

    setSubmitError('')
    setSubmitting(true)

    const displayName: string = user?.user_metadata?.display_name ?? ''
    // Show first name + last initial for privacy: "Ade O."
    const parts = displayName.trim().split(' ')
    const reviewerName = parts.length > 1
      ? `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`
      : parts[0] || 'Customer'

    let mediaUrls: string[] = []
    try {
      mediaUrls = await uploadReviewMediaDrafts()
    } catch (uploadError) {
      Sentry.captureException(uploadError, { extra: { context: 'review_media_upload', orderId, mediaCount: reviewMedia.length } })
      setSubmitting(false)
      const message = isLikelyConnectivityIssue(uploadError)
        ? 'Connection looks weak. Review media did not upload yet.'
        : 'We could not upload that review media. Try removing it or choosing a smaller file.'
      setSubmitError(message)
      Alert.alert('Media not uploaded', message)
      return
    }

    const { data, error } = await invokeFunction<{ ok?: boolean; publicationStatus?: 'published' | 'held' }>('review-action', {
      body: {
        action: 'submit-tailor-review',
        orderId,
        reviewerName,
        rating,
        body: body.trim() || undefined,
        tags,
        mediaUrls,
      },
    })

    if (error) {
      Sentry.captureException(error, {
        extra: {
          context: 'review_submit',
          orderId,
          orderSummary,
          rating,
          tags,
          bodyLength: body.trim().length,
        },
      })
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
        goBack()
        return
      }
    }

    capture('review_submitted', {
      rating,
      tag_count: tags.length,
      media_count: mediaUrls.length,
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
        'Your review was saved. It may take a little longer to appear publicly while Drapeon checks the order context.',
      )
      goToCompletedOrders('review_submitted')
    } else if (rating >= 4 && tailorProfileId) {
      Alert.alert(
        'Glad it went well!',
        `Know someone who could use a great tailor? Share ${tailorName}'s profile with them.`,
        [
          {
            text: 'Share',
            onPress: () => {
              referToTailor(tailorProfileId, tailorName, user?.id ?? '')
              goToCompletedOrders('review_submitted')
            },
          },
          { text: 'Maybe later', onPress: () => goToCompletedOrders('review_submitted') },
        ]
      )
    } else {
      goToCompletedOrders('review_submitted')
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
          Alert.alert('Could not complete order', message)
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
      Alert.alert('Could not complete order', message)
      return
    }
    setSkipping(false)
    goToCompletedOrders('review_skipped')
  }

  const displayRating = hovered || rating

  if (loadingOrder) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
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
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
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
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => goToCompletedOrders()}>
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
                Reviews stay open for {REVIEW_WINDOW_DAYS} days after delivery, collection, or completion. Most go public quickly, but Drapeon may hold a review a little longer if there is policy or dispute context to check.
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
              <Text style={styles.sectionLabel}>What stood out?</Text>
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
              hint={`${body.length}/300 · Stars and tags are enough. Add a note only if you want.`}
            />


            <View style={styles.section}>
              <View style={styles.mediaHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionLabel}>Photos or video</Text>
                  <Text style={styles.mediaHint}>Optional. Add up to {MAX_REVIEW_MEDIA}; videos must be {REVIEW_VIDEO_MAX_SECONDS} seconds or less.</Text>
                </View>
                <TouchableOpacity
                  style={[styles.mediaAddBtn, reviewMedia.length >= MAX_REVIEW_MEDIA && styles.mediaAddBtnDisabled]}
                  onPress={pickReviewMedia}
                  disabled={reviewMedia.length >= MAX_REVIEW_MEDIA || submitting || skipping}
                >
                  <Text style={styles.mediaAddText}>{reviewMedia.length > 0 ? 'Add more' : 'Add media'}</Text>
                </TouchableOpacity>
              </View>
              {reviewMedia.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaStrip}>
                  {reviewMedia.map((item) => (
                    <View key={item.id} style={styles.mediaThumbWrap}>
                      {item.type === 'video' ? (
                        <PortfolioVideoPreview uri={item.uri} style={styles.mediaThumb} autoplay={false} />
                      ) : (
                        <RNImage source={{ uri: item.uri }} style={styles.mediaThumb} resizeMode="cover" />
                      )}
                      <TouchableOpacity style={styles.mediaRemoveBtn} onPress={() => removeReviewMedia(item.id)}>
                        <Text style={styles.mediaRemoveText}>×</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              ) : null}
            </View>
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
        <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom + Spacing.sm, Spacing.xl) }]}>
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
  starFilled: { color: Colors.statusPending },

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


  mediaHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  mediaHint: { marginTop: 4, fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  mediaAddBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.white,
  },
  mediaAddBtnDisabled: { opacity: 0.45 },
  mediaAddText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  mediaStrip: { gap: Spacing.sm, paddingRight: Spacing.lg },
  mediaThumbWrap: { position: 'relative' },
  mediaThumb: { width: 92, height: 92, borderRadius: Radius.md, backgroundColor: Colors.boneDeep, overflow: 'hidden' },
  mediaRemoveBtn: {
    position: 'absolute',
    top: -7,
    right: -7,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.ink,
  },
  mediaRemoveText: { color: Colors.textInverse, fontSize: 18, lineHeight: 20, fontWeight: FontWeight.bold },
  noteCard: {
    backgroundColor: Colors.boneDeep, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.needleGreen + '35',
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
  retryBtnText: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
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
