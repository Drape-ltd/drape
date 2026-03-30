drop policy if exists "Customer creates orders" on orders;
create policy "Customer creates orders"
  on orders for insert
  to authenticated
  with check (
    auth.uid()::text = customer_id::text
    and (
      (
        coalesce(order_kind::text, 'CUSTOM') = 'CUSTOM'
        and stage = 'PENDING_QUOTE'
        and exists (
          select 1 from tailor_profiles tp
          where tp.id::text = orders.tailor_profile_id::text
            and tp.is_live = true
            and (
              orders.tailor_id is null
              or orders.tailor_id::text = tp.user_id::text
            )
        )
      )
      or
      (
        order_kind::text = 'READY_MADE'
        and stage in ('PENDING_QUOTE', 'CONFIRMED')
        and seller_item_id is not null
        and exists (
          select 1
          from tailor_profiles tp
          join seller_items si on si.tailor_profile_id::text = tp.id::text
          where tp.id::text = orders.tailor_profile_id::text
            and tp.is_live = true
            and si.id::text = orders.seller_item_id::text
            and coalesce(si.is_live, false) = true
            and coalesce(si.stock_status, 'IN_STOCK') not in ('SOLD_OUT', 'HIDDEN')
            and (
              orders.tailor_id is null
              or orders.tailor_id::text = tp.user_id::text
            )
        )
      )
    )
  );
