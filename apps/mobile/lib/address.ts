type NominatimSuggestion = {
  display_name?: string
  address?: Record<string, string | undefined>
}

export type StructuredAddressFields = {
  line1: string
  line2: string
  city: string
  stateRegion: string
  postcode: string
  country: string
}

function clean(value: string | undefined | null) {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueParts(parts: Array<string | undefined | null>) {
  const seen = new Set<string>()
  return parts
    .map(clean)
    .filter((part) => {
      if (!part) return false
      const key = part.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function parseNominatimSuggestion(suggestion: NominatimSuggestion): StructuredAddressFields & {
  displayValue: string
} {
  const address = suggestion.address ?? {}
  const houseNumber = clean(address.house_number)
  const road = clean(
    address.road ??
      address.pedestrian ??
      address.footway ??
      address.path ??
      address.residential ??
      address.street ??
      address.industrial ??
      address.estate ??
      address.block
  )
  const building = clean(
    address.building ??
      address.house ??
      address.amenity ??
      address.shop ??
      address.office ??
      address.tourism
  )
  const landmark = clean(
    address.neighbourhood ??
      address.suburb ??
      address.city_district ??
      address.quarter ??
      address.hamlet
  )
  const locality = clean(
    address.city ??
      address.town ??
      address.village ??
      address.municipality ??
      address.county ??
      address.district ??
      address.region ??
      address.state_district
  )
  const region = clean(address.state ?? address.region ?? address.province ?? address.state_district ?? address.county)
  const postcode = clean(address.postcode)
  const country = clean(address.country)

  const line1 =
    uniqueParts([houseNumber ? `${houseNumber} ${road}` : road, building])[0] ||
    clean(suggestion.display_name?.split(',')[0]) ||
    building ||
    landmark

  const line2 = uniqueParts([building && building !== line1 ? building : '', landmark]).join(', ')
  const city = locality || landmark || region
  const stateRegion = region || locality
  const displayValue = uniqueParts([line1, line2, city, stateRegion, postcode, country]).join(', ')

  return {
    line1,
    line2,
    city,
    stateRegion,
    postcode,
    country,
    displayValue,
  }
}

export function composeStructuredAddress(fields: StructuredAddressFields) {
  return uniqueParts([
    fields.line1,
    fields.line2,
    [fields.city, fields.stateRegion].map(clean).filter(Boolean).join(', '),
    fields.postcode,
    fields.country,
  ]).join('\n')
}
