#!/usr/bin/env node
/**
 * READ-ONLY Finance migration rehearsal.
 *
 * Inspects an exported local Finance fixture / `.ees-local/finance-test/state.json` snapshot and reports
 * readiness findings. It never writes to that file, never opens a database connection, and has no
 * production write path.
 *
 * Usage:
 *   node scripts/finance-migration-rehearsal-readonly.cjs
 *   node scripts/finance-migration-rehearsal-readonly.cjs path/to/state.json
 *   node scripts/finance-migration-rehearsal-readonly.cjs --json
 */
"use strict";

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const WRITE_FLAGS = new Set(["--write", "--apply", "--migrate", "--import", "--fix"]);
for (const arg of process.argv.slice(2)) {
  if (WRITE_FLAGS.has(arg) || arg.startsWith("--write") || arg.startsWith("--apply")) {
    console.error("REFUSED: this utility is read-only. No write / apply / migrate / import flags are accepted.");
    process.exit(2);
  }
}

const args = process.argv.slice(2).filter((a) => a !== "--json");
const asJson = process.argv.includes("--json");
const root = path.resolve(__dirname, "..");
const defaultPath = path.join(root, ".ees-local", "finance-test", "state.json");
const target = path.resolve(args[0] || defaultPath);
const cache = new Map();

function loadTs(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  const req = (name) => {
    if (name.startsWith(".") || name.startsWith("@/")) {
      const base = name.startsWith("@/") ? path.resolve(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.json`];
      const targetPath = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
      if (targetPath && (targetPath.endsWith(".ts") || targetPath.endsWith(".tsx"))) return loadTs(targetPath);
      if (targetPath) return require(targetPath);
    }
    return require(name);
  };
  // eslint-disable-next-line no-new-func
  new Function("module", "exports", "require", js)(mod, mod.exports, req);
  return mod.exports;
}

function loadEnvelope(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Snapshot not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function workspaceStates(envelope) {
  if (envelope?.workspaces?.owner || envelope?.workspaces?.previous_demo) {
    return [
      { name: "owner", state: envelope.workspaces.owner },
      { name: "previous_demo", state: envelope.workspaces.previous_demo }
    ].filter((row) => row.state && Array.isArray(row.state.bookings));
  }
  if (envelope?.state && Array.isArray(envelope.state.bookings)) {
    return [{ name: "state", state: envelope.state }];
  }
  if (Array.isArray(envelope?.bookings)) {
    return [{ name: "raw", state: envelope }];
  }
  throw new Error("Unrecognized Finance snapshot shape (expected envelope.workspaces or envelope.state).");
}

function main() {
  const envelope = loadEnvelope(target);
  const reconcile = loadTs(path.join(root, "lib", "finance-sheet-reconciliation.ts"));
  const pricing = loadTs(path.join(root, "lib", "finance-pricing-verification.ts"));
  const workspaces = workspaceStates(envelope);
  const report = {
    mode: "read-only",
    writePathPresent: false,
    snapshotPath: target,
    savedAt: envelope.savedAt || null,
    kind: envelope.kind || null,
    workspaces: []
  };

  for (const ws of workspaces) {
    const findings = reconcile.reconcileFinanceState(ws.state);
    const pricingReport = pricing.buildPricingVerificationReport(ws.state);
    const sheets = ws.state.billingSheets || [];
    const money = sheets.map((sheet) => {
      const totals = reconcile.sheetMoneyTotals(ws.state, sheet);
      return {
        sheetId: sheet.id,
        simulatedTrn: sheet.simulatedTrn || null,
        officialTrn: sheet.officialTrn,
        stage: sheet.stage,
        approvedAt: sheet.approvedAt || null,
        ...totals
      };
    });
    report.workspaces.push({
      name: ws.name,
      bookingCount: ws.state.bookings.length,
      sheetCount: sheets.length,
      findings,
      findingCounts: {
        error: findings.filter((f) => f.severity === "error").length,
        warning: findings.filter((f) => f.severity === "warning").length,
        info: findings.filter((f) => f.severity === "info").length
      },
      pricing: {
        missingFuelDates: pricingReport.missingFuelDates,
        proposedMappings: pricingReport.proposedMappings.length,
        approvedMappings: pricingReport.approvedMappings.length,
        conflicts: pricingReport.conflicts.length,
        effectiveGaps: pricingReport.effectiveGaps.length
      },
      money
    });
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }

  console.log("Finance migration rehearsal (READ-ONLY)");
  console.log(`Snapshot: ${target}`);
  console.log(`Saved at: ${report.savedAt || "—"}`);
  console.log("Write path: NONE (utility refuses --write/--apply/--migrate/--import)\n");
  for (const ws of report.workspaces) {
    console.log(`Workspace: ${ws.name}`);
    console.log(`  bookings=${ws.bookingCount} sheets=${ws.sheetCount}`);
    console.log(`  findings: error=${ws.findingCounts.error} warning=${ws.findingCounts.warning} info=${ws.findingCounts.info}`);
    console.log(`  pricing: missingFuel=${ws.pricing.missingFuelDates.length} proposedMaps=${ws.pricing.proposedMappings} approvedMaps=${ws.pricing.approvedMappings} conflicts=${ws.pricing.conflicts} gaps=${ws.pricing.effectiveGaps}`);
    for (const row of ws.money) {
      console.log(`  sheet ${row.sheetId} ${row.simulatedTrn || row.sheetId} stage=${row.stage} transport=${row.transportThb.toFixed(2)} extras=${row.extrasThb.toFixed(2)} total=${row.totalThb.toFixed(2)}${row.incomplete ? " (incomplete)" : ""}`);
    }
    for (const f of ws.findings.filter((x) => x.severity === "error").slice(0, 20)) {
      console.log(`  ERROR [${f.code}] ${f.subject}: ${f.detail}`);
    }
    for (const f of ws.findings.filter((x) => x.severity === "warning").slice(0, 20)) {
      console.log(`  WARN  [${f.code}] ${f.subject}: ${f.detail}`);
    }
    console.log("");
  }
  console.log("Safe future steps are documented in docs/finance-migration-rehearsal.md — do not run SQL from this script.");
}

try {
  main();
} catch (err) {
  console.error(String(err && err.stack || err));
  process.exit(1);
}
