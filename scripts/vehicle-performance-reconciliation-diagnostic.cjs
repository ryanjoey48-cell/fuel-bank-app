const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

const WORKBOOK_CANDIDATES = [
  "C:\\Users\\User\\Downloads\\Vehicle_Performance_Import_Jan-Jul_2026 (1).xlsx",
  "C:\\Users\\User\\Downloads\\Vehicle_Performance_Import_Jan-Jul_2026.xlsx"
];
const OUTPUT_PATH = path.resolve("output/vehicle-performance-reconciliation-2026-jan-jul.csv");
const ALIASES = new Map([
  ["3ฒน-9565", "9565"],
  ["3ฒล-4565", "4565"],
  ["ฒอ-8453", "8453"]
]);

function readEnv() {
  return Object.fromEntries(
    fs.readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

function normalizeRegistration(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function fetchAll(env, pathName) {
  const rows = [];
  const batchSize = 1000;
  let from = 0;

  while (true) {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${pathName}`, {
      headers: {
        apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
        Accept: "application/json",
        Range: `${from}-${from + batchSize - 1}`
      }
    });

    if (!response.ok) {
      throw new Error(`${pathName}: ${response.status} ${await response.text()}`);
    }

    const batch = await response.json();
    rows.push(...batch);
    if (batch.length < batchSize) break;
    from += batchSize;
  }

  return rows;
}

function parseWorkbookRows() {
  const workbookPath = WORKBOOK_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!workbookPath) {
    throw new Error(`Workbook not found. Checked: ${WORKBOOK_CANDIDATES.join(", ")}`);
  }

  const workbook = XLSX.readFile(workbookPath);
  const rows = [];
  let skippedRows = 0;

  for (const sheetName of workbook.SheetNames) {
    const worksheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: true,
      defval: ""
    });
    let headerSeen = false;

    for (const [index, row] of worksheetRows.entries()) {
      const registration = String(row[1] ?? "").trim();
      const normalized = registration.toLowerCase();
      const month = Number(row[0]);
      const hasContent = row.some((cell) => String(cell ?? "").trim());
      const isHeader = normalized === "ทะเบียนรถ";

      if (
        !registration ||
        isHeader ||
        normalized.includes("dummy") ||
        normalized.includes("total") ||
        registration.includes("รวม")
      ) {
        if (isHeader) headerSeen = true;
        if (hasContent || headerSeen) skippedRows += 1;
        continue;
      }

      if (month >= 1 && month <= 7) {
        rows.push({
          month,
          registration: normalizeRegistration(registration),
          excelFuel: Number(row[6] || 0),
          sourceSheet: sheetName,
          sourceRow: index + 1
        });
      }
    }
  }

  return { rows, skippedRows, sheetNames: workbook.SheetNames, workbookPath };
}

function buildFuelTotals(logs) {
  const totals = new Map();

  for (const log of logs) {
    const date = String(log.date ?? "");
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    const registration = normalizeRegistration(log.vehicle_reg);
    const key = `${year}-${month}-${registration}`;
    totals.set(key, (totals.get(key) ?? 0) + Number(log.total_cost || 0));
  }

  return totals;
}

async function main() {
  const env = readEnv();
  const workbook = parseWorkbookRows();
  const [vehicles, logs] = await Promise.all([
    fetchAll(env, "vehicles?select=vehicle_reg&order=vehicle_reg.asc"),
    fetchAll(env, "fuel_logs?select=id,date,vehicle_reg,total_cost&date=gte.2026-01-01&date=lte.2026-07-31")
  ]);
  const vehicleLookup = new Map(
    vehicles.map((vehicle) => {
      const registration = normalizeRegistration(vehicle.vehicle_reg);
      return [registration, registration];
    })
  );
  const canonicalVehicles = Array.from(vehicleLookup.keys()).sort((left, right) => left.localeCompare(right));
  const fuelTotals = buildFuelTotals(logs);
  const counts = {
    ready: 0,
    fuelMismatch: 0,
    vehicleNotMatched: 0,
    duplicate: 0,
    needsReview: 0
  };
  const outputRows = [[
    "Month",
    "Excel Registration",
    "Canonical App Registration",
    "Vehicle Match?",
    "Excel Fuel",
    "Fuel Spend Report Fuel",
    "Vehicle Performance Fuel",
    "Difference",
    "Status"
  ]];

  for (const row of workbook.rows) {
    const alias = ALIASES.get(row.registration);
    const canonicalRegistration =
      vehicleLookup.get(row.registration) ??
      (alias ? vehicleLookup.get(alias) : "") ??
      "";
    const reportFuel = canonicalRegistration
      ? fuelTotals.get(`2026-${row.month}-${canonicalRegistration}`) ?? 0
      : 0;
    const difference = reportFuel - row.excelFuel;
    const status = !canonicalRegistration
      ? "Vehicle not matched"
      : Math.abs(difference) <= 1
        ? "Ready"
        : "Fuel mismatch";

    if (status === "Ready") counts.ready += 1;
    else if (status === "Fuel mismatch") counts.fuelMismatch += 1;
    else counts.vehicleNotMatched += 1;

    outputRows.push([
      row.month,
      row.registration,
      canonicalRegistration,
      canonicalRegistration ? "Yes" : "No",
      money(row.excelFuel),
      money(reportFuel),
      money(reportFuel),
      money(difference),
      status
    ]);
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, outputRows.map((row) => row.map(csv).join(",")).join("\n"), "utf8");

  console.log(JSON.stringify({
    outputPath: OUTPUT_PATH,
    workbookPath: workbook.workbookPath,
    sheetNames: workbook.sheetNames,
    vehicleRows: workbook.rows.length,
    skippedRows: workbook.skippedRows,
    rawVehicles: vehicles.length,
    canonicalVehicles: canonicalVehicles.length,
    canonicalRegistrations: canonicalVehicles,
    fuelLogRows: logs.length,
    counts,
    statusSum: counts.ready + counts.fuelMismatch + counts.vehicleNotMatched + counts.duplicate + counts.needsReview
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
