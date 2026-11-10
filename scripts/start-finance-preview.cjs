// Opens the real Finance Centre dashboard pages in fixture-preview mode.
// Child-process overrides do not alter any environment file or shell profile.
// Production/Development Supabase credentials are cleared for this process only.
const { spawn } = require("node:child_process");

const port = Number(process.env.EES_FINANCE_FIXTURE_PORT || process.env.EES_FINANCE_PREVIEW_PORT || "3000");
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("EES_FINANCE_PREVIEW_PORT must be an available local TCP port.");
}

const env = {
  ...process.env,
  // Force development so page.demo.tsx routes and demo-only credential clearing stay active
  // even if a parent shell left a non-standard NODE_ENV value.
  NODE_ENV: "development",
  EES_FINANCE_DEMO_ONLY: "1",
  NEXT_PUBLIC_EES_FINANCE_PREVIEW: "1",
  NEXT_PUBLIC_EES_FINANCE_FIXTURE: "1",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  SUPABASE_ACCESS_TOKEN: "",
  SUPABASE_DB_PASSWORD: "",
  // Avoid inheriting low-memory / isolated-build flags from earlier QA shells.
  FUEL_BANK_LOW_MEMORY: "",
  FUEL_BANK_ISOLATED_BUILD: "",
  FUEL_BANK_ISOLATED_BUILD_DIR: ""
};

const next = require.resolve("next/dist/bin/next");
process.stdout.write(`EES Finance Centre (fixture): http://127.0.0.1:${port}/finance-centre\n`);
process.stdout.write(`Manual Mass test booking: http://127.0.0.1:${port}/booking-diary\n`);
process.stdout.write(`Job verification (enter WO): http://127.0.0.1:${port}/job-verification?booking=manual-mass-1\n`);
process.stdout.write("Interactive full demo: http://127.0.0.1:${port}/finance-demo\n".replace("${port}", String(port)));
process.stdout.write("No Supabase credentials are required or passed to this development process.\n");
process.stdout.write("This is not live data. Do not issue invoices or open production.\n");

const child = spawn(process.execPath, [next, "dev", "-H", "127.0.0.1", "-p", String(port)], { env, stdio: "inherit" });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { if (!child.killed) child.kill(signal); });
