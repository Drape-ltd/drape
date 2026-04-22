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
