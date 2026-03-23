import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  Animated, Image, ActivityIndicator, Linking, Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useCustomerProfile } from '@/lib/customerProfile'
import { shareCustomerReferral, shareDiscoverTailors } from '@/lib/invite'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'

// ─── Types ───────────────────────────────────────────────────────────────────

type MeasurementProfile = {
  chest: number | null
  waist: number | null
  hips: number | null
  shoulderWidth: number | null
  inseam: number | null
  sleeveLength: number | null
  neckCircumference: number | null
  height: number | null
  unit: 'in' | 'cm'
}

type RecentOrder = {
  id: string
  reference: string
  garmentType: string
  stage: OrderStage
  tailorName: string
  createdAt: string
}

const MEASUREMENT_KEYS: Array<keyof MeasurementProfile> = [
  'chest', 'waist', 'hips', 'shoulderWidth', 'inseam', 'sleeveLength', 'neckCircumference', 'height',
]

const STAGE_COLOR: Partial<Record<OrderStage, string>> = {
  PENDING_QUOTE: Colors.warning, CONSULTATION: Colors.warning, QUOTE_SENT: Colors.warning,
  CONFIRMED: Colors.needleGreen, DESIGNING: Colors.needleGreen, SOURCING: Colors.needleGreen,
  CUTTING: Colors.needleGreen, SEWING: Colors.needleGreen,
  FINISHING: Colors.needleGreen, SHIPPED: Colors.needleGreen, READY_FOR_COLLECTION: Colors.needleGreen,
  IN_DISPUTE: Colors.kanteRust,
  COMPLETE: Colors.midGrey, DELIVERED: Colors.needleGreen, COLLECTED: Colors.needleGreen,
  DECLINED: Colors.midGrey, CANCELLED: Colors.midGrey, EXPIRED: Colors.midGrey, REFUNDED: Colors.midGrey,
}

