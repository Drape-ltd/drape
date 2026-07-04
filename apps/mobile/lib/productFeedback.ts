import { Alert, Platform } from 'react-native'
import { supabase } from './supabase'

export type ProductFeedbackContext =
  | 'vision_scan_saved'
  | 'vision_scan_failed'
  | 'order_completed'
  | 'general'

type ProductFeedbackInput = {
  userId?: string | null
  context: ProductFeedbackContext
  rating?: number | null
  comment?: string | null
  measurementScanId?: string | null
  orderId?: string | null
  metadata?: Record<string, unknown>
}

function cleanRating(value: number | null | undefined) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5
    ? value
    : null
}

export async function submitProductFeedback(input: ProductFeedbackInput) {
  if (!input.userId) return

  const { error } = await supabase.from('product_feedback').insert({
    user_id: input.userId,
    context: input.context,
    rating: cleanRating(input.rating),
    comment: input.comment?.trim() || null,
    measurement_scan_id: input.measurementScanId ?? null,
    order_id: input.orderId ?? null,
    app_variant: process.env.EXPO_PUBLIC_APP_VARIANT ?? (__DEV__ ? 'development' : 'production'),
    platform: Platform.OS,
    app_version: process.env.EXPO_PUBLIC_APP_VERSION ?? null,
    metadata: input.metadata ?? {},
  })

  if (error && __DEV__) {
    console.warn('[product_feedback] insert failed', error)
  }
}

export function promptProductFeedback(input: Omit<ProductFeedbackInput, 'rating'> & {
  title: string
  message: string
}) {
  if (!input.userId) return

  const send = (rating: number) => {
    void submitProductFeedback({
      userId: input.userId,
      context: input.context,
      rating,
      comment: input.comment,
      measurementScanId: input.measurementScanId,
      orderId: input.orderId,
      metadata: input.metadata,
    })
  }

  Alert.alert(input.title, input.message, [
    { text: 'Great', onPress: () => send(5) },
    { text: 'Needs work', onPress: () => send(2) },
    { text: 'Not now', style: 'cancel' },
  ])
}
