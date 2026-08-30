'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MessageCircle,
  Package,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import type {
  CommunicationCategory,
  CommunicationChannel,
  CommunicationPurpose,
  CommunicationSeverity,
} from '@drape/shared'

import { createClient } from '../lib/supabase'
import { Button } from './ui/button'
import { Switch } from './ui/switch'

type PreferenceCell = {
  enabled: boolean
  mandatory: boolean
  requiresConsent: boolean
}

type PreferenceMatrix = Record<CommunicationCategory, Record<CommunicationChannel, PreferenceCell>>

type ConsentState = Partial<Record<CommunicationChannel, { granted: boolean } | null>>

type InboxItem = {
  id: string
  category: CommunicationCategory
  purpose: CommunicationPurpose
  severity: CommunicationSeverity
  title: string
  body: string
  destination_key: string | null
  destination_params: Record<string, unknown>
  acknowledgement_required: boolean
  read_at: string | null
  acknowledged_at: string | null
  expires_at: string | null
  created_at: string
}

type PreferencesResponse = {
  preferences: PreferenceMatrix
  marketingConsents: ConsentState
}

type InboxResponse = {
  items: InboxItem[]
  unreadCount: number
}

const ROUTINE_CATEGORIES: Array<{
  category: CommunicationCategory
  icon: LucideIcon
  title: string
  description: string
}> = [
  { category: 'ORDER', icon: Package, title: 'Orders and fulfillment', description: 'Quotes, production, delivery, collection, and decisions.' },
  { category: 'MESSAGE', icon: MessageCircle, title: 'Messages and calls', description: 'New messages, consultation activity, and call updates.' },
]

const ESSENTIAL_CATEGORIES: Array<{
  icon: LucideIcon
  title: string
  description: string
}> = [
  { icon: CreditCard, title: 'Payments and refunds', description: 'Receipts, failed payments, refunds, and recovery steps.' },
  { icon: CircleDollarSign, title: 'Earnings and payouts', description: 'Releases, blocked payouts, and destination changes.' },
  { icon: ShieldCheck, title: 'Account and safety', description: 'Sign-in, privacy, support, and safety decisions.' },
  { icon: AlertTriangle, title: 'Service incidents', description: 'Important disruptions, mitigations, and recovery notices.' },
]

const OPTIONAL_CATEGORIES: Array<{
  category: 'PROMOTION' | 'PRODUCT_UPDATE'
  icon: LucideIcon
  title: string
  description: string
}> = [
  { category: 'PROMOTION', icon: Sparkles, title: 'Offers and rewards', description: 'Discounts, credits, seasonal offers, and eligible rewards.' },
  { category: 'PRODUCT_UPDATE', icon: Bell, title: 'Product updates', description: 'New Drapeon capabilities and occasional product news.' },
]

const OPTIONAL_CHANNELS: Array<{ channel: Exclude<CommunicationChannel, 'IN_APP' | 'SMS'>; label: string; icon: LucideIcon }> = [
  { channel: 'PUSH', label: 'Device', icon: Smartphone },
  { channel: 'EMAIL', label: 'Email', icon: Mail },
]

function messageFromError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  if (/fetch|network|timeout|connection/i.test(text)) {
    return 'Connection looks weak. Your previous choices are unchanged; try again.'
  }
  return text || 'Drapeon could not complete this action. Try again.'
}

async function invokeCommunications<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke('communications-action', { body })
  if (error) throw error
  if (data?.error) throw new Error(String(data.error))
  return data as T
}

