import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { invokeFunction, supabase } from '@/lib/supabase'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { ChoiceSheet } from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      memberName: string
      ownerName: string
      orderReference: string
      garmentType: string
      inviteStatus: string
      alreadyAcceptedByYou: boolean
      acceptedBySomeoneElse: boolean
    }

type MeasurementProfile = {
  id: string
  label: string
  relationship: string | null
  updated_at: string | null
  is_default: boolean | null
}

export default function GroupInviteScreen() {
  const { code } = useLocalSearchParams<{ code: string }>()
  const inviteCode = Array.isArray(code) ? code[0] : code
  const router = useRouter()
  const { session, user } = useAuth()
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' })
  const [profiles, setProfiles] = useState<MeasurementProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [profileSheetOpen, setProfileSheetOpen] = useState(false)
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const hasProfiles = profiles.length > 0
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? null,
    [profiles, selectedProfileId],
  )

  useEffect(() => {
    if (!session?.access_token || !user?.id || !inviteCode) {
      return
    }

    let cancelled = false

    async function load() {
      setPreview({ status: 'loading' })
      setLoadingProfiles(true)
      const [previewResult, profilesResult] = await Promise.all([
        invokeFunction<{
          memberName?: string
          ownerName?: string
          orderReference?: string
          garmentType?: string
          status?: string
          alreadyAcceptedByYou?: boolean
          acceptedBySomeoneElse?: boolean
          error?: string
        }>('group-member-action', { body: { action: 'preview', inviteCode } }),
        supabase
          .from('customer_measurement_profiles')
          .select('id, label, relationship, updated_at, is_default')
          .eq('customer_id', user?.id ?? '')
          .order('is_default', { ascending: false })
          .order('updated_at', { ascending: false }),
      ])

      if (cancelled) return
      setLoadingProfiles(false)

      if (previewResult.error || !previewResult.data) {
        setPreview({
          status: 'error',
          message: previewResult.data?.error ?? 'This group invite could not be opened.',
        })
      } else {
        setPreview({
          status: 'ready',
          memberName: previewResult.data.memberName ?? 'Group member',
          ownerName: previewResult.data.ownerName ?? 'The order owner',
          orderReference: previewResult.data.orderReference ?? 'Group order',
          garmentType: previewResult.data.garmentType ?? 'Group order',
          inviteStatus: previewResult.data.status ?? 'INVITED',
          alreadyAcceptedByYou: previewResult.data.alreadyAcceptedByYou === true,
          acceptedBySomeoneElse: previewResult.data.acceptedBySomeoneElse === true,
        })
      }

      if (!profilesResult.error) {
        const nextProfiles = (profilesResult.data ?? []) as MeasurementProfile[]
        setProfiles(nextProfiles)
        setSelectedProfileId(nextProfiles[0]?.id ?? null)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [inviteCode, session?.access_token, user?.id])

  async function handleAccept() {
    if (!inviteCode || submitting) return
    if (!selectedProfile?.id) {
      Alert.alert(
        'Measurement profile needed',
        'Add a measurement profile first so your tailor receives the right fit details for this group order.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open measurements', onPress: () => router.push('/(customer)/profile/measurements') },
        ],
      )
      return
    }

    setSubmitting(true)
    const { data, error } = await invokeFunction<{ ok?: boolean; error?: string }>('group-member-action', {
      body: {
        action: 'accept',
        inviteCode,
        measurementProfileId: selectedProfile.id,
      },
    })
    setSubmitting(false)

    if (error || !data?.ok) {
      const message = error
        ? isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not accept the group invite yet.'
          : await readFunctionErrorMessage(error, 'We could not accept this group invite right now.')
        : data?.error ?? 'We could not accept this group invite right now.'
      Alert.alert('Invite not accepted', message)
      return
    }

    Alert.alert(
      'Invite accepted',
      'Your measurement profile is now attached to this group order. The order owner and tailor can keep the work coordinated in Drapeon.',
      [{ text: 'Open orders', onPress: () => router.replace('/(customer)/orders') }],
    )
  }

  async function handleDecline() {
    if (!inviteCode || submitting) return
    setSubmitting(true)
    const { data, error } = await invokeFunction<{ ok?: boolean; error?: string }>('group-member-action', {
      body: { action: 'decline', inviteCode },
    })
    setSubmitting(false)

    if (error || !data?.ok) {
      Alert.alert('Could not decline invite', data?.error ?? 'Try again in a moment.')
      return
    }

    Alert.alert('Invite declined', 'The order owner will see that you declined this group invite.', [
      { text: 'Done', onPress: () => router.replace('/(customer)') },
    ])
  }

  function openSignIn() {
    router.replace('/(auth)/welcome')
  }

  if (!session?.access_token) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Group order invite</Text>
            <Text style={styles.title}>Sign in to accept this invite.</Text>
            <Text style={styles.copy}>
              Drapeon needs your account so the right measurement profile can travel with the group
              order.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={openSignIn}>
              <Text style={styles.primaryBtnText}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (!inviteCode) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <View style={styles.card}>
            <Feather name="alert-circle" size={28} color={Colors.kanteRust} />
            <Text style={styles.title}>Invite unavailable</Text>
            <Text style={styles.copy}>This group invite link is missing its invite code.</Text>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/(customer)')}>
              <Text style={styles.secondaryBtnText}>Go to home</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (preview.status === 'loading') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.needleGreen} />
          <Text style={styles.loadingText}>Opening group invite...</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (preview.status === 'error') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <View style={styles.card}>
            <Feather name="alert-circle" size={28} color={Colors.kanteRust} />
            <Text style={styles.title}>Invite unavailable</Text>
            <Text style={styles.copy}>{preview.message}</Text>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/(customer)')}>
              <Text style={styles.secondaryBtnText}>Go to home</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>Group order invite</Text>
          <Text style={styles.title}>Join {preview.ownerName}'s Drapeon order.</Text>
          <Text style={styles.copy}>
            You were invited as {preview.memberName} for {preview.garmentType}. Accepting attaches
            your measurement profile so the tailor can work from the right fit record.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Order</Text>
          <InfoRow label="Reference" value={preview.orderReference} />
          <InfoRow label="For" value={preview.memberName} />
          <InfoRow label="Status" value={preview.inviteStatus.replace(/_/g, ' ').toLowerCase()} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Measurement profile</Text>
          {loadingProfiles ? (
            <ActivityIndicator color={Colors.needleGreen} />
          ) : hasProfiles ? (
            <TouchableOpacity
              style={styles.profileOption}
              onPress={() => setProfileSheetOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Choose measurement profile"
            >
              <View>
                <Text style={styles.profileTitle}>{selectedProfile?.label ?? 'Choose profile'}</Text>
                <Text style={styles.profileSub}>
                  {selectedProfile?.relationship ?? 'Profile'}{selectedProfile?.is_default ? ' · default' : ''}
                </Text>
              </View>
              <Feather name="chevron-down" size={20} color={Colors.midGrey} />
            </TouchableOpacity>
          ) : (
            <View style={styles.emptyBox}>
              <Text style={styles.copy}>
                Add measurements first so this group order does not drift into guesswork.
              </Text>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => router.push('/(customer)/profile/measurements')}
              >
                <Text style={styles.secondaryBtnText}>Open measurements</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {preview.alreadyAcceptedByYou ? (
          <View style={styles.successCard}>
            <Feather name="check" size={20} color={Colors.needleGreen} />
            <Text style={styles.successText}>You already accepted this invite.</Text>
          </View>
        ) : preview.acceptedBySomeoneElse ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningText}>This invite was already accepted by another account.</Text>
          </View>
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.primaryBtn, (submitting || !hasProfiles) && styles.disabledBtn]}
              onPress={handleAccept}
              disabled={submitting || !hasProfiles}
            >
              {submitting ? (
                <ActivityIndicator color={Colors.textInverse} />
              ) : (
                <Text style={styles.primaryBtnText}>Accept invite</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleDecline} disabled={submitting}>
              <Text style={styles.secondaryBtnText}>Decline</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
      <ChoiceSheet
        visible={profileSheetOpen}
        title="Choose measurements"
        subtitle="Attach the profile that belongs to this group order member."
        options={profiles.map((profile) => ({
          value: profile.id,
          title: profile.is_default ? `${profile.label} · default` : profile.label,
          body: profile.updated_at
            ? `Updated ${new Date(profile.updated_at).toLocaleDateString()}`
            : profile.relationship ?? 'Saved profile',
          icon: profile.relationship === 'SELF' ? 'user' : 'users',
        }))}
        selectedValue={selectedProfileId}
        onClose={() => setProfileSheetOpen(false)}
        onSelect={(value) => {
          setSelectedProfileId(value)
          setProfileSheetOpen(false)
        }}
      />
    </SafeAreaView>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  scroll: { padding: Spacing.lg, gap: Spacing.md },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  eyebrow: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  title: { fontSize: FontSize.xl, color: Colors.ink, fontWeight: FontWeight.bold, fontFamily: Fonts.display, lineHeight: 30 },
  copy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 21 },
  loadingText: { color: Colors.inkLight, fontSize: FontSize.sm },
  sectionTitle: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.semibold, fontFamily: Fonts.display },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  infoLabel: { color: Colors.midGrey, fontSize: FontSize.sm },
  infoValue: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.medium, flex: 1, textAlign: 'right' },
  profileList: { gap: Spacing.sm },
  profileOption: {
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  profileOptionSelected: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  profileTitle: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  profileSub: { fontSize: FontSize.xs, color: Colors.inkLight, marginTop: 2 },
  emptyBox: { gap: Spacing.md },
  actions: { gap: Spacing.sm },
  primaryBtn: {
    minHeight: 50,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  primaryBtnText: { color: Colors.textInverse, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  secondaryBtn: {
    minHeight: 48,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  secondaryBtnText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  disabledBtn: { opacity: 0.55 },
  successCard: {
    borderRadius: Radius.lg,
    backgroundColor: Colors.needleGreenLight,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  successText: { color: Colors.needleGreen, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, flex: 1 },
  warningCard: { borderRadius: Radius.lg, backgroundColor: Colors.statusPendingBg, padding: Spacing.md },
  warningText: { color: Colors.ink, fontSize: FontSize.sm, lineHeight: 20 },
})
