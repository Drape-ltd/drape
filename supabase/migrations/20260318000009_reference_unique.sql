-- Add UNIQUE constraint on orders.reference
-- Prevents duplicate reference numbers in the unlikely event of a collision
-- (client-side generation uses Date.now() + random suffix, but DB enforces uniqueness).

ALTER TABLE orders
  ADD CONSTRAINT orders_reference_unique UNIQUE (reference);
