-- Rules the Prisma schema language cannot express.

-- A laser code has at most one ACTIVE allocation; switching or replacing closes the old row (history kept).
CREATE UNIQUE INDEX "core_inv_allocation_active_laser_code"
  ON "core_inv_allocation" ("tenant_id", "laser_code") WHERE "status" = 'ACTIVE';

-- An order position (FRONT / REAR) has at most one ACTIVE allocation.
CREATE UNIQUE INDEX "core_inv_allocation_active_order_position"
  ON "core_inv_allocation" ("order_id", "position") WHERE "status" = 'ACTIVE';

-- An allocation appears on at most one live (not cancelled) challan line at a time.
-- Enforced in the dispatch service; lines of cancelled challans are kept for history.

-- The audit log is append-only.
CREATE OR REPLACE FUNCTION util_audit_log_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'util_audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER util_audit_log_no_update
  BEFORE UPDATE OR DELETE ON "util_audit_log"
  FOR EACH ROW EXECUTE FUNCTION util_audit_log_block_change();

-- Ledger entries are append-only too.
CREATE OR REPLACE FUNCTION util_wallet_entry_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'util_wallet_entry is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER util_wallet_entry_no_update
  BEFORE UPDATE OR DELETE ON "util_wallet_entry"
  FOR EACH ROW EXECUTE FUNCTION util_wallet_entry_block_change();
