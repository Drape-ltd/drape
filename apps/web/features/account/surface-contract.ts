export type AccountSurface =
  | 'explore' | 'orders' | 'order-detail' | 'messages' | 'measurements' | 'brief'
  | 'shop' | 'work' | 'earnings' | 'payout' | 'profile' | 'checkout' | 'saved'
  | 'settings' | 'support' | 'item-detail'

export type AccountSurfaceCopy = { eyebrow: string; title: string; body: string }

const surfaceCopy: Record<AccountSurface, AccountSurfaceCopy> = {
  explore: { eyebrow: 'Explore', title: 'Find the right tailor.', body: 'Browse tailor profiles, portfolio work, pricing, fulfillment, reviews, and ready-made pieces before you start a brief.' },
  orders: { eyebrow: 'Orders', title: 'Track every order from one place.', body: 'Review custom and ready-made work, payment state, fulfillment, production updates, and next steps.' },
  'order-detail': { eyebrow: 'Order detail', title: 'One order, full context.', body: 'Brief, payment, timeline, messages, and handoff context stay together so nobody has to guess what happened.' },
  messages: { eyebrow: 'Messages', title: 'Order conversations stay protected.', body: 'Review and reply inside real order threads. Calls, photos, and notes stay tied to the order.' },
  measurements: { eyebrow: 'Measurements', title: 'Fit records you can trust.', body: 'Named wearer profiles, Drapeon Vision scans, manual profiles, and measurement age all stay visible before ordering.' },
  brief: { eyebrow: 'Custom brief', title: 'Send a protected custom-order request.', body: 'Share the garment, references, fit context, fabric plan, and fulfillment preference. The tailor reviews the brief before quoting.' },
  shop: { eyebrow: 'Marketplace', title: 'Ready-made pieces from Drapeon tailors.', body: 'Browse available garments with price, stock, fit guidance, fulfillment options, and checkout from the item detail.' },
  work: { eyebrow: 'Tailor workspace', title: 'Your business at a glance.', body: 'Active orders, availability, payout readiness, and the next action that needs your attention stay together.' },
  earnings: { eyebrow: 'Earnings', title: 'Know what is pending, blocked, and paid.', body: 'Review payout records and order payment context. Money movement follows provider checks, handoff windows, refunds, and Drapeon controls.' },
  payout: { eyebrow: 'Payout setup', title: 'Keep payout readiness explicit.', body: 'Review payout destination status and use provider-backed setup paths where supported. Manual bank entry remains reviewed before payouts.' },
  profile: { eyebrow: 'Your profile', title: 'Storefront, setup, and trust.', body: 'Manage your live profile, payout readiness, portfolio, and how customers see your business on Drapeon.' },
  checkout: { eyebrow: 'Payment', title: 'Pay only when an order is ready.', body: 'Custom briefs move to payment after a quote. Ready-made pieces can go straight to checkout, while pending or failed attempts remain attached to the order.' },
  saved: { eyebrow: 'Saved', title: 'Wishlists, saved tailors, and pieces.', body: 'Keep saved tailors, ready-made pieces, and planning lists easy to find.' },
  settings: { eyebrow: 'Settings', title: 'Account settings without guesswork.', body: 'Review profile, currency, notifications, login security, privacy, support, and deletion routes.' },
  support: { eyebrow: 'Support', title: 'Get help with the right context.', body: 'Choose the issue type, include the order when possible, and keep payment, fit, delivery, and account questions routed clearly.' },
  'item-detail': { eyebrow: 'Ready-made detail', title: 'Review the piece before checkout.', body: 'Images, size, stock, fit guidance, fulfillment, tailor context, and price stay focused on the purchase.' },
}

const tailorOverrides: Partial<Record<AccountSurface, AccountSurfaceCopy>> = {
  orders: { eyebrow: 'Order pipeline', title: 'Active, completed, and all orders.', body: 'Pending quotes and production orders stay at the top. Search and filter to find any order in your history.' },
  shop: { eyebrow: 'Your shop', title: 'Manage your ready-made catalogue.', body: 'Control item visibility, stock, pricing, sizing, and the media customers see.' },
  messages: { eyebrow: 'Messages', title: 'Order conversations with customers.', body: 'Every thread is tied to an order, keeping calls, media, decisions, and updates in context.' },
  earnings: { eyebrow: 'Earnings', title: 'Pending, blocked, and paid at a glance.', body: 'Payout records stay tied to each order. Money movement follows provider checks and handoff windows.' },
}

export function accountSurfaceCopy(surface: AccountSurface, role: 'CUSTOMER' | 'TAILOR'): AccountSurfaceCopy {
  return (role === 'TAILOR' ? tailorOverrides[surface] : undefined) ?? surfaceCopy[surface]
}
