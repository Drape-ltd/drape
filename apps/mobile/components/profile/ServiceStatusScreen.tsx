import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'
import { listServiceStatus, type ServiceIncident } from '@/lib/communications'
import { goBackOrFallback } from '@/lib/navigation'

type Role = 'customer' | 'tailor'

const STATUS_LABELS: Record<ServiceIncident['status'], string> = {
  INVESTIGATING: 'Investigating',
  IDENTIFIED: 'Issue identified',
  MONITORING: 'Monitoring recovery',
  RESOLVED: 'Resolved',
}

const SEVERITY_LABELS: Record<ServiceIncident['severity'], string> = {
  INFO: 'Information',
  NOTICE: 'Notice',
  WARNING: 'Important',
  CRITICAL: 'Critical',
}

function friendlyService(value: string) {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function displayTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently updated'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function IncidentRow({ incident }: { incident: ServiceIncident }) {
  const active = incident.status !== 'RESOLVED'
  const critical = incident.severity === 'CRITICAL'
  return (
    <View
      style={[styles.incident, active && styles.incidentActive, critical && styles.incidentCritical]}
      accessibilityLabel={`${incident.title}. ${STATUS_LABELS[incident.status]}. ${incident.summary}`}
    >
      <View style={styles.incidentHeader}>
        <View style={[styles.statusDot, active ? styles.statusDotActive : styles.statusDotResolved]} />
        <View style={styles.incidentTitleCopy}>
          <Text style={styles.incidentTitle}>{incident.title}</Text>
          <Text style={styles.incidentMeta}>
            {STATUS_LABELS[incident.status]} · {SEVERITY_LABELS[incident.severity]}
          </Text>
        </View>
      </View>
      <Text style={styles.summary}>{incident.summary}</Text>
      {incident.affected_services.length > 0 ? (
        <View style={styles.services}>
          {incident.affected_services.map((service) => (
            <View key={service} style={styles.serviceChip}>
              <Text style={styles.serviceText}>{friendlyService(service)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={styles.updated}>Updated {displayTime(incident.updated_at)}</Text>
    </View>
  )
}

export default function ServiceStatusScreen({ role }: { role: Role }) {
  const router = useRouter()
  const navigation = useNavigation()
  const [incidents, setIncidents] = useState<ServiceIncident[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fallback = role === 'customer'
    ? '/(customer)/profile/notifications'
    : '/(tailor)/profile/notifications'

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const response = await listServiceStatus()
      setIncidents(response.incidents)
    } catch {
      setError('Drapeon could not load service status. Your account and orders are unchanged.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const active = useMemo(() => incidents.filter((incident) => incident.status !== 'RESOLVED'), [incidents])
  const resolved = useMemo(() => incidents.filter((incident) => incident.status === 'RESOLVED').slice(0, 8), [incidents])

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backButton}
          onPress={() => goBackOrFallback(router, navigation, fallback)}
        >
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Service status</Text>
          <Text style={styles.headerSubtitle}>Live Drapeon availability</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.needleGreen} />
          <Text style={styles.centerText}>Checking Drapeon services…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={Colors.needleGreen} />}
        >
          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Status unavailable</Text>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.retryButton} onPress={() => void load()}>
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : active.length === 0 ? (
            <View style={styles.operational}>
              <View style={styles.operationalIcon}><Feather name="check" size={21} color={Colors.textInverse} /></View>
              <View style={styles.operationalCopy}>
                <Text style={styles.operationalTitle}>All systems operational</Text>
                <Text style={styles.operationalText}>Drapeon services are working normally.</Text>
              </View>
            </View>
          ) : (
            <View>
              <Text style={styles.sectionLabel}>ACTIVE UPDATES</Text>
              <View style={styles.list}>{active.map((incident) => <IncidentRow key={incident.id} incident={incident} />)}</View>
            </View>
          )}

          {!error && resolved.length > 0 ? (
            <View style={styles.resolvedSection}>
              <Text style={styles.sectionLabel}>RECENTLY RESOLVED</Text>
              <View style={styles.list}>{resolved.map((incident) => <IncidentRow key={incident.id} incident={incident} />)}</View>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.lightGrey, backgroundColor: Colors.bone },
  backButton: { width: 42, height: 42, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.lightGrey },
  headerCopy: { flex: 1 },
  headerTitle: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.xl, color: Colors.ink },
  headerSubtitle: { marginTop: 2, fontFamily: Fonts.body, fontSize: FontSize.sm, color: Colors.midGrey },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  centerText: { fontFamily: Fonts.body, fontSize: FontSize.md, color: Colors.midGrey },
  body: { padding: Spacing.xl, paddingBottom: 48 },
  sectionLabel: { marginBottom: Spacing.md, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.xs, letterSpacing: 1.5, color: Colors.needleGreen },
  list: { gap: Spacing.md },
  incident: { padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.lightGrey, backgroundColor: Colors.white },
  incidentActive: { borderColor: Colors.statusPending },
  incidentCritical: { borderColor: Colors.kanteRust },
  incidentHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  incidentTitleCopy: { flex: 1 },
  statusDot: { width: 9, height: 9, marginTop: 6, borderRadius: Radius.full },
  statusDotActive: { backgroundColor: Colors.statusPending },
  statusDotResolved: { backgroundColor: Colors.success },
  incidentTitle: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.lg, color: Colors.ink },
  incidentMeta: { marginTop: 2, fontFamily: Fonts.bodyMedium, fontSize: FontSize.xs, color: Colors.midGrey },
  summary: { marginTop: Spacing.md, fontFamily: Fonts.body, fontSize: FontSize.md, lineHeight: 22, color: Colors.inkLight },
  services: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  serviceChip: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: Colors.boneDeep },
  serviceText: { fontFamily: Fonts.bodyMedium, fontSize: FontSize.xs, color: Colors.inkLight },
  updated: { marginTop: Spacing.md, fontFamily: Fonts.body, fontSize: FontSize.xs, color: Colors.midGrey },
  operational: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, padding: Spacing.xl, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.needleGreenLight, backgroundColor: Colors.white },
  operationalIcon: { width: 42, height: 42, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.needleGreen },
  operationalCopy: { flex: 1 },
  operationalTitle: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.lg, color: Colors.needleGreen },
  operationalText: { marginTop: 3, fontFamily: Fonts.body, fontSize: FontSize.sm, color: Colors.inkLight },
  resolvedSection: { marginTop: Spacing.xxxl },
  errorCard: { padding: Spacing.xl, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.kanteRustLight, backgroundColor: Colors.white },
  errorTitle: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.lg, color: Colors.ink },
  errorText: { marginTop: Spacing.sm, fontFamily: Fonts.body, fontSize: FontSize.sm, lineHeight: 21, color: Colors.inkLight },
  retryButton: { alignSelf: 'flex-start', marginTop: Spacing.lg, minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.xl, borderRadius: Radius.full, backgroundColor: Colors.needleGreen },
  retryText: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, color: Colors.textInverse },
})
