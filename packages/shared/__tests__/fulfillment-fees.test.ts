import { inferCountryCode, resolveDrapeManagedFulfillmentFee } from '../src/fulfillment-fees'

describe('inferCountryCode', () => {
  it('detects Canada from common city and country aliases', () => {
    expect(inferCountryCode('Toronto, Ontario, Canada')).toBe('CA')
    expect(inferCountryCode('Vancouver, British Columbia')).toBe('CA')
    expect(inferCountryCode('Montreal, Quebec')).toBe('CA')
  })

  it('detects Nigeria from common Lagos district aliases', () => {
    expect(inferCountryCode('Shomolu')).toBe('NG')
    expect(inferCountryCode('Somolu, Lagos')).toBe('NG')
    expect(inferCountryCode('Victoria Island')).toBe('NG')
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

  it('keeps Lagos district delivery on the domestic Nigeria flat fee', () => {
    const fee = resolveDrapeManagedFulfillmentFee({
      fulfillment: 'DELIVERY',
      orderCurrency: 'NGN',
      sellerLocation: 'Shomolu',
      destinationAddress: '12 Allen Avenue, Ikeja, Lagos, Nigeria',
    })

    expect(fee.baseCurrency).toBe('NGN')
    expect(fee.baseAmountMajor).toBe(10_000)
    expect(fee.scope).toBe('DOMESTIC_NIGERIA')
    expect(fee.feeMinorUnits).toBe(1_000_000)
  })
})
