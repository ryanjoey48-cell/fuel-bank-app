#!/usr/bin/env node
const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = process.env.PORT || "3010";
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    FUEL_BANK_ISOLATED_BUILD: "1",
    FUEL_BANK_DIST_DIR: process.env.FUEL_BANK_DIST_DIR || ".next-maintenance-qa",
    PORT: String(port)
  }
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
