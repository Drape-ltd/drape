import type { FinalizeOrderTerminalRequest } from '../../../packages/shared/src/order-terminal.ts'

type RpcResultRow = {
  order_id: string
  previous_stage: string
  current_stage: string
  inventory_released: boolean
  idempotent: boolean
}

export async function finalizeOrderTerminal(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: RpcResultRow[] | null; error: { message: string } | null }> },
  orderId: string,
  request: FinalizeOrderTerminalRequest,
) {
  const { data, error } = await supabase.rpc('finalize_order_terminal', {
    p_order_id: orderId,
    p_target_stage: request.p_target_stage,
    p_actor_id: request.p_actor_id ?? null,
    p_actor_role: request.p_actor_role ?? null,
    p_event: request.p_event,
    p_note: request.p_note,
    p_payload: request.p_payload ?? {},
    p_expected_stages: request.p_expected_stages ?? null,
    p_special_note: request.p_special_note ?? null,
    p_replace_special_note: request.p_replace_special_note ?? false,
    p_clear_payment_session: request.p_clear_payment_session ?? false,
    p_reset_fulfillment_payment: request.p_reset_fulfillment_payment ?? false,
    p_release_ready_made_inventory: request.p_release_ready_made_inventory ?? false,
  })

  if (error) {
    throw new Error(error.message)
  }

  const row = Array.isArray(data) ? data[0] : null
  if (!row?.order_id) {
    throw new Error('Terminal order transition returned no result.')
  }

  return row
}
