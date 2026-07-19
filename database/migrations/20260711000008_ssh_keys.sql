-- Saved SSH public keys, so users pick a key when creating a server instead
-- of pasting it each time. Names unique per user among active keys, mirroring
-- functions/instances. user_id nullable until Clerk auth lands.

-- migrate:up
CREATE TABLE IF NOT EXISTS ssh_keys (
    id         TEXT PRIMARY KEY DEFAULT 'key-' || gen_random_uuid(),
    name       TEXT        NOT NULL,
    public_key TEXT        NOT NULL,
    user_id    TEXT        REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_ssh_keys_active_name
    ON ssh_keys (COALESCE(user_id, ''), name)
    WHERE deleted_at IS NULL;

-- migrate:down
DROP TABLE IF EXISTS ssh_keys;
