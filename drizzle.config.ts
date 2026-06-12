import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./electron/src/main/db/schema.ts",
  out: "./electron/src/main/db/migrations",
  dbCredentials: {
    url: process.env["OPENCAD_DB_PATH"] ?? "./data/opencad.sqlite",
  },
  verbose: true,
  strict: true,
});
