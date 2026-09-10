'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Copy, Pencil, Plus, Search, Trash2, UsersRound } from 'lucide-react'
import { formatDate, formatDatabaseEnumLabel } from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { NativeSelect } from '../../../components/ui/native-select'
import { StatusChip } from '../../../components/ui/status-chip'
import { Surface, SurfaceHeader } from '../../../components/ui/surface'
import { Textarea } from '../../../components/ui/textarea'
import { AccountRouteRuntime } from '../account-route-runtime'

type CustomerOrder = {
  id: string
  customer_id: string | null
  garment_type: string | null
  item_title: string | null
  stage: string | null
  created_at: string | null
}
type CustomerProfile = { user_id: string; display_name: string | null; avatar_url: string | null }
type DiaryEntry = {
  id: string
  passport_id: string | null
  full_name: string
  invite_status: string | null
  measurement_unit: 'cm' | 'in' | null
  chest: number | null
  shoulder: number | null
  sleeve: number | null
  waist: number | null
  hip: number | null
  neck: number | null
  client_notes: string | null
  fabric_preference: string | null
  style_preference: string | null
  event_type: string | null
  measured_at: string | null
  measured_location: string | null
  updated_at: string | null
}
type Client = CustomerProfile & { orders: CustomerOrder[] }
type Data = { clients: Client[]; diary: DiaryEntry[] }
type State = { status: 'loading' } | { status: 'ready'; data: Data } | { status: 'error'; message: string }
type Form = {
  fullName: string
  unit: 'cm' | 'in'
  chest: string
  shoulder: string
  sleeve: string
  waist: string
  hip: string
  neck: string
  notes: string
  fabric: string
  style: string
  eventType: string
  measuredAt: string
  measuredLocation: 'SHOP' | 'CUSTOMER_HOME' | 'EVENT'
}

const emptyForm: Form = {
  fullName: '', unit: 'cm', chest: '', shoulder: '', sleeve: '', waist: '', hip: '', neck: '',
  notes: '', fabric: '', style: '', eventType: '', measuredAt: '', measuredLocation: 'SHOP',
}
const diarySelect = 'id, passport_id, full_name, invite_status, measurement_unit, chest, shoulder, sleeve, waist, hip, neck, client_notes, fabric_preference, style_preference, event_type, measured_at, measured_location, updated_at'

function initials(name: string) {
  return name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'C'
}
function numberOrNull(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function formFor(entry: DiaryEntry): Form {
  return {
    fullName: entry.full_name,
    unit: entry.measurement_unit ?? 'cm',
    chest: entry.chest?.toString() ?? '', shoulder: entry.shoulder?.toString() ?? '',
    sleeve: entry.sleeve?.toString() ?? '', waist: entry.waist?.toString() ?? '',
    hip: entry.hip?.toString() ?? '', neck: entry.neck?.toString() ?? '',
    notes: entry.client_notes ?? '', fabric: entry.fabric_preference ?? '',
    style: entry.style_preference ?? '', eventType: entry.event_type ?? '',
    measuredAt: entry.measured_at?.slice(0, 10) ?? '',
    measuredLocation: (entry.measured_location as Form['measuredLocation'] | null) ?? 'SHOP',
  }
}
async function errorMessage(error: unknown) {
  const context = error && typeof error === 'object' ? (error as { context?: Response }).context : null
  try {
    const body = context?.clone ? await context.clone().json() as { error?: string; message?: string } : null
    return body?.message || body?.error || null
  } catch { return null }
}
async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke('diary-entry-action', { body })
  if (error) throw new Error((await errorMessage(error)) || 'The diary update could not finish.')
  return data as T
}
async function load(userId: string): Promise<Data> {
  const supabase = createClient()
  const [ordersResult, diaryResult] = await Promise.all([
    supabase.from('orders').select('id, customer_id, garment_type, item_title, stage, created_at').eq('tailor_id', userId).order('created_at', { ascending: false }).limit(100),
    supabase.from('diary_entries').select(diarySelect).eq('tailor_id', userId).order('updated_at', { ascending: false }).limit(100),
  ])
  if (ordersResult.error || diaryResult.error) throw new Error('Client records could not load. Refresh to retry.')
  const orders = (ordersResult.data ?? []) as CustomerOrder[]
  const ids = [...new Set(orders.map((order) => order.customer_id).filter((id): id is string => Boolean(id)))]
  const profilesResult = ids.length
    ? await supabase.from('customer_profiles').select('user_id, display_name, avatar_url').in('user_id', ids)
    : { data: [], error: null }
  if (profilesResult.error) throw new Error('Customer names could not load. Refresh to retry.')
  const profiles = new Map(((profilesResult.data ?? []) as CustomerProfile[]).map((profile) => [profile.user_id, profile]))
  return {
    clients: ids.map((id) => ({
      ...(profiles.get(id) ?? { user_id: id, display_name: 'Customer', avatar_url: null }),
      orders: orders.filter((order) => order.customer_id === id),
    })),
    diary: (diaryResult.data ?? []) as DiaryEntry[],
  }
}

