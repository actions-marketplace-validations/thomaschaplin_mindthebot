import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  // Optional: only loaded when --datadog is used.
  external: ["hot-shots"],
  banner: { js: "#!/usr/bin/env node" },
});
