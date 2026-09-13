function sentenceCase(value: string) {
  return value.length > 0 ? `${value[0]?.toUpperCase()}${value.slice(1).toLowerCase()}` : value
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`)
}

function postgresArrayItem(value: string) {
  return `{"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"}`
}

export function specialtyTagSearchClauses(term: string | null) {
  if (!term) return []

  const normalized = term.replace(/[{}"\\,]/gu, ' ').replace(/\s+/gu, ' ').trim()
  if (!normalized) return []

  const variants = Array.from(new Set([
    normalized,
    normalized.toLowerCase(),
    sentenceCase(normalized),
    titleCase(normalized),
    normalized.toUpperCase(),
  ]))

  return variants.map((variant) => `specialty_tags.cs.${postgresArrayItem(variant)}`)
}
