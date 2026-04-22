const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

const WORKBOOK_PATH = "C:/Users/User/Downloads/oil change data.xlsx";
const REPORT_DIR = path.join(process.cwd(), "import-reports");
const DEFAULT_OUTPUT = path.join(REPORT_DIR, "oil-change-import-preview.json");
const INTERVAL_BY_VEHICLE_TYPE = require("../lib/oil-change-intervals.json");

const VEHICLE_TYPE_LABELS = {
  EIGHTEEN_WHEELER: "18 wheeler",
  SIX_WHEEL_TRUCK: "6 wheeler",
  SIX_PLUS_SIX_WHEELER: "6 + 6 wheeler",
  FOUR_WHEEL_TRUCK: "4 wheeler"
};

function readEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    env[line.slice(0, index)] = line.slice(index + 1);
  }
  return env;
}

function normalizeVehicleReg(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/^[^\dA-Zก-ฮ]+/, "");
}

function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function parseNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function getHeaderKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function findColumn(headers, candidates) {
  const normalized = headers.map(getHeaderKey);
  for (const candidate of candidates) {
    const index = normalized.indexOf(getHeaderKey(candidate));
    if (index !== -1) return index;
  }
  return -1;
}

function getLatestWeeklyByVehicle(weeklyRows) {
  const latest = new Map();
  for (const row of weeklyRows) {
    const key = normalizeVehicleReg(row.vehicle_reg);
    const odometer = parseNumber(row.odometer_reading ?? row.mileage);
    if (!key || odometer == null || !row.week_ending) continue;
    const previous = latest.get(key);
    const sortValue = `${row.week_ending}::${row.created_at ?? ""}::${row.id}`;
    if (!previous || sortValue > previous.sortValue) {
      latest.set(key, { row, odometer, sortValue });
    }
  }
  return latest;
}

function buildDriverIndexes(drivers) {
  const exact = new Map();
  const digit = new Map();
  for (const driver of drivers) {
    const key = normalizeVehicleReg(driver.vehicle_reg ?? driver.vehicle);
    if (!key) continue;
    exact.set(key, [...(exact.get(key) ?? []), driver]);
    const digitKey = digitsOnly(key);
    if (digitKey) {
      digit.set(digitKey, [...(digit.get(digitKey) ?? []), driver]);
    }
  }
  return { exact, digit };
}

function classifyMatch(reg, indexes) {
  const exactKey = normalizeVehicleReg(reg);
  const exactMatches = indexes.exact.get(exactKey) ?? [];
  if (exactMatches.length === 1) {
    return { status: "matched", driver: exactMatches[0], reason: "Exact normalized vehicle registration match" };
  }
  if (exactMatches.length > 1) {
    return { status: "matched_needs_review", driver: null, reason: "Duplicate exact vehicle registration in drivers table" };
  }

  const digitKey = digitsOnly(exactKey);
  const digitMatches = digitKey ? indexes.digit.get(digitKey) ?? [] : [];
  if (digitMatches.length === 1 && digitMatches[0].vehicle_reg !== reg) {
    return {
      status: "matched_needs_review",
      driver: digitMatches[0],
      reason: `Digit-only match to ${digitMatches[0].vehicle_reg}; requires human confirmation`
    };
  }
  if (digitMatches.length > 1) {
    return { status: "matched_needs_review", driver: null, reason: "Multiple digit-only driver matches" };
  }

  return { status: "unmatched_vehicle", driver: null, reason: "No confident vehicle registration match" };
}

