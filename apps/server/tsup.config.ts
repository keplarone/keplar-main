import { defineConfig } from "tsup";

export default defineConfig({
  // Flat output so every bundle resolves ./migrations next to itself.
  entry: { "api-main": "src/api-main.ts", "worker-main": "src/worker-main.ts", "migrate-main": "src/db/migrate-main.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  // The shared contracts package ships TypeScript source, so bundle it; keep real dependencies external.
  noExternal: ["@keplar/contracts"],
});