function inboxDestination(item: InboxItem): string | null {
  const params = item.destination_params ?? {}
  const stringParam = (key: string) => typeof params[key] === 'string' ? params[key] as string : null
  const orderId = stringParam('orderId') ?? stringParam('order_id')
  const conversationId = stringParam('conversationId') ?? stringParam('conversation_id')
  const caseId = stringParam('caseId') ?? stringParam('case_id')

  switch (item.destination_key) {
    case 'ORDER_DETAIL': return orderId ? `/account/orders?orderId=${encodeURIComponent(orderId)}` : '/account/orders'
    case 'ORDER_CHAT': return conversationId
      ? `/account/messages?conversationId=${encodeURIComponent(conversationId)}`
      : orderId
        ? `/account/messages?orderId=${encodeURIComponent(orderId)}`
        : '/account/messages'
    case 'PAYOUT_SETUP': return '/account/payout'
    case 'ACCOUNT_SETTINGS': return '/account/settings'
    case 'SERVICE_STATUS': return '/status'
    case 'SUPPORT_CASE': return caseId ? `/account/support?caseId=${encodeURIComponent(caseId)}` : '/account/support'
    case 'PROMOTION': return '/account'
    case 'NOTIFICATIONS': return '/account/settings#communications'
    default: return null
  }
}

