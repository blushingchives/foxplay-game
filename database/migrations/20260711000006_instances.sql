-- Long-lived, SSH-able microVM instances (EC2-style), managed by the
-- instance-manager service. Distinct from functions: persistent writable
-- disk, network-addressable, explicit start/stop lifecycle. Ids are
-- srv-prefixed; names unique per user among active instances, mirroring
-- the functions table.

-- migrate:up
CREATE TABLE IF NOT EXISTS instances (
    id             TEXT PRIMARY KEY DEFAULT 'srv-' || gen_random_uuid(),
    name           TEXT        NOT NULL,
    user_id        TEXT        REFERENCES users(id),
    state          TEXT        NOT NULL DEFAULT 'creating',
    base_image     TEXT        NOT NULL DEFAULT 'alpine',
    vcpu           INT         NOT NULL DEFAULT 1,
    mem_mib        INT         NOT NULL DEFAULT 128,
    guest_ip       TEXT,       -- private IP on the host bridge, e.g. 172.16.0.2
    ssh_host_port  INT,        -- droplet port DNAT'd to the guest's :22
    ssh_public_key TEXT,       -- injected into the guest at provision
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_instances_active_name
    ON instances (COALESCE(user_id, ''), name)
    WHERE deleted_at IS NULL;

-- migrate:down
DROP TABLE IF EXISTS instances;
