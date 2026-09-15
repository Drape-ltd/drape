export function safeAccountReturnPath(value: string | null | undefined): string | null {
  const isSafePrefix = value?.startsWith('/account/') || value?.startsWith('/referral/') || value?.startsWith('/group-invite/')
  if (!value || !isSafePrefix || value.startsWith('//') || value.includes('\\')) return null

  try {
    const parsed = new URL(value, 'https://drapeon.local')
    if (parsed.origin !== 'https://drapeon.local') return null
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}
