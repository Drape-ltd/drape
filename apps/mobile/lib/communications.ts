import type {
  CommunicationCategory,
  CommunicationChannel,
  CommunicationPurpose,
  CommunicationSeverity,
} from '@drape/shared/communications'

import { invokeFunction } from '@/lib/supabase'

export type CommunicationPreference = {
  enabled: boolean
  mandatory: boolean
  requiresConsent?: boolean
  source?: string
}

export type CommunicationPreferenceMatrix = Record<
  CommunicationCategory,
  Record<CommunicationChannel, CommunicationPreference>
>

export type MarketingConsent = {
  granted: boolean
  policyVersion?: string | null
  source?: string | null
  createdAt?: string | null
}

export type CommunicationPreferencesResponse = {
  categories: CommunicationCategory[]
  channels: CommunicationChannel[]
  preferences: CommunicationPreferenceMatrix
  marketingConsents: Partial<Record<CommunicationChannel, MarketingConsent>>
}

export type CommunicationInboxItem = {
  id: string
  category: CommunicationCategory
  purpose: CommunicationPurpose
  severity: CommunicationSeverity
  title: string
  body: string
  destination_key?: string | null
  destination_params?: Record<string, unknown> | null
  media?: Record<string, unknown> | null
  correlation_id?: string | null
  acknowledgement_required: boolean
  read_at?: string | null
  acknowledged_at?: string | null
  created_at: string
  expires_at?: string | null
}

export type ServiceIncident = {
  id: string
  incident_key: string
  title: string
  summary: string
  severity: CommunicationSeverity
  status: 'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING' | 'RESOLVED'
  affected_services: string[]
  acknowledgement_required: boolean
  destination: Record<string, unknown>
  started_at: string
  resolved_at?: string | null
  updated_at: string
}

async function callCommunications<T>(body: Record<string, unknown>) {
  const { data, error } = await invokeFunction<T>('communications-action', { body })
  if (error) throw error
  if (!data) throw new Error('Drapeon could not load your communication settings.')
  return data
}

export function getCommunicationPreferences() {
  return callCommunications<CommunicationPreferencesResponse>({ action: 'PREFERENCES_GET' })
}

export function setCommunicationPreference(
  category: CommunicationCategory,
  channel: CommunicationChannel,
  enabled: boolean,
) {
  return callCommunications<{ ok: true }>({
    action: 'PREFERENCE_SET',
    category,
    channel,
    enabled,
  })
}

export function setMarketingConsent(channel: CommunicationChannel, granted: boolean) {
  return callCommunications<{ ok: true }>({
    action: 'CONSENT_SET',
    channel,
    granted,
    policyVersion: 'communications-v1',
    source: 'MOBILE_SETTINGS',
  })
}

export function listCommunicationInbox(cursor?: string | null, limit = 40) {
  return callCommunications<{
    items: CommunicationInboxItem[]
    unreadCount: number
    nextCursor: string | null
  }>({ action: 'INBOX_LIST', before: cursor ?? null, limit })
}

export function listServiceStatus() {
  return callCommunications<{ incidents: ServiceIncident[] }>({ action: 'STATUS_LIST' })
}

export function markCommunicationInbox(
  id: string,
  mode: 'READ' | 'UNREAD' | 'ACKNOWLEDGED',
) {
  return callCommunications<{ item: CommunicationInboxItem }>({
    action: 'INBOX_MARK',
    inboxId: id,
    inboxAction: mode,
  })
}
