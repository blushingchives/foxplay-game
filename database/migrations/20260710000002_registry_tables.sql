-- The function registry and users, used by the Next.js frontend.
-- Clerk-ready: users.id is TEXT (Clerk ids are strings like "user_...");
-- functions.user_id stays NULL until auth lands.

-- migrate:up
CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    email      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS functions (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    user_id    TEXT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE IF EXISTS functions;
DROP TABLE IF EXISTS users;
