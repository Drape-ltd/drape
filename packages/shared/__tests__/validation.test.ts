import { validateUuid } from '../src/validation'

describe('validateUuid', () => {
  it('accepts database UUIDs', () => {
    expect(validateUuid('3ec3912e-980d-4ba0-acff-81b435bc6ec7')).toBe(true)
  })

  it.each(['admin', '', null, undefined, '3ec3912e-980d-4ba0-acff'])('rejects non-UUID actor values: %p', (value) => {
    expect(validateUuid(value)).toBe(false)
  })
})
