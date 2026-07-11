-- Periodic CPU/memory samples for running instances, emitted by the
-- instance-manager's sampler. High-churn like invocations; pruned by age
-- later if it grows (none for now).

-- migrate:up
CREATE TABLE IF NOT EXISTS instance_metrics (
    id          TEXT PRIMARY KEY DEFAULT 'im-' || gen_random_uuid(),
    instance_id TEXT        NOT NULL,
    cpu_pct     INT         NOT NULL DEFAULT 0,   -- percent of one core (may exceed 100 for multi-vCPU)
    mem_rss_kb  BIGINT      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_instance_metrics_time
    ON instance_metrics (instance_id, created_at DESC);

-- migrate:down
DROP TABLE IF EXISTS instance_metrics;