function parseWorkbook(workbookPath) {
  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false, blankrows: true });
    return {
      name,
      ref: sheet["!ref"] ?? "",
      merges: (sheet["!merges"] ?? []).length,
      rows
    };
  });

  const selected = sheets.find((sheet) =>
    sheet.rows.some((row) => row.some((cell) => getHeaderKey(cell).includes("vechile reg") || getHeaderKey(cell).includes("vehicle reg")))
  );

  if (!selected) {
    throw new Error("No sheet with a vehicle registration header was found.");
  }

  const headerIndex = selected.rows.findIndex((row) =>
    row.some((cell) => getHeaderKey(cell).includes("vechile reg") || getHeaderKey(cell).includes("vehicle reg"))
  );
  const headers = selected.rows[headerIndex];
  const dateCol = findColumn(headers, ["Date"]);
  const regCol = findColumn(headers, ["Vechile reg", "Vehicle reg"]);
  const lastCol = findColumn(headers, ["mileage last changed", "mileage last changed"]);
  const dueCol = findColumn(headers, ["mile they are suppose to change"]);
  const currentCol = 5;
  const remainingCol = 6;

  const parsedRows = [];
  for (let rowIndex = headerIndex + 1; rowIndex < selected.rows.length; rowIndex += 1) {
    const row = selected.rows[rowIndex];
    if (!row || row.every((cell) => cell == null || String(cell).trim() === "")) continue;
    const serviceDate = parseDateValue(row[dateCol]);
    const vehicleReg = normalizeVehicleReg(row[regCol]);
    const serviceOdometer = parseNumber(row[lastCol]);
    const nextDue = parseNumber(row[dueCol]);
    const currentOdometer = parseNumber(row[currentCol]);
    const kmRemaining = parseNumber(row[remainingCol]);
    const intervalFromDue = nextDue != null && serviceOdometer != null ? nextDue - serviceOdometer : null;

    parsedRows.push({
      sourceRowNumber: rowIndex + 1,
      raw: row,
      serviceDate,
      vehicleReg,
      serviceOdometer,
      nextDue,
      currentOdometer,
      kmRemaining,
      intervalFromDue
    });
  }

  return {
    workbook: {
      path: workbookPath,
      sheetNames: workbook.SheetNames,
      sheets: sheets.map((sheet) => ({ name: sheet.name, ref: sheet.ref, merges: sheet.merges })),
      selectedSheet: selected.name,
      headerRowNumber: headerIndex + 1,
      headers
    },
    parsedRows
  };
}

async function loadAppData() {
  const env = readEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const [driversResult, weeklyResult, vehiclesResult, logsResult] = await Promise.all([
    supabase.from("drivers").select("*"),
    supabase.from("weekly_mileage").select("*").order("week_ending", { ascending: false }).order("id", { ascending: false }),
    supabase.from("vehicles").select("*"),
    supabase.from("vehicle_service_logs").select("*")
  ]);

  return {
    supabase,
    drivers: driversResult.data ?? [],
    weeklyMileage: weeklyResult.data ?? [],
    vehicles: vehiclesResult.data ?? [],
    existingLogs: logsResult.data ?? [],
    errors: {
      drivers: driversResult.error,
      weeklyMileage: weeklyResult.error,
      vehicles: vehiclesResult.error,
      serviceLogs: logsResult.error
    }
  };
}

