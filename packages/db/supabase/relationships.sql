-- ============================================================
-- Drape V1 — FK relationships missing after Prisma db push
-- Run once in the Supabase SQL Editor.
--
-- Prisma's @relation is only used by Prisma Client. When the
-- Supabase JS client joins tables (tailor_profiles!inner etc.),
-- PostgREST needs real FK constraints in the DB.
-- ============================================================

-- orders.customer_id → customer_profiles.user_id
-- Lets PostgREST resolve customer_profiles!customer_id(...) joins from orders.
ALTER TABLE orders
  ADD CONSTRAINT orders_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES customer_profiles(user_id)
  ON DELETE CASCADE;

-- reviews has no customer_id column — reviewer identity comes through order_id.
-- messages.sender_id has no FK (senders can be either role).
