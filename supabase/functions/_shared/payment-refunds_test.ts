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

      if (table === 'ops_issues') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({ data: null, error: { message: 'ops issue persistence disabled in unit test' } })
                  },
                }
              },
            }
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
    supabase as never,
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
      recordCommercialPaymentRefund: async () => ({ transactionId: 'ledger_1', entries: [] }),
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
    supabase as never,
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
      recordCommercialPaymentRefund: async () => ({ transactionId: 'ledger_2', entries: [] }),
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
    supabase as never,
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
      recordCommercialPaymentRefund: async () => ({ transactionId: 'ledger_3', entries: [] }),
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

Deno.test('reviewed partial refund carries the exact restoration into the ledger adapter', async () => {
  const attempts: RefundablePaymentAttemptRow[] = [{ id:'pay_exact',order_id:'order_exact',phase:'INITIAL_ORDER',provider:'STRIPE',currency:'USD',amount:10000,status:'SUCCEEDED',provider_payment_id:'pi_exact',refunded_amount:0,partial_refund_count:0 }]
  const supabase = makeSupabase(attempts)
  const ledgerCalls: Array<Record<string, unknown>> = []
  const exactRestoration = { refundResolutionId:'resolution_1',tailorWorkAmount:7000,platformFeeAmount:500,taxAmount:500,fulfillmentAmount:1000,consultationAmount:0,promotionAmount:200,drapeonFundedAmount:0 }
  await partiallyRefundOrderPayments(supabase as never,{ orderId:'order_exact',amount:9000,actorRole:'OPS',allowedPhases:['INITIAL_ORDER'],exactRestoration },{
    refundStripePaymentIntent:async(options)=>({id:'re_exact',status:'succeeded',amount:options.amount,payment_intent:options.paymentIntentId}),
    refundPaystackTransaction:async()=>{throw new Error('Paystack should not be called')},
    markPaymentAttemptStatus:async()=>null,
    recordCommercialPaymentRefund:async(_client,input)=>{ledgerCalls.push(input as unknown as Record<string,unknown>);return {transactionId:'ledger_exact',entries:[]}},
  })
  assertEquals(ledgerCalls.length,1)
  assertEquals(ledgerCalls[0].exactRestoration,exactRestoration)
})

Deno.test('partial refund validates the commercial journal before contacting the provider', async () => {
  const attempts: RefundablePaymentAttemptRow[] = [{ id:'pay_preflight',order_id:'order_preflight',phase:'INITIAL_ORDER',provider:'PAYSTACK',currency:'NGN',amount:100000,status:'SUCCEEDED',provider_payment_id:'paystack_preflight',refunded_amount:0,partial_refund_count:0 }]
  const supabase = makeSupabase(attempts)
  let providerCalls = 0
  let message = ''
  try {
    await partiallyRefundOrderPayments(supabase as never,{ orderId:'order_preflight',amount:50000,actorRole:'OPS' },{
      refundStripePaymentIntent:async()=>{throw new Error('Stripe should not be called')},
      refundPaystackTransaction:async()=>{providerCalls += 1;return {id:1,status:'processed',transaction:'paystack_preflight'}},
      markPaymentAttemptStatus:async()=>null,
      recordCommercialPaymentRefund:async()=>({transactionId:'never',entries:[]}),
      assertCommercialPaymentRefundReady:async()=>{throw new Error('The payment capture ledger transaction is missing.')},
    })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assertEquals(providerCalls,0)
  assertEquals(message,'The payment capture ledger transaction is missing.')
  assertEquals(attempts[0].status,'SUCCEEDED')
})

Deno.test('pending Paystack refund remains financially unposted until the processed webhook', async () => {
  const attempts: RefundablePaymentAttemptRow[] = [{ id:'pay_pending',order_id:'order_pending',phase:'INITIAL_ORDER',provider:'PAYSTACK',currency:'NGN',amount:100000,status:'SUCCEEDED',provider_payment_id:'paystack_pending',refunded_amount:0,partial_refund_count:0,provider_response:{} }]
  const supabase = makeSupabase(attempts)
  let ledgerCalls = 0
  let providerCalls = 0
  const result = await partiallyRefundOrderPayments(supabase as never,{ orderId:'order_pending',amount:50000,actorRole:'OPS' },{
    refundStripePaymentIntent:async()=>{throw new Error('Stripe should not be called')},
    refundPaystackTransaction:async()=>{providerCalls += 1;return {id:17949565,status:'pending',transaction:'paystack_pending'}},
    markPaymentAttemptStatus:async()=>null,
    recordCommercialPaymentRefund:async()=>{ledgerCalls += 1;return {transactionId:'never',entries:[]}},
    assertCommercialPaymentRefundReady:async()=>({transactionId:null,entries:[],validated:true as const}),
  })
  assertEquals(result.refundedAttempts,[])
  assertEquals(result.pendingAttempts,[{
    id:'pay_pending',
    provider:'PAYSTACK',
    providerPaymentId:'paystack_pending',
    providerRefundId:'17949565',
    phase:'INITIAL_ORDER',
    amount:50000,
    currency:'NGN',
    status:'PENDING',
  }])
  assertEquals(ledgerCalls,0)
  assertEquals(providerCalls,1)
  assertEquals(attempts[0].status,'SUCCEEDED')
  assertEquals(attempts[0].refunded_amount,0)
  const duplicateResult = await partiallyRefundOrderPayments(supabase as never,{ orderId:'order_pending',amount:50000,actorRole:'OPS' },{
    refundStripePaymentIntent:async()=>{throw new Error('Stripe should not be called')},
    refundPaystackTransaction:async()=>{providerCalls += 1;throw new Error('A pending refund must not be submitted twice')},
    markPaymentAttemptStatus:async()=>null,
    recordCommercialPaymentRefund:async()=>{ledgerCalls += 1;return {transactionId:'never',entries:[]}},
    assertCommercialPaymentRefundReady:async()=>({transactionId:null,entries:[],validated:true as const}),
  })
  assertEquals(duplicateResult.pendingAttempts[0]?.providerRefundId,'17949565')
  assertEquals(providerCalls,1)
  assertEquals(ledgerCalls,0)
})

Deno.test('provider success with ledger failure is not reported as a successful refund', async () => {
  const attempts: RefundablePaymentAttemptRow[] = [{ id:'pay_reconcile',order_id:'order_reconcile',phase:'INITIAL_ORDER',provider:'PAYSTACK',currency:'NGN',amount:100000,status:'SUCCEEDED',provider_payment_id:'paystack_reconcile',refunded_amount:0,partial_refund_count:0,provider_response:{} }]
  const supabase = makeSupabase(attempts)
  let message = ''
  try {
    await partiallyRefundOrderPayments(supabase as never,{ orderId:'order_reconcile',amount:50000,actorRole:'OPS' },{
      refundStripePaymentIntent:async()=>{throw new Error('Stripe should not be called')},
      refundPaystackTransaction:async()=>({id:2,status:'processed',transaction:'paystack_reconcile'}),
      markPaymentAttemptStatus:async()=>null,
      recordCommercialPaymentRefund:async()=>{throw new Error('ledger unavailable')},
      assertCommercialPaymentRefundReady:async()=>({transactionId:null,entries:[],validated:true}),
    })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assertEquals(message,'The provider refund completed, but ledger reconciliation is still pending. Do not retry the provider refund.')
  assertEquals(attempts[0].status,'PARTIAL_REFUND')
  assertEquals(attempts[0].refunded_amount,50000)
})
