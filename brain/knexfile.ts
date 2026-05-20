import type { Knex } from "knex";

// Update with your config settings.
require("dotenv").config();

const config: { [key: string]: Knex.Config } = {
  production: {
    client: "pg",
    connection: process.env.DATABASE_CONNECTION_STRING,
    migrations: {
      tableName: "migrations",
      directory: "migrations",
    },
  },
};

module.exports = config;

// npx knex migrate:latest --env production
// npx knex migrate:rollback --env production
