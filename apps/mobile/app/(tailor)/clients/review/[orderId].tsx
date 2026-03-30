import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button, Input } from '@/components/ui'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const REVIEW_TAGS = [
  'Clear communication',
  'Responsive',
  'Respectful',
  'Prepared',
  'Easy to work with',
]

export default function TailorCustomerReviewScreen() {
  const { orderId, returnTo } = useLocalSearchParams<{ orderId: string; returnTo?: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const [customerName, setCustomerName] = useState('Customer')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [rating, setRating] = useState(0)
  const [body, setBody] = useState('')
  const [bodyError, setBodyError] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  function goBack() {
    if (returnTo) router.replace(returnTo as any)
    else router.replace('/(tailor)/clients')
  }

  useEffect(() => {
    async function load() {
      setLoading(true)

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('customer_id, stage, customer_profiles!customer_id(display_name)')
        .eq('id', orderId)
        .eq('tailor_id', user?.id)
        .maybeSingle()

      if (orderError || !order) {
        setLoading(false)
        Alert.alert('Review unavailable', 'We could not load this client review yet.')
        goBack()
        return
      }

      const row = order as any
      if (!['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(row.stage)) {
        setLoading(false)
        Alert.alert('Review unavailable', 'You can review a customer after the order is delivered or collected.')
        goBack()
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

      setLoading(false)
    }

    void load()
  }, [orderId, user?.id])

  function validateBody(text: string) {
    const result = filterContactInfo(text)
    if (result.blocked) {
      setBodyError("Contact details can't be included in reviews.")
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
      Alert.alert('Error', error.message ?? 'Could not save your review. Please try again.')
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.headerCard}>
            <Text style={styles.eyebrow}>Customer review</Text>
            <Text style={styles.title}>Rate how it was working with {customerName}.</Text>
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
  },
})
