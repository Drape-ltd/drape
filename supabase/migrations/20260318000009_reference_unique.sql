-- Add UNIQUE constraint on orders.reference
-- Prevents duplicate reference numbers in the unlikely event of a collision
-- (client-side generation uses Date.now() + random suffix, but DB enforces uniqueness).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_reference_unique'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_reference_unique UNIQUE (reference);
  END IF;
END $$;
