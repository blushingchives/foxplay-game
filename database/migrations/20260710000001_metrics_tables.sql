-- Written by the pool-manager / artifact-store via the metrics service.
-- Column order matches the live database (later columns were added by
-- ALTERs there), keeping codegen output identical across environments.

-- migrate:up
CREATE TABLE IF NOT EXISTS invocations (
    id            BIGSERIAL PRIMARY KEY,
    function_name TEXT        NOT NULL,
    start_type    TEXT        NOT NULL, -- 'cold' | 'restored' | 'warm'
    queue_wait_ms BIGINT      NOT NULL DEFAULT 0,
    boot_ms       BIGINT      NOT NULL DEFAULT 0,
    invoke_ms     BIGINT      NOT NULL DEFAULT 0,
    status        INT         NOT NULL DEFAULT 0,
    infra_error   BOOLEAN     NOT NULL DEFAULT FALSE,
    cpu_ms        BIGINT      NOT NULL DEFAULT 0,
    mem_peak_kb   BIGINT      NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_body  TEXT        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_invocations_fn_time
    ON invocations (function_name, created_at DESC);

CREATE TABLE IF NOT EXISTS deployments (
    id                     BIGSERIAL PRIMARY KEY,
    function_name          TEXT        NOT NULL,
    image_size_bytes       BIGINT      NOT NULL DEFAULT 0,
    build_ms               BIGINT      NOT NULL DEFAULT 0,
    snapshot_enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
    snapshot_ms            BIGINT      NOT NULL DEFAULT 0,
    snapshot_ok            BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    kernel_path            TEXT        NOT NULL DEFAULT '',
    kernel_size_bytes      BIGINT      NOT NULL DEFAULT 0,
    base_rootfs_path       TEXT        NOT NULL DEFAULT '',
    base_rootfs_size_bytes BIGINT      NOT NULL DEFAULT 0,
    bootstrap_version      TEXT        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_deployments_fn_time
    ON deployments (function_name, created_at DESC);

-- migrate:down
DROP TABLE IF EXISTS invocations;
DROP TABLE IF EXISTS deployments;
