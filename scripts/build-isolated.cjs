#!/usr/bin/env node
/**
 * Run a production build into an isolated distDir so a live `next dev` on `.next` is not overwritten.
 * Restores next-env.d.ts to the live `.next` types path afterwards.
 */
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const distDir = process.env.FUEL_BANK_DIST_DIR || ".next-maintenance-qa";
const nextEnvPath = path.join(root, "next-env.d.ts");
const nextEnvBefore = fs.existsSync(nextEnvPath) ? fs.readFileSync(nextEnvPath, "utf8") : null;

const child = spawn(process.execPath, [nextBin, "build", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    FUEL_BANK_ISOLATED_BUILD: "1",
    FUEL_BANK_DIST_DIR: distDir,
    FUEL_BANK_LOW_MEMORY: process.env.FUEL_BANK_LOW_MEMORY || "1",
    NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || "1"
  }
});

child.on("exit", (code, signal) => {
  if (nextEnvBefore !== null) {
    try {
      fs.writeFileSync(nextEnvPath, nextEnvBefore);
    } catch {
      try {
        execFileSync("git", ["checkout", "--", "next-env.d.ts"], { cwd: root, stdio: "ignore", windowsHide: true });
      } catch {
        // Leave next-env.d.ts as Next wrote it if restore fails.
      }
    }
  }
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
