import { defineConfig } from "tsup";
import path from "node:path";

export default defineConfig([
  {
    entry: { "main/index": "src/main/index.ts" },
    format: "cjs",
    platform: "node",
    target: "node22",
    outDir: "dist",
    sourcemap: true,
    clean: true,
    splitting: false,
    bundle: true,
    external: ["electron", "better-sqlite3"],
    noExternal: ["electron-log", "drizzle-orm", "zod"],
    esbuildOptions(options) {
      options.alias = {
        "@shared": path.resolve(__dirname, "../shared"),
      };
    },
  },
  {
    entry: { "preload/index": "src/preload/index.ts" },
    format: "cjs",
    platform: "node",
    target: "node22",
    outDir: "dist",
    sourcemap: true,
    clean: false,
    splitting: false,
    bundle: true,
    external: ["electron"],
    noExternal: ["electron-log"],
    esbuildOptions(options) {
      options.alias = {
        "@shared": path.resolve(__dirname, "../shared"),
      };
    },
  },
]);
