#!/usr/bin/env node
/**
 * Start (or keep) one Next.js development server for this checkout on port 3000.
 * Stops only confirmed orphan Next.js processes for this repository that hold the port.
 */
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 3000);
const rootNorm = root.replaceAll("\\", "/").toLowerCase();

function commandLineForPid(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return "";
  if (process.platform !== "win32") {
    try {
      return execFileSync("ps", ["-p", String(pid), "-o", "args="], { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  }
  try {
    return execFileSync("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      `$fleetProcess = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($fleetProcess) { $fleetProcess.CommandLine }`
    ], { encoding: "utf8", windowsHide: true }).trim();
  } catch {
    throw new Error(`Unable to identify the process on port ${port}; the server was not changed.`);
  }
}

function listeningPid() {
  if (process.platform !== "win32") {
    try {
      const out = execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
      return out ? Number(out.split(/\s+/)[0]) : null;
    } catch {
      return null;
    }
  }
  try {
    const out = execFileSync("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      `$fleetConnection = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($fleetConnection) { $fleetConnection.OwningProcess }`
    ], { encoding: "utf8", windowsHide: true }).trim();
    const pid = Number(out);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    throw new Error(`Unable to inspect port ${port}; no server was started or stopped.`);
  }
}

function isThisCheckoutNext(command = "") {
  const normalized = command.replaceAll("\\", "/").toLowerCase();
  if (!normalized.includes(rootNorm)) return false;
  return /(^|[\\/\s"])next([\\/\s"]|$)|start-server\.js|npx-cli\.js.*next/.test(normalized);
}

function isProductionStart(command = "") {
  const normalized = command.replaceAll("\\", "/").toLowerCase();
  return /next["']?\s+start(?:\s|$)/.test(normalized);
}

function killTree(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // Already exited.
  }
}

function serverHealth() {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/fleet-tracking", timeout: 30000 }, (response) => {
      response.resume();
      resolve({ healthy: response.statusCode >= 200 && response.statusCode < 500, status: response.statusCode });
    });
    request.on("error", () => resolve({ healthy: false, status: null }));
    request.on("timeout", () => request.destroy(new Error("Local page check timed out")));
  });
}

async function main() {
  process.chdir(root);
  delete process.env.FUEL_BANK_ISOLATED_BUILD;
  delete process.env.FUEL_BANK_LOW_MEMORY;
  delete process.env.FUEL_BANK_DIST_DIR;

  const owner = listeningPid();
  if (owner) {
    const command = commandLineForPid(owner);
    if (isThisCheckoutNext(command)) {
      const health = await serverHealth();
      if (health.healthy && !isProductionStart(command)) {
        console.log(`Dev server healthy for this checkout on http://localhost:${port} (HTTP ${health.status}, pid ${owner}).`);
        return;
      }
      console.log(isProductionStart(command)
        ? `Replacing EES production preview on port ${port} with the current development server (pid ${owner}).`
        : `Restarting unhealthy EES development server on port ${port} (${health.status ? `HTTP ${health.status}` : "page check failed"}, pid ${owner}).`);
      killTree(owner);
      await new Promise((resolve) => setTimeout(resolve, 1200));
    } else {
      console.error(`Port ${port} is in use by pid ${owner}, which is not this EES checkout's Next.js server.`);
      console.error("Stop that process manually if it is safe, then re-run npm run dev:stable.");
      process.exit(1);
    }
  }

  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextBin)) {
    console.error("Next.js binary not found. Run npm install in this checkout first.");
    process.exit(1);
  }

  console.log(`Starting Next.js development server for ${root} on port ${port}.`);
  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, PORT: String(port) }
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
