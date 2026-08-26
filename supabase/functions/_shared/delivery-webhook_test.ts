import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { deliveryWebhookLogistics, identifyDeliveryWebhook } from './delivery-webhook.ts'

Deno.test('delivery webhook logistics normalizes provider ETA, location, and tracking context', () => {
  assertEquals(
    deliveryWebhookLogistics({
      data: {
        tracking_url: 'https://tracking.example/parcel-1',
        estimated_delivery: '2026-08-23T17:30:00-05:00',
        timezone: 'America/Chicago',
        current_location: {
          label: 'Airport Residential Area, Accra',
          lat: '5.6061',
          lng: -0.1818,
        },
      },
    }),
    {
      trackingUrl: 'https://tracking.example/parcel-1',
      etaAt: '2026-08-23T22:30:00.000Z',
      etaTimezone: 'America/Chicago',
      location: {
        label: 'Airport Residential Area, Accra',
        latitude: 5.6061,
        longitude: -0.1818,
      },
    },
  )
})

Deno.test('delivery webhook logistics accepts a plain-text provider location', () => {
  assertEquals(
    deliveryWebhookLogistics({ location: 'Osu, Accra' }),
    {
      trackingUrl: null,
      etaAt: null,
      etaTimezone: null,
      location: { label: 'Osu, Accra' },
    },
  )
})

Deno.test('delivery webhook identity is stable when the provider omits an event id', async () => {
  const payload = {
    event: 'shipment.in_transit',
    updated_at: '2026-08-22T17:00:00Z',
    data: { tracking_number: 'DRAPE-TRACK-1' },
  }
  const rawPayload = JSON.stringify(payload)
  const first = await identifyDeliveryWebhook({ provider: 'TOPSHIP', payload, rawPayload })
  const second = await identifyDeliveryWebhook({ provider: 'TOPSHIP', payload, rawPayload })

  assertEquals(first, second)
  assertEquals(first.providerEventId, 'DRAPE-TRACK-1:shipment.in_transit:2026-08-22T17:00:00Z')
})
