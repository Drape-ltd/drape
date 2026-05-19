import type { FinalizeOrderTerminalRequest } from '../../../packages/shared/src/order-terminal.ts'

type RpcResultRow = {
  order_id: string
  previous_stage: string
  current_stage: string
  inventory_released: boolean
  idempotent: boolean
}

const TERMINAL_STAGES = ['COMPLETE', 'DECLINED', 'EXPIRED', 'REFUNDED', 'CANCELLED'] as const

function isTerminalStage(stage: string | null | undefined) {
  return TERMINAL_STAGES.includes((stage ?? '').toUpperCase() as typeof TERMINAL_STAGES[number])
}

async function fallbackFinalizeOrderTerminal(
  supabase: any,
  orderId: string,
  request: FinalizeOrderTerminalRequest,
): Promise<RpcResultRow> {
  const targetStage = request.p_target_stage
  if (!isTerminalStage(targetStage)) {
    throw new Error(`Target stage ${targetStage} is not terminal.`)
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, stage, order_kind, seller_item_id, item_quantity, item_size')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) throw new Error(orderError.message)
  if (!order?.id) throw new Error(`Order ${orderId} was not found.`)

  const previousStage = String(order.stage ?? '')
  if (previousStage === targetStage) {
    return {
      order_id: order.id,
      previous_stage: previousStage,
      current_stage: previousStage,
      inventory_released: false,
      idempotent: true,
    }
  }

  if (isTerminalStage(previousStage)) {
    throw new Error(`Order ${order.id} is already terminal at stage ${previousStage}.`)
  }

  const expectedStages = request.p_expected_stages ?? null
  if (expectedStages && !expectedStages.includes(previousStage as any)) {
    throw new Error(`Order ${order.id} is at stage ${previousStage} but expected one of ${expectedStages.join(', ')}.`)
  }

  const patch: Record<string, unknown> = {
    stage: targetStage,
    stage_updated_at: new Date().toISOString(),
    escrow_released: false,
    escrow_released_at: null,
    auto_release_at: null,
  }

  if (request.p_replace_special_note) {
    patch.special_note = request.p_special_note ?? null
  }

  if (request.p_clear_payment_session) {
    patch.payment_provider = null
    patch.payment_intent_id = null
    patch.payment_checkout_url = null
  }

  if (request.p_reset_fulfillment_payment) {
    patch.fulfillment_payment_requested_at = null
    patch.fulfillment_payment_paid_at = null
    patch.fulfillment_payment_provider = null
    patch.fulfillment_payment_intent_id = null
    patch.fulfillment_payment_checkout_url = null
  }

  let updateQuery = supabase.from('orders').update(patch).eq('id', order.id)
  if (expectedStages && expectedStages.length > 0) {
    updateQuery = updateQuery.in('stage', expectedStages)
  }

  const { data: updatedRows, error: updateError } = await updateQuery.select('id, stage')
  if (updateError) throw new Error(updateError.message)
  const updated = Array.isArray(updatedRows) ? updatedRows[0] : null
  if (!updated?.id) {
    throw new Error(`Order ${order.id} could not be moved from ${previousStage} to ${targetStage}.`)
  }

  let inventoryReleased = false
  if (
    request.p_release_ready_made_inventory
    && String(order.order_kind ?? 'CUSTOM') === 'READY_MADE'
    && typeof order.seller_item_id === 'string'
    && order.seller_item_id.trim().length > 0
  ) {
    const { error: releaseError } = await supabase.rpc('release_seller_item_inventory', {
      target_item_id: order.seller_item_id,
      released_quantity: Math.max(Number(order.item_quantity ?? 1), 1),
      released_size: typeof order.item_size === 'string' && order.item_size.trim().length > 0 ? order.item_size.trim() : null,
    })
    if (releaseError) throw new Error(releaseError.message)
    inventoryReleased = true
  }

  const { error: stageUpdateError } = await supabase
    .from('order_stage_updates')
    .insert({
      order_id: order.id,
      stage: targetStage,
      note: request.p_note,
    })
  if (stageUpdateError) {
    console.error('terminal_fallback.stage_update_failed', stageUpdateError.message)
  }

  const { error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      actor_id: request.p_actor_id ?? null,
      actor_role: request.p_actor_role ?? null,
      order_id: order.id,
      event: request.p_event,
      severity: ['REFUNDED', 'CANCELLED', 'DECLINED', 'EXPIRED'].includes(targetStage) ? 'warn' : 'info',
      payload: {
        ...(request.p_payload ?? {}),
        from_stage: previousStage,
        to_stage: targetStage,
        inventory_released: inventoryReleased,
        terminal_fallback: true,
      },
    })
  if (auditError) {
    console.error('terminal_fallback.audit_failed', auditError.message)
  }

  return {
    order_id: order.id,
    previous_stage: previousStage,
    current_stage: targetStage,
    inventory_released: inventoryReleased,
    idempotent: false,
  }
}

export async function finalizeOrderTerminal(
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: RpcResultRow[] | null; error: { message: string } | null }>
    from?: any
  },
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
    if (typeof supabase.from === 'function') {
      return fallbackFinalizeOrderTerminal(supabase, orderId, request)
    }
    throw new Error(error.message)
  }

  const row = Array.isArray(data) ? data[0] : null
  if (!row?.order_id) {
    if (typeof supabase.from === 'function') {
      return fallbackFinalizeOrderTerminal(supabase, orderId, request)
    }
    throw new Error('Terminal order transition returned no result.')
  }

  return row
}