function recentOrderHint(stage: OrderStage): string {
  switch (stage) {
    case 'PENDING_QUOTE':
      return 'Waiting for quote'
    case 'CONSULTATION':
      return 'Consultation requested'
    case 'QUOTE_SENT':
      return 'Review quote'
    case 'READY_FOR_COLLECTION':
      return 'Bring your collection code'
    case 'SHIPPED':
      return 'Track delivery'
    case 'DELIVERED':
      return 'Finish and review'
    case 'COLLECTED':
      return 'Finish and review'
    case 'IN_DISPUTE':
      return 'Concern under review'
    case 'COMPLETE':
      return 'Order complete'
    default:
      return STAGE_LABELS[stage] ?? stage
  }
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonBox({ width, height, style }: { width?: number | string; height: number; style?: object }) {
  const anim = useRef(new Animated.Value(0.4)).current
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    )
    animation.start()
    return () => animation.stop()
  }, [anim])
  return (
    <Animated.View style={[{ width, height, borderRadius: Radius.sm, backgroundColor: Colors.lightGrey, opacity: anim }, style]} />
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CustomerProfileScreen() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { avatarUrl, setAvatarUrl } = useCustomerProfile()
  const [measurements, setMeasurements] = useState<MeasurementProfile | null>(null)
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([])
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  async function openExternalUrl(url: string, fallbackMessage: string) {
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert('Unable to open link', fallbackMessage)
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Unable to open link', fallbackMessage)
    }
  }
  const [retryTrigger, setRetryTrigger] = useState(0)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [notifCount, setNotifCount] = useState(0)

  const displayName = user?.user_metadata?.display_name ?? ''
  const initials = displayName
    .split(' ')
    .map((p: string) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

  useFocusEffect(
    useCallback(() => {
      async function load() {
        setFetchError(false)
        setLoading(true)
      try {
        const [profileRes, ordersRes] = await Promise.allSettled([
          supabase
            .from('customer_profiles')
            .select('measurements, created_at, avatar_url')
            .eq('user_id', user?.id)
            .maybeSingle(),
          supabase
            .from('orders')
            .select('id, reference, garment_type, stage, created_at, tailor_profiles!tailor_profile_id(display_name)')
            .eq('customer_id', user?.id)
            .order('created_at', { ascending: false })
            .limit(3),
        ])

        const profileFailed =
          profileRes.status === 'rejected' ||
          (profileRes.status === 'fulfilled' && !!profileRes.value.error)
        const ordersFailed =
          ordersRes.status === 'rejected' ||
          (ordersRes.status === 'fulfilled' && !!ordersRes.value.error)

        if (profileFailed && ordersFailed) {
          setFetchError(true)
          setMeasurements(null)
          setCreatedAt(null)
          setRecentOrders([])
          setNotifCount(0)
          setLoading(false)
          return
        }

        const profile =
          profileRes.status === 'fulfilled' && !profileRes.value.error
            ? profileRes.value.data
            : null
        const orders =
          ordersRes.status === 'fulfilled' && !ordersRes.value.error
            ? ((ordersRes.value.data ?? []) as any[])
            : []

        // Count unread notifications — order_stage_updates since last check
        const lastCheck = user?.user_metadata?.last_notif_check ?? new Date(0).toISOString()
        let unreadCount = 0
        if (orders.length > 0) {
          const { count } = await supabase
            .from('order_stage_updates')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', lastCheck)
            .in('order_id', orders.map((o) => o.id))
          unreadCount = count ?? 0
        }

        if (profile) {
          setMeasurements(profile.measurements as MeasurementProfile ?? null)
          setCreatedAt(profile.created_at ?? null)
          if (profile.avatar_url && !avatarUrl) {
            setAvatarUrl(profile.avatar_url)
          }
        } else {
          setMeasurements(null)
          setCreatedAt(null)
        }

        setNotifCount(unreadCount)

        setRecentOrders(
          orders.map((o) => ({
            id: o.id,
            reference: o.reference,
            garmentType: o.garment_type,
            stage: o.stage as OrderStage,
            tailorName: (o.tailor_profiles as any)?.display_name ?? 'Tailor',
            createdAt: o.created_at,
          }))
        )

        setLoading(false)
        } catch {
          setFetchError(true)
          setLoading(false)
        }
      }
      load()
    }, [user?.id, retryTrigger]),
  )

  const filledCount = measurements
    ? MEASUREMENT_KEYS.filter((k) => measurements[k] !== null && measurements[k] !== undefined).length
    : 0

  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : null

  // ── Photo upload ────────────────────────────────────────────────────────────

  async function handleAvatarPress() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to set a profile picture.')
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    })

    if (result.canceled || !result.assets[0]) return

    setUploadingAvatar(true)
    try {
      // Compress to 800×800 JPEG — keeps avatars small
      const compressed = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 800, height: 800 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      )

      const fileName = `${user!.id}/avatar.jpg`

      // Fetch blob from local URI
      const response = await fetch(compressed.uri)
      const blob = await response.blob()

      if (blob.size > 5 * 1024 * 1024) {
        Alert.alert('Image too large', 'Please choose a photo under 5 MB.')
        return
      }

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName)

      // Cache-bust so the new image replaces the old one immediately
      const bustUrl = `${publicUrl}?t=${Date.now()}`

      const { error: profileError } = await supabase
        .from('customer_profiles')
        .update({ avatar_url: bustUrl })
        .eq('user_id', user!.id)
      if (profileError) throw profileError

      setAvatarUrl(bustUrl)
    } catch (err) {
      console.error('[avatar upload]', err)
      Alert.alert('Upload failed', 'Could not update your photo. Please try again.')
    } finally {
      setUploadingAvatar(false)
    }
  }

  // ── Sign out ────────────────────────────────────────────────────────────────

  async function handleLogOut() {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => {
          void signOut().catch(() => {
            Alert.alert('Unable to log out', 'Please try again in a moment.')
          })
        },
      },
    ])
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Customer profile</Text>
            <Text style={styles.stateTitle}>Couldn't load your profile.</Text>
            <Text style={styles.stateHint}>
              This is where your fit profile, recent orders, and account tools stay organised. Please try again in a moment.
            </Text>
            <TouchableOpacity
              style={styles.statePrimaryBtn}
              onPress={() => { setFetchError(false); setLoading(true); setRetryTrigger((n) => n + 1) }}
            >
              <Text style={styles.statePrimaryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.stateSecondaryBtn}
              onPress={() => router.replace('/(customer)')}
            >
              <Text style={styles.stateSecondaryBtnText}>Open home</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: Spacing.xxxl }}>

        {/* ── Profile header strip ── */}
        <View style={styles.profileHeader}>
          <Text style={styles.profileHeaderTitle}>Profile</Text>
          <TouchableOpacity
            style={styles.bellBtn}
            onPress={() => router.push('/(customer)/profile/notifications')}
            activeOpacity={0.7}
          >
            <Feather name="bell" size={20} color={Colors.white} />
            {notifCount > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{notifCount > 9 ? '9+' : String(notifCount)}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Hero ── */}
        <View style={styles.hero}>
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={handleAvatarPress}
            disabled={uploadingAvatar}
            activeOpacity={0.8}
          >
            {uploadingAvatar ? (
              <View style={[styles.avatar, styles.avatarLoading]}>
                <ActivityIndicator color={Colors.white} />
              </View>
            ) : avatarUrl ? (
              <Image
                source={{ uri: avatarUrl }}
                style={styles.avatarImage}
                resizeMode="cover"
                onError={() => setAvatarUrl(null)}
              />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
            )}
            {/* Camera badge */}
            <View style={styles.cameraBadge}>
              <Feather name="camera" size={11} color={Colors.white} />
            </View>
          </TouchableOpacity>

          <Text style={styles.heroName}>{displayName}</Text>
          {memberSince && <Text style={styles.heroMeta}>Member since {memberSince}</Text>}
        </View>

        <View style={styles.body}>
          <View style={styles.workspaceCard}>
            <Text style={styles.workspaceEyebrow}>Your account hub</Text>
            <Text style={styles.workspaceText}>
              Keep your measurements, orders, and support paths together here so every booking stays easy to manage.
            </Text>
          </View>

          <View style={styles.guideCard}>
            <Text style={styles.guideTitle}>Best profile habit</Text>
            <Text style={styles.guideText}>
              Keep your measurements and contact details current here so new bookings start with cleaner fit context and fewer back-and-forth questions.
            </Text>
          </View>

          {/* ── Measurements ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Measurement profile</Text>
              <TouchableOpacity
                onPress={() => router.push('/(customer)/profile/measurements')}
                style={styles.sectionLink}
              >
                <Text style={styles.sectionLinkText}>{filledCount > 0 ? 'Edit' : 'Set up'}</Text>
                <Feather name="chevron-right" size={14} color={Colors.needleGreen} />
              </TouchableOpacity>
            </View>

            {loading ? (
              <View style={styles.card}>
                <SkeletonBox width="50%" height={10} />
                <SkeletonBox width="100%" height={5} style={{ marginTop: 8 }} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: 12 }}>
                  {[0, 1, 2, 3].map((i) => <SkeletonBox key={i} width="47%" height={44} />)}
                </View>
              </View>
            ) : filledCount === 0 ? (
              <TouchableOpacity
                style={styles.emptyRow}
                onPress={() => router.push('/(customer)/profile/measurements')}
                activeOpacity={0.7}
              >
                <View style={styles.emptyRowIcon}>
                  <Feather name="sliders" size={20} color={Colors.needleGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.emptyRowTitle}>Add your measurements</Text>
                  <Text style={styles.emptyRowHint}>Attached automatically to every order</Text>
                </View>
                <Feather name="chevron-right" size={18} color={Colors.midGrey} />
              </TouchableOpacity>
            ) : (
              <View style={styles.card}>
                <View style={styles.completenessRow}>
                  <Text style={styles.completenessLabel}>{filledCount} of 8 measurements added</Text>
                  <View style={styles.bar}>
                    <View style={[styles.barFill, { width: `${(filledCount / 8) * 100}%` as any }]} />
                  </View>
                </View>
                <View style={styles.measureGrid}>
                  {MEASUREMENT_KEYS.map((k) => {
                    const val = measurements?.[k]
                    const labels: Record<string, string> = {
                      chest: 'Chest', waist: 'Waist', hips: 'Hips', shoulderWidth: 'Shoulder',
                      inseam: 'Inseam', sleeveLength: 'Sleeve', neckCircumference: 'Neck', height: 'Height',
                    }
                    return (
                      <View key={k} style={styles.measureCell}>
                        <Text style={styles.measureLabel}>{labels[k]}</Text>
                        <Text style={[styles.measureValue, !val && styles.measureEmpty]}>
                          {val ? `${val} ${measurements?.unit ?? 'cm'}` : '—'}
                        </Text>
                      </View>
                    )
                  })}
                </View>
              </View>
            )}

            {filledCount > 0 && (
              <Text style={styles.privacyNote}>
                Measurements are private — shared only when you start an order.
              </Text>
            )}
          </View>

          {/* ── Recent orders ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent orders</Text>
              <TouchableOpacity onPress={() => router.navigate('/(customer)/orders')} style={styles.sectionLink}>
                <Text style={styles.sectionLinkText}>See all orders</Text>
                <Feather name="chevron-right" size={14} color={Colors.needleGreen} />
              </TouchableOpacity>
            </View>
            {loading ? (
              <View style={styles.card}>
                {[0, 1].map((i) => <SkeletonBox key={i} width="100%" height={48} style={{ marginBottom: 8 }} />)}
              </View>
            ) : recentOrders.length > 0 ? (
              <View style={styles.menuList}>
                {recentOrders.map((order, i) => (
                  <TouchableOpacity
                    key={order.id}
                    style={[styles.orderRow, i === recentOrders.length - 1 && styles.rowLast]}
                    onPress={() => router.navigate(`/(customer)/orders/${order.id}` as any)}
                    activeOpacity={0.6}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.orderTitle}>{order.garmentType}</Text>
                      <Text style={styles.orderSub}>{order.tailorName} · #{order.reference}</Text>
                      <Text style={styles.orderHint}>{recentOrderHint(order.stage)}</Text>
                    </View>
                    <View style={[styles.stagePill, { backgroundColor: (STAGE_COLOR[order.stage] ?? Colors.midGrey) + '18' }]}>
                      <Text style={[styles.stageText, { color: STAGE_COLOR[order.stage] ?? Colors.midGrey }]}>
                        {STAGE_LABELS[order.stage] ?? order.stage}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <TouchableOpacity
                style={styles.emptyRow}
                onPress={() => router.navigate('/(customer)')}
                activeOpacity={0.7}
              >
                <View style={styles.emptyRowIcon}>
                  <Feather name="shopping-bag" size={20} color={Colors.needleGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.emptyRowTitle}>Start your first order</Text>
                  <Text style={styles.emptyRowHint}>Browse tailors, place a brief, and track the whole journey here.</Text>
                </View>
                <Feather name="chevron-right" size={18} color={Colors.midGrey} />
              </TouchableOpacity>
            )}
          </View>

          {/* ── Become a tailor ── */}
          <TouchableOpacity
            style={styles.becomeCard}
            onPress={() => { void openExternalUrl('https://drapeon.co/tailors', 'Please visit https://drapeon.co/tailors manually.') }}
            activeOpacity={0.8}
          >
            <Text style={styles.becomeEmoji}>✂️</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.becomeTitle}>Are you a tailor?</Text>
              <Text style={styles.becomeSub}>Join Drape and reach customers looking for bespoke work.</Text>
            </View>
            <Feather name="chevron-right" size={18} color={Colors.inkLight} />
          </TouchableOpacity>

          {/* ── Main action list ── */}
          <View style={styles.flatList}>
            <FlatRow icon="settings" label="Account settings" onPress={() => router.push('/(customer)/profile/account-settings')} />
            <FlatRow icon="help-circle" label="Get help" onPress={() => router.push('/(customer)/profile/help')} />
            <FlatRow icon="user" label="View profile" onPress={() => router.push('/(customer)/profile/view-profile')} />
            <FlatRow icon="shield" label="Privacy" last onPress={() => router.push('/(customer)/profile/privacy')} />
          </View>

          {/* ── Refer & share ── */}
          <View style={styles.flatList}>
            <FlatRow
              icon="user-plus"
              label="Invite a friend to Drape"
              onPress={() => shareCustomerReferral(user?.id ?? '', displayName)}
            />
            <FlatRow
              icon="scissors"
              label="Share tailor discovery"
              onPress={() => shareDiscoverTailors(user?.id ?? '')}
            />
            <FlatRow
              icon="file-text"
              label="Legal"
              last
              onPress={() => { void openExternalUrl('https://drapeon.co/legal', 'Please visit https://drapeon.co/legal manually.') }}
            />
          </View>

          {/* ── Log out ── */}
          <TouchableOpacity style={styles.logOutRow} onPress={handleLogOut} activeOpacity={0.6}>
            <Feather name="log-out" size={18} color={Colors.error} />
            <Text style={styles.logOutText}>Log out</Text>
          </TouchableOpacity>

        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── FlatRow ─────────────────────────────────────────────────────────────────

