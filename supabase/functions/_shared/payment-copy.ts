type OrderKind = string | null | undefined

export function paymentPendingStageNote(orderKind?: OrderKind) {
  return orderKind === 'READY_MADE'
    ? 'Checkout started. This order will be placed once payment is completed.'
    : 'Payment started. Production can begin once payment is confirmed.'
}

export function paymentConfirmedStageNote(orderKind?: OrderKind) {
  return orderKind === 'READY_MADE'
    ? 'Payment confirmed. This order is now placed.'
    : 'Payment confirmed. This order is now ready for production.'
}

export function tailorPaymentConfirmedNotification(orderKind?: OrderKind) {
  return orderKind === 'READY_MADE'
    ? {
        title: 'Order placed ✅',
        body: 'Payment is confirmed and this ready-made order is ready for fulfillment.',
      }
    : {
        title: 'Payment confirmed ✅',
        body: 'The order is paid and ready for production.',
      }
}

export function fulfillmentPaymentRequestedStageNote(method?: string | null) {
  if (method === 'LOCAL_DELIVERY') {
    return 'Delivery payment requested. The order can move out for delivery once this is paid.'
  }

  return 'Shipping payment requested. The order can be dispatched once this is paid.'
}

export function fulfillmentPaymentConfirmedStageNote(method?: string | null) {
  if (method === 'LOCAL_DELIVERY') {
    return 'Delivery payment confirmed. The seller can now arrange the local handoff.'
  }

  return 'Shipping payment confirmed. The seller can now book and dispatch this order.'
}

export function customerFulfillmentPaymentRequestedNotification(method?: string | null) {
  if (method === 'LOCAL_DELIVERY') {
    return {
      title: 'Delivery payment needed 🚚',
      body: 'Your seller has arranged local delivery details. Pay the delivery fee so dispatch can start.',
    }
  }

  return {
    title: 'Shipping payment needed 📦',
    body: 'Your seller has arranged shipping details. Pay the shipping fee so dispatch can start.',
  }
}

export function tailorFulfillmentPaymentConfirmedNotification(method?: string | null) {
  if (method === 'LOCAL_DELIVERY') {
    return {
      title: 'Delivery payment confirmed ✅',
      body: 'The delivery fee is paid. You can now hand this order to the local delivery partner.',
    }
  }

  return {
    title: 'Shipping payment confirmed ✅',
    body: 'The shipping fee is paid. You can now dispatch this order.',
  }
}
