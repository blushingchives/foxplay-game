-- Functions are now identified by UUID everywhere (artifact files, invoke
-- URLs, metrics); name becomes a display label. Names are unique per user
-- among ACTIVE (non-deleted) functions — pre-Clerk all rows have NULL
-- user_id, which COALESCE folds into one namespace. Deletes are soft
-- (deleted_at) so metrics history stays attributable. Old metrics rows were
-- keyed by name and are truncated per decision on 2026-07-11.

-- migrate:up
TRUNCATE invocations, deployments;

ALTER TABLE invocations RENAME COLUMN function_name TO function_id;
ALTER TABLE deployments RENAME COLUMN function_name TO function_id;
ALTER INDEX idx_invocations_fn_time RENAME TO idx_invocations_fnid_time;
ALTER INDEX idx_deployments_fn_time RENAME TO idx_deployments_fnid_time;

ALTER TABLE functions ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE functions DROP CONSTRAINT IF EXISTS functions_name_key;
CREATE UNIQUE INDEX idx_functions_active_name
    ON functions (COALESCE(user_id, ''), name)
    WHERE deleted_at IS NULL;

-- migrate:down
DROP INDEX IF EXISTS idx_functions_active_name;
ALTER TABLE functions ADD CONSTRAINT functions_name_key UNIQUE (name);
ALTER TABLE functions DROP COLUMN deleted_at;
ALTER INDEX idx_invocations_fnid_time RENAME TO idx_invocations_fn_time;
ALTER INDEX idx_deployments_fnid_time RENAME TO idx_deployments_fn_time;
ALTER TABLE invocations RENAME COLUMN function_id TO function_name;
ALTER TABLE deployments RENAME COLUMN function_id TO function_name;
