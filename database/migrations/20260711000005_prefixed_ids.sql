-- Type-prefixed ids (fn-/art-/log- + UUID), AWS/Stripe style: ids become
-- self-describing in logs and URLs. Columns switch from uuid to TEXT with
-- the prefix baked into the default; existing rows are prefixed in place.

-- migrate:up
ALTER TABLE functions ALTER COLUMN id DROP DEFAULT;
ALTER TABLE functions ALTER COLUMN id TYPE TEXT USING id::text;
ALTER TABLE functions ALTER COLUMN id SET DEFAULT 'fn-' || gen_random_uuid();
UPDATE functions SET id = 'fn-' || id WHERE id NOT LIKE 'fn-%';

ALTER TABLE deployments ALTER COLUMN id DROP DEFAULT;
ALTER TABLE deployments ALTER COLUMN id TYPE TEXT USING id::text;
ALTER TABLE deployments ALTER COLUMN id SET DEFAULT 'art-' || gen_random_uuid();
UPDATE deployments SET id = 'art-' || id WHERE id NOT LIKE 'art-%';

ALTER TABLE invocations ALTER COLUMN id DROP DEFAULT;
ALTER TABLE invocations ALTER COLUMN id TYPE TEXT USING id::text;
ALTER TABLE invocations ALTER COLUMN id SET DEFAULT 'log-' || gen_random_uuid();
UPDATE invocations SET id = 'log-' || id WHERE id NOT LIKE 'log-%';

-- keep metric references consistent with the new function ids
UPDATE invocations SET function_id = 'fn-' || function_id WHERE function_id NOT LIKE 'fn-%';
UPDATE deployments SET function_id = 'fn-' || function_id WHERE function_id NOT LIKE 'fn-%';

-- migrate:down
UPDATE invocations SET function_id = substring(function_id FROM 4) WHERE function_id LIKE 'fn-%';
UPDATE deployments SET function_id = substring(function_id FROM 4) WHERE function_id LIKE 'fn-%';

UPDATE invocations SET id = substring(id FROM 5) WHERE id LIKE 'log-%';
ALTER TABLE invocations ALTER COLUMN id DROP DEFAULT;
ALTER TABLE invocations ALTER COLUMN id TYPE UUID USING id::uuid;
ALTER TABLE invocations ALTER COLUMN id SET DEFAULT gen_random_uuid();

UPDATE deployments SET id = substring(id FROM 5) WHERE id LIKE 'art-%';
ALTER TABLE deployments ALTER COLUMN id DROP DEFAULT;
ALTER TABLE deployments ALTER COLUMN id TYPE UUID USING id::uuid;
ALTER TABLE deployments ALTER COLUMN id SET DEFAULT gen_random_uuid();

UPDATE functions SET id = substring(id FROM 4) WHERE id LIKE 'fn-%';
ALTER TABLE functions ALTER COLUMN id DROP DEFAULT;
ALTER TABLE functions ALTER COLUMN id TYPE UUID USING id::uuid;
ALTER TABLE functions ALTER COLUMN id SET DEFAULT gen_random_uuid();
