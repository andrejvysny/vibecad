import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./electron/src/main/db/schema.ts",
  out: "./electron/src/main/db/migrations",
  dbCredentials: {
    url: process.env["VIBECAD_DB_PATH"] ?? "./data/vibecad.sqlite",
  },
  verbose: true,
  strict: true,
});
