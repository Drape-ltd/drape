/**
 * Drapeon Contact Leakage Prevention
 * Blocks phone numbers, social handles, URLs, and off-platform references
 * across all user-generated text inputs.
 */

export interface FilterResult {
  blocked: boolean
  matchedPattern?: string
  userMessage: string
}

const CONTACT_BLOCK_MESSAGE =
  "Contact details can't be shared on Drapeon. This protects your payment, your measurements, and your order history — for both of you. Everything you need to complete this order is right here."

const ABUSE_BLOCK_MESSAGE =
  "That message can't be sent. Keep all communication respectful — our team reviews flagged messages."

// Phone number patterns
const PHONE_PATTERNS: RegExp[] = [
  // International prefix formats
  /(\+\d{1,3}[\s\-.]?\(?\d{1,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4})/i,
  // UK mobile (07xxx)
  /\b0\s*7\s*\d[\s\d]{7,10}\b/i,
  // Spelled out "zero seven", "oh seven", "nought seven"
  /\b(zero|oh|nought|o)\s*(seven|7)\b/i,
  // Dotted or spaced number blocks
  /\b\d{3,5}[\s.\-]\d{3,5}[\s.\-]\d{3,5}\b/,
  // Long unformatted digit sequences (9+ digits) — international numbers without + or separators
  /\b\d{9,}\b/,
]

// Social handle and platform patterns
const SOCIAL_PATTERNS: RegExp[] = [
  // @username
  /@[a-zA-Z0-9_.]{2,}/,
  // Platform names
  /\b(instagram|whatsapp|facebook|messenger|tiktok|snapchat|twitter|telegram|wechat|signal|viber|line|kik)\b/i,
  // Redirect phrases
  /\b(find me on|dm me|message me on|reach me at|same handle|my @ is|look me up|hit me up on|slide into|call me|text me|email me|send me your number|drop me your number)\b/i,
]

// URL and web address patterns
const URL_PATTERNS: RegExp[] = [
  /https?:\/\//i,
  /www\./i,
  /\b\w+\.(com|co|io|ng|co\.uk|net|org|info|biz|app|dev|me)\b/i,
  /\b(linktree|link\.tree|beacons\.ai|bio\.site|allmylinks|taplink)\b/i,
]

const EMAIL_PATTERNS: RegExp[] = [
  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
]

// Threat and abuse patterns
const ABUSE_PATTERNS: RegExp[] = [
  // Explicit threats
  /\b(i('ll| will|'m going to| am going to)) (kill|hurt|harm|beat|attack|destroy|ruin) (you|u|your|ur)\b/i,
  /\b(you('re| are) (dead|finished|done)|watch your back|i know where you live)\b/i,
]

const ALL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  ...PHONE_PATTERNS.map((p) => ({ pattern: p, label: 'phone number' })),
  ...EMAIL_PATTERNS.map((p) => ({ pattern: p, label: 'email address' })),
  ...SOCIAL_PATTERNS.map((p) => ({ pattern: p, label: 'social handle or platform' })),
  ...URL_PATTERNS.map((p) => ({ pattern: p, label: 'URL or web address' })),
  ...ABUSE_PATTERNS.map((p) => ({ pattern: p, label: 'threatening language' })),
]

/**
 * Check text for blocked contact patterns.
 * Returns { blocked: false } if clean, or { blocked: true, ... } if violation found.
 */
export function filterContactInfo(text: string): FilterResult {
  for (const { pattern, label } of ALL_PATTERNS) {
    if (pattern.test(text)) {
      const isAbuse = label === 'threatening language'
      return {
        blocked: true,
        matchedPattern: label,
        userMessage: isAbuse ? ABUSE_BLOCK_MESSAGE : CONTACT_BLOCK_MESSAGE,
      }
    }
  }
  return { blocked: false, userMessage: '' }
}

/**
 * Strip any blocked content from text (for server-side sanitisation).
 * Returns sanitised text and a flag indicating whether content was removed.
 */
export function sanitiseText(text: string): { sanitised: string; hadViolation: boolean } {
  let sanitised = text
  let hadViolation = false

  for (const { pattern } of ALL_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
    if (globalPattern.test(sanitised)) {
      hadViolation = true
      sanitised = sanitised.replace(globalPattern, '[removed]')
    }
  }

  return { sanitised, hadViolation }
}

const PLACEHOLDER_VALUES = new Set([
  'n/a', 'na', 'none', 'nil', 'tbd', 'n.a.', 'null', 'undefined',
  '-', '--', '—', '–', '.', '..', '...', 'ok', 'okay', 'yes', 'no',
  'nothing', 'idk', 'dunno', 'same', 'see above', 'as above',
])

/**
 * Check whether a string is a placeholder / non-answer value.
 * Returns an error string if it is a placeholder, or null if valid.
 */
export function rejectPlaceholder(text: string, fieldName = 'This field'): string | null {
  const normalised = text.trim().toLowerCase()
  if (PLACEHOLDER_VALUES.has(normalised)) {
    return `${fieldName} needs a real answer — not "${text.trim()}".`
  }
  return null
}

/**
 * Style reference link filtering pipeline — 7 steps.
 * Used in the order brief to validate social media / inspiration links.
 * Returns { allowed: true, cleaned: string } or { allowed: false, reason: string }.
 */
const ALLOWED_STYLE_DOMAINS = [
  'instagram.com', 'www.instagram.com',
  'pinterest.com', 'www.pinterest.com', 'pin.it',
  'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com',
  'youtube.com', 'www.youtube.com', 'youtu.be',
  'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com',
]

const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'igshid', 'ref']

export interface StyleRefResult {
  allowed: boolean
  cleaned?: string
  reason?: string
}

export function filterStyleReference(input: string): StyleRefResult {
  // Step 1: Normalize
  const trimmed = input.trim()

  // Step 2: Reject empty
  if (!trimmed) return { allowed: false, reason: 'Please enter a style reference link.' }

  // Step 3 & 4 — max / dedup checks are caller's responsibility

  // Block arbitrary handles — only actual content links are allowed.
  if (trimmed.startsWith('@')) {
    return { allowed: false, reason: 'Only post or video links are accepted here — not profile handles.' }
  }

  // Step 6: Validate URL
  let url: URL
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
  } catch {
    // Not a URL and not a handle — reject
    return { allowed: false, reason: 'Please paste a valid post or video link (e.g. instagram.com/p/…).' }
  }

  const hostname = url.hostname.replace(/^www\./, '')
  const fullHostname = url.hostname
  const isAllowed = ALLOWED_STYLE_DOMAINS.includes(hostname) || ALLOWED_STYLE_DOMAINS.includes(fullHostname)

  if (!isAllowed) {
    return {
      allowed: false,
      reason: 'Only links from Instagram, TikTok, YouTube, Pinterest, and X are accepted as style references.',
    }
  }

  // Block profile DMs, story links, and redirect paths
  const blockedPaths = ['/direct', '/messages', '/accounts/login', '/inbox']
  if (blockedPaths.some((p) => url.pathname.startsWith(p))) {
    return { allowed: false, reason: 'Direct messages or login links aren\'t accepted. Share a post or style page instead.' }
  }

  // Content-link only rules — profile pages and general landing pages are not allowed.
  const path = url.pathname
  const hostnameKey = hostname.toLowerCase()
  const isInstagramContent = /^\/(p|reel)\/[^/]+\/?$/i.test(path)
  const isPinterestContent = /^\/pin\/\d+\/?$/i.test(path) || hostnameKey === 'pin.it'
  const isTikTokContent =
    /^\/@[^/]+\/video\/\d+\/?$/i.test(path) ||
    hostnameKey === 'vm.tiktok.com'
  const isYouTubeContent =
    (hostnameKey === 'youtu.be' && /^\/[^/]+\/?$/.test(path)) ||
    ((hostnameKey === 'youtube.com' || hostnameKey === 'www.youtube.com') &&
      (/^\/watch$/i.test(path) && !!url.searchParams.get('v') || /^\/shorts\/[^/]+\/?$/i.test(path)))
  const isXContent = /^\/[^/]+\/status\/\d+\/?$/i.test(path)

  if (!(isInstagramContent || isPinterestContent || isTikTokContent || isYouTubeContent || isXContent)) {
    return { allowed: false, reason: 'Only post and video links are accepted here — not profile or landing pages.' }
  }

  // Step 7: Strip tracking params
  for (const param of TRACKING_PARAMS) {
    url.searchParams.delete(param)
  }

  return { allowed: true, cleaned: url.toString() }
}

/**
 * Validate a display name or business name.
 * Returns an error string if invalid, or null if valid.
 */
export function validateDisplayName(name: string): string | null {
  const result = filterContactInfo(name)
  if (result.blocked) {
    return "Your name can't include contact details. Choose a name that describes your work."
  }
  if (name.trim().length < 2) {
    return 'Name must be at least 2 characters.'
  }
  if (name.length > 60) {
    return 'Name must be 60 characters or fewer.'
  }
  return null
}
