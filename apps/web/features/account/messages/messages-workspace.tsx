'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ClipboardList, ImagePlus, MessageCircle, Search, Send, Video } from 'lucide-react'
import {
  filterContactInfo,
  formatDatabaseEnumLabel,
  formatRelative,
  MEDIA_CACHE_CONTROL_SECONDS,
} from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { StatusChip } from '../../../components/ui/status-chip'
import { AccountRouteRuntime } from '../account-route-runtime'

type Party = {
  display_name?: string | null
  business_name?: string | null
  avatar_url?: string | null
}
type Order = {
  id: string
  reference: string | null
  order_kind: string | null
  garment_type: string | null
  item_title: string | null
  stage: string | null
  customer_id: string | null
  tailor_id: string | null
  tailor_profile_id: string | null
  created_at: string | null
  updated_at: string | null
  video_call_url: string | null
  tailor_profiles?: Party | Party[] | null
  customer_profiles?: Party | Party[] | null
}
type Message = {
  id: string
  order_id: string
  sender_id: string | null
  sender_name: string | null
  type: 'TEXT' | 'PHOTO' | 'VOICE'
  body: string | null
  photo_url: string | null
  voice_url: string | null
  read_at: string | null
  created_at: string | null
  is_deleted: boolean | null
  edited_at: string | null
  reply_to_id: string | null
}
type Data = { tailorProfileId: string | null; orders: Order[]; messages: Message[] }
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: Data }
  | { status: 'error'; message: string }
const terminalStages = new Set([
  'COMPLETE',
  'COMPLETED',
  'PARTIALLY_REFUNDED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
])
const orderSelect =
  'id, reference, order_kind, garment_type, item_title, stage, customer_id, tailor_id, tailor_profile_id, created_at, updated_at, video_call_url, tailor_profiles!tailor_profile_id(display_name, business_name, avatar_url)'

