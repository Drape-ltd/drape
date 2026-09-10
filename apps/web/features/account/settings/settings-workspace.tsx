'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Camera, ChevronRight, Laptop, LockKeyhole, ShieldCheck, Smartphone, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  CONTACTS,
  formatRelative,
  normalizePhoneForStorage,
  validatePasswordStrength,
  validatePhoneForProfile,
  type TrustedDeviceSummary,
} from '@drape/shared'
import { validateDisplayName } from '@drape/shared/contact-filter'
import { PHONE_STORAGE_HINT } from '@drape/shared/phone'
import { CommunicationCenter } from '../../../components/communication-center'
import { PhoneNumberField } from '../../../components/ui/phone-number-field'
import { createClient } from '../../../lib/supabase'
import { invalidateAccountData, readAccountData } from '../../../lib/account-data-cache'
import { publishWebAccountIdentityUpdate } from '../../../lib/web-account-cache-events'
import { deviceTrustRequest } from '../../../lib/device-trust-client'
import { AccountRouteRuntime, type AccountRouteIdentity } from '../account-route-runtime'

type Profile = {
  display_name: string | null
  business_name?: string | null
  avatar_url: string | null
  currency?: string | null
}
type Loaded = {
  customer: Profile | null
  tailor: Profile | null
  currency: string
  orderCurrencies: string[]
}
type Deletion = { id: string; status: string; createdAt: string; activeOrderCount: number }
type DataAccessRequest = { id: string | null; status: string; createdAt: string }
type Notice = { tone: 'error' | 'success'; text: string } | null
const currencies = ['USD', 'GBP', 'NGN', 'CAD', 'EUR', 'GHS', 'KES']