function relativeTime(value: string) {
  const milliseconds = Date.now() - new Date(value).getTime()
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function SeverityDot({ severity }: { severity: CommunicationSeverity }) {
  const color = severity === 'CRITICAL' ? 'bg-rust' : severity === 'WARNING' ? 'bg-amber-500' : 'bg-drape-green'
  return <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${color}`} />
}

export function CommunicationCenter({ session }: { session: Session | null }) {
  const [preferences, setPreferences] = useState<PreferenceMatrix | null>(null)
  const [consents, setConsents] = useState<ConsentState>({})
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = useCallback(async (refresh = false) => {
    if (!session) return
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [preferenceData, inboxData] = await Promise.all([
        invokeCommunications<PreferencesResponse>({ action: 'PREFERENCES_GET' }),
        invokeCommunications<InboxResponse>({ action: 'INBOX_LIST', limit: 6 }),
      ])
      setPreferences(preferenceData.preferences)
      setConsents(preferenceData.marketingConsents ?? {})
      setInboxItems(inboxData.items ?? [])
      setUnreadCount(inboxData.unreadCount ?? 0)
    } catch (loadError) {
      setError(messageFromError(loadError))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [session])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const marketingEnabled = useMemo(() => {
    if (!preferences) return {} as Partial<Record<CommunicationChannel, boolean>>
    return Object.fromEntries(OPTIONAL_CHANNELS.map(({ channel }) => [
      channel,
      OPTIONAL_CATEGORIES.some(({ category }) => preferences[category][channel].enabled),
    ]))
  }, [preferences])

  if (!session) return null

  async function savePreference(category: CommunicationCategory, channel: CommunicationChannel, enabled: boolean) {
    if (!preferences) return
    const key = `${category}:${channel}`
    const previous = preferences
    const previousConsents = consents
    setSavingKey(key)
    setError(null)
    setSuccess(null)
    setPreferences({
      ...preferences,
      [category]: {
        ...preferences[category],
        [channel]: { ...preferences[category][channel], enabled },
      },
    })

    try {
      const optional = category === 'PROMOTION' || category === 'PRODUCT_UPDATE'
      if (optional && enabled && consents[channel]?.granted !== true) {
        await invokeCommunications({ action: 'CONSENT_SET', channel, granted: true, policyVersion: 'communications-v1' })
        setConsents((current) => ({ ...current, [channel]: { granted: true } }))
      }
      await invokeCommunications({ action: 'PREFERENCE_SET', category, channel, enabled })

      if (optional && !enabled) {
        const otherCategory = category === 'PROMOTION' ? 'PRODUCT_UPDATE' : 'PROMOTION'
        if (!preferences[otherCategory][channel].enabled) {
          await invokeCommunications({ action: 'CONSENT_SET', channel, granted: false, policyVersion: 'communications-v1' })
          setConsents((current) => ({ ...current, [channel]: { granted: false } }))
        }
      }
      setSuccess('Communication choice saved.')
    } catch (saveError) {
      setPreferences(previous)
      setConsents(previousConsents)
      setError(messageFromError(saveError))
    } finally {
      setSavingKey(null)
    }
  }

  async function markInbox(item: InboxItem, action: 'READ' | 'UNREAD' | 'ACKNOWLEDGED') {
    const key = `inbox:${item.id}:${action}`
    setSavingKey(key)
    setError(null)
    try {
      await invokeCommunications({ action: 'INBOX_MARK', inboxId: item.id, inboxAction: action })
      setInboxItems((current) => current.map((entry) => entry.id === item.id ? {
        ...entry,
        read_at: action === 'UNREAD' ? null : entry.read_at ?? new Date().toISOString(),
        acknowledged_at: action === 'ACKNOWLEDGED' ? new Date().toISOString() : entry.acknowledged_at,
      } : entry))
      setUnreadCount((count) => action === 'UNREAD' ? count + (item.read_at ? 1 : 0) : Math.max(0, count - (item.read_at ? 0 : 1)))
      setSuccess(action === 'ACKNOWLEDGED' ? 'Acknowledgement recorded.' : 'Inbox updated.')
    } catch (markError) {
      setError(messageFromError(markError))
    } finally {
      setSavingKey(null)
    }
  }

  if (loading && !preferences) {
    return (
      <div className="flex min-h-40 items-center justify-center gap-2 rounded-[12px] border border-ui-border bg-white text-sm text-ink/60">
        <LoaderCircle className="size-5 animate-spin" /> Loading communications…
      </div>
    )
  }

  return (
    <div id="communications" className="grid scroll-mt-28 gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">Communications</p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-ink/52">Control routine alerts and optional updates. Important account, money, safety, support, and service messages always remain available in Drapeon.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load(true)} disabled={refreshing}>
          <RefreshCw className={refreshing ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      {error ? <div role="alert" className="rounded-[8px] border border-rust/20 bg-rust/5 px-4 py-3 text-sm text-rust">{error}</div> : null}
      {success ? <div role="status" className="rounded-[8px] border border-drape-green/20 bg-drape-green/5 px-4 py-3 text-sm text-drape-green">{success}</div> : null}

      <section aria-labelledby="routine-communications" className="grid gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-drape-green">Routine alerts</p>
          <h3 id="routine-communications" className="mt-1 text-base font-semibold text-ink">Choose what interrupts you</h3>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {ROUTINE_CATEGORIES.map(({ category, icon: Icon, title, description }) => (
            <div key={category} className="rounded-[12px] border border-ui-border bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-drape-green/8 text-drape-green"><Icon className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-ink/52">{description}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-ui-border pt-3">
                {OPTIONAL_CHANNELS.map(({ channel, label, icon: ChannelIcon }) => {
                  const key = `${category}:${channel}`
                  return (
                    <div key={channel} className="flex min-h-11 items-center justify-between gap-2 rounded-[8px] bg-ui-muted px-3">
                      <span className="flex items-center gap-2 text-xs font-semibold text-ink"><ChannelIcon className="size-4 text-ink/50" />{label}</span>
                      {savingKey === key ? <LoaderCircle className="size-4 animate-spin text-drape-green" /> : (
                        <Switch
                          checked={preferences?.[category][channel].enabled ?? false}
                          onCheckedChange={(checked) => void savePreference(category, channel, checked)}
                          aria-label={`${title}: ${label}`}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="essential-communications" className="grid gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-drape-green">Essential</p>
          <h3 id="essential-communications" className="mt-1 text-base font-semibold text-ink">Protection that stays on</h3>
        </div>
        <div className="divide-y divide-ui-border overflow-hidden rounded-[12px] border border-ui-border bg-ui-muted/45">
          {ESSENTIAL_CATEGORIES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex min-h-16 items-center gap-3 px-4 py-3">
              <Icon className="size-5 shrink-0 text-drape-green" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{title}</p>
                <p className="text-xs leading-5 text-ink/50">{description}</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-drape-green"><LockKeyhole className="size-3" /> Required</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="optional-communications" className="grid gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-drape-green">Optional</p>
          <h3 id="optional-communications" className="mt-1 text-base font-semibold text-ink">Offers and product news</h3>
          <p className="mt-1 text-xs leading-5 text-ink/52">Off by default. Turning a channel on records your consent; turning every optional topic off withdraws it.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {OPTIONAL_CATEGORIES.map(({ category, icon: Icon, title, description }) => (
            <div key={category} className="rounded-[12px] border border-ui-border bg-white p-4">
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 size-5 shrink-0 text-drape-green" />
                <div><p className="text-sm font-semibold text-ink">{title}</p><p className="mt-1 text-xs leading-5 text-ink/52">{description}</p></div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {OPTIONAL_CHANNELS.map(({ channel, label }) => {
                  const key = `${category}:${channel}`
                  return (
                    <div key={channel} className="flex min-h-11 items-center justify-between gap-2 rounded-[8px] bg-ui-muted px-3">
                      <span className="text-xs font-semibold text-ink">{label}</span>
                      {savingKey === key ? <LoaderCircle className="size-4 animate-spin text-drape-green" /> : (
                        <Switch checked={preferences?.[category][channel].enabled ?? false} onCheckedChange={(checked) => void savePreference(category, channel, checked)} aria-label={`${title}: ${label}`} />
                      )}
                    </div>
                  )
                })}
              </div>
              {OPTIONAL_CHANNELS.some(({ channel }) => marketingEnabled[channel] && consents[channel]?.granted === true) ? <p className="mt-3 text-[11px] text-ink/45">Consent is recorded only for enabled optional channels.</p> : null}
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="communication-inbox" className="grid gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-drape-green">Inbox</p>
            <h3 id="communication-inbox" className="mt-1 flex items-center gap-2 text-base font-semibold text-ink"><Inbox className="size-5" /> Important updates</h3>
          </div>
          <span className="rounded-full bg-drape-green/8 px-3 py-1 text-xs font-bold text-drape-green">{unreadCount} unread</span>
        </div>

        {inboxItems.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-ui-border px-4 py-8 text-center text-sm text-ink/50">No communication history yet.</div>
        ) : (
          <div className="divide-y divide-ui-border overflow-hidden rounded-[12px] border border-ui-border bg-white">
            {inboxItems.map((item) => {
              const href = inboxDestination(item)
              const acknowledgeRequired = item.acknowledgement_required
              return (
                <article key={item.id} className={`grid gap-3 px-4 py-4 ${item.read_at ? 'bg-white' : 'bg-drape-green/[0.035]'}`}>
                  <div className="flex items-start gap-3">
                    <SeverityDot severity={item.severity} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h4 className="text-sm font-semibold text-ink">{item.title}</h4>
                        <span className="text-[11px] text-ink/40">{relativeTime(item.created_at)}</span>
                        {!item.read_at ? <span className="rounded-full bg-drape-green px-2 py-0.5 text-[10px] font-bold text-white">New</span> : null}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-ink/58">{item.body}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => void markInbox(item, item.read_at ? 'UNREAD' : 'READ')} disabled={savingKey?.startsWith(`inbox:${item.id}`)}>
                      {item.read_at ? <Bell /> : <Check />} {item.read_at ? 'Mark unread' : 'Mark read'}
                    </Button>
                    {acknowledgeRequired && !item.acknowledged_at ? (
                      <Button variant="secondary" size="sm" onClick={() => void markInbox(item, 'ACKNOWLEDGED')} disabled={savingKey?.startsWith(`inbox:${item.id}`)}><CheckCheck /> Acknowledge</Button>
                    ) : null}
                    {href ? <Button asChild size="sm"><Link href={href as Route}>Open context <ChevronRight /></Link></Button> : null}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
