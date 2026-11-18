import { defineConfig } from "tsup";

export default defineConfig([
  {
    // The npm CLI. Dependencies are installed by npm, so they stay external.
    entry: { cli: "src/cli.ts" },
    outDir: "dist",
    format: ["esm"],
    target: "node22",
    platform: "node",
    clean: true,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    // The GitHub Action. Actions don't run `npm install`, so bundle everything into one file.
    entry: { index: "src/action.ts" },
    outDir: "action/dist",
    format: ["esm"],
    target: "node24",
    platform: "node",
    clean: true,
    noExternal: [/.*/],
    splitting: false,
    // Some bundled CommonJS dependencies call require(); give ESM output a require to use.
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  },
]);
