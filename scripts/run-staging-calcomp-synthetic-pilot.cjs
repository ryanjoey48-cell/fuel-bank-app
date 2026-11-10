#!/usr/bin/env node
/** Thin launcher — see run-staging-calcomp-synthetic-pilot.ts */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsx", path.join("scripts", "run-staging-calcomp-synthetic-pilot.ts")],
  { cwd: path.resolve(__dirname, ".."), stdio: "inherit", shell: true }
);
process.exit(result.status ?? 1);
