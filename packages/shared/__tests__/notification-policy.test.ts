import {
  notificationDestinationData,
  resolveNotificationDeliveryPolicy,
} from '../src/notification-policy'

describe('notification delivery policy', () => {
  it('keeps informational events in the shared in-app timeline', () => {
    expect(resolveNotificationDeliveryPolicy({
      importance: 'INFORMATIONAL',
      destination: { kind: 'ORDER', orderId: ' order-1 ' },
    })).toEqual({
      importance: 'INFORMATIONAL',
      channels: ['IN_APP'],
      smsFallback: false,
      destination: { kind: 'ORDER', orderId: 'order-1' },
    })
  })

  it('gives every decision event in-app, push, and email coverage', () => {
    expect(resolveNotificationDeliveryPolicy({
      importance: 'ACTION_REQUIRED',
      destination: { kind: 'MESSAGE_THREAD', conversationId: 'conversation-1' },
      allowSmsFallback: true,
    })).toMatchObject({
      channels: ['IN_APP', 'PUSH', 'EMAIL'],
      smsFallback: false,
    })
  })

  it('allows SMS only as an explicit time-sensitive fallback', () => {
    expect(resolveNotificationDeliveryPolicy({
      importance: 'TIME_SENSITIVE',
      destination: { kind: 'PAYOUT', payoutId: 'payout-1' },
      allowSmsFallback: true,
    })).toMatchObject({
      channels: ['IN_APP', 'PUSH', 'EMAIL'],
      smsFallback: true,
    })
  })

  it('serializes exact context for platform navigation', () => {
    expect(notificationDestinationData({
      kind: 'MESSAGE_THREAD',
      conversationId: 'thread-1',
      orderId: 'order-1',
    })).toEqual({
      destination: 'MESSAGE_THREAD',
      conversationId: 'thread-1',
      orderId: 'order-1',
    })
  })

  it('rejects a context-free order destination', () => {
    expect(() => resolveNotificationDeliveryPolicy({
      importance: 'ACTION_REQUIRED',
      destination: { kind: 'ORDER', orderId: ' ' },
    })).toThrow('orderId is required')
  })
})
