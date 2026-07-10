-- Replace incremental BIGSERIAL ids with random UUIDs on invocations,
-- deployments, and functions. users.id stays TEXT (Clerk ids). Existing
-- rows each get a fresh UUID; insertion order remains via created_at.

-- migrate:up
ALTER TABLE invocations DROP COLUMN id;
ALTER TABLE invocations ADD COLUMN id UUID PRIMARY KEY DEFAULT gen_random_uuid();

ALTER TABLE deployments DROP COLUMN id;
ALTER TABLE deployments ADD COLUMN id UUID PRIMARY KEY DEFAULT gen_random_uuid();

ALTER TABLE functions DROP COLUMN id;
ALTER TABLE functions ADD COLUMN id UUID PRIMARY KEY DEFAULT gen_random_uuid();

-- migrate:down
ALTER TABLE invocations DROP COLUMN id;
ALTER TABLE invocations ADD COLUMN id BIGSERIAL PRIMARY KEY;

ALTER TABLE deployments DROP COLUMN id;
ALTER TABLE deployments ADD COLUMN id BIGSERIAL PRIMARY KEY;

ALTER TABLE functions DROP COLUMN id;
ALTER TABLE functions ADD COLUMN id BIGSERIAL PRIMARY KEY;
