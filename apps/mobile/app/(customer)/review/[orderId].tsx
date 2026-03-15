import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
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

export default function ReviewScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>()
  const router = useRouter()
  const { user } = useAuth()

  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [body, setBody] = useState('')
  const [bodyError, setBodyError] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  function validateBody(text: string) {
    const res = filterContactInfo(text)
    if (res.blocked) { setBodyError("Contact details can't be included in reviews."); return false }
    setBodyError(''); return true
  }

  function toggleTag(tag: string) {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])
  }

  async function submit() {
    if (rating === 0) { Alert.alert('Rating required', 'Please select a star rating.'); return }
    if (body.trim() && !validateBody(body)) return

    setSubmitting(true)

    // Get tailor_id + tailor_profile_id from order
    const { data: order } = await supabase
      .from('orders')
      .select('tailor_id, tailor_profile_id')
      .eq('id', orderId)
      .eq('customer_id', user?.id)
      .single()

    if (!order) {
      setSubmitting(false)
      Alert.alert('Error', 'Order not found.')
      return
    }

    const displayName: string = user?.user_metadata?.display_name ?? ''
    // Show first name + last initial for privacy: "Ade O."
    const parts = displayName.trim().split(' ')
    const reviewerName = parts.length > 1
      ? `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`
      : parts[0] || 'Customer'

    const { error } = await supabase.from('reviews').insert({
      order_id: orderId,
      tailor_id: (order as any).tailor_id,
      tailor_profile_id: (order as any).tailor_profile_id ?? null,
      reviewer_name: reviewerName,
      rating,
      body: body.trim() || null,
      tags,
    })

    if (error) {
      setSubmitting(false)
      Alert.alert('Error', 'Could not submit review. Please try again.')
      return
    }

    // Move order to COMPLETE
    await supabase
      .from('orders')
      .update({ stage: 'COMPLETE' })
      .eq('id', orderId)

    // Update tailor avg_rating in profile (best-effort)
    const { data: allReviews } = await supabase
      .from('reviews')
      .select('rating')
      .eq('tailor_id', (order as any).tailor_id)

    if (allReviews && allReviews.length > 0) {
      const avg = allReviews.reduce((s: number, r: any) => s + r.rating, 0) / allReviews.length
      await supabase
        .from('tailor_profiles')
        .update({
          avg_rating: Math.round(avg * 10) / 10,
          total_reviews: allReviews.length,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', (order as any).tailor_id)
    }

    // Increment total_orders on the tailor profile
    await supabase.rpc('increment_tailor_orders', { tailor_user_id: (order as any).tailor_id }).catch(() => {
      // Non-fatal if RPC doesn't exist yet — total_orders can be back-filled
    })

    capture('review_submitted', {
      rating,
      tag_count: tags.length,
      has_body: !!body.trim(),
      tags,
    })

    setSubmitting(false)
    router.replace('/(customer)/orders')
  }

  async function skip() {
    await supabase.from('orders').update({ stage: 'COMPLETE' }).eq('id', orderId)
    router.replace('/(customer)/orders')
  }

  const displayRating = hovered || rating

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
          <View style={styles.content}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.heading}>How was your order?</Text>
              <Text style={styles.sub}>Your review helps other customers and rewards great tailors.</Text>
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
              placeholder="Describe your experience — the fit, the communication, the quality…"
              value={body}
              onChangeText={(v) => { setBody(v); if (bodyError) validateBody(v) }}
              onBlur={() => validateBody(body)}
              error={bodyError}
              multiline
              numberOfLines={5}
              maxLength={300}
              filterContact
              hint={`${body.length}/300 · Published after a short review hold`}
            />

            {/* Reviewer note */}
            <View style={styles.noteCard}>
              <Text style={styles.noteText}>
                Your review appears publicly as "{user?.user_metadata?.display_name?.split(' ')[0]} {user?.user_metadata?.display_name?.split(' ').slice(-1)[0]?.[0]}." — first name and last initial only.
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* CTAs */}
        <View style={styles.cta}>
          <Button
            label="Submit review"
            onPress={submit}
            loading={submitting}
            disabled={rating === 0}
          />
          <TouchableOpacity style={styles.skipBtn} onPress={skip}>
            <Text style={styles.skipText}>Skip — complete order without reviewing</Text>
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

  cta: {
    padding: Spacing.xl, gap: Spacing.md, backgroundColor: Colors.white,
    borderTopWidth: 1, borderTopColor: Colors.lightGrey,
  },
  skipBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  skipText: { fontSize: FontSize.sm, color: Colors.midGrey },
})
