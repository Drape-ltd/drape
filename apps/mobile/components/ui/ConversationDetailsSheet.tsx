import { useEffect, useMemo, useState } from 'react'
import { Feather } from '@expo/vector-icons'
import {
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { OrderStage } from '@drape/shared/order-machine'
import { formatStatusLabel } from '@drape/shared/status-display'
import {
  FALLBACK_TRANSLATION_LANGUAGES,
  languageName,
  type ConversationTranslationPreference,
  type TranslationLanguage,
} from '@drape/shared/message-translation'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import { AvatarImage } from './AvatarImage'

type Participant = {
  name: string
  role: string
  avatarUrl?: string | null
}

type CallHistoryRow = {
  id: string
  call_room_id: string
  status: 'STARTED' | 'ENDED'
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  order_call_rooms:
    | { call_type: 'audio' | 'video'; call_kind: 'CONSULTATION' | 'ORDER' }
    | { call_type: 'audio' | 'video'; call_kind: 'CONSULTATION' | 'ORDER' }[]
    | null
}

function callRoomMeta(row: CallHistoryRow) {
  return Array.isArray(row.order_call_rooms)
    ? row.order_call_rooms[0] ?? null
    : row.order_call_rooms
}

function formatCallDuration(seconds: number | null) {
  if (seconds == null) return 'Duration pending'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

function formatCallStart(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Time unavailable'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function ConversationDetailsSheet({
  visible,
  orderId,
  orderLabel,
  orderStage,
  participants,
  onClose,
  onOpenOrder,
  onReport,
  translationPreference = { autoTranslate: false, targetLanguage: 'en', sourceLanguage: null },
  translationLanguages = FALLBACK_TRANSLATION_LANGUAGES,
  translationSaving,
  translationError,
  onChangeTranslationPreference = async () => {},
}: {
  visible: boolean
  orderId: string
  orderLabel: string
  orderStage: OrderStage
  participants: Participant[]
  onClose: () => void
  onOpenOrder: () => void
  onReport: () => void
  translationPreference?: ConversationTranslationPreference
  translationLanguages?: TranslationLanguage[]
  translationSaving?: boolean
  translationError?: string | null
  onChangeTranslationPreference?: (preference: ConversationTranslationPreference) => Promise<void>
}) {
  const [callHistory, setCallHistory] = useState<CallHistoryRow[]>([])
  const [loadingCallHistory, setLoadingCallHistory] = useState(false)
  const [showLanguagePicker, setShowLanguagePicker] = useState(false)
  const [languagePickerMode, setLanguagePickerMode] = useState<'target' | 'source'>('target')
  const [languageSearch, setLanguageSearch] = useState('')

  const filteredLanguages = useMemo(() => {
    const query = languageSearch.trim().toLowerCase()
    if (!query) return translationLanguages
    return translationLanguages.filter((language) =>
      language.name.toLowerCase().includes(query) || language.code.toLowerCase().includes(query)
    )
  }, [languageSearch, translationLanguages])

  useEffect(() => {
    if (!visible || !orderId) return
    let active = true
    setLoadingCallHistory(true)
    void supabase
      .from('order_call_sessions')
      .select('id, call_room_id, status, started_at, ended_at, duration_seconds, order_call_rooms!inner(call_type, call_kind)')
      .eq('order_id', orderId)
      .order('started_at', { ascending: true })
      .limit(20)
      .then(({ data, error }) => {
        if (!active) return
        setCallHistory(error ? [] : (data ?? []) as CallHistoryRow[])
        setLoadingCallHistory(false)
      })
    return () => {
      active = false
    }
  }, [orderId, visible])

  const historyWithRejoins = useMemo(() => {
    const roomCounts = new Map<string, number>()
    return callHistory
      .map((row) => {
        const roomAttempt = roomCounts.get(row.call_room_id) ?? 0
        roomCounts.set(row.call_room_id, roomAttempt + 1)
        return { row, rejoined: roomAttempt > 0 }
      })
      .reverse()
  }, [callHistory])

  async function openSupport() {
    const subject = encodeURIComponent(`Drapeon order support: ${orderLabel}`)
    await Linking.openURL(`mailto:support@drapeon.co?subject=${subject}`)
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={onClose}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Conversation details</Text>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close conversation details"
          >
            <Feather name="x" size={23} color={Colors.ink} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.orderSummary}>
            <View style={styles.orderIcon}>
              <Feather name="scissors" size={20} color={Colors.needleGreen} />
            </View>
            <View style={styles.orderCopy}>
              <Text style={styles.orderLabel}>{orderLabel}</Text>
              <Text style={styles.orderStage}>
                {formatStatusLabel(orderStage, { domain: 'order' })}
              </Text>
            </View>
          </View>
          <TouchableOpacity style={styles.primaryAction} onPress={onOpenOrder}>
            <Text style={styles.primaryActionText}>Open order control</Text>
            <Feather name="chevron-right" size={20} color={Colors.textInverse} />
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>In this conversation</Text>
          <View style={styles.rows}>
            {participants.map((participant) => (
              <View key={`${participant.role}:${participant.name}`} style={styles.participantRow}>
                <AvatarImage
                  uri={participant.avatarUrl}
                  initials={participant.name}
                  size={44}
                  borderWidth={0}
                />
                <View>
                  <Text style={styles.rowTitle}>{participant.name}</Text>
                  <Text style={styles.rowDetail}>{participant.role}</Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Translation</Text>
          <View style={styles.rows}>
            <View style={styles.translationToggleRow}>
              <View style={styles.actionCopy}>
                <Text style={styles.rowTitle}>Always translate this conversation</Text>
                <Text style={styles.rowDetail}>Incoming text appears in your preferred language. Originals stay available.</Text>
              </View>
              <Switch
                value={translationPreference.autoTranslate}
                disabled={translationSaving}
                onValueChange={(autoTranslate) => {
                  void onChangeTranslationPreference({ ...translationPreference, autoTranslate })
                }}
                trackColor={{ false: Colors.lightGrey, true: Colors.needleGreenLight }}
                thumbColor={translationPreference.autoTranslate ? Colors.needleGreen : Colors.midGrey}
                accessibilityLabel="Always translate this conversation"
              />
            </View>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => {
                setLanguagePickerMode('target')
                setShowLanguagePicker(true)
              }}
              accessibilityRole="button"
              accessibilityLabel={`Translate messages to ${languageName(translationPreference.targetLanguage, translationLanguages)}`}
            >
              <View style={styles.actionIcon}>
                <Feather name="globe" size={20} color={Colors.needleGreen} />
              </View>
              <View style={styles.actionCopy}>
                <Text style={styles.rowTitle}>Translate messages to</Text>
                <Text style={styles.rowDetail}>{languageName(translationPreference.targetLanguage, translationLanguages)}</Text>
              </View>
              {translationSaving
                ? <ActivityIndicator size="small" color={Colors.needleGreen} />
                : <Feather name="chevron-right" size={20} color={Colors.midGrey} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => {
                setLanguagePickerMode('source')
                setShowLanguagePicker(true)
              }}
              accessibilityRole="button"
              accessibilityLabel={`Message language ${translationPreference.sourceLanguage ? languageName(translationPreference.sourceLanguage, translationLanguages) : 'Detect automatically'}`}
            >
              <View style={styles.actionIcon}>
                <Feather name="message-circle" size={20} color={Colors.needleGreen} />
              </View>
              <View style={styles.actionCopy}>
                <Text style={styles.rowTitle}>Message language</Text>
                <Text style={styles.rowDetail}>
                  {translationPreference.sourceLanguage
                    ? languageName(translationPreference.sourceLanguage, translationLanguages)
                    : 'Detect automatically'}
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={Colors.midGrey} />
            </TouchableOpacity>
          </View>
          {translationError ? <Text style={styles.translationError}>{translationError}</Text> : null}
          <Text style={styles.callHistoryFootnote}>
            Language detection is automatic. Translation may be less exact for dialects such as Nigerian Pidgin.
          </Text>

          <Text style={styles.sectionLabel}>Call history</Text>
          <View style={styles.rows}>
            {loadingCallHistory ? (
              <View style={styles.callHistoryState}>
                <ActivityIndicator size="small" color={Colors.needleGreen} />
                <Text style={styles.rowDetail}>Loading provider-confirmed calls…</Text>
              </View>
            ) : historyWithRejoins.length > 0 ? (
              historyWithRejoins.map(({ row, rejoined }) => {
                const meta = callRoomMeta(row)
                const callKind = meta?.call_type === 'audio' ? 'Audio' : 'Video'
                const lifecycle = row.status === 'ENDED'
                  ? formatCallDuration(row.duration_seconds)
                  : 'In progress'
                return (
                  <View key={row.id} style={styles.callHistoryRow}>
                    <View style={styles.actionIcon}>
                      <Feather
                        name={meta?.call_type === 'audio' ? 'phone' : 'video'}
                        size={20}
                        color={Colors.needleGreen}
                      />
                    </View>
                    <View style={styles.actionCopy}>
                      <Text style={styles.rowTitle}>
                        {rejoined ? `Rejoined ${callKind.toLowerCase()} call` : `${callKind} call`}
                      </Text>
                      <Text style={styles.rowDetail}>
                        {formatCallStart(row.started_at)} · {lifecycle}
                      </Text>
                    </View>
                  </View>
                )
              })
            ) : (
              <View style={styles.callHistoryState}>
                <Feather name="clock" size={20} color={Colors.midGrey} />
                <Text style={styles.rowDetail}>No completed or active calls yet.</Text>
              </View>
            )}
          </View>
          <Text style={styles.callHistoryFootnote}>
            Drapeon records join, leave, and duration metadata for support and safety—not call audio or video.
          </Text>

          <Text style={styles.sectionLabel}>Help and safety</Text>
          <View style={styles.rows}>
            <TouchableOpacity style={styles.actionRow} onPress={() => void openSupport()}>
              <View style={styles.actionIcon}>
                <Feather name="help-circle" size={21} color={Colors.ink} />
              </View>
              <View style={styles.actionCopy}>
                <Text style={styles.rowTitle}>Get order support</Text>
                <Text style={styles.rowDetail}>Help with delivery, payment, or an order decision</Text>
              </View>
              <Feather name="chevron-right" size={20} color={Colors.midGrey} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionRow} onPress={onReport}>
              <View style={styles.actionIcon}>
                <Feather name="flag" size={20} color={Colors.kanteRust} />
              </View>
              <View style={styles.actionCopy}>
                <Text style={[styles.rowTitle, styles.reportText]}>Report a safety concern</Text>
                <Text style={styles.rowDetail}>Abuse, pressure to move off Drapeon, or unsafe behavior</Text>
              </View>
              <Feather name="chevron-right" size={20} color={Colors.midGrey} />
            </TouchableOpacity>
          </View>
          <Text style={styles.footnote}>
            Reporting is separate from ordinary order support. Your order and message history remain the evidence record.
          </Text>
        </ScrollView>

        <Modal
          visible={showLanguagePicker}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowLanguagePicker(false)}
        >
          <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            <View style={[styles.header, styles.languagePickerHeader]}>
              <Text style={[styles.title, styles.languagePickerTitle]}>
                {languagePickerMode === 'target' ? 'Translation language' : 'Message language'}
              </Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setShowLanguagePicker(false)}
                accessibilityRole="button"
                accessibilityLabel="Close language picker"
              >
                <Feather name="x" size={23} color={Colors.ink} />
              </TouchableOpacity>
            </View>
            <View style={styles.languageSearchWrap}>
              <Feather name="search" size={18} color={Colors.midGrey} />
              <TextInput
                value={languageSearch}
                onChangeText={setLanguageSearch}
                placeholder="Search languages"
                placeholderTextColor={Colors.midGrey}
                style={styles.languageSearchInput}
                autoCorrect={false}
                accessibilityLabel="Search translation languages"
              />
            </View>
            <ScrollView contentContainerStyle={styles.languageList} keyboardShouldPersistTaps="handled">
              {languagePickerMode === 'source' ? (
                <TouchableOpacity
                  style={styles.languageRow}
                  onPress={() => {
                    void onChangeTranslationPreference({
                      ...translationPreference,
                      sourceLanguage: null,
                    }).then(() => setShowLanguagePicker(false))
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: translationPreference.sourceLanguage === null }}
                >
                  <View style={styles.actionCopy}>
                    <Text style={styles.rowTitle}>Detect automatically</Text>
                    <Text style={styles.rowDetail}>Recommended for multilingual conversations</Text>
                  </View>
                  {translationPreference.sourceLanguage === null
                    ? <Feather name="check" size={20} color={Colors.needleGreen} />
                    : null}
                </TouchableOpacity>
              ) : null}
              {filteredLanguages.map((language) => {
                const selected = languagePickerMode === 'target'
                  ? language.code === translationPreference.targetLanguage
                  : language.code === translationPreference.sourceLanguage
                return (
                  <TouchableOpacity
                    key={language.code}
                    style={styles.languageRow}
                    onPress={() => {
                      void onChangeTranslationPreference({
                        ...translationPreference,
                        ...(languagePickerMode === 'target'
                          ? { targetLanguage: language.code }
                          : { sourceLanguage: language.code }),
                      }).then(() => setShowLanguagePicker(false))
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <View style={styles.actionCopy}>
                      <Text style={styles.rowTitle}>{language.name}</Text>
                      <Text style={styles.rowDetail}>{language.code}</Text>
                    </View>
                    {selected ? <Feather name="check" size={20} color={Colors.needleGreen} /> : null}
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  header: {
    minHeight: 64,
    paddingLeft: Spacing.xl,
    paddingRight: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 24, fontWeight: FontWeight.bold, color: Colors.ink },
  languagePickerHeader: { minHeight: 78, paddingTop: Spacing.md, gap: Spacing.sm },
  languagePickerTitle: { flex: 1, fontSize: 22 },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.boneDeep,
  },
  content: { paddingHorizontal: Spacing.xl, paddingBottom: 40 },
  orderSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.lg,
  },
  orderIcon: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  orderCopy: { flex: 1 },
  orderLabel: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink },
  orderStage: {
    marginTop: 3,
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    textTransform: 'capitalize',
  },
  primaryAction: {
    marginTop: Spacing.lg,
    minHeight: 50,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.needleGreen,
  },
  primaryActionText: { color: Colors.textInverse, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  sectionLabel: {
    marginTop: 34,
    marginBottom: Spacing.sm,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.inkLight,
  },
  rows: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.lightGrey },
  participantRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  actionRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  callHistoryRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  callHistoryState: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  callHistoryFootnote: {
    marginTop: Spacing.sm,
    fontSize: FontSize.xs,
    lineHeight: 18,
    color: Colors.midGrey,
  },
  translationError: {
    marginTop: Spacing.sm,
    fontSize: FontSize.xs,
    lineHeight: 18,
    color: Colors.kanteRust,
  },
  translationToggleRow: {
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  languageSearchWrap: {
    marginHorizontal: Spacing.xl,
    marginVertical: Spacing.md,
    minHeight: 48,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  languageSearchInput: { flex: 1, fontSize: FontSize.md, color: Colors.ink },
  languageList: { paddingHorizontal: Spacing.xl, paddingBottom: 40 },
  languageRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  actionIcon: { width: 28, alignItems: 'center' },
  actionCopy: { flex: 1, paddingVertical: Spacing.sm },
  rowTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  rowDetail: { marginTop: 3, fontSize: FontSize.sm, lineHeight: 19, color: Colors.inkLight },
  reportText: { color: Colors.kanteRust },
  footnote: {
    marginTop: Spacing.lg,
    fontSize: FontSize.xs,
    lineHeight: 18,
    color: Colors.midGrey,
  },
})
