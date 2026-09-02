'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRef, useState, type ReactNode } from 'react'
import {
  Briefcase,
  ChevronLeft,
  CircleHelp,
  ClipboardList,
  Heart,
  LogOut,
  Menu,
  MessageCircle,
  Ruler,
  Search,
  Settings,
  ShoppingBag,
  UserRound,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react'
import { signOutWebSession } from '../../lib/web-auth-session'
import { Button } from '../../components/ui/button'
import { IconButton } from '../../components/ui/icon-button'
import {
  accountHomeRoute,
  accountNavigation,
  isAccountRouteActive,
  type AccountNavIcon,
} from './navigation-contract'
import { accountSurfaceCopy, type AccountSurface } from './surface-contract'

export type AccountWorkspaceShellProps = {
  role: 'CUSTOMER' | 'TAILOR'
  surface: AccountSurface
  email: string
  displayName: string
  avatarUrl?: string | null
  activeOrders: number
  unreadMessages: number
  checkoutPendingCount: number
  payoutNeedsSetup: boolean
  warning?: string | null
  children: ReactNode
}

const icons: Record<AccountNavIcon, LucideIcon> = {
  briefcase: Briefcase,
  card: ShoppingBag,
  heart: Heart,
  help: CircleHelp,
  logout: LogOut,
  message: MessageCircle,
  orders: ClipboardList,
  profile: UserRound,
  ruler: Ruler,
  search: Search,
  settings: Settings,
  wallet: WalletCards,
}

function NavigationIcon({ name }: { name: AccountNavIcon }) {
  const Icon = icons[name]
  return <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={2} />
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'D'
}

function Identity({ email, displayName, avatarUrl, collapsed, signingOut, onSignOut }: {
  email: string
  displayName: string
  avatarUrl?: string | null
  collapsed: boolean
  signingOut: boolean
  onSignOut: () => void
}) {
  const [pending, setPending] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function requestSignOut() {
    if (signingOut) return
    if (pending) {
      if (timer.current) clearTimeout(timer.current)
      setPending(false)
      onSignOut()
      return
    }
    setPending(true)
    timer.current = setTimeout(() => setPending(false), 3000)
  }

  return (
    <div className={collapsed ? 'border-t border-white/10 pt-4' : 'border-t border-white/10 px-2 pt-4'}>
      <Link href="/account/settings" title="Account settings" className={collapsed ? 'flex justify-center' : 'flex items-center gap-3 rounded-[8px] px-2 py-2 transition-colors hover:bg-white/8'}>
        <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 text-sm font-semibold text-white ring-2 ring-white/14">
          {avatarUrl ? <Image src={avatarUrl} alt="" width={44} height={44} unoptimized className="size-full object-cover" /> : initials(displayName)}
        </div>
        {!collapsed ? <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{displayName}</p>{email ? <p className="mt-0.5 truncate text-xs text-white/56">{email}</p> : null}</div> : null}
      </Link>
      <div className={collapsed ? 'mx-auto mt-2 flex flex-col items-center gap-1' : 'mt-2 grid gap-1'}>
        <button type="button" onClick={requestSignOut} disabled={signingOut} title={signingOut ? 'Signing out' : pending ? 'Tap again to confirm' : 'Sign out'} className={`${collapsed ? 'grid size-11 place-items-center' : 'inline-flex w-full items-center gap-3 px-3'} rounded-[8px] border py-2.5 text-sm font-semibold transition disabled:opacity-40 ${pending ? 'border-rust/40 bg-rust/20 text-rust' : 'border-white/16 bg-white/8 text-white/80 hover:bg-white/14 hover:text-white'}`}>
          <NavigationIcon name="logout" />
          {collapsed ? <span className="sr-only">{pending ? 'Confirm sign out' : 'Sign out'}</span> : <span>{signingOut ? 'Signing out...' : pending ? 'Tap to confirm' : 'Sign out'}</span>}
        </button>
        {pending && !collapsed ? <button type="button" onClick={() => { if (timer.current) clearTimeout(timer.current); setPending(false) }} className="w-full rounded-[8px] py-1 text-xs font-semibold text-white/44 hover:text-white/70">Cancel</button> : null}
      </div>
    </div>
  )
}

export function AccountWorkspaceShell(props: AccountWorkspaceShellProps) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const copy = accountSurfaceCopy(props.surface, props.role)
  const home = accountHomeRoute(props.role)
  const groups = accountNavigation(props.role, { activeOrders: props.activeOrders, unreadMessages: props.unreadMessages, payoutNeedsSetup: props.payoutNeedsSetup })
  const ordersPath = pathname === '/account/orders' || Boolean(pathname?.startsWith('/account/orders/'))

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    setDrawerOpen(false)
    try {
      await signOutWebSession({ reason: 'manual', redirectTo: '/sign-in?signed_out=1', scope: 'local' })
    } catch (error) {
      console.warn('[account-shell] Sign out failed.', error)
      setSigningOut(false)
    }
  }

  function navigation(compact: boolean) {
    return <nav aria-label="Account navigation" className={compact ? 'grid justify-items-center gap-2' : 'grid gap-2'}>{groups.map((group, groupIndex) => <div key={group.title} className={compact ? 'grid w-full justify-items-center gap-2' : 'grid gap-2'}>{groupIndex > 0 ? <hr className={compact ? 'my-1 w-10 border-white/10' : 'my-2 border-white/10'} /> : null}{group.items.map((item) => {
      const active = isAccountRouteActive(pathname, item.href)
      return <Link key={item.href} href={item.href} onClick={() => setDrawerOpen(false)} title={item.label} aria-current={active ? 'page' : undefined} className={`${compact ? 'grid size-11 place-items-center' : 'flex min-h-11 items-center justify-between gap-3 px-3 py-2.5'} relative rounded-[8px] text-sm font-semibold ${active ? 'bg-needle text-white shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}><span className={compact ? 'grid place-items-center' : 'flex min-w-0 items-center gap-3'}><NavigationIcon name={item.icon} />{compact ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}</span>{item.badge ? <span className={compact ? 'absolute right-1 top-1 min-w-4 rounded-full bg-[#ef5b3a] px-1 text-center text-[0.62rem] leading-4' : 'rounded-full bg-white/15 px-2 py-0.5 text-xs'}>{item.badge}</span> : null}</Link>
    })}</div>)}</nav>
  }

  const identity = (compact: boolean) => <Identity email={props.email} displayName={props.displayName} avatarUrl={props.avatarUrl} collapsed={compact} signingOut={signingOut} onSignOut={() => { void signOut() }} />

  return (
    <main className="min-h-screen bg-ui-canvas" data-account-workspace-ready="true">
      <div className="w-full px-4 py-4 sm:px-6 lg:px-0 lg:py-0 lg:pr-6">
        <header className="sticky top-2 z-30 rounded-[8px] border border-white/10 bg-[#171a18]/96 p-3 shadow-lg backdrop-blur lg:hidden"><div className="flex items-center justify-between gap-4"><Link href={home} className="flex items-center gap-3 text-2xl font-semibold text-white"><Image src="/icon-192.png" alt="" width={40} height={40} className="size-10 rounded-[8px]" /><span>Drapeon</span></Link><IconButton onClick={() => setDrawerOpen(true)} variant="ghost" className="border border-white/10 bg-white/10 text-white hover:bg-white/15 hover:text-white" aria-expanded={drawerOpen} aria-controls="account-mobile-drawer" label="Open account menu"><Menu /></IconButton></div></header>

        {drawerOpen ? <div id="account-mobile-drawer" className="fixed inset-0 z-50 bg-ink/45 p-4 backdrop-blur-sm lg:hidden"><div className="flex max-h-full flex-col overflow-y-auto rounded-[8px] border border-white/10 bg-[#171a18] p-4 shadow-2xl"><div className="flex items-center justify-between gap-4"><Link href={home} onClick={() => setDrawerOpen(false)} className="flex items-center gap-3 text-2xl font-semibold text-white"><Image src="/icon-192.png" alt="" width={40} height={40} className="size-10 rounded-[8px]" /><span>Drapeon</span></Link><IconButton onClick={() => setDrawerOpen(false)} variant="ghost" className="border border-white/10 bg-white/10 text-white" label="Close account menu"><X /></IconButton></div><div className="mt-5">{navigation(false)}</div><div className="mt-5">{identity(false)}</div></div></div> : null}

        <div className={collapsed ? 'grid gap-4 lg:min-h-screen lg:grid-cols-[5.5rem_minmax(0,1fr)] lg:gap-6' : 'grid gap-4 lg:min-h-screen lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-6'}>
          <aside className={`${collapsed ? 'p-3' : 'p-4'} sticky top-0 hidden h-screen border-r border-white/10 bg-[#171a18] lg:block`}><div className="flex h-full flex-col"><IconButton onClick={() => setCollapsed((value) => !value)} size="icon-sm" variant="secondary" className="absolute -right-4 top-24 z-10 rounded-full shadow-md" label={collapsed ? 'Expand account menu' : 'Collapse account menu'}><ChevronLeft className={collapsed ? 'rotate-180 transition-transform' : 'transition-transform'} /></IconButton><Link href={home} className={collapsed ? 'flex justify-center' : 'flex items-center gap-3'}><Image src="/icon-192.png" alt="" width={44} height={44} className="size-11 rounded-[8px]" />{collapsed ? <span className="sr-only">Drapeon</span> : <span className="text-2xl font-semibold text-white">Drapeon</span>}</Link><div className={collapsed ? 'mt-8 flex-1 overflow-y-auto' : 'mt-8 flex-1 overflow-y-auto pr-1'}>{navigation(collapsed)}</div><div className="mt-4">{identity(collapsed)}</div></div></aside>

          <div className="min-w-0 lg:py-4">
            {props.surface !== 'messages' ? <section className="py-3 lg:pt-0"><div className="app-surface p-4"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><p className="text-[0.68rem] font-semibold uppercase text-needle/80">{copy.eyebrow}</p><h1 className="mt-1 text-2xl font-semibold leading-tight text-ink sm:text-3xl">{copy.title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-ink/64">{copy.body}</p></div><div className="flex flex-wrap gap-2 md:justify-end">{props.checkoutPendingCount > 0 ? <Button asChild variant="destructive" size="sm"><Link href="/account/checkout">Pay {props.checkoutPendingCount > 1 ? `(${props.checkoutPendingCount})` : ''}</Link></Button> : null}{!ordersPath ? <Button asChild variant="secondary" size="sm"><Link href="/account/orders"><ClipboardList /> Orders</Link></Button> : null}</div></div>{props.warning ? <p className="mt-3 rounded-lg border border-rust/18 bg-rust/8 px-3 py-2 text-xs leading-5 text-rust">{props.warning}</p> : null}</div></section> : null}
            {props.children}
          </div>
        </div>
      </div>
    </main>
  )
}
