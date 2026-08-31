import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { fetchReadGateway } from '@/lib/read-gateway'
import { RemoteImage } from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import type { StorageImageBucket } from '@/lib/image-url'

type PublicTailor = {
  id: string
  display_name?: string | null
  location?: string | null
  specialty_tags?: unknown
  avg_rating?: number | null
  total_reviews?: number | null
  availability?: string | null
  supports_custom_orders?: boolean | null
  supports_ready_made?: boolean | null
  explore_image_url?: string | null
  explore_image_bucket?: StorageImageBucket | null
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

export default function PublicExploreScreen() {
  const router = useRouter()
  const [tailors, setTailors] = useState<PublicTailor[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (forceRefresh = false) => {
    setError('')
    try {
      const data = await fetchReadGateway<PublicTailor[]>(
        { action: 'explore-tailors', limit: 30, query: query.trim() },
        { forceRefresh },
      )
      setTailors(data)
    } catch {
      setError('We could not load public profiles right now. Check your connection and try again.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [query])

  useEffect(() => {
    const timer = setTimeout(() => { void load() }, query.trim() ? 350 : 0)
    return () => clearTimeout(timer)
  }, [load, query])

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.wordmark}>Drapeon</Text>
        <TouchableOpacity
          style={styles.accountButton}
          onPress={() => router.push('/(auth)/welcome')}
          accessibilityRole="button"
          accessibilityLabel="Continue to Drapeon account"
        >
          <Text style={styles.accountButtonText}>Sign in</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true) }} />}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>Made for you, wherever you are.</Text>
          <Text style={styles.body}>Approved tailors worldwide.</Text>
          <View style={styles.searchWrap}>
            <Feather name="search" size={19} color={Colors.midGrey} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search style, specialty, or location"
              placeholderTextColor={Colors.midGrey}
              style={styles.searchInput}
              returnKeyType="search"
              accessibilityLabel="Search public tailor profiles"
            />
          </View>
        </View>

        {loading ? <ActivityIndicator color={Colors.needleGreen} style={styles.loader} /> : null}
        {error ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>Explore is taking a moment.</Text>
            <Text style={styles.stateBody}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => { setLoading(true); void load(true) }}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!loading && !error ? (
          <View style={styles.grid}>
            {tailors.map((tailor) => {
              const specialties = stringList(tailor.specialty_tags).slice(0, 3)
              return (
                <TouchableOpacity
                  key={tailor.id}
                  style={styles.card}
                  onPress={() => router.push({ pathname: '/(public)/explore/tailor/[id]', params: { id: tailor.id } })}
                  activeOpacity={0.84}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${tailor.display_name ?? 'tailor'} public profile`}
                >
                  <RemoteImage
                    uri={tailor.explore_image_url}
                    bucket={tailor.explore_image_bucket ?? undefined}
                    style={styles.cardImage}
                    surface="public_explore"
                  />
                  <View style={styles.cardContent}>
                    <View style={styles.cardTitleRow}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{tailor.display_name ?? 'Drapeon tailor'}</Text>
                      <Text style={styles.rating}>★ {(tailor.avg_rating ?? 0).toFixed(1)}</Text>
                    </View>
                    <Text style={styles.location} numberOfLines={1}>{tailor.location ?? 'Location not listed'}</Text>
                    <Text style={styles.specialties} numberOfLines={2}>{specialties.join(' · ') || 'Custom and ready-made fashion'}</Text>
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: { minHeight: 60, paddingHorizontal: Spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.bone },
  wordmark: { fontFamily: Fonts.display, fontSize: 22, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  accountButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: Spacing.lg, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.ink, backgroundColor: Colors.bone },
  accountButtonText: { color: Colors.ink, fontFamily: Fonts.bodySemiBold, fontWeight: FontWeight.semibold },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxxl },
  hero: { gap: Spacing.sm, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  title: { maxWidth: 340, fontFamily: Fonts.display, fontSize: 32, lineHeight: 37, fontWeight: FontWeight.bold, color: Colors.ink },
  body: { maxWidth: 350, fontFamily: Fonts.body, fontSize: 15, lineHeight: 22, color: Colors.inkLight },
  searchWrap: { minHeight: 50, marginTop: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.lightGrey, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  searchInput: { flex: 1, fontFamily: Fonts.body, fontSize: 16, color: Colors.ink },
  loader: { paddingVertical: Spacing.xxl },
  stateCard: { padding: Spacing.xl, borderRadius: Radius.xl, backgroundColor: Colors.white, gap: Spacing.sm },
  stateTitle: { fontFamily: Fonts.display, fontSize: 24, color: Colors.ink },
  stateBody: { fontFamily: Fonts.body, lineHeight: 22, color: Colors.inkLight },
  retryButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.lg, borderRadius: Radius.full, backgroundColor: Colors.needleGreen },
  retryText: { color: Colors.textInverse, fontWeight: FontWeight.semibold },
  grid: { gap: Spacing.lg },
  card: { overflow: 'hidden', borderRadius: Radius.xl, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.lightGrey, ...Shadow.sm },
  cardImage: { width: '100%', aspectRatio: 1.7 },
  cardContent: { padding: Spacing.md, gap: Spacing.xs },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  cardTitle: { flex: 1, fontFamily: Fonts.display, fontSize: 21, fontWeight: FontWeight.semibold, color: Colors.ink },
  rating: { fontFamily: Fonts.bodySemiBold, color: Colors.ink },
  location: { fontFamily: Fonts.body, color: Colors.inkLight },
  specialties: { marginTop: Spacing.xs, fontFamily: Fonts.body, color: Colors.ink, lineHeight: 20 },
})
