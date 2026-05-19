import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildReadyMadeStockNotification } from './ready-made-inventory.ts'
import { sendPushToUser } from './notify.ts'

export async function notifyTailorAboutReadyMadeStockChange(
  supabase: SupabaseClient,
  input: {
    orderKind?: string | null
    sellerItemId?: string | null
    tailorId?: string | null
    itemTitle?: string | null
    itemSize?: string | null
  },
): Promise<void> {
  if (input.orderKind !== 'READY_MADE' || !input.sellerItemId || !input.tailorId) {
    return
  }

  const { data: item } = await supabase
    .from('seller_items')
    .select('title, sizes, size_inventory, inventory_quantity')
    .eq('id', input.sellerItemId)
    .maybeSingle()

  if (!item) return

  const notification = buildReadyMadeStockNotification({
    itemTitle: input.itemTitle ?? item.title ?? 'This ready-made item',
    sizes: Array.isArray(item.sizes) ? item.sizes.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0) : [],
    sizeInventory: item.size_inventory,
    inventoryQuantity: typeof item.inventory_quantity === 'number' ? item.inventory_quantity : 0,
    requestedSize: input.itemSize ?? null,
  })

  if (!notification) return

  await sendPushToUser(supabase, input.tailorId, {
    title: notification.title,
    body: notification.body,
    preferenceKey: 'lowStockAlerts',
    data: {
      sellerItemId: input.sellerItemId,
      screen: 'shop',
    },
  })
}