function ClientsContent({ data, refresh }: { data: Data; refresh: () => void }) {
  const [tab, setTab] = useState<'CUSTOMERS' | 'DIARY'>('CUSTOMERS')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<DiaryEntry | 'NEW' | null>(null)
  const [form, setForm] = useState<Form>(emptyForm)
  const [busy, setBusy] = useState(false)
  const [armedDelete, setArmedDelete] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const filteredClients = useMemo(() => data.clients.filter((client) => (client.display_name ?? 'Customer').toLowerCase().includes(query.toLowerCase())), [data.clients, query])
  const filteredDiary = useMemo(() => data.diary.filter((entry) => entry.full_name.toLowerCase().includes(query.toLowerCase())), [data.diary, query])

  function openEditor(entry: DiaryEntry | 'NEW') {
    setEditing(entry); setForm(entry === 'NEW' ? emptyForm : formFor(entry)); setError(null); setNotice(null); setArmedDelete(false)
  }
  function setField<K extends keyof Form>(key: K, value: Form[K]) { setForm((current) => ({ ...current, [key]: value })) }
  function payload() {
    return {
      full_name: form.fullName.trim(), gender: null, client_notes: form.notes.trim() || null,
      measurement_unit: form.unit, chest: numberOrNull(form.chest), shoulder: numberOrNull(form.shoulder),
      sleeve: numberOrNull(form.sleeve), waist: numberOrNull(form.waist), hip: numberOrNull(form.hip), neck: numberOrNull(form.neck),
      trouser_length: null, thigh: null, inseam: null, ankle: null, bicep: null, wrist: null, back_length: null, under_bust: null,
      fabric_preference: form.fabric.trim() || null, style_preference: form.style.trim() || null,
      event_type: form.eventType || null, special_fitting_notes: null,
      measured_at: form.measuredAt || null, measured_location: form.measuredLocation,
    }
  }
  async function save() {
    setError(null); setNotice(null)
    if (!form.fullName.trim()) { setError('Add the client name before saving.'); return }
    if (![form.chest, form.shoulder, form.sleeve, form.waist, form.hip, form.neck].some((value) => value.trim())) { setError('Add at least one measurement before saving.'); return }
    setBusy(true)
    try {
      if (editing === 'NEW') await invoke({ action: 'create', entry: payload() })
      else if (editing) await invoke({ action: 'update', entryId: editing.id, entry: payload() })
      setEditing(null); setNotice('Diary entry saved.'); refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Diary entry could not be saved.') }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!editing || editing === 'NEW') return
    if (!armedDelete) { setArmedDelete(true); return }
    setBusy(true)
    try { await invoke({ action: 'delete', entryId: editing.id }); setEditing(null); setNotice('Diary entry removed.'); refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Diary entry could not be removed.') }
    finally { setBusy(false); setArmedDelete(false) }
  }
  async function copyInvite(entry: DiaryEntry) {
    setError(null); setNotice(null)
    if (!entry.passport_id) { setError('Save at least one measurement before creating an invite.'); return }
    try {
      await navigator.clipboard.writeText(`https://drape.app/passport/claim/${entry.passport_id}`)
      await invoke({ action: 'mark-invite-sent', entryId: entry.id })
      setNotice(`Invite link for ${entry.full_name} copied.`); refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invite link could not be copied.') }
  }

  return <div data-route-content-ready="true" className="grid gap-5 pb-10">
    <Surface>
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="inline-flex rounded-[8px] bg-ui-muted p-1" role="tablist" aria-label="Client records">
          <button type="button" role="tab" aria-selected={tab === 'CUSTOMERS'} onClick={() => { setTab('CUSTOMERS'); setEditing(null) }} className={`rounded-[6px] px-4 py-2 text-sm font-semibold ${tab === 'CUSTOMERS' ? 'bg-white text-needle shadow-sm' : 'text-ink/55'}`}>Customers · {data.clients.length}</button>
          <button type="button" role="tab" aria-selected={tab === 'DIARY'} onClick={() => setTab('DIARY')} className={`rounded-[6px] px-4 py-2 text-sm font-semibold ${tab === 'DIARY' ? 'bg-white text-needle shadow-sm' : 'text-ink/55'}`}>Diary · {data.diary.length}</button>
        </div>
        {tab === 'DIARY' ? <Button size="sm" onClick={() => openEditor('NEW')}><Plus className="size-4" /> New diary client</Button> : null}
      </div>
      <div className="border-t border-ui-border p-5">
        <label className="relative block max-w-md"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-ink/35" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder={tab === 'CUSTOMERS' ? 'Search customers' : 'Search private diary'} /></label>
      </div>
    </Surface>
    {notice ? <p role="status" className="rounded-[8px] border border-needle/20 bg-needle/7 px-4 py-3 text-sm font-semibold text-needle">{notice}</p> : null}
    {error ? <p role="alert" className="rounded-[8px] border border-rust/20 bg-rust/7 px-4 py-3 text-sm font-semibold text-rust">{error}</p> : null}
    {editing ? <Surface>
      <SurfaceHeader title={editing === 'NEW' ? 'New diary client' : `Edit ${editing.full_name}`} description="Private fitting context. Contact details are intentionally blocked." />
      <div className="grid gap-4 p-5">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem_12rem]"><Input aria-label="Client name" value={form.fullName} onChange={(e) => setField('fullName', e.target.value)} placeholder="Client name" /><NativeSelect aria-label="Measurement unit" value={form.unit} onChange={(e) => setField('unit', e.target.value as Form['unit'])}><option value="cm">Centimetres</option><option value="in">Inches</option></NativeSelect><Input aria-label="Measured date" type="date" value={form.measuredAt} onChange={(e) => setField('measuredAt', e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{(['chest','shoulder','sleeve','waist','hip','neck'] as const).map((key) => <Input key={key} aria-label={`${key} measurement`} inputMode="decimal" value={form[key]} onChange={(e) => setField(key, e.target.value)} placeholder={`${key.charAt(0).toUpperCase()}${key.slice(1)} (${form.unit})`} />)}</div>
        <div className="grid gap-3 md:grid-cols-3"><NativeSelect aria-label="Measured location" value={form.measuredLocation} onChange={(e) => setField('measuredLocation', e.target.value as Form['measuredLocation'])}><option value="SHOP">Tailor shop</option><option value="CUSTOMER_HOME">Customer home</option><option value="EVENT">Event</option></NativeSelect><NativeSelect aria-label="Event type" value={form.eventType} onChange={(e) => setField('eventType', e.target.value)}><option value="">No event selected</option><option value="WEDDING">Wedding</option><option value="CASUAL">Casual</option><option value="ASOEBI">Asoebi</option><option value="FORMAL">Formal</option><option value="OTHER">Other</option></NativeSelect><Input aria-label="Fabric preference" value={form.fabric} onChange={(e) => setField('fabric', e.target.value)} placeholder="Fabric preference" /></div>
        <Input aria-label="Style preference" value={form.style} onChange={(e) => setField('style', e.target.value)} placeholder="Style preference" />
        <Textarea aria-label="Private client notes" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={3} placeholder="Private fitting notes" />
        <div className="flex flex-wrap gap-2"><Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save diary entry'}</Button><Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>{editing !== 'NEW' ? <Button variant="secondary" className="text-rust" onClick={() => void remove()} disabled={busy}><Trash2 className="size-4" />{armedDelete ? 'Confirm remove' : 'Remove'}</Button> : null}</div>
      </div>
    </Surface> : null}
    {tab === 'CUSTOMERS' ? <section className="grid gap-3 md:grid-cols-2">{filteredClients.map((client) => { const name = client.display_name?.trim() || 'Customer'; const latest = client.orders[0]; return <Surface key={client.user_id}><div className="flex items-start gap-4 p-5"><div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-needle/9 font-semibold text-needle">{client.avatar_url ? <Image src={client.avatar_url} alt="" width={48} height={48} unoptimized className="size-full object-cover" /> : initials(name)}</div><div className="min-w-0 flex-1"><h2 className="font-semibold text-ink">{name}</h2><p className="mt-1 text-sm text-ink/55">{client.orders.length} {client.orders.length === 1 ? 'order' : 'orders'} · Last {formatDate(latest?.created_at, { fallback: 'date unavailable' })}</p>{latest ? <Link href={`/account/orders/${latest.id}`} className="mt-3 inline-flex text-sm font-semibold text-needle">Open latest order</Link> : null}</div>{latest ? <StatusChip status={latest.stage} fallback="Order" /> : null}</div></Surface> })}{!filteredClients.length ? <Surface><div className="p-7 text-center"><UsersRound className="mx-auto size-6 text-needle" /><h2 className="mt-3 font-semibold text-ink">No customers found</h2><p className="mt-1 text-sm text-ink/55">Platform customers appear after they place an order.</p></div></Surface> : null}</section> : <section className="grid gap-3 md:grid-cols-2">{filteredDiary.map((entry) => <Surface key={entry.id}><div className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-needle">Private diary</p><h2 className="mt-1 text-lg font-semibold text-ink">{entry.full_name}</h2><p className="mt-1 text-sm text-ink/50"><CalendarDays className="mr-1 inline size-4" />{formatDate(entry.measured_at || entry.updated_at, { fallback: 'Date not recorded' })} · {entry.measurement_unit ?? 'cm'}</p></div><StatusChip status={entry.invite_status} fallback="Not invited" /></div><div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => openEditor(entry)}><Pencil className="size-4" /> Edit</Button><Button size="sm" variant="secondary" onClick={() => void copyInvite(entry)} disabled={!entry.passport_id}><Copy className="size-4" /> Copy invite</Button></div></div></Surface>)}{!filteredDiary.length ? <Surface><div className="p-7 text-center"><CalendarDays className="mx-auto size-6 text-needle" /><h2 className="mt-3 font-semibold text-ink">Your private diary is empty</h2><p className="mt-1 text-sm text-ink/55">Add an offline client only with their consent, then record the fitting details you need.</p><Button className="mt-4" size="sm" onClick={() => openEditor('NEW')}><Plus className="size-4" /> New diary client</Button></div></Surface> : null}</section>}
  </div>
}

function ClientsRoute({ userId }: { userId: string }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<State>({ status: 'loading' })
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => { let active = true; void load(userId).then((data) => { if (active) setState({ status: 'ready', data }) }).catch((cause) => { if (active) setState({ status: 'error', message: cause instanceof Error ? cause.message : 'Clients could not load.' }) }); return () => { active = false } }, [revision, userId])
  if (state.status === 'loading') return <section className="app-surface p-7" aria-busy="true">Loading clients…</section>
  if (state.status === 'error') return <section className="app-surface p-7" role="alert"><h2 className="text-2xl font-semibold text-ink">Clients unavailable</h2><p className="mt-2 text-sm text-ink/60">{state.message}</p><Button className="mt-5" onClick={refresh}>Try again</Button></section>
  return <ClientsContent data={state.data} refresh={refresh} />
}

export function ClientsWorkspace() {
  return <AccountRouteRuntime surface="clients">{({ session }) => <ClientsRoute userId={session.user.id} />}</AccountRouteRuntime>
}