function buildPreview(parsedRows, appData) {
  const indexes = buildDriverIndexes(appData.drivers);
  const latestWeekly = getLatestWeeklyByVehicle(appData.weeklyMileage);
  const existingLogKeys = new Set(
    appData.existingLogs.map((log) =>
      `${normalizeVehicleReg(log.vehicle_reg)}::${log.service_type ?? "oil_change"}::${log.service_date}::${Math.trunc(Number(log.odometer ?? log.service_odometer ?? 0))}`
    )
  );
  const seenSourceKeys = new Set();
  const previewRows = [];

  for (const row of parsedRows) {
    const issues = [];
    if (!row.serviceDate) issues.push("Invalid or missing service date");
    if (!row.vehicleReg) issues.push("Missing vehicle registration");
    if (row.serviceOdometer == null) issues.push("Invalid or missing service odometer");
    if (row.intervalFromDue == null || row.intervalFromDue <= 0) issues.push("Invalid interval inferred from due odometer");

    const match = classifyMatch(row.vehicleReg, indexes);
    const driver = match.driver;
    const vehicleType = driver?.vehicle_type ?? null;
    const typeInterval = vehicleType ? INTERVAL_BY_VEHICLE_TYPE[vehicleType] ?? null : null;
    const explicitInterval = row.intervalFromDue != null && row.intervalFromDue > 0 ? row.intervalFromDue : null;
    const selectedInterval = explicitInterval ?? typeInterval ?? null;
    const intervalSource = explicitInterval != null ? "excel_due_minus_last" : typeInterval != null ? "vehicle_type" : "missing";

    if (!vehicleType && match.status === "matched") issues.push("Missing vehicle type");
    if (!selectedInterval) issues.push("Missing interval");
    if (explicitInterval != null && typeInterval != null && explicitInterval !== typeInterval) {
      issues.push(`Interval conflict: Excel ${explicitInterval}, vehicle type default ${typeInterval}`);
    }

    const sourceDuplicateKey = `${row.vehicleReg}::oil_change::${row.serviceDate}::${row.serviceOdometer}`;
    const duplicateInFile = seenSourceKeys.has(sourceDuplicateKey);
    seenSourceKeys.add(sourceDuplicateKey);
    const duplicateInDb = existingLogKeys.has(sourceDuplicateKey);
    if (duplicateInFile) issues.push("Duplicate in workbook");
    if (duplicateInDb) issues.push("Duplicate already exists in service logs");

    const latestWeeklyForVehicle = latestWeekly.get(normalizeVehicleReg(driver?.vehicle_reg ?? row.vehicleReg));
    const category =
      issues.some((issue) => issue.startsWith("Invalid")) ? "invalid_row" :
      duplicateInFile || duplicateInDb ? "duplicate_skipped" :
      match.status === "unmatched_vehicle" ? "unmatched_vehicle" :
      match.status === "matched_needs_review" ? "matched_needs_review" :
      issues.length ? "matched_needs_review" :
      "ready_to_import";

    previewRows.push({
      ...row,
      category,
      matchStatus: match.status,
      matchReason: match.reason,
      driverId: driver?.id ?? null,
      driverName: driver?.name ?? null,
      appVehicleReg: driver?.vehicle_reg ?? null,
      vehicleType,
      vehicleTypeLabel: VEHICLE_TYPE_LABELS[vehicleType] ?? null,
      typeDefaultInterval: typeInterval,
      selectedInterval,
      intervalSource,
      latestWeeklyOdometer: latestWeeklyForVehicle?.odometer ?? null,
      latestWeeklyDate: latestWeeklyForVehicle?.row?.week_ending ?? null,
      issues
    });
  }

  const readyRows = previewRows.filter((row) => row.category === "ready_to_import");
  const baselineByVehicle = new Map();
  for (const row of readyRows) {
    const key = normalizeVehicleReg(row.appVehicleReg);
    const current = baselineByVehicle.get(key);
    if (!current || row.serviceDate > current.serviceDate) {
      baselineByVehicle.set(key, row);
    }
  }

  return {
    rows: previewRows,
    baselines: Array.from(baselineByVehicle.values()).map((row) => ({
      appVehicleReg: row.appVehicleReg,
      driverName: row.driverName,
      vehicleType: row.vehicleType,
      serviceDate: row.serviceDate,
      serviceOdometer: row.serviceOdometer,
      intervalKm: row.selectedInterval,
      intervalSource: row.intervalSource
    })),
    summary: {
      totalRows: previewRows.length,
      readyToImport: readyRows.length,
      invalidRows: previewRows.filter((row) => row.category === "invalid_row").length,
      duplicatesSkipped: previewRows.filter((row) => row.category === "duplicate_skipped").length,
      unmatchedVehicles: previewRows.filter((row) => row.category === "unmatched_vehicle").length,
      reviewRequiredRows: previewRows.filter((row) => row.category === "matched_needs_review").length,
      baselinesToUpdate: baselineByVehicle.size,
      vehiclesUsingExcelExplicitInterval: readyRows.filter((row) => row.intervalSource === "excel_due_minus_last").length,
      vehiclesUsingVehicleTypeInterval: readyRows.filter((row) => row.intervalSource === "vehicle_type").length
    }
  };
}

