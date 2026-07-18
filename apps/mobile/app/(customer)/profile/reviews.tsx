import { useCallback, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRouter, useFocusEffect } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { goBackOrFallback } from '@/lib/navigation'

type CustomerReviewRow = {
  id: string
  rating: number
  tags: string[]
  body: string | null
  reviewerName: string
  createdAt: string
}

type CustomerReviewQueryRow = {
  id: string
  rating: number | null
  tags: string[] | null
  body: string | null
  reviewer_name: string | null
  created_at: string
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

export default function CustomerReviewsScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const [reviews, setReviews] = useState<CustomerReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    setFetchError('')
    const { data, error } = await supabase
      .from('customer_reviews')
      .select('id, rating, tags, body, reviewer_name, created_at')
      .eq('customer_id', user?.id)
      .order('created_at', { ascending: false })

    if (error) {
      setFetchError(
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your reviews should still be here — retry when the signal improves.'
          : 'Could not load your reviews right now. Please try again in a moment.'
      )
      setReviews([])
      setLoading(false)
      return
    }

    setReviews(
      ((data ?? []) as CustomerReviewQueryRow[]).map((row) => ({
        id: row.id,
        rating: row.rating ?? 0,
        tags: asStringList(row.tags),
        body: row.body ?? null,
        reviewerName: row.reviewer_name ?? 'Tailor',
        createdAt: row.created_at,
      }))
    )
    setLoading(false)
  }, [user?.id])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const averageRating = reviews.length > 0
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    : null

  function goBack() {
    goBackOrFallback(router, navigation, '/(customer)/profile')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Reviews from tailors</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={Colors.needleGreen} />
        </View>
      ) : fetchError ? (
        <View style={styles.stateWrap}>
          <Text style={styles.stateTitle}>Couldn't load reviews.</Text>
          <Text style={styles.stateHint}>{fetchError}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { void load() }}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : reviews.length === 0 ? (
        <View style={styles.stateWrap}>
          <Text style={styles.stateTitle}>No reviews yet.</Text>
          <Text style={styles.stateHint}>Reviews from tailors will appear here after completed orders.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{averageRating!.toFixed(1)}</Text>
            <Text style={styles.summaryLabel}>{reviews.length} review{reviews.length === 1 ? '' : 's'}</Text>
          </View>

          {reviews.map((review) => (
            <View key={review.id} style={styles.reviewCard}>
              <View style={styles.reviewHeader}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {review.reviewerName.split(' ').map((part) => part[0]).slice(0, 2).join('')}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reviewerName}>{review.reviewerName}</Text>
                  <Text style={styles.reviewDate}>
                    {new Date(review.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                  </Text>
                </View>
                <Text style={styles.reviewStars}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</Text>
              </View>

              {review.tags.length > 0 ? (
                <View style={styles.tags}>
                  {review.tags.map((tag) => (
                    <View key={tag} style={styles.tag}>
                      <Text style={styles.tagText}>{tag}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {review.body ? <Text style={styles.reviewBody}>{review.body}</Text> : null}
            </View>
          ))}
        </ScrollView>
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
  content: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: 36 },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl, gap: Spacing.md },
  stateTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display, textAlign: 'center' },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    backgroundColor: Colors.needleGreen,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
  },
  retryBtnText: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  summaryCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 4,
    ...Shadow.sm,
  },
  summaryValue: { fontSize: 30, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  summaryLabel: { fontSize: FontSize.sm, color: Colors.midGrey },
  reviewCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 20,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  reviewerName: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  reviewDate: { fontSize: FontSize.xs, color: Colors.midGrey },
  reviewStars: { fontSize: FontSize.sm, color: Colors.warning, letterSpacing: 0.4 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  tag: {
    backgroundColor: Colors.bone,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.full,
  },
  tagText: { fontSize: FontSize.xs, color: Colors.inkLight },
  reviewBody: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 18 },
})
