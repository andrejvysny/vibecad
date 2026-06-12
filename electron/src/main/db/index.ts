import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { app } from "electron";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import * as schema from "./schema.js";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getMigrationsPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, "migrations");
  return join(__dirname, "../../../src/main/db/migrations");
}

function getDbPath(): string {
  if (process.env["OPENCAD_DB_PATH"]) return process.env["OPENCAD_DB_PATH"];
  const dir = app.getPath("userData");
  mkdirSync(dir, { recursive: true });
  return join(dir, "opencad.sqlite");
}

export function initDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (db) return db;

  const sqlite = new Database(getDbPath());
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  db = drizzle(sqlite, { schema });

  try {
    migrate(db, { migrationsFolder: getMigrationsPath() });
  } catch {
    // migrations folder may not exist yet during development before first drizzle-kit generate
  }

  return db;
}