async function responseMessage(error: unknown) {
  try {
    const response = (error as { context?: Response }).context
    const payload = response
      ? ((await response.clone().json()) as { message?: string; error?: string })
      : null
    return payload?.message || payload?.error || null
  } catch {
    return null
  }
}
async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke(name, { body })
  if (error)
    throw new Error((await responseMessage(error)) || 'That action could not finish. Try again.')
  const payload = (data ?? {}) as Record<string, unknown>
  if (payload.error) throw new Error(String(payload.message || payload.error))
  return payload as T
}
async function reauth(
  password: string,
  purpose: 'PHONE_CHANGE' | 'PASSWORD_CHANGE' | 'EMAIL_CHANGE' | 'ACCOUNT_DELETION'
) {
  const result = await invoke<{ proof?: string }>('reauth-proof-action', {
    action: 'issue-proof',
    password,
    purpose,
  })
  if (!result.proof) throw new Error('Could not confirm your current password.')
  return result.proof
}
async function load(userId: string, role: AccountRouteIdentity['role']): Promise<Loaded> {
  const supabase = createClient()
  const [customer, tailor, userRow] = await Promise.all([
    supabase
      .from('customer_profiles')
      .select('display_name, avatar_url')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('tailor_profiles')
      .select('display_name, business_name, avatar_url, currency')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('users').select('default_currency').eq('id', userId).maybeSingle(),
  ])
  const profile = role === 'TAILOR' ? tailor.data : customer.data
  if (!profile) throw new Error('Your profile settings could not load.')
  const profileId =
    role === 'TAILOR'
      ? (await supabase.from('tailor_profiles').select('id').eq('user_id', userId).maybeSingle())
          .data?.id
      : null
  const orderFilter = profileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${profileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`
  const orderResult = await supabase
    .from('orders')
    .select('currency')
    .or(orderFilter)
    .not('currency', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(3)
  return {
    customer: customer.data as Profile | null,
    tailor: tailor.data as Profile | null,
    currency: String(
      userRow.data?.default_currency || (tailor.data as Profile | null)?.currency || 'USD'
    ),
    orderCurrencies: [
      ...new Set((orderResult.data || []).map((row) => String(row.currency)).filter(Boolean)),
    ],
  }
}
function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <section className="app-surface overflow-hidden">
      <header className="flex items-center gap-3 border-b border-ui-border px-5 py-4">
        <span className="grid size-8 place-items-center rounded-[8px] bg-needle/8 text-needle">
          {icon}
        </span>
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
      </header>
      <div className="divide-y divide-ui-border">{children}</div>
    </section>
  )
}
function Row({
  label,
  detail,
  children,
}: {
  label: string
  detail?: string
  children?: ReactNode
}) {
  return (
    <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(12rem,0.55fr)_minmax(0,1fr)] md:items-start">
      <div>
        <h3 className="text-sm font-semibold text-ink">{label}</h3>
        {detail ? <p className="mt-1 text-xs leading-5 text-ink/52">{detail}</p> : null}
      </div>
      {children ? (
        <div className="min-w-0 md:justify-self-end md:text-right">{children}</div>
      ) : null}
    </div>
  )
}
function Alert({ notice }: { notice: Notice }) {
  return notice ? (
    <p
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className={`rounded-[8px] border p-3 text-sm ${notice.tone === 'error' ? 'border-rust/20 bg-rust/8 text-rust' : 'border-needle/20 bg-needle/8 text-needle'}`}
    >
      {notice.text}
    </p>
  ) : null
}
const input =
  'h-10 w-full rounded-[8px] border border-ui-border bg-white px-3 text-sm outline-none focus:border-needle focus:ring-2 focus:ring-needle/15'
const primary =
  'h-9 rounded-[8px] bg-drape-green px-3 text-sm font-semibold text-white disabled:opacity-45'
const secondary =
  'h-9 rounded-[8px] border border-ui-border bg-white px-3 text-sm font-semibold text-ink hover:border-needle/40 disabled:opacity-45'

function Basics({
  session,
  identity,
  loaded,
  refresh,
}: {
  session: Session
  identity: AccountRouteIdentity
  loaded: Loaded
  refresh: () => void
}) {
  const profile = identity.role === 'TAILOR' ? loaded.tailor : loaded.customer
  const [name, setName] = useState(
    profile?.business_name || profile?.display_name || identity.displayName
  )
  const [currency, setCurrency] = useState(loaded.currency)
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const avatarPreviewUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file])
  const [savedAvatarUrl, setSavedAvatarUrl] = useState(profile?.avatar_url ?? null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!avatarPreviewUrl) return
    return () => URL.revokeObjectURL(avatarPreviewUrl)
  }, [avatarPreviewUrl])
  async function saveName() {
    const error = validateDisplayName(name)
    if (error) {
      setNotice({ tone: 'error', text: error })
      return
    }
    setBusy('name')
    try {
      await invoke('account-profile-action', {
        action: 'update-display-name',
        role: identity.role,
        displayName: name.trim(),
      })
      setNotice({ tone: 'success', text: 'Display name updated.' })
      refresh()
    } catch (cause) {
      setNotice({
        tone: 'error',
        text: cause instanceof Error ? cause.message : 'Name could not save.',
      })
    } finally {
      setBusy(null)
    }
  }
  async function saveCurrency() {
    setBusy('currency')
    try {
      await invoke('account-profile-action', {
        action: 'update-currency',
        role: identity.role,
        currency,
      })
      setNotice({ tone: 'success', text: 'Currency preference updated.' })
      refresh()
    } catch (cause) {
      setNotice({
        tone: 'error',
        text: cause instanceof Error ? cause.message : 'Currency could not save.',
      })
    } finally {
      setBusy(null)
    }
  }
  async function uploadAvatar() {
    if (!file) return
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setNotice({ tone: 'error', text: 'Choose a JPG, PNG, or WebP image under 10 MB.' })
      return
    }
    setBusy('avatar')
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${session.user.id}/${crypto.randomUUID()}.${ext}`
      const supabase = createClient()
      const result = await supabase.storage
        .from('avatars')
        .upload(path, file, { contentType: file.type, cacheControl: '31536000' })
      if (result.error) throw result.error
      const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
      await invoke('account-profile-action', {
        action: 'update-avatar',
        role: identity.role,
        avatarUrl: url,
      })
      setSavedAvatarUrl(url)
      publishWebAccountIdentityUpdate({ avatarUrl: url })
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setNotice({ tone: 'success', text: 'Profile photo updated.' })
      refresh()
    } catch {
      setNotice({ tone: 'error', text: 'Profile photo could not update.' })
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <div className="px-5 py-4">
        <Alert notice={notice} />
      </div>
      <Row
        label="Profile photo"
        detail="Used in your account and, for approved tailors, your public profile."
      >
        <div className="flex max-w-xl items-center gap-3 text-left md:justify-end">
          <div
            className="shrink-0 overflow-hidden rounded-full border border-ui-border bg-needle/8 shadow-sm"
            style={{ width: '4rem', height: '4rem' }}
          >
            {avatarPreviewUrl ? (
              <img
                src={avatarPreviewUrl}
                alt="Selected profile photo preview"
                className="block object-cover"
                style={{ width: '100%', height: '100%' }}
              />
            ) : savedAvatarUrl ? (
              <Image
                src={savedAvatarUrl}
                alt="Current profile"
                width={80}
                height={80}
                unoptimized
                className="block object-cover"
                style={{ width: '100%', height: '100%' }}
              />
            ) : (
              <span className="grid place-items-center text-needle" style={{ width: '100%', height: '100%' }}><UserRound className="size-7" aria-hidden="true" /></span>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs text-ink/52">{file ? file.name : savedAvatarUrl ? 'Current photo' : 'JPG, PNG, or WebP · maximum 10 MB'}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <label className={`${secondary} inline-flex cursor-pointer items-center gap-2`}>
                <Camera className="size-4" aria-hidden="true" />
                {file ? 'Choose another' : 'Choose photo'}
                <input
                  ref={fileRef}
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    setNotice(null)
                    setFile(event.target.files?.[0] || null)
                  }}
                />
              </label>
              {file ? (
                <>
                  <button
                    type="button"
                    className={`${secondary} inline-flex items-center gap-2`}
                    disabled={busy !== null}
                    onClick={() => {
                      setFile(null)
                      if (fileRef.current) fileRef.current.value = ''
                    }}
                  >
                    <X className="size-4" aria-hidden="true" /> Clear
                  </button>
                  <button
                    type="button"
                    className={primary}
                    disabled={busy !== null}
                    onClick={() => void uploadAvatar()}
                  >
                    {busy === 'avatar' ? 'Uploading…' : 'Save profile photo'}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </Row>
      <Row label="Display name" detail="This is the name other people see inside Drapeon.">
        <div className="flex gap-2">
          <input
            aria-label="Display name"
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className={primary} disabled={busy !== null} onClick={() => void saveName()}>
            {busy === 'name' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Row>
      <Row
        label="Currency"
        detail={`Prices default to this currency. Recent order currencies: ${loaded.orderCurrencies.join(', ') || 'none yet'}.`}
      >
        <div className="flex gap-2">
          <select
            aria-label="Account currency"
            className={input}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {currencies.map((code) => (
              <option key={code}>{code}</option>
            ))}
          </select>
          <button className={primary} disabled={busy !== null} onClick={() => void saveCurrency()}>
            {busy === 'currency' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Row>
    </>
  )
}
function Phone({
  session,
  role,
  displayName,
  refresh,
}: {
  session: Session
  role: AccountRouteIdentity['role']
  displayName: string
  refresh: () => void
}) {
  const saved = normalizePhoneForStorage(String(session.user.user_metadata?.phone || ''))
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState(saved)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  async function save() {
    const normalized = normalizePhoneForStorage(phone)
    const error = validatePhoneForProfile(normalized)
    if (error) {
      setNotice({ tone: 'error', text: error })
      return
    }
    if (!password) {
      setNotice({ tone: 'error', text: 'Enter your current password to confirm this change.' })
      return
    }
    setBusy(true)
    try {
      const proof = await reauth(password, 'PHONE_CHANGE')
      await invoke('account-profile-action', {
        action: 'update-personal-info',
        role,
        displayName,
        phone: normalized,
        reauthProof: proof,
      })
      await createClient().auth.refreshSession()
      setOpen(false)
      setPassword('')
      setNotice({ tone: 'success', text: 'Phone number updated securely.' })
      refresh()
    } catch (cause) {
      setNotice({
        tone: 'error',
        text: cause instanceof Error ? cause.message : 'Phone could not update.',
      })
    } finally {
      setBusy(false)
    }
  }
  if (!open)
    return (
      <div className="grid gap-2 md:justify-items-end">
        <Alert notice={notice} />
        <button className={secondary} onClick={() => setOpen(true)}>
          {saved ? 'Change phone number' : 'Add phone number'}
        </button>
      </div>
    )
  return (
    <div role="group" aria-label="Phone number settings" className="grid max-w-md gap-3 text-left">
      <Alert notice={notice} />
      <PhoneNumberField
        value={phone}
        onValueChange={setPhone}
        hint={PHONE_STORAGE_HINT}
        aria-label="Account phone number"
      />
      <input
        className={input}
        type="password"
        autoComplete="current-password"
        placeholder="Current password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="flex gap-2">
        <button className={primary} disabled={busy} onClick={() => void save()}>
          {busy ? 'Confirming…' : 'Save phone'}
        </button>
        <button
          className={secondary}
          disabled={busy}
          onClick={() => {
            setOpen(false)
            setPhone(saved)
            setPassword('')
            setNotice(null)
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
function Credentials({ session }: { session: Session }) {
  const [mode, setMode] = useState<'password' | 'email' | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  function reset() {
    setMode(null)
    setCurrent('')
    setNext('')
    setConfirm('')
  }
  async function submit() {
    setNotice(null)
    if (!current) {
      setNotice({ tone: 'error', text: 'Enter your current password.' })
      return
    }
    if (mode === 'password') {
      const error = validatePasswordStrength(next, { forbiddenValues: [session.user.email] })
      if (error) {
        setNotice({ tone: 'error', text: error })
        return
      }
      if (next !== confirm) {
        setNotice({ tone: 'error', text: 'Passwords do not match.' })
        return
      }
    } else if (
      !/^\S+@\S+\.\S+$/.test(next) ||
      next.toLowerCase() === session.user.email?.toLowerCase()
    ) {
      setNotice({ tone: 'error', text: 'Enter a different valid email address.' })
      return
    }
    setBusy(true)
    try {
      const purpose = mode === 'password' ? 'PASSWORD_CHANGE' : 'EMAIL_CHANGE'
      const proof = await reauth(current, purpose)
      if (mode === 'password') {
        const result = await invoke<{ emailQueued?: boolean }>('account-security-action', {
          action: 'change-password',
          reauthProof: proof,
          newPassword: next,
        })
        setNotice({
          tone: 'success',
          text: result.emailQueued
            ? 'Password updated. A security receipt was emailed.'
            : 'Password updated.',
        })
      } else {
        await invoke('account-security-action', {
          action: 'start-email-change',
          reauthProof: proof,
          newEmail: next.trim(),
        })
        setNotice({
          tone: 'success',
          text: `Confirmation sent to ${next.trim()} and your current address.`,
        })
      }
      reset()
    } catch (cause) {
      setNotice({
        tone: 'error',
        text: cause instanceof Error ? cause.message : 'Security change could not finish.',
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-3">
      <Alert notice={notice} />
      {mode ? (
        <>
          <input
            aria-label="Current password"
            className={input}
            type="password"
            autoComplete="current-password"
            placeholder="Current password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <input
            aria-label={mode === 'password' ? 'New password' : 'New email address'}
            className={input}
            type={mode === 'password' ? 'password' : 'email'}
            placeholder={mode === 'password' ? 'New password' : 'New email address'}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          {mode === 'password' ? (
            <input
              aria-label="Confirm new password"
              className={input}
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          ) : null}
          <div className="flex gap-2">
            <button className={primary} disabled={busy} onClick={() => void submit()}>
              {busy ? 'Saving…' : 'Confirm change'}
            </button>
            <button className={secondary} disabled={busy} onClick={reset}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2 md:justify-end">
          <button className={secondary} onClick={() => setMode('password')}>
            Change password
          </button>
          <button className={secondary} onClick={() => setMode('email')}>
            Change email
          </button>
        </div>
      )}
    </div>
  )
}
function Sessions({ session }: { session: Session }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  async function end() {
    setBusy(true)
    const { error } = await createClient().auth.signOut({ scope: 'others' })
    setNotice(
      error
        ? { tone: 'error', text: 'Other sessions could not be ended.' }
        : { tone: 'success', text: 'All other sessions ended. This device remains signed in.' }
    )
    setBusy(false)
  }
  return (
    <div className="grid gap-2 md:justify-items-end">
      <p className="text-xs text-ink/50">
        Last sign-in {formatRelative(session.user.last_sign_in_at)}
      </p>
      <Alert notice={notice} />
      <button className={secondary} disabled={busy} onClick={() => void end()}>
        {busy ? 'Signing out…' : 'Sign out other devices'}
      </button>
    </div>
  )
}

function TrustedDevices({ session }: { session: Session }) {
  const [devices, setDevices] = useState<TrustedDeviceSummary[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)

  const loadDevices = useCallback(async () => {
    try {
      const result = await deviceTrustRequest(session, { action: 'list' })
      setDevices(result.devices ?? [])
      setStatus('ready')
    } catch (cause) {
      setStatus('error')
      setNotice({ tone: 'error', text: cause instanceof Error ? cause.message : 'Trusted devices could not load.' })
    }
  }, [session])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDevices()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadDevices])

  async function revoke(device: TrustedDeviceSummary) {
    setBusyId(device.id)
    setNotice(null)
    try {
      await deviceTrustRequest(session, { action: 'revoke', deviceId: device.id })
      setDevices((current) => current.filter((item) => item.id !== device.id))
      setNotice({
        tone: 'success',
        text: device.current
          ? 'This browser is no longer trusted. Your current signed-in session remains active.'
          : 'That device has been revoked.',
      })
    } catch (cause) {
      setNotice({ tone: 'error', text: cause instanceof Error ? cause.message : 'That device could not be revoked.' })
    } finally {
      setBusyId(null)
    }
  }

  async function revokeOthers() {
    const current = devices.find((device) => device.current)
    setBusyId('all')
    setNotice(null)
    try {
      await deviceTrustRequest(session, { action: 'revoke-all', exceptDeviceId: current?.id })
      setDevices((items) => items.filter((device) => device.current))
      setNotice({ tone: 'success', text: 'All other trusted devices were revoked.' })
    } catch (cause) {
      setNotice({ tone: 'error', text: cause instanceof Error ? cause.message : 'Other devices could not be revoked.' })
    } finally {
      setBusyId(null)
    }
  }

  if (status === 'loading') return <p className="text-sm text-ink/52">Checking trusted devices…</p>
  if (status === 'error') {
    return (
      <div className="grid gap-3 md:justify-items-end">
        <Alert notice={notice} />
        <button className={secondary} onClick={() => { setStatus('loading'); void loadDevices() }}>Try again</button>
      </div>
    )
  }

  return (
    <div className="grid min-w-0 gap-3 md:min-w-[22rem]">
      <Alert notice={notice} />
      {devices.length ? (
        <ul className="grid gap-2" aria-label="Trusted devices">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center gap-3 rounded-[8px] border border-ink/8 bg-white px-3 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-needle/8 text-needle">
                {device.platform === 'WEB' ? <Laptop className="size-4" aria-hidden="true" /> : <Smartphone className="size-4" aria-hidden="true" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{device.label}</span>
                <span className="mt-0.5 block text-xs text-ink/50">
                  {device.current ? 'This device · ' : ''}Last used {formatRelative(device.lastUsedAt)}
                </span>
              </span>
              <button
                type="button"
                className="shrink-0 text-xs font-semibold text-rust hover:underline disabled:text-ink/30"
                disabled={busyId !== null}
                onClick={() => void revoke(device)}
              >
                {busyId === device.id ? 'Revoking…' : 'Revoke'}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink/52">No remembered devices yet. Your next password sign-in will require an email code.</p>
      )}
      {devices.some((device) => !device.current) ? (
        <button className={secondary} disabled={busyId !== null} onClick={() => void revokeOthers()}>
          {busyId === 'all' ? 'Revoking…' : 'Revoke all other devices'}
        </button>
      ) : null}
    </div>
  )
}

function DataAccessPanel({ session }: { session: Session }) {
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error'
    request: DataAccessRequest | null
  }>({ status: 'loading', request: null })
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const check = useCallback(async () => {
    setState({ status: 'loading', request: null })
    try {
      const result = await invoke<{ request?: DataAccessRequest | null }>('request-data-access', {
        action: 'STATUS',
        source: 'WEB_APP',
      })
      setState({ status: 'ready', request: result.request || null })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'We could not check your data-request status.'
      setState({ status: 'error', request: null })
      setNotice({ tone: 'error', text: message })
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => { void check() })
  }, [check, session.user.id])

  async function submit() {
    setBusy(true)
    setNotice(null)
    try {
      const result = await invoke<{
        alreadyPending?: boolean
        request?: DataAccessRequest | null
      }>('request-data-access', {
        action: 'SUBMIT',
        source: 'WEB_APP',
        note: note.trim() || undefined,
      })
      setState({ status: 'ready', request: result.request || null })
      setNotice({
        tone: 'success',
        text: result.alreadyPending
          ? 'Your existing data request is still in review.'
          : 'Your data request is now in Drapeon.',
      })
      setNote('')
      setOpen(false)
    } catch (cause) {
      setNotice({
        tone: 'error',
        text: cause instanceof Error ? cause.message : 'Your data request could not be submitted.',
      })
    } finally {
      setBusy(false)
    }
  }

  if (state.status === 'loading') return <p className="text-sm text-ink/52">Checking request status…</p>
  if (state.status === 'error') {
    return (
      <div className="grid gap-2 text-left md:justify-items-end">
        <Alert notice={notice || { tone: 'error', text: 'We could not check your data-request status.' }} />
        <div className="flex flex-wrap gap-2">
          <button className={secondary} onClick={() => void check()}>Try again</button>
          <a className={`${secondary} inline-flex items-center`} href={`mailto:${CONTACTS.privacy}?subject=Data access request`}>
            Email privacy team
          </a>
        </div>
      </div>
    )
  }
  if (state.request) {
    return (
      <div className="grid max-w-xl gap-2 rounded-[8px] border border-needle/20 bg-needle/5 p-3 text-left">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-needle">Request received</p>
        <p className="text-sm font-semibold text-ink">Your data request is in privacy review.</p>
        <p className="text-xs leading-5 text-ink/55">
          Requested {formatRelative(state.request.createdAt)}. We aim to acknowledge requests within 72 hours and respond within 30 days. Identity verification may be required before release.
        </p>
        {state.request.id ? <p className="break-all font-mono text-[11px] text-ink/45">{state.request.id}</p> : null}
        <Alert notice={notice} />
      </div>
    )
  }
  if (!open) {
    return <button className={secondary} onClick={() => setOpen(true)}>Request my data</button>
  }
  return (
    <div className="grid max-w-xl gap-3 text-left">
      <p className="text-xs leading-5 text-ink/55">
        Use this for a broader copy of your account data. You can edit your name, phone, measurements, and preferences directly without a formal request.
      </p>
      <textarea
        aria-label="Data request context"
        className={`${input} min-h-20 py-2`}
        maxLength={300}
        placeholder="Optional: tell the privacy team what you need"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={busy} onClick={() => void submit()}>
          {busy ? 'Submitting…' : 'Submit data request'}
        </button>
        <button className={secondary} disabled={busy} onClick={() => { setOpen(false); setNote(''); setNotice(null) }}>
          Cancel
        </button>
      </div>
      <Alert notice={notice} />
    </div>
  )
}

function RoleSwitcher({
  session,
  identity,
  loaded,
}: {
  session: Session
  identity: AccountRouteIdentity
  loaded: Loaded
}) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const hasTailor = Boolean(loaded.tailor)
  const target = identity.role === 'TAILOR' ? 'CUSTOMER' : 'TAILOR'
  const canSwitch = target === 'CUSTOMER' ? true : hasTailor

  async function switchRole() {
    if (!canSwitch || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const supabase = createClient()
      await invoke('account-profile-action', { action: 'switch-role', role: target })
      const refreshResult = await supabase.auth.refreshSession()
      if (refreshResult.error) throw refreshResult.error
      invalidateAccountData()
      window.location.assign(target === 'TAILOR' ? '/account/work' : '/account/orders')
    } catch {
      setNotice({ tone: 'error', text: 'Drapeon mode could not switch. Try again.' })
      setBusy(false)
    }
  }

  if (!canSwitch) {
    return identity.role === 'CUSTOMER' ? (
      <Link href="/account/profile?setup=1" className="inline-flex items-center gap-1 text-sm font-semibold text-needle">
        Set up a tailor profile <ChevronRight className="size-4" />
      </Link>
    ) : null
  }

  return (
    <div className="grid gap-2 md:justify-items-end">
      <Alert notice={notice} />
      <button className={secondary} disabled={busy} onClick={() => void switchRole()}>
        {busy ? 'Switching…' : target === 'TAILOR' ? 'Switch to tailor mode' : 'Switch to customer mode'}
      </button>
    </div>
  )
}

function DeletionPanel({ session }: { session: Session }) {
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error'
    request: Deletion | null
  }>({ status: 'loading', request: null })
  const [confirm, setConfirm] = useState('')
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const check = useCallback(async () => {
    setState({ status: 'loading', request: null })
    try {
      const result = await invoke<{ request?: Deletion | null }>('request-account-deletion', {
        action: 'STATUS',
      })
      setState({ status: 'ready', request: result.request || null })
    } catch {
      setState({ status: 'error', request: null })
    }
  }, [])
  useEffect(() => {
    queueMicrotask(() => { void check() })
  }, [check, session.user.id])
  async function submit() {
    if (confirm.toLowerCase() !== 'delete' || !password) {
      setNotice({ tone: 'error', text: 'Type “delete” and enter your current password.' })
      return
    }
    setBusy(true)
    try {
      const proof = await reauth(password, 'ACCOUNT_DELETION')
      const result = await invoke<{
        alreadyPending?: boolean
        activeOrderCount?: number
        request?: Deletion | null
      }>('request-account-deletion', {
        action: 'SUBMIT',
        source: 'WEB_APP',
        confirmationText: 'DELETE',
        reauthProof: proof,
        reason: reason.trim() || undefined,
      })
      setState({ status: 'ready', request: result.request || null })
      setNotice({
        tone: 'success',
        text: result.alreadyPending
          ? 'A deletion request is already pending.'
          : result.activeOrderCount
            ? `Request received. ${result.activeOrderCount} active order${result.activeOrderCount === 1 ? '' : 's'} must be resolved first.`
            : 'Deletion request received for privacy review.',
      })
      setConfirm('')
      setPassword('')
      setReason('')
    } catch (cause) {
      setNotice({
        tone: 'error',
        text: cause instanceof Error ? cause.message : `Request failed. Email ${CONTACTS.privacy}.`,
      })
    } finally {
      setBusy(false)
    }
  }
  if (state.status === 'loading')
    return <p className="text-sm text-ink/52">Checking existing request…</p>
  if (state.status === 'error')
    return (
      <div className="grid gap-3">
        <p role="alert" className="text-sm text-rust">
          We could not confirm deletion status, so a duplicate request is blocked.
        </p>
        <button className={secondary} onClick={() => void check()}>
          Try again
        </button>
      </div>
    )
  if (state.request)
    return (
      <div className="grid gap-2 rounded-[8px] border border-rust/20 bg-rust/5 p-4 text-left">
        <p className="text-xs font-semibold uppercase text-rust">Request received</p>
        <p className="font-semibold">Deletion is in review.</p>
        <p className="text-sm text-ink/60">
          Status {state.request.status.replaceAll('_', ' ').toLowerCase()} ·{' '}
          {state.request.activeOrderCount} active orders
        </p>
        <p className="break-all font-mono text-xs text-ink/45">{state.request.id}</p>
        <Alert notice={notice} />
      </div>
    )
  return (
    <div className="grid max-w-2xl gap-3 text-left">
      <p className="text-xs leading-5 text-ink/55">
        Active orders, disputes, payouts, and legal retention must resolve first. This creates a
        durable review request.
      </p>
      <textarea
        aria-label="Deletion reason"
        className={`${input} min-h-20 py-2`}
        placeholder="Optional note"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          aria-label="Deletion confirmation"
          className={input}
          placeholder='Type "delete"'
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <input
          aria-label="Deletion current password"
          className={input}
          type="password"
          autoComplete="current-password"
          placeholder="Current password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Alert notice={notice} />
      <button
        className="h-9 w-fit rounded-[8px] bg-rust px-3 text-sm font-semibold text-white disabled:opacity-45"
        disabled={busy || confirm.toLowerCase() !== 'delete' || !password}
        onClick={() => void submit()}
      >
        {busy ? 'Submitting…' : 'Request deletion'}
      </button>
    </div>
  )
}
function SettingsContent({
  session,
  identity,
}: {
  session: Session
  identity: AccountRouteIdentity
}) {
  const [state, setState] = useState<{
    status: 'loading' | 'error' | 'ready'
    data?: Loaded
    message?: string
  }>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    void readAccountData(`settings:${session.user.id}:${identity.role}`, () => load(session.user.id, identity.role))
      .then((data) => {
        if (active) setState({ status: 'ready', data })
      })
      .catch((error) => {
        if (active)
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Settings could not load.',
          })
      })
    return () => {
      active = false
    }
  }, [identity.role, revision, session.user.id])
  if (state.status === 'loading')
    return (
      <section className="app-surface p-6" aria-busy="true">
        Loading settings…
      </section>
    )
  if (state.status === 'error' || !state.data)
    return (
      <section className="app-surface p-6" role="alert">
        <h2 className="text-xl font-semibold">Settings unavailable</h2>
        <p className="mt-2 text-sm text-ink/60">{state.message}</p>
        <button className={`${primary} mt-4`} onClick={() => { invalidateAccountData(`settings:${session.user.id}:`); setRevision((v) => v + 1) }}>
          Try again
        </button>
      </section>
    )
  const refresh = () => { invalidateAccountData(`settings:${session.user.id}:`); setRevision((v) => v + 1) }
  const savedPhone = normalizePhoneForStorage(String(session.user.user_metadata?.phone || ''))
  return (
    <div className="grid gap-5 pb-10">
      <Section title="Profile and preferences" icon={<UserRound className="size-4" />}>
        <Basics session={session} identity={identity} loaded={state.data} refresh={refresh} />
        <Row
          label={identity.role === 'TAILOR' ? 'Tailor account' : 'Account type'}
          detail={
            identity.role === 'TAILOR'
              ? 'Tailor tools are active. Switch modes when you need to buy as a customer.'
              : state.data.tailor
                ? 'Customer tools are active. Your approved tailor workspace remains available.'
                : 'Customer account active. Tailor access requires review.'
          }
        >
          <RoleSwitcher session={session} identity={identity} loaded={state.data} />
        </Row>
      </Section>
      <Section title="Security" icon={<LockKeyhole className="size-4" />}>
        <Row label="Email and password" detail={session.user.email || 'Email unavailable'}>
          <Credentials session={session} />
        </Row>
        <Row label="Phone number" detail={savedPhone || 'No phone number saved'}>
          <Phone
            session={session}
            role={identity.role}
            displayName={identity.displayName}
            refresh={refresh}
          />
        </Row>
        <Row
          label="Recovery and verification"
          detail="Use guarded recovery when you cannot provide your current password."
        >
          <Link
            href="/account/recovery"
            className="inline-flex items-center gap-1 text-sm font-semibold text-needle"
          >
            Account recovery <ChevronRight className="size-4" />
          </Link>
        </Row>
        <Row
          label="Trusted devices"
          detail="Recognized devices can skip the email code for up to 30 days. Sensitive account and payout changes still require fresh verification."
        >
          <TrustedDevices session={session} />
        </Row>
        <Row label="Active sessions">
          <Sessions session={session} />
        </Row>
      </Section>
      <Section title="Communication" icon={<ShieldCheck className="size-4" />}>
        <div className="p-5">
          <CommunicationCenter session={session} />
        </div>
      </Section>
      <Section title="Privacy and account" icon={<ShieldCheck className="size-4" />}>
        <Row
          label="Privacy choices"
          detail="Request access to your protected measurements, orders, messages, and account data."
        >
          <div className="grid gap-3 md:justify-items-end">
            <Link href="/privacy" className="text-sm font-semibold text-needle">Privacy policy</Link>
            <DataAccessPanel session={session} />
          </div>
        </Row>
        {identity.role === 'TAILOR' ? (
          <Row
            label="Payout destination"
            detail="Payout changes use provider verification and guarded replacement."
          >
            <Link href="/account/payout" className="text-sm font-semibold text-needle">
              Review payout setup
            </Link>
          </Row>
        ) : null}
        <div id="delete-account" className="scroll-mt-24 bg-rust/[0.035] px-5 py-5">
          <h3 className="text-sm font-semibold text-rust">Delete account</h3>
          <div className="mt-3">
            <DeletionPanel session={session} />
          </div>
        </div>
      </Section>
    </div>
  )
}
export function SettingsWorkspace() {
  return (
    <AccountRouteRuntime surface="settings">
      {({ session, identity }) => <SettingsContent session={session} identity={identity} />}
    </AccountRouteRuntime>
  )
}