function first<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}
function title(order: Order) {
  return order.item_title?.trim() || order.garment_type?.trim() || 'Drapeon order'
}
function party(order: Order, userId: string) {
  const profile = partyProfile(order, userId)
  return (
    profile?.business_name?.trim() ||
    profile?.display_name?.trim() ||
    (order.customer_id === userId ? 'Tailor' : 'Customer')
  )
}
function partyProfile(order: Order, userId: string) {
  return order.customer_id === userId ? first(order.tailor_profiles) : first(order.customer_profiles)
}
function preview(message: Message | null) {
  if (!message) return 'No messages yet.'
  if (message.is_deleted) return 'Message removed.'
  return (
    message.body?.trim() ||
    (message.photo_url ? 'Photo' : message.voice_url ? 'Voice note' : 'Message')
  )
}
async function functionError(error: unknown) {
  const context =
    error && typeof error === 'object' ? (error as { context?: Response }).context : null
  try {
    if (context?.clone) {
      const body = (await context.clone().json()) as { message?: string; error?: string }
      return body.message || body.error || null
    }
  } catch {
    /* use safe fallback */
  }
  return null
}
async function invoke(name: string, body: Record<string, unknown>) {
  const { data, error } = await createClient().functions.invoke(name, { body })
  if (error)
    throw new Error((await functionError(error)) || 'That action could not finish. Try again.')
  if ((data as { error?: unknown } | null)?.error)
    throw new Error(
      String(
        (data as { message?: unknown; error?: unknown }).message ||
          (data as { error?: unknown }).error
      )
    )
  return data
}
async function load(userId: string): Promise<Data> {
  const supabase = createClient()
  const tailorResult = await supabase
    .from('tailor_profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (tailorResult.error) throw new Error('Your messaging role could not be confirmed.')
  const tailorProfileId = (tailorResult.data as { id?: string } | null)?.id ?? null
  const filter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`
  const orderResult = await supabase
    .from('orders')
    .select(orderSelect)
    .or(filter)
    .order('updated_at', { ascending: false })
    .limit(40)
  if (orderResult.error) throw new Error('Your protected conversations could not load.')
  let orders = (orderResult.data ?? []) as unknown as Order[]
  const customerIds = [
    ...new Set(orders.map((order) => order.customer_id).filter((id): id is string => Boolean(id))),
  ]
  if (customerIds.length) {
    const customers = await supabase
      .from('customer_profiles')
      .select('user_id, display_name, avatar_url')
      .in('user_id', customerIds)
    if (!customers.error) {
      const byId = new Map(
        (customers.data ?? []).map((row) => [
          row.user_id,
          { display_name: row.display_name, avatar_url: row.avatar_url },
        ])
      )
      orders = orders.map((order) => ({
        ...order,
        customer_profiles: order.customer_id ? (byId.get(order.customer_id) ?? null) : null,
      }))
    }
  }
  const ids = orders.map((order) => order.id)
  if (!ids.length) return { tailorProfileId, orders, messages: [] }
  const messageResult = await supabase
    .from('messages')
    .select(
      'id, order_id, sender_id, sender_name, type, body, photo_url, voice_url, read_at, created_at, is_deleted, edited_at, reply_to_id'
    )
    .in('order_id', ids)
    .order('created_at', { ascending: false })
    .limit(1000)
  if (messageResult.error)
    throw new Error('Messages could not load. Your records have not changed.')
  return { tailorProfileId, orders, messages: ((messageResult.data ?? []) as Message[]).reverse() }
}

function Media({ message }: { message: Message }) {
  const [source, setSource] = useState<string | null>(null)
  const path = message.photo_url || message.voice_url
  useEffect(() => {
    if (!path) return
    if (/^https?:\/\//iu.test(path)) {
      queueMicrotask(() => setSource(path))
      return
    }
    let active = true
    void createClient()
      .storage.from('message-media')
      .createSignedUrl(path.replace(/^message-media\//u, ''), 3600)
      .then(({ data }) => {
        if (active) setSource(data?.signedUrl ?? null)
      })
    return () => {
      active = false
    }
  }, [path])
  if (!path) return null
  if (!source)
    return (
      <div
        className="mt-2 h-20 animate-pulse rounded-[8px] bg-ink/8"
        aria-label="Loading protected media"
      />
    )
  if (message.voice_url)
    return <audio className="mt-2 h-10 w-full max-w-xs" controls preload="metadata" src={source} />
  return (
    <a href={source} target="_blank" rel="noreferrer" className="mt-2 block w-fit">
      <Image
        src={source}
        alt="Order conversation attachment"
        width={720}
        height={480}
        unoptimized
        className="max-h-72 max-w-full rounded-[8px] object-contain"
      />
    </a>
  )
}

function Composer({ order, onSaved }: { order: Order; onSaved: () => void }) {
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; copy: string } | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const disabled = terminalStages.has(order.stage ?? '')
  async function send() {
    const text = body.trim()
    setNotice(null)
    if (!text && !file) {
      setNotice({ tone: 'error', copy: 'Write a message or attach an image first.' })
      return
    }
    const contact = filterContactInfo(text)
    if (contact.blocked) {
      setNotice({ tone: 'error', copy: contact.userMessage })
      return
    }
    if (
      file &&
      (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 10 * 1024 * 1024)
    ) {
      setNotice({ tone: 'error', copy: 'Choose a JPEG, PNG, or WebP image under 10 MB.' })
      return
    }
    setBusy(true)
    try {
      if (file) {
        const extension =
          file.name
            .split('.')
            .pop()
            ?.toLowerCase()
            .replace(/[^a-z0-9]/gu, '') || 'jpg'
        const path = `messages/${order.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`
        const uploaded = await createClient()
          .storage.from('message-media')
          .upload(path, file, {
            contentType: file.type,
            cacheControl: MEDIA_CACHE_CONTROL_SECONDS.private,
            upsert: false,
          })
        if (uploaded.error) throw new Error('The image could not upload. Try a smaller file.')
        await invoke('message-action', {
          action: 'send-message',
          orderId: order.id,
          type: 'PHOTO',
          photoUrl: path,
        })
      }
      if (text)
        await invoke('message-action', {
          action: 'send-message',
          orderId: order.id,
          type: 'TEXT',
          body: text,
        })
      setBody('')
      setFile(null)
      if (input.current) input.current.value = ''
      setNotice({
        tone: 'success',
        copy: file && text ? 'Image and message sent.' : file ? 'Image sent.' : 'Message sent.',
      })
      onSaved()
    } catch (error) {
      setNotice({
        tone: 'error',
        copy: error instanceof Error ? error.message : 'Message could not send.',
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="border-t border-ui-border bg-white px-3 py-3 sm:px-5">
      {disabled ? (
        <p className="rounded-[8px] bg-ink/5 px-3 py-2 text-xs text-ink/58">
          This conversation is read-only because the order is closed.
        </p>
      ) : (
        <>
          {notice ? (
            <p
              role={notice.tone === 'error' ? 'alert' : 'status'}
              className={`mb-2 rounded-[8px] px-3 py-2 text-xs font-semibold ${notice.tone === 'error' ? 'bg-rust/10 text-rust' : 'bg-needle/8 text-needle'}`}
            >
              {notice.copy}
            </p>
          ) : null}
          {file ? (
            <div className="mb-2 flex items-center justify-between rounded-[8px] bg-ink/5 px-3 py-2 text-xs">
              <span className="truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="font-semibold text-rust"
              >
                Remove
              </button>
            </div>
          ) : null}
          <div className="flex items-end gap-2 rounded-[12px] border border-ui-border bg-ui-muted/35 p-2 focus-within:border-needle focus-within:ring-2 focus-within:ring-needle/10">
            <label className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-[8px] text-needle transition hover:bg-white" title="Attach image">
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <ImagePlus className="size-5" /><span className="sr-only">Attach image</span>
            </label>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} rows={1} maxLength={2000} placeholder="Message about this order" aria-label="Message" className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-sm outline-none" />
            <button type="button" disabled={busy || (!body.trim() && !file)} onClick={() => void send()} className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-needle text-white transition hover:bg-needle/90 disabled:cursor-not-allowed disabled:opacity-35" aria-label={busy ? 'Sending message' : 'Send message'}>{busy ? <span className="size-4 animate-spin rounded-full border-2 border-white/35 border-t-white" /> : <Send className="size-4" />}</button>
          </div>
        </>
      )}
    </div>
  )
}

function MessagesContent({
  userId,
  data,
  refresh,
}: {
  userId: string
  data: Data
  refresh: () => void
}) {
  const params = useSearchParams()
  const requested = params.get('orderId')
  const [selectedId, setSelectedId] = useState<string | null>(() => requested)
  const [filter, setFilter] = useState<'active' | 'completed'>('active')
  const [query, setQuery] = useState('')
  const messageEndRef = useRef<HTMLDivElement | null>(null)
  const messagesByOrder = useMemo(() => {
    const result = new Map<string, Message[]>()
    for (const message of data.messages)
      result.set(message.order_id, [...(result.get(message.order_id) ?? []), message])
    return result
  }, [data.messages])
  const visibleOrders = data.orders
    .filter((order) => (filter === 'active') !== terminalStages.has(order.stage ?? ''))
    .filter(
      (order) =>
        !query.trim() ||
        `${title(order)} ${party(order, userId)} ${order.reference ?? ''}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
    )
  const selected = data.orders.find((order) => order.id === selectedId) ?? null
  const selectedMessages = useMemo(
    () => selected ? (messagesByOrder.get(selected.id) ?? []) : [],
    [messagesByOrder, selected]
  )
  useEffect(() => {
    if (selectedId || typeof window === 'undefined' || !window.matchMedia('(min-width: 768px)').matches) return
    const firstVisible = visibleOrders[0]
    if (firstVisible) queueMicrotask(() => setSelectedId(firstVisible.id))
  }, [selectedId, visibleOrders])
  useEffect(() => {
    if (!selectedId) return
    const url = new URL(window.location.href)
    url.searchParams.set('orderId', selectedId)
    window.history.replaceState(window.history.state, '', url)
  }, [selectedId])
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'end' })
  }, [selectedId, selectedMessages.length])
  useEffect(() => {
    if (!selected || !selectedMessages.length) return
    const unread = selectedMessages
      .filter((message) => message.sender_id !== userId && !message.read_at)
      .map((message) => message.id)
    if (!unread.length) return
    void createClient()
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .in('id', unread)
      .then(() => refresh())
  }, [refresh, selected, selectedMessages, userId])
  return (
    <div
      data-route-content-ready="true"
      className="grid h-[calc(100dvh-2rem)] min-h-[38rem] overflow-hidden rounded-[12px] border border-ui-border bg-white shadow-sm md:grid-cols-[21rem_minmax(0,1fr)]"
    >
      <aside
        className={`${selected ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-r border-ui-border`}
      >
        <div className="border-b border-ui-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
                Messages
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-ink">Conversations</h1>
            </div>
            <Link href="/account/orders" className="text-xs font-semibold text-needle">
              Orders
            </Link>
          </div>
          <label className="mt-3 flex h-10 items-center gap-2 rounded-[8px] border border-ui-border bg-ui-muted/35 px-3 focus-within:border-needle"><Search className="size-4 text-ink/40" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
          <div className="mt-2 flex gap-1 rounded-[8px] bg-ink/4 p-1">
            {(['active', 'completed'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`flex-1 rounded-[6px] px-2 py-1.5 text-xs font-semibold ${filter === value ? 'bg-white text-ink shadow-sm' : 'text-ink/55'}`}
              >
                {value === 'active' ? 'Active' : 'Completed'}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto">
          {visibleOrders.length ? (
            visibleOrders.map((order) => {
              const messages = messagesByOrder.get(order.id) ?? []
              const latest = messages.at(-1) ?? null
              const unread = messages.filter(
                (message) => message.sender_id !== userId && !message.read_at
              ).length
              const contact = partyProfile(order, userId)
              const contactName = party(order, userId)
              return (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => setSelectedId(order.id)}
                  className={`w-full border-b border-ui-border p-3 text-left transition hover:bg-ink/3 ${selectedId === order.id ? 'bg-needle/[0.08]' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-needle/10 text-sm font-bold text-needle">{contact?.avatar_url ? <Image src={contact.avatar_url} alt="" width={44} height={44} unoptimized className="size-full object-cover" /> : contactName.slice(0, 1).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">
                        {contactName}
                      </p>
                      <p className="truncate text-xs text-ink/48">{title(order)}</p>
                    </div>
                    {unread ? (
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-needle text-[0.65rem] font-bold text-white">
                        {unread}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 pl-14"><p className="min-w-0 truncate text-xs text-ink/52">{preview(latest)}</p><p className="shrink-0 text-[0.68rem] text-ink/38">{formatRelative(latest?.created_at ?? order.updated_at)}</p></div>
                </button>
              )
            })
          ) : (
            <div className="p-5">
              <p className="text-sm font-semibold text-ink">No {filter} conversations.</p>
              <Link
                href="/account/explore"
                className="mt-3 inline-flex text-xs font-semibold text-needle"
              >
                Explore tailors
              </Link>
            </div>
          )}
        </div>
      </aside>
      <section className={`${selected ? 'flex' : 'hidden md:flex'} min-h-0 flex-col`}>
        {selected ? (
          <>
            <header className="flex items-center gap-3 border-b border-ui-border px-4 py-3">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="grid size-9 place-items-center rounded-[8px] border border-ui-border md:hidden"
              >
                <ArrowLeft className="size-4" /><span className="sr-only">Back to conversations</span>
              </button>
              <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-needle/10 font-bold text-needle">{partyProfile(selected, userId)?.avatar_url ? <Image src={partyProfile(selected, userId)!.avatar_url!} alt="" width={40} height={40} unoptimized className="size-full object-cover" /> : party(selected, userId).slice(0, 1).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold text-ink">{party(selected, userId)}</h2>
                <p className="truncate text-xs text-ink/48">
                  {title(selected)} · {formatDatabaseEnumLabel(selected.stage, 'Order')}
                </p>
              </div>
              <StatusChip status={selected.stage} fallback="Order" />
              {selected.video_call_url ? (
                <Link
                  href={`/account/call-join?orderId=${encodeURIComponent(selected.id)}`}
                  className="grid size-9 place-items-center rounded-[8px] bg-needle text-white"
                >
                  <Video className="size-4" /><span className="sr-only">Join video call</span>
                </Link>
              ) : null}
              <Link
                href={`/account/orders/${selected.id}`}
                className="grid size-9 place-items-center rounded-[8px] border border-ui-border"
              >
                <ClipboardList className="size-4" /><span className="sr-only">Open order</span>
              </Link>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f7f5f0_0%,#f2eee6_100%)] p-4 sm:p-6" aria-live="polite">
              {selectedMessages.length ? (
                <div className="mx-auto grid max-w-[46rem] gap-2.5">
                  {selectedMessages.map((message) => {
                    const mine = message.sender_id === userId
                    return (
                      <article
                        key={message.id}
                        className={`max-w-[82%] rounded-[14px] px-3.5 py-2.5 shadow-sm ${mine ? 'justify-self-end rounded-br-[4px] bg-needle text-white' : 'justify-self-start rounded-bl-[4px] border border-ui-border bg-white text-ink'}`}
                      >
                        <p
                          className={`text-[0.65rem] font-semibold ${mine ? 'text-white/65' : 'text-ink/42'}`}
                        >
                          {mine ? 'You' : message.sender_name || party(selected, userId)} ·{' '}
                          {formatRelative(message.created_at)}
                        </p>
                        {message.is_deleted ? (
                          <p className="mt-1 text-sm italic opacity-65">Message removed</p>
                        ) : (
                          <>
                            <Media message={message} />
                            {message.body ? (
                              <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                                {message.body}
                              </p>
                            ) : null}
                            {message.edited_at ? (
                              <p className="mt-1 text-[0.65rem] opacity-55">Edited</p>
                            ) : null}
                          </>
                        )}
                      </article>
                    )
                  })}
                  <div ref={messageEndRef} aria-hidden="true" />
                </div>
              ) : (
                <div className="grid h-full place-items-center">
                  <div className="text-center">
                    <MessageCircle className="mx-auto size-8 text-needle/45" /><h3 className="mt-3 font-semibold text-ink">Start this order conversation.</h3>
                    <p className="mt-1 text-sm text-ink/52">
                      Messages and attachments stay with the order.
                    </p>
                  </div>
                </div>
              )}
            </div>
            <Composer order={selected} onSaved={refresh} />
          </>
        ) : (
          <div className="grid h-full place-items-center text-center">
            <div>
              <h2 className="text-xl font-semibold text-ink">Choose a conversation.</h2>
              <p className="mt-2 text-sm text-ink/52">
                Open an order thread to review its complete context.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function MessagesRoute({ userId }: { userId: string }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    let active = true
    void load(userId)
      .then((data) => {
        if (active) setState({ status: 'ready', data })
      })
      .catch((error) => {
        if (active)
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Messages could not load.',
          })
      })
    return () => {
      active = false
    }
  }, [revision, userId])
  useEffect(() => {
    if (state.status !== 'ready') return
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const queue = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(refresh, 150)
    }
    const ids = state.data.orders.map((order) => order.id)
    if (!ids.length) return
    const channel = supabase
      .channel(`web-messages:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `order_id=in.(${ids.join(',')})`,
        },
        queue
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `customer_id=eq.${userId}` },
        queue
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `tailor_id=eq.${userId}` },
        queue
      )
    if (state.data.tailorProfileId) {
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `tailor_profile_id=eq.${state.data.tailorProfileId}`,
        },
        queue
      )
    }
    channel.subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [refresh, state, userId])
  if (state.status === 'loading')
    return (
      <section className="app-surface p-7" aria-busy="true">
        <p className="text-sm font-semibold text-ink/60">Loading protected conversations…</p>
      </section>
    )
  if (state.status === 'error')
    return (
      <section className="app-surface p-7" role="alert">
        <h1 className="text-2xl font-semibold text-ink">Messages unavailable</h1>
        <p className="mt-2 text-sm text-ink/60">{state.message}</p>
        <Button className="mt-5" onClick={refresh}>
          Try again
        </Button>
      </section>
    )
  return <MessagesContent userId={userId} data={state.data} refresh={refresh} />
}

export function MessagesWorkspace() {
  return (
    <AccountRouteRuntime surface="messages">
      {({ session }) => <MessagesRoute userId={session.user.id} />}
    </AccountRouteRuntime>
  )
}
