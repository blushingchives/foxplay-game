import { Pool } from "pg";

// One pool for the whole server process, surviving dev hot reloads.
const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const db =
  globalForPg.pgPool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = db;

// Schema is owned by database/migrations (applied via dbmate); generated
// row types live in database/typescript. This module only provides the pool.
