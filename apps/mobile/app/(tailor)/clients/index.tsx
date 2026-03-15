/**
 * Tailor CRM — client list
 * All customers who've placed at least one order with this tailor.
 * Design doc §9.6
 */
import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

type ClientRow = {
  customerId: string
  displayName: string
  totalOrders: number
  lastOrderDate: string
  lastGarmentType: string
}

export default function TailorClientsScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [clients, setClients] = useState<ClientRow[]>([])
  const [filtered, setFiltered] = useState<ClientRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function fetchClients() {
    const { data } = await supabase
      .from('orders')
      .select(`
        customer_id, garment_type, created_at,
        customer_profiles!customer_id(display_name)
      `)
      .eq('tailor_id', user?.id)
      .order('created_at', { ascending: false })

    if (!data) return

    // Aggregate per customer
    const map = new Map<string, ClientRow>()
    for (const row of data as any[]) {
      if (!row.customer_id) continue
      const existing = map.get(row.customer_id)
      if (existing) {
        existing.totalOrders += 1
      } else {
        map.set(row.customer_id, {
          customerId: row.customer_id,
          displayName: row.customer_profiles?.display_name ?? 'Customer',
          totalOrders: 1,
          lastOrderDate: row.created_at,
          lastGarmentType: row.garment_type,
        })
      }
    }

    const list = Array.from(map.values()).sort((a, b) =>
      new Date(b.lastOrderDate).getTime() - new Date(a.lastOrderDate).getTime()
    )
    setClients(list)
    applySearch(list, search)
  }

  function applySearch(list: ClientRow[], q: string) {
    if (!q.trim()) {
      setFiltered(list)
    } else {
      const lower = q.toLowerCase()
      setFiltered(list.filter((c) => c.displayName.toLowerCase().includes(lower)))
    }
  }

  useEffect(() => {
    fetchClients().finally(() => setLoading(false))
  }, [])

  const onSearch = useCallback((text: string) => {
    setSearch(text)
    applySearch(clients, text)
  }, [clients])

  async function onRefresh() {
    setRefreshing(true)
    await fetchClients()
    setRefreshing(false)
  }

  const initials = (name: string) =>
    name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Clients</Text>
        <Text style={styles.count}>{clients.length}</Text>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="Search clients…"
          placeholderTextColor={Colors.midGrey}
          value={search}
          onChangeText={onSearch}
          autoCorrect={false}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.customerId}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{search ? 'No results' : 'No clients yet'}</Text>
            <Text style={styles.emptyHint}>
              {search
                ? 'Try a different name.'
                : 'Clients will appear here once customers place their first order with you.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/(tailor)/clients/${item.customerId}`)}
            activeOpacity={0.75}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(item.displayName)}</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.clientName}>{item.displayName}</Text>
              <Text style={styles.clientMeta}>
                {item.totalOrders} order{item.totalOrders !== 1 ? 's' : ''}
                {'  ·  '}
                Last: {item.lastGarmentType}
              </Text>
            </View>
            <View style={styles.cardRight}>
              <Text style={styles.lastDate}>
                {new Date(item.lastOrderDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </Text>
              <Text style={styles.chevron}>›</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, paddingBottom: Spacing.sm,
  },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.ink },
  count: {
    fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white,
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 2, overflow: 'hidden',
  },

  searchWrap: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md },
  search: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    fontSize: FontSize.md, color: Colors.ink, ...Shadow.sm,
  },

  list: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxxl, gap: Spacing.sm },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, ...Shadow.sm,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.needleGreenLight,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  cardBody: { flex: 1, gap: 3 },
  clientName: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  clientMeta: { fontSize: FontSize.xs, color: Colors.midGrey },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  lastDate: { fontSize: FontSize.xs, color: Colors.midGrey },
  chevron: { fontSize: 20, color: Colors.midGrey, lineHeight: 22 },

  empty: { paddingTop: Spacing.xxxl, alignItems: 'center', gap: Spacing.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
})
