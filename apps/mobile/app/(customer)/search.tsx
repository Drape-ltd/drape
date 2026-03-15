import { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable, FlatList, ScrollView, ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { Input, TierBadgeChip, StarRating, Tag } from '@/components/ui'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const GARMENT_FILTERS = ['All', 'Agbada', 'Suits', 'Ankara', 'Bridal', 'Lehenga', 'Kaftans', 'Bespoke']
const TIER_FILTERS = ['All', 'MASTER', 'RISING', 'VERIFIED']

type TailorResult = {
  id: string
  displayName: string
  location: string
  specialtyTags: string[]
  avgRating: number
  totalReviews: number
  tier: string
  availability: string
  avgResponseHours: number | null
  priceRangeMin: number | null
}

export default function SearchScreen() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [garment, setGarment] = useState('All')
  const [tier, setTier] = useState('All')
  const [results, setResults] = useState<TailorResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const search = useCallback(async (q: string, g: string, t: string) => {
    setLoading(true)
    setSearched(true)

    let query = supabase
      .from('tailor_profiles')
      .select('id, display_name, location, specialty_tags, avg_rating, total_reviews, tier, availability, avg_response_hours, price_range_min')
      .eq('is_live', true)
      .neq('availability', 'FULLY_BOOKED')

    if (q.trim()) {
      query = query.or(`display_name.ilike.%${q}%,location.ilike.%${q}%,specialty_tags.cs.{${q}}`)
    }
    if (g !== 'All') {
      query = query.contains('specialty_tags', [g])
    }
    if (t !== 'All') {
      query = query.eq('tier', t)
    }

    const { data } = await query.order('avg_rating', { ascending: false }).limit(30)
    setResults(
      (data ?? []).map((d: any) => ({
        id: d.id,
        displayName: d.display_name,
        location: d.location,
        specialtyTags: d.specialty_tags ?? [],
        avgRating: d.avg_rating,
        totalReviews: d.total_reviews,
        tier: d.tier,
        availability: d.availability,
        avgResponseHours: d.avg_response_hours,
        priceRangeMin: d.price_range_min,
      }))
    )
    setLoading(false)
  }, [])

  function handleSearch() { search(query, garment, tier) }

  function selectGarment(g: string) {
    setGarment(g)
    search(query, g, tier)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Find a tailor</Text>
        <Input
          placeholder="Name, location, or specialty..."
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          containerStyle={styles.searchInput}
          testID="search-input"
          rightElement={
            <TouchableOpacity onPress={handleSearch} testID="search-submit-btn" style={{ padding: 4 }}>
              <Text style={{ fontSize: 16 }}>🔍</Text>
            </TouchableOpacity>
          }
        />

        {/* Garment filter chips */}
        <FlatList
          horizontal
          data={GARMENT_FILTERS}
          keyExtractor={(i) => i}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.chip, garment === item && styles.chipActive]}
              onPress={() => selectGarment(item)}
            >
              <Text style={[styles.chipText, garment === item && styles.chipTextActive]}>{item}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} color={Colors.needleGreen} size="large" />
      ) : !searched ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Search for a tailor to get started.</Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No tailors found for that search.</Text>
          <Text style={styles.emptyHint}>Try a different specialty or location.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {results.map((item) => (
            <Pressable
              key={item.id}
              style={styles.card}
              testID={`tailor-result-${item.id}`}
              accessibilityLabel={`${item.displayName} card`}
              onPress={() => router.push(`/(customer)/tailor/${item.id}`)}
            >
              <View style={styles.cardTop}>
                <View style={styles.avatar}>
                  <Text style={{ fontSize: 28 }}>👤</Text>
                </View>
                <View style={styles.info}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name}>{item.displayName}</Text>
                    <TierBadgeChip tier={item.tier as any} />
                  </View>
                  <Text style={styles.location}>{item.location}</Text>
                  <View style={styles.metaRow}>
                    <StarRating rating={item.avgRating} count={item.totalReviews} />
                    {item.avgResponseHours && (
                      <Text style={styles.response}>~{Math.round(item.avgResponseHours)}h response</Text>
                    )}
                  </View>
                </View>
              </View>
              <View style={styles.tags}>
                {(item.specialtyTags ?? []).slice(0, 4).map((t) => <Tag key={t} label={t} />)}
              </View>
              {item.availability === 'LIMITED' && (
                <View style={styles.limitedBadge}>
                  <Text style={styles.limitedText}>Limited availability</Text>
                </View>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: { padding: Spacing.xl, gap: Spacing.md, backgroundColor: Colors.bone },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },
  searchInput: { marginBottom: -Spacing.sm },
  filterRow: { gap: Spacing.sm, paddingRight: Spacing.xl },
  chip: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  chipActive: { backgroundColor: Colors.needleGreen, borderColor: Colors.needleGreen },
  chipText: { fontSize: FontSize.sm, color: Colors.inkLight, fontWeight: FontWeight.medium },
  chipTextActive: { color: Colors.white },
  loader: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.sm },
  emptyText: { fontSize: FontSize.md, color: Colors.inkLight },
  emptyHint: { fontSize: FontSize.sm, color: Colors.midGrey },
  list: { padding: Spacing.xl, gap: Spacing.md },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm,
  },
  cardTop: { flexDirection: 'row', gap: Spacing.md },
  avatar: {
    width: 52, height: 52, borderRadius: Radius.full,
    backgroundColor: Colors.boneDeep, alignItems: 'center', justifyContent: 'center',
  },
  info: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  location: { fontSize: FontSize.sm, color: Colors.midGrey },
  metaRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  response: { fontSize: FontSize.xs, color: Colors.midGrey },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  limitedBadge: {
    backgroundColor: '#FEF3C7', paddingHorizontal: Spacing.md,
    paddingVertical: 4, borderRadius: Radius.full, alignSelf: 'flex-start',
  },
  limitedText: { fontSize: FontSize.xs, color: '#92400E', fontWeight: FontWeight.medium },
})
