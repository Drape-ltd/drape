import { inferCountryCode, resolveDrapeManagedFulfillmentFee } from '../src/fulfillment-fees'

describe('inferCountryCode', () => {
  it('detects Canada from common city and country aliases', () => {
    expect(inferCountryCode('Toronto, Ontario, Canada')).toBe('CA')
    expect(inferCountryCode('Vancouver, British Columbia')).toBe('CA')
    expect(inferCountryCode('Montreal, Quebec')).toBe('CA')
  })
})

describe('resolveDrapeManagedFulfillmentFee', () => {
  it('treats Canada domestic delivery as standard domestic, not international', () => {
    const fee = resolveDrapeManagedFulfillmentFee({
      fulfillment: 'DELIVERY',
      orderCurrency: 'USD',
      sellerLocation: 'Toronto, Ontario, Canada',
      destinationAddress: 'Ottawa, Ontario, Canada',
    })

    expect(fee.baseCurrency).toBe('USD')
    expect(fee.baseAmountMajor).toBe(15)
    expect(fee.scope).toBe('DOMESTIC_STANDARD')
    expect(fee.feeMinorUnits).toBe(1500)
  })

  it('converts Canada domestic delivery into CAD when checkout currency is CAD', () => {
    const fee = resolveDrapeManagedFulfillmentFee({
      fulfillment: 'DELIVERY',
      orderCurrency: 'CAD',
      sellerLocation: 'Toronto, Ontario, Canada',
      destinationAddress: 'Ottawa, Ontario, Canada',
    })

    expect(fee.baseCurrency).toBe('USD')
    expect(fee.baseAmountMajor).toBe(15)
    expect(fee.scope).toBe('DOMESTIC_STANDARD')
    expect(fee.feeMinorUnits).toBe(2040)
  })
})
