import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { finalizeOrderTerminal } from './order-terminal.ts'

Deno.test('finalizeOrderTerminal forwards the normalized RPC payload', async () => {
  let captured:
    | {
      fn: string
      args: Record<string, unknown>
    }
    | null = null

  const fakeClient = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      captured = { fn, args }
      return {
        data: [{
          order_id: 'order-1',
          previous_stage: 'PENDING_QUOTE',
          current_stage: 'CANCELLED',
          inventory_released: false,
          idempotent: false,
        }],
        error: null,
      }
    },
  }

  const result = await finalizeOrderTerminal(fakeClient, 'order-1', {
    p_target_stage: 'CANCELLED',
    p_actor_id: 'customer-1',
    p_actor_role: 'CUSTOMER',
    p_event: 'order.cancelled_by_customer',
    p_note: 'Customer cancelled the order before live production started.',
    p_payload: { from_stage: 'PENDING_QUOTE' },
    p_expected_stages: ['PENDING_QUOTE'],
    p_clear_payment_session: false,
  })

  assertEquals(result.current_stage, 'CANCELLED')
  assertEquals(captured, {
    fn: 'finalize_order_terminal',
    args: {
      p_order_id: 'order-1',
      p_target_stage: 'CANCELLED',
      p_actor_id: 'customer-1',
      p_actor_role: 'CUSTOMER',
      p_event: 'order.cancelled_by_customer',
      p_note: 'Customer cancelled the order before live production started.',
      p_payload: { from_stage: 'PENDING_QUOTE' },
      p_expected_stages: ['PENDING_QUOTE'],
      p_special_note: null,
      p_replace_special_note: false,
      p_clear_payment_session: false,
      p_reset_fulfillment_payment: false,
      p_release_ready_made_inventory: false,
    },
  })
})

Deno.test('finalizeOrderTerminal throws when the RPC errors', async () => {
  const fakeClient = {
    rpc: async () => ({
      data: null,
      error: { message: 'Order is already terminal.' },
    }),
  }

  await assertRejects(
    () =>
      finalizeOrderTerminal(fakeClient, 'order-1', {
        p_target_stage: 'CANCELLED',
        p_event: 'order.cancelled_by_customer',
        p_note: 'Cancelled.',
      }),
    Error,
    'Order is already terminal.',
  )
})
