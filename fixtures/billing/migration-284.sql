-- Migration 284: add billing_status to invoices and backfill historical rows.
-- The migration runner wraps every file in a single transaction, so this ALTER
-- takes an ACCESS EXCLUSIVE lock on invoices and holds it until COMMIT.

BEGIN;

ALTER TABLE invoices
  ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'unbilled';

UPDATE invoices
   SET billing_status = CASE
     WHEN paid_at   IS NOT NULL THEN 'paid'
     WHEN voided_at IS NOT NULL THEN 'voided'
     ELSE 'unbilled'
   END
 WHERE billing_status = 'unbilled';

-- Denormalized balances must reflect the new statuses produced by the backfill.
UPDATE accounts a
   SET balance_cents = COALESCE((
     SELECT SUM(i.amount_cents)
       FROM invoices i
      WHERE i.account_id = a.id
        AND i.billing_status = 'unbilled'
   ), 0)
 WHERE EXISTS (
   SELECT 1 FROM invoices i WHERE i.account_id = a.id
 );

CREATE INDEX IF NOT EXISTS idx_invoices_account_billing_status
  ON invoices (account_id, billing_status);

COMMIT;