async function applyImport(preview, appData) {
  const readyRows = preview.rows.filter((row) => row.category === "ready_to_import");
  const inserted = [];
  const skipped = [];
  const baselines = new Map();

  for (const row of readyRows) {
    const existingVehicle = await appData.supabase
      .from("vehicles")
      .select("*")
      .ilike("vehicle_reg", row.appVehicleReg)
      .limit(1)
      .maybeSingle();

    if (existingVehicle.error) throw existingVehicle.error;

    let vehicle = existingVehicle.data;
    if (!vehicle) {
      const createdVehicle = await appData.supabase
        .from("vehicles")
        .insert({
          vehicle_reg: row.appVehicleReg,
          vehicle_name: row.driverName || row.appVehicleReg,
          vehicle_category: row.vehicleType === "EIGHTEEN_WHEELER" ? "HEAVY_LORRY" : "LORRY",
          vehicle_type: row.vehicleType,
          fuel_type: "DIESEL",
          active: true
        })
        .select()
        .single();
      if (createdVehicle.error) throw createdVehicle.error;
      vehicle = createdVehicle.data;
    } else if (row.vehicleType && !vehicle.vehicle_type) {
      const updatedVehicle = await appData.supabase
        .from("vehicles")
        .update({ vehicle_type: row.vehicleType })
        .eq("id", vehicle.id)
        .select()
        .single();
      if (updatedVehicle.error) throw updatedVehicle.error;
      vehicle = updatedVehicle.data;
    }

    const payload = {
      vehicle_id: vehicle.id,
      vehicle_reg: row.appVehicleReg,
      service_type: "oil_change",
      service_date: row.serviceDate,
      odometer: row.serviceOdometer,
      interval_km: row.selectedInterval,
      vehicle_type_snapshot: row.vehicleType,
      notes: `Imported from oil change data.xlsx row ${row.sourceRowNumber}`
    };
    const duplicate = await appData.supabase
      .from("vehicle_service_logs")
      .select("id")
      .eq("vehicle_reg", payload.vehicle_reg)
      .eq("service_type", payload.service_type)
      .eq("service_date", payload.service_date)
      .eq("odometer", payload.odometer)
      .limit(1);

    if (duplicate.error) throw duplicate.error;
    if ((duplicate.data ?? []).length) {
      skipped.push({ row: row.sourceRowNumber, reason: "Duplicate found during apply" });
      continue;
    }

    const result = await appData.supabase.from("vehicle_service_logs").insert(payload).select().single();
    if (result.error) throw result.error;
    inserted.push(result.data);

    const baselineKey = normalizeVehicleReg(row.appVehicleReg);
    const currentBaseline = baselines.get(baselineKey);
    if (!currentBaseline || row.serviceDate > currentBaseline.serviceDate) {
      baselines.set(baselineKey, { row, vehicle });
    }
  }

  const updatedBaselines = [];
  for (const { row, vehicle } of baselines.values()) {
    const updated = await appData.supabase
      .from("vehicles")
      .update({
        last_oil_change_date: row.serviceDate,
        last_oil_change_odometer: row.serviceOdometer,
        oil_change_interval_km: row.selectedInterval,
        vehicle_type: row.vehicleType
      })
      .eq("id", vehicle.id)
      .select()
      .single();
    if (updated.error) throw updated.error;
    updatedBaselines.push(updated.data);
  }

  return { inserted, skipped, updatedBaselines };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const workbookPath = process.argv.includes("--file")
    ? process.argv[process.argv.indexOf("--file") + 1]
    : WORKBOOK_PATH;
  const parsed = parseWorkbook(workbookPath);
  const appData = await loadAppData();
  const preview = buildPreview(parsed.parsedRows, appData);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? "apply" : "preview",
    workbook: parsed.workbook,
    databaseErrors: Object.fromEntries(
      Object.entries(appData.errors).map(([key, error]) => [
        key,
        error ? { code: error.code, message: error.message, details: error.details, hint: error.hint } : null
      ])
    ),
    preview,
    applyResult: null
  };

  if (apply) {
    if (!args.has("--confirm-reviewed-preview")) {
      throw new Error("Refusing to import without --confirm-reviewed-preview. Review the preview report first.");
    }
    report.applyResult = await applyImport(preview, appData);
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(DEFAULT_OUTPUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    reportPath: DEFAULT_OUTPUT,
    mode: report.mode,
    summary: preview.summary,
    databaseErrors: report.databaseErrors
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
