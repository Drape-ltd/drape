import { CONTACTS } from '@drape/shared'
import Link from 'next/link'
import type { JSX } from 'react'

export function SiteFooter(): JSX.Element {
  return (
    <footer className="mt-20 rounded-[2rem] border border-white/75 bg-white/72 px-6 py-10 shadow-[0_22px_70px_rgba(22,28,24,0.08)] backdrop-blur sm:px-8">
      <div className="grid gap-8 lg:grid-cols-[1.4fr_0.8fr_0.8fr]">
        <div>
          <div className="text-4xl font-semibold tracking-[-0.06em] text-needle">drape</div>
          <p className="mt-4 max-w-xl text-sm leading-7 text-ink/68">
            Find the right tailor, place one clear order, and follow it through.
          </p>
          <div className="mt-6 inline-flex rounded-full border border-needle/10 bg-bone px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-needle/75">
            Clear orders and clean handoff
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Explore</p>
          <div className="mt-4 grid gap-3 text-sm text-ink/72">
            <Link href="/how-it-works" className="transition hover:text-ink">
              How it works
            </Link>
            <Link href="/about" className="transition hover:text-ink">
              About
            </Link>
            <Link href="/faq" className="transition hover:text-ink">
              FAQ
            </Link>
            <Link href="/customers" className="transition hover:text-ink">
              Customers
            </Link>
            <Link href="/tailors" className="transition hover:text-ink">
              Tailors
            </Link>
            <Link href="/join" className="transition hover:text-ink">
              Join waitlist
            </Link>
            <Link href="/apply" className="transition hover:text-ink">
              Apply as tailor
            </Link>
            <Link href="/contact" className="transition hover:text-ink">
              Contact
            </Link>
            <Link href="/help" className="transition hover:text-ink">
              Help
            </Link>
            <Link href="/partnerships" className="transition hover:text-ink">
              Partnerships
            </Link>
            <Link href="/press" className="transition hover:text-ink">
              Press
            </Link>
            <Link href="/careers" className="transition hover:text-ink">
              Careers
            </Link>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Contact</p>
          <div className="mt-4 grid gap-3 text-sm text-ink/72">
            <a href={`mailto:${CONTACTS.hello}`} className="break-words transition hover:text-ink">
              {CONTACTS.hello}
            </a>
            <a href={`mailto:${CONTACTS.support}`} className="break-words transition hover:text-ink">
              {CONTACTS.support}
            </a>
            <a href={`mailto:${CONTACTS.tailors}`} className="break-words transition hover:text-ink">
              {CONTACTS.tailors}
            </a>
            <a href={`mailto:${CONTACTS.partnerships}`} className="break-words transition hover:text-ink">
              {CONTACTS.partnerships}
            </a>
            <a href={`mailto:${CONTACTS.press}`} className="break-words transition hover:text-ink">
              {CONTACTS.press}
            </a>
          </div>
        </div>
      </div>
      <div className="mt-10 flex flex-wrap gap-4 border-t border-ink/6 pt-6 text-sm text-ink/60">
        <Link href="/privacy" className="transition hover:text-ink">
          Privacy
        </Link>
        <Link href="/terms" className="transition hover:text-ink">
          Terms
        </Link>
        <Link href="/verify" className="transition hover:text-ink">
          Verify
        </Link>
        <Link href="/payouts" className="transition hover:text-ink">
          Payouts
        </Link>
        <Link href="/security" className="transition hover:text-ink">
          Security
        </Link>
        <Link href="/legal" className="transition hover:text-ink">
          Legal
        </Link>
      </div>
    </footer>
  )
}
