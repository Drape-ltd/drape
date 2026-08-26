import { composeStructuredAddress, parseAddressSearchSuggestion } from '../src/address'

describe('structured address search', () => {
  it('maps a provider result into the fields used by fulfillment eligibility', () => {
    expect(parseAddressSearchSuggestion({
      place_id: 42,
      display_name: '14 Kofi Atta Annan Street, Accra, Greater Accra, Ghana',
      address: {
        house_number: '14',
        road: 'Kofi Atta Annan Street',
        city: 'Accra',
        state: 'Greater Accra',
        country: 'Ghana',
        country_code: 'gh',
      },
    })).toMatchObject({
      line1: '14 Kofi Atta Annan Street',
      city: 'Accra',
      stateRegion: 'Greater Accra',
      country: 'Ghana',
      countryCode: 'GH',
    })
  })

  it('keeps manual structured addresses readable', () => {
    expect(composeStructuredAddress({
      line1: '12 Marina Road',
      line2: '',
      city: 'Lagos',
      stateRegion: 'Lagos',
      postcode: '101241',
      country: 'Nigeria',
    })).toBe('12 Marina Road\nLagos, Lagos\n101241\nNigeria')
  })

  it('keeps a searched venue visible when the provider also returns a road', () => {
    expect(parseAddressSearchSuggestion({
      display_name: 'Accra Mall, Spintex Road, Accra, Greater Accra, Ghana',
      address: {
        shop: 'Accra Mall',
        road: 'Spintex Road',
        city: 'Accra',
        state: 'Greater Accra',
        postcode: 'GD-110-6313',
        country: 'Ghana',
        country_code: 'gh',
      },
    })).toMatchObject({
      line1: 'Accra Mall',
      line2: 'Spintex Road',
      city: 'Accra',
      stateRegion: 'Greater Accra',
      countryCode: 'GH',
      displayValue: 'Accra Mall, Spintex Road, Accra, Greater Accra, GD-110-6313, Ghana',
    })
  })
})
