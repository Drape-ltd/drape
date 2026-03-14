/**
 * Drape Contact Leakage Prevention
 * Blocks phone numbers, social handles, URLs, and off-platform references
 * across all user-generated text inputs.
 */

export interface FilterResult {
  blocked: boolean
  matchedPattern?: string
  userMessage: string
}

const BLOCK_MESSAGE =
  "Contact details can't be shared on Drape. This protects your payment, your measurements, and your order history — for both of you. Everything you need to complete this order is right here."

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
]

// Social handle and platform patterns
const SOCIAL_PATTERNS: RegExp[] = [
  // @username
  /@[a-zA-Z0-9_.]{2,}/,
  // Platform names
  /\b(instagram|whatsapp|tiktok|snapchat|twitter|telegram|wechat|signal|viber|line|kik)\b/i,
  // Redirect phrases
  /\b(find me on|dm me|message me on|reach me at|same handle|my @ is|look me up|hit me up on|slide into)\b/i,
]

// URL and web address patterns
const URL_PATTERNS: RegExp[] = [
  /https?:\/\//i,
  /www\./i,
  /\b\w+\.(com|co|io|ng|co\.uk|net|org|info|biz|app|dev|me)\b/i,
  /\b(linktree|link\.tree|beacons\.ai|bio\.site|allmylinks|taplink)\b/i,
]

const ALL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  ...PHONE_PATTERNS.map((p) => ({ pattern: p, label: 'phone number' })),
  ...SOCIAL_PATTERNS.map((p) => ({ pattern: p, label: 'social handle or platform' })),
  ...URL_PATTERNS.map((p) => ({ pattern: p, label: 'URL or web address' })),
]

/**
 * Check text for blocked contact patterns.
 * Returns { blocked: false } if clean, or { blocked: true, ... } if violation found.
 */
export function filterContactInfo(text: string): FilterResult {
  for (const { pattern, label } of ALL_PATTERNS) {
    if (pattern.test(text)) {
      return {
        blocked: true,
        matchedPattern: label,
        userMessage: BLOCK_MESSAGE,
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
