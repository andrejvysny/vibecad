import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  // The opencascade.js emscripten glue is multi-MB and references Node builtins
  // behind env checks — keep esbuild's dep optimizer from pre-bundling it.
  optimizeDeps: {
    exclude: ["opencascade.js"],
  },
  build: {
    outDir: "dist",
    target: "es2022",
    minify: "esbuild",
    sourcemap: "hidden",
    rollupOptions: {
      input: { app: "./index.html" },
    },
  },
});