function FlatRow({
  icon, label, last, onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  last?: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.flatRow, last && styles.rowLast]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <Feather name={icon} size={20} color={Colors.inkLight} style={{ width: 24 }} />
      <Text style={styles.flatRowLabel}>{label}</Text>
      <Feather name="chevron-right" size={16} color={Colors.midGrey} />
    </TouchableOpacity>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
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
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  stateTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  stateHint: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    textAlign: 'center',
    lineHeight: 21,
  },
  statePrimaryBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  statePrimaryBtnText: { color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  stateSecondaryBtn: {
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  stateSecondaryBtnText: { color: Colors.ink, fontWeight: FontWeight.medium, fontSize: FontSize.sm },

  // Profile header strip
  profileHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.needleGreen,
  },
  profileHeaderTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.white },
  bellBtn: {
    width: 38, height: 38, borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  bellBadge: {
    position: 'absolute', top: -2, right: -2,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: Colors.kanteRust,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2, borderColor: Colors.needleGreen,
  },
  bellBadgeText: { fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white },

  // Hero
  hero: {
    backgroundColor: Colors.needleGreen,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xxxl + Spacing.xl,
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xl,
  },
  avatarWrap: { position: 'relative', marginBottom: Spacing.sm },
  avatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLoading: { opacity: 0.6 },
  avatarImage: {
    width: 88, height: 88, borderRadius: 44,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.45)',
    overflow: 'hidden',
  },
  avatarText: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.white },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenDark,
    borderWidth: 2, borderColor: Colors.needleGreen,
    alignItems: 'center', justifyContent: 'center',
  },
  heroName: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.white },
  heroMeta: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.75)' },

  body: {
    marginTop: -(Spacing.xl + 4),
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: Colors.bone,
    paddingTop: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.xl,
  },
  workspaceCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  workspaceEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  workspaceText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
  },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  guideText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },

  // Sections
  section: { gap: Spacing.md },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  sectionLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  sectionLinkText: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  // Cards
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm,
  },

  emptyRow: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, ...Shadow.sm,
  },
  emptyRowIcon: {
    width: 42, height: 42, borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center',
  },
  emptyRowTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyRowHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },

  // Completeness bar
  completenessRow: { gap: 6 },
  completenessLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  bar: { height: 4, backgroundColor: Colors.lightGrey, borderRadius: 2 },
  barFill: { height: '100%', backgroundColor: Colors.needleGreen, borderRadius: 2 },

  // Measure grid
  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  measureCell: {
    width: '47%', backgroundColor: Colors.bone, borderRadius: Radius.sm,
    padding: Spacing.md, gap: 2,
  },
  measureLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  measureValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  measureEmpty: { color: Colors.lightGrey },

  privacyNote: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'center' },

  // Recent orders
  menuList: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  orderRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey,
  },
  orderTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  orderSub: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },
  orderHint: { fontSize: FontSize.xs, color: Colors.needleGreen, marginTop: 4, fontWeight: FontWeight.medium },
  stagePill: {
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
    borderRadius: Radius.full,
  },
  stageText: { fontSize: 11, fontWeight: FontWeight.semibold },

  // Become a tailor
  becomeCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    ...Shadow.sm,
  },
  becomeEmoji: { fontSize: 32 },
  becomeTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  becomeSub: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2, lineHeight: 16 },

  // Flat action list (Airbnb style)
  flatList: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm,
  },
  flatRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.lg,
    paddingHorizontal: Spacing.lg, paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey,
  },
  rowLast: { borderBottomWidth: 0 },
  flatRowLabel: { flex: 1, fontSize: FontSize.md, color: Colors.ink },

  // Log out
  logOutRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  logOutText: { fontSize: FontSize.md, color: Colors.error, fontWeight: FontWeight.medium },
})
