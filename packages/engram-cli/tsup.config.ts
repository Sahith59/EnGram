import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node18",
  outDir: "dist",
  banner: { js: "#!/usr/bin/env node" },
  minify: false,
  sourcemap: false,
  clean: true,
});
