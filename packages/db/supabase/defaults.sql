-- ============================================================
-- Drape V1 — Column defaults missing after Prisma db push
-- Run once in the Supabase SQL Editor.
--
-- Prisma generates UUIDs and timestamps client-side (@default(uuid())
-- and @updatedAt). When the Supabase JS client writes directly, these
-- defaults don't exist at the DB level. This file adds them.
-- ============================================================

-- ─── UUID primary keys ────────────────────────────────────────────────────────
ALTER TABLE customer_profiles     ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE tailor_profiles       ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE portfolio_photos      ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE tailor_client_notes   ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE tailor_clients        ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE offline_orders        ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE orders                ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE order_stage_updates   ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE order_photos          ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE messages              ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE reviews               ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE disputes              ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE payouts               ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE push_tokens           ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE contact_bypass_logs   ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- ─── created_at defaults ──────────────────────────────────────────────────────
ALTER TABLE customer_profiles     ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE tailor_profiles       ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE portfolio_photos      ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE tailor_client_notes   ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE tailor_clients        ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE offline_orders        ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE orders                ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE order_stage_updates   ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE order_photos          ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE messages              ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE reviews               ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE disputes              ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE payouts               ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE push_tokens           ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE contact_bypass_logs   ALTER COLUMN created_at SET DEFAULT now();

-- ─── updated_at defaults ──────────────────────────────────────────────────────
ALTER TABLE customer_profiles   ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE tailor_profiles     ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE tailor_client_notes ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE tailor_clients      ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE offline_orders      ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE orders              ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE orders              ALTER COLUMN stage_updated_at SET DEFAULT now();
ALTER TABLE reviews             ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE push_tokens         ALTER COLUMN updated_at SET DEFAULT now();
