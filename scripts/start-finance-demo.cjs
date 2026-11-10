// Starts only the fictional Finance demonstration on a predictable local port.
// Child-process overrides do not alter any environment file or the user's shell.
const { spawn } = require("node:child_process");

const port = Number(process.env.EES_FINANCE_DEMO_PORT || "3102");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("EES_FINANCE_DEMO_PORT must be an available local TCP port.");
const env = { ...process.env,
  NODE_ENV: "development",
  EES_FINANCE_DEMO_ONLY: "1",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  SUPABASE_ACCESS_TOKEN: "",
  SUPABASE_DB_PASSWORD: "",
  FUEL_BANK_LOW_MEMORY: "",
  FUEL_BANK_ISOLATED_BUILD: "",
  FUEL_BANK_ISOLATED_BUILD_DIR: ""
};
const next = require.resolve("next/dist/bin/next");
process.stdout.write(`EES fixture-only demonstration: http://localhost:${port}/finance-demo\n`);
process.stdout.write("No Supabase credentials are required or passed to this development process.\n");
const child = spawn(process.execPath, [next, "dev", "-H", "127.0.0.1", "-p", String(port)], { env, stdio: "inherit" });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { if (!child.killed) child.kill(signal); });
