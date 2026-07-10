// Generates database/typescript/db.ts and database/go/models.go from the
// live database schema. Run via generate.sh; --check verifies the committed
// output matches without writing.
//
// Exit codes: 0 ok, 1 stale output (--check), 2 database unreachable.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// reuse the frontend's pg dependency — no package.json needed here
const require = createRequire(join(here, "..", "frontend", "package.json"));
const { Client } = require("pg");

const HEADER = "Code generated from the live database schema by database/generate.sh. DO NOT EDIT.";

const TS_TYPES = {
  int2: "number",
  int4: "number",
  int8: "number", // cast ::int in SQL — node-postgres returns bigint as string otherwise
  float4: "number",
  float8: "number",
  numeric: "number",
  text: "string",
  varchar: "string",
  uuid: "string",
  bool: "boolean",
  timestamptz: "string", // the ISO form it takes once JSON-serialized
  timestamp: "string",
  jsonb: "unknown",
  json: "unknown",
};

const GO_TYPES = {
  int2: "int16",
  int4: "int",
  int8: "int64",
  float4: "float32",
  float8: "float64",
  numeric: "float64",
  text: "string",
  varchar: "string",
  uuid: "string",
  bool: "bool",
  timestamptz: "time.Time",
  timestamp: "time.Time",
  jsonb: "json.RawMessage",
  json: "json.RawMessage",
};

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const f of [join(here, ".env"), join(here, "..", "frontend", ".env.local")]) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, "utf8").match(/^DATABASE_URL=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

function pascal(snake) {
  return snake
    .split("_")
    .map((p) => (p === "id" ? "ID" : p === "url" ? "URL" : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("");
}

function renderTS(tables) {
  let out = `// ${HEADER}\n// timestamptz columns are typed as string — the ISO form they take once\n// JSON-serialized by an API route.\n\n`;
  for (const [table, cols] of tables) {
    out += `export interface ${pascal(table)}Row {\n`;
    for (const c of cols) {
      const base = TS_TYPES[c.udt_name] ?? "unknown";
      out += `  ${c.column_name}: ${base}${c.is_nullable === "YES" ? " | null" : ""};\n`;
    }
    out += `}\n\n`;
  }
  return out;
}

function renderGo(tables) {
  let usesTime = false;
  let usesJSON = false;
  let body = "";
  for (const [table, cols] of tables) {
    body += `type ${pascal(table)}Row struct {\n`;
    for (const c of cols) {
      let goType = GO_TYPES[c.udt_name] ?? "any";
      if (goType === "time.Time") usesTime = true;
      if (goType === "json.RawMessage") usesJSON = true;
      if (c.is_nullable === "YES") goType = "*" + goType;
      body += `\t${pascal(c.column_name)} ${goType} \`json:"${c.column_name}" db:"${c.column_name}"\`\n`;
    }
    body += `}\n\n`;
  }

  let out = `// ${HEADER}\n\npackage dbtypes\n\n`;
  const imports = [];
  if (usesJSON) imports.push(`"encoding/json"`);
  if (usesTime) imports.push(`"time"`);
  if (imports.length > 0) {
    out += `import (\n${imports.map((i) => `\t${i}\n`).join("")})\n\n`;
  }
  return out + body.trimEnd() + "\n";
}

const check = process.argv.includes("--check");
const url = loadDatabaseUrl();
if (!url) {
  console.error("codegen: DATABASE_URL not set (env, database/.env, or frontend/.env.local)");
  process.exit(2);
}

const client = new Client({ connectionString: url });
try {
  await client.connect();
} catch (err) {
  console.error(`codegen: cannot reach database: ${err.message}`);
  process.exit(2);
}

const res = await client.query(`
  SELECT table_name, column_name, udt_name, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name <> 'schema_migrations'
  ORDER BY table_name, ordinal_position
`);
await client.end();

const tables = new Map();
for (const row of res.rows) {
  if (!tables.has(row.table_name)) tables.set(row.table_name, []);
  tables.get(row.table_name).push(row);
}
if (tables.size === 0) {
  console.error("codegen: no tables found — run the migrations first (database/migrate.sh)");
  process.exit(2);
}

const outputs = [
  { path: join(here, "typescript", "db.ts"), content: renderTS(tables) },
  { path: join(here, "go", "models.go"), content: renderGo(tables) },
];

let stale = false;
for (const { path, content } of outputs) {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (check) {
    if (existing !== content) {
      console.error(`codegen: STALE ${path}`);
      stale = true;
    }
  } else if (existing !== content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`codegen: wrote ${path}`);
  } else {
    console.log(`codegen: up to date ${path}`);
  }
}

if (check) {
  if (stale) process.exit(1);
  console.log("codegen: generated types are up to date");
}
