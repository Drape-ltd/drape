import { filterContactInfo, filterStyleReference, sanitiseText, validateDisplayName } from '../src/contact-filter'

// ─── filterContactInfo ────────────────────────────────────────────────────────

describe('filterContactInfo — phone numbers', () => {
  const cases: [string, string][] = [
    ['+44 7911 123456', 'international prefix'],
    ['+1-202-555-0173', 'US number with dashes'],
    ['07911 123456', 'UK mobile 07xxx'],
    ['07 9 1 1 1 2 3 4 5 6', 'UK mobile with spaces'],
    ['zero seven 911 123456', 'UK mobile spelled out'],
    ['oh seven 911 123456', 'oh seven variant'],
    ['nought seven 123 4567', 'nought seven variant'],
    ['123 456 789', 'dotted number block'],
    ['123-456-7890', 'dashed number block'],
  ]

  test.each(cases)('blocks "%s" (%s)', (text) => {
    const result = filterContactInfo(text)
    expect(result.blocked).toBe(true)
    expect(result.matchedPattern).toBe('phone number')
  })
})

describe('filterContactInfo — social handles and platforms', () => {
  const cases: [string, string][] = [
    ['@ada_okafor', '@handle'],
    ['my insta is @ada', '@handle in sentence'],
    ['message me on whatsapp', 'whatsapp mention'],
    ['call me after this fitting', 'call me redirect phrase'],
    ['text me when you are outside', 'text me redirect phrase'],
    ['find me on instagram', 'instagram mention'],
    ['dm me', 'redirect phrase'],
    ['same handle on telegram', 'telegram with redirect'],
    ['my @ is tailorjane', 'my @ is phrase'],
    ['slide into my dms', 'slide into phrase'],
  ]

  test.each(cases)('blocks "%s" (%s)', (text) => {
    expect(filterContactInfo(text).blocked).toBe(true)
  })
})

describe('filterContactInfo — URLs and web addresses', () => {
  const cases: [string, string][] = [
    ['https://instagram.com/ada', 'https URL'],
    ['http://mysite.com', 'http URL'],
    ['www.drapeoffplatform.com', 'www prefix'],
    ['myshop.co.uk', '.co.uk domain'],
    ['linktree/adatailors', 'linktree reference'],
    ['ada@example.com', 'email address'],
  ]

  test.each(cases)('blocks "%s" (%s)', (text) => {
    expect(filterContactInfo(text).blocked).toBe(true)
  })
})

describe('filterContactInfo — clean inputs', () => {
  const clean = [
    'I specialise in Nigerian agbada and Yoruba wedding attire.',
    'Please add a 2cm seam allowance on the shoulders.',
    'I would like this delivered by the end of the month.',
    'My measurements are in the brief — feel free to ask questions.',
    'I can do custom embroidery too!',
    'The fabric has a beautiful seven-colour weave.',
    'Size seven shoe, in case it matters for length.',
    "I'm available Monday to Friday.",
  ]

  test.each(clean)('passes "%s"', (text) => {
    expect(filterContactInfo(text).blocked).toBe(false)
  })
})

// ─── sanitiseText ─────────────────────────────────────────────────────────────

describe('sanitiseText', () => {
  it('replaces a phone number with [removed]', () => {
    const { sanitised, hadViolation } = sanitiseText('Call me on 07911 123456 please')
    expect(hadViolation).toBe(true)
    expect(sanitised).toContain('[removed]')
    expect(sanitised).not.toContain('07911')
  })

  it('replaces a URL with [removed]', () => {
    const { sanitised, hadViolation } = sanitiseText('See my portfolio at www.adatailors.com')
    expect(hadViolation).toBe(true)
    expect(sanitised).toContain('[removed]')
  })

  it('leaves clean text unchanged', () => {
    const text = 'Beautiful hand-stitched lace fabric preferred.'
    const { sanitised, hadViolation } = sanitiseText(text)
    expect(hadViolation).toBe(false)
    expect(sanitised).toBe(text)
  })
})

// ─── validateDisplayName ──────────────────────────────────────────────────────

describe('validateDisplayName', () => {
  it('accepts a normal name', () => {
    expect(validateDisplayName('Ada Okafor')).toBeNull()
    expect(validateDisplayName('Bespoke by Tunde')).toBeNull()
  })

  it('rejects names shorter than 2 characters', () => {
    expect(validateDisplayName('A')).not.toBeNull()
    expect(validateDisplayName('')).not.toBeNull()
  })

  it('rejects names longer than 60 characters', () => {
    expect(validateDisplayName('A'.repeat(61))).not.toBeNull()
  })

  it('rejects names containing contact details', () => {
    expect(validateDisplayName('Ada @adatailors')).not.toBeNull()
    expect(validateDisplayName('Tunde WhatsApp Tailors')).not.toBeNull()
  })

  it('accepts names exactly 60 characters', () => {
    expect(validateDisplayName('A'.repeat(60))).toBeNull()
  })
})

describe('filterStyleReference', () => {
  it('rejects arbitrary social handles', () => {
    expect(filterStyleReference('@ada_okafor')).toEqual({
      allowed: false,
      reason: 'Only post or video links are accepted here — not profile handles.',
    })
  })

  it('accepts supported content links', () => {
    const result = filterStyleReference('instagram.com/p/abc123/?utm_source=test')
    expect(result.allowed).toBe(true)
    expect(result.cleaned).toContain('instagram.com/p/abc123/')
    expect(result.cleaned).not.toContain('utm_source')
  })

  it('rejects profile pages even on allowed domains', () => {
    expect(filterStyleReference('https://instagram.com/ada_okafor')).toEqual({
      allowed: false,
      reason: 'Only post and video links are accepted here — not profile or landing pages.',
    })
  })

  it('accepts YouTube, TikTok, Pinterest, and X content links', () => {
    expect(filterStyleReference('https://youtu.be/abc123').allowed).toBe(true)
    expect(filterStyleReference('https://www.tiktok.com/@stylist/video/123456789').allowed).toBe(true)
    expect(filterStyleReference('https://pin.it/abc123').allowed).toBe(true)
    expect(filterStyleReference('https://x.com/designer/status/123456789').allowed).toBe(true)
  })

  it('rejects invalid non-link text', () => {
    expect(filterStyleReference('my favorite tailor page')).toEqual({
      allowed: false,
      reason: 'Please paste a valid post or video link (e.g. instagram.com/p/…).',
    })
  })
})
