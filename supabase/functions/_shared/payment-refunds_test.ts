import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  partiallyRefundOrderPayments,
  refundSettledOrderPayments,
  type RefundablePaymentAttemptRow,
} from './payment-refunds.ts'

type FakeSupabase = {
  auditRows: unknown[]
  from: (table: string) => any
}

function makeSupabase(attempts: RefundablePaymentAttemptRow[]): FakeSupabase {
  const auditRows: unknown[] = []

  return {
    auditRows,
    from(table: string) {
      if (table === 'order_payments') {
        return {
          select() {
            return {
              eq() {
                return {
                  in() {
                    return {
                      order() {
                        return Promise.resolve({ data: attempts, error: null })
                      },
                    }
                  },
                }
              },
            }
          },
          update(patch: Record<string, unknown>) {
            return {
              eq(_column: string, value: string) {
                const attempt = attempts.find((row) => row.id === value)
                if (!attempt) return Promise.resolve({ error: { message: 'not found' } })
                Object.assign(attempt, patch)
                return Promise.resolve({ error: null })
              },
            }
          },
        }
      }

      if (table === 'audit_logs') {
        return {
          insert(row: unknown) {
            auditRows.push(row)
            return Promise.resolve({ error: null })
          },
        }
      }

      throw new Error(`Unexpected table ${table}`)
    },
  }
}

Deno.test('refundSettledOrderPayments refunds consultation attempts and marks them refunded', async () => {
  const attempts: RefundablePaymentAttemptRow[] = [
    {
      id: 'pay_consult',
      order_id: 'order_1',
      phase: 'CONSULTATION',
      provider: 'PAYSTACK',
      currency: 'NGN',
      amount: 500000,
      status: 'SUCCEEDED',
      provider_payment_id: 'pay_ref_123',
      refunded_amount: 0,
      partial_refund_count: 0,
    },
  ]

  const supabase = makeSupabase(attempts)
  const refundCalls: Array<Record<string, unknown>> = []
  const markCalls: Array<Record<string, unknown>> = []

  const result = await refundSettledOrderPayments(
    supabase,
    {
      orderId: 'order_1',
      reason: 'Customer cancelled order from CONSULTATION',
      actorRole: 'CUSTOMER',
      actorId: 'user_1',
    },
    {
      refundStripePaymentIntent: async () => {
        throw new Error('Stripe should not be called')
      },
      refundPaystackTransaction: async (options) => {
        refundCalls.push(options as unknown as Record<string, unknown>)
        return { id: 1, status: 'processed', transaction: options.reference }
      },
      markPaymentAttemptStatus: async (_supabase, input) => {
        markCalls.push(input as unknown as Record<string, unknown>)
        return null
      },
    },
  )

  assertEquals(refundCalls.length, 1)
  assertEquals(refundCalls[0].reference, 'pay_ref_123')
  assertEquals(markCalls.length, 0)
  assertEquals(result.refundedAttempts.length, 1)
  assertEquals(result.refundedAttempts[0].phase, 'CONSULTATION')
})

Deno.test('refundSettledOrderPayments skips attempts already marked refunded', async () => {
  const attempts: RefundablePaymentAttemptRow[] = [
    {
      id: 'pay_1',
      order_id: 'order_2',
      phase: 'INITIAL_ORDER',
      provider: 'STRIPE',
      currency: 'USD',
      amount: 12000,
      status: 'REFUNDED',
      provider_payment_id: 'pi_refunded',
      refunded_amount: 12000,
      partial_refund_count: 1,
    },
  ]

  const supabase = makeSupabase(attempts)

  const result = await refundSettledOrderPayments(
    supabase,
    {
      orderId: 'order_2',
      actorRole: 'OPS',
    },
    {
      refundStripePaymentIntent: async () => {
        throw new Error('Stripe should not be called')
      },
      refundPaystackTransaction: async () => {
        throw new Error('Paystack should not be called')
      },
      markPaymentAttemptStatus: async () => {
        throw new Error('No status update should occur')
      },
    },
  )

  assertEquals(result.refundedAttempts, [])
  assertEquals(result.alreadyRefundedAttemptIds, ['pay_1'])
})

Deno.test('partiallyRefundOrderPayments applies a partial refund and keeps the attempt partially refunded', async () => {
  const attempts: RefundablePaymentAttemptRow[] = [
    {
      id: 'pay_partial',
      order_id: 'order_3',
      phase: 'INITIAL_ORDER',
      provider: 'STRIPE',
      currency: 'USD',
      amount: 20000,
      status: 'SUCCEEDED',
      provider_payment_id: 'pi_partial_123',
      refunded_amount: 0,
      partial_refund_count: 0,
      provider_response: {},
    },
  ]

  const supabase = makeSupabase(attempts)

  const result = await partiallyRefundOrderPayments(
    supabase,
    {
      orderId: 'order_3',
      amount: 5000,
      reason: 'Aftercare partial refund',
      actorRole: 'OPS',
      actorId: 'ops_1',
    },
    {
      refundStripePaymentIntent: async (options) => {
        return { id: 're_123', status: 'succeeded', amount: options.amount, payment_intent: options.paymentIntentId }
      },
      refundPaystackTransaction: async () => {
        throw new Error('Paystack should not be called')
      },
      markPaymentAttemptStatus: async () => {
        throw new Error('markPaymentAttemptStatus should not be called for partial refunds')
      },
    },
  )

  assertEquals(result.totalRefundedAmount, 5000)
  assertEquals(result.remainingRefundableAmount, 15000)
  assertEquals(result.refundedAttempts.length, 1)
  assertEquals(result.refundedAttempts[0].partial, true)
  assertEquals(attempts[0].status, 'PARTIAL_REFUND')
  assertEquals(attempts[0].refunded_amount, 5000)
  assertEquals(attempts[0].partial_refund_count, 1)
})
