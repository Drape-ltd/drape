/**
 * Notification Settings (Tailor)
 *
 * Push notification preferences stored in user_metadata.notif_prefs.
 */

import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

type NotifPrefs = {
  newOrders: boolean
  messages: boolean
  reviews: boolean
  promotions: boolean
}

const DEFAULT_PREFS: NotifPrefs = {
  newOrders: true,
  messages: true,
  reviews: true,
  promotions: false,
}

function PrefRow({
  icon, title, description, value, onChange,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  title: string
  description: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <View style={styles.prefRow}>
      <Feather name={icon} size={20} color={Colors.inkLight} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.prefTitle}>{title}</Text>
        <Text style={styles.prefDesc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: Colors.lightGrey, true: Colors.needleGreen }}
        thumbColor={Colors.white}
      />
    </View>
  )
}

export default function TailorNotificationSettingsScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const stored = user?.user_metadata?.notif_prefs
    if (stored) setPrefs({ ...DEFAULT_PREFS, ...stored })
  }, [user?.user_metadata?.notif_prefs])

  async function toggle(key: keyof NotifPrefs, value: boolean) {
    const updated = { ...prefs, [key]: value }
    setPrefs(updated)
    setSaving(true)
    await supabase.auth.updateUser({ data: { notif_prefs: updated } })
    setSaving(false)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        {saving && <ActivityIndicator size="small" color={Colors.midGrey} style={{ marginLeft: 'auto' }} />}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>

        <Text style={styles.intro}>
          Choose which push notifications you receive from Drape.
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Orders</Text>
          <View style={styles.card}>
            <PrefRow
              icon="shopping-bag"
              title="New order requests"
              description="Alert when a customer requests an order from you."
              value={prefs.newOrders}
              onChange={(v) => toggle('newOrders', v)}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Communication</Text>
          <View style={styles.card}>
            <PrefRow
              icon="message-circle"
              title="Messages"
              description="Push alerts for new messages from customers."
              value={prefs.messages}
              onChange={(v) => toggle('messages', v)}
            />
            <View style={styles.divider} />
            <PrefRow
              icon="star"
              title="New reviews"
              description="Alert when a customer leaves a review on a completed order."
              value={prefs.reviews}
              onChange={(v) => toggle('reviews', v)}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Drape</Text>
          <View style={styles.card}>
            <PrefRow
              icon="zap"
              title="Tips & promotions"
              description="Platform updates, tailoring tips, and Drape announcements."
              value={prefs.promotions}
              onChange={(v) => toggle('promotions', v)}
            />
          </View>
          <Text style={styles.hint}>
            Transactional notifications about your orders are always sent.
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: Radius.full,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },
  body: { padding: Spacing.xl, paddingBottom: 64, gap: Spacing.xl },
  intro: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 22 },
  section: { gap: Spacing.sm },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginHorizontal: Spacing.lg },
  hint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18, paddingHorizontal: 2 },
  prefRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    padding: Spacing.lg,
  },
  prefTitle: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.ink, marginBottom: 4 },
  prefDesc: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
})
