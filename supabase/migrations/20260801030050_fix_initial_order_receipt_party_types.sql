-- Development-forward compatibility fix: order party IDs are text in the
-- existing orders contract, while auth identities remain UUID-shaped strings.
drop policy if exists "commercial receipts: order parties can view" on public.commercial_receipts;

alter table public.commercial_receipts
  drop constraint if exists commercial_receipts_customer_id_fkey,
  drop constraint if exists commercial_receipts_tailor_id_fkey;

alter table public.commercial_receipts
  alter column customer_id type text using customer_id::text,
  alter column tailor_id type text using tailor_id::text;

create policy "commercial receipts: order parties can view"
  on public.commercial_receipts for select to authenticated
  using (customer_id = auth.uid()::text or tailor_id = auth.uid()::text);
