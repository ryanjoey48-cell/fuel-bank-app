import type { Driver, WeeklyMileageEntry } from "@/types/database";

export type ExtractedMileageRow = {
  week_ending?: string | null;
  driver_name?: string | null;
  vehicle_reg?: string | null;
  odometer_reading?: string | number | null;
  source_image_name?: string | null;
  source_index?: number | null;
  notes?: string[] | null;
};

export type DuplicateResolution = "skip" | "replace" | "keep-both";
export type MileageRowStatus = "valid" | "warning" | "error" | "ignored";

export type MileagePreviewRow = {
  id: string;
  week_ending: string;
  driver_name: string;
  driver_id: string;
  vehicle_reg: string;
  odometer_reading: string;
  source_image_name: string;
  source_index: number;
  ignored: boolean;
  matched_driver: boolean;
  duplicate_key: string;
  duplicate_entry_id: string | null;
  duplicate_with_existing: boolean;
  duplicate_with_upload: boolean;
  duplicate_resolution: DuplicateResolution;
  issues: string[];
  status: MileageRowStatus;
};

const MIN_ODOMETER = 1000;
const MAX_ODOMETER = 5000000;
const HIGH_WEEKLY_JUMP_KM = 2000;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeName(value: string) {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizeVehicleReg(value: string) {
  const compact = normalizeWhitespace(value).toUpperCase();
  const cleaned = compact.replace(/[^A-Z0-9-]/g, "");
  const collapsed = cleaned.replace(/-+/g, "-").replace(/^-|-$/g, "");
  const regDigits = collapsed.replace(/[^0-9]/g, "");

  if (!collapsed) return "";
  if (collapsed.includes("-")) return collapsed;
  if (regDigits.length === 6) return `${regDigits.slice(0, 2)}-${regDigits.slice(2)}`;
  if (regDigits.length === 5) return `${regDigits.slice(0, 1)}-${regDigits.slice(1)}`;
  return collapsed;
}

function parseDateToken(token: string) {
  const trimmed = token.trim();
  if (!trimmed) return "";

  const isoMatch = trimmed.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const altMatch = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (altMatch) {
    const [, first, second, yearRaw] = altMatch;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    const day = Number(first) > 12 ? first : second;
    const month = Number(first) > 12 ? second : first;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return "";
}

function normalizeOdometerInput(value: string | number | null | undefined) {
  const raw = typeof value === "number" ? String(value) : String(value ?? "");
  const trimmed = normalizeWhitespace(raw);
  const hadLetters = /[A-Za-z]/.test(trimmed);
  const corrected = trimmed
    .replace(/[oOqQD]/g, "0")
    .replace(/[iIlL|]/g, "1")
    .replace(/[sS]/g, "5")
    .replace(/[bB]/g, "8")
    .replace(/[gG]/g, "9")
    .replace(/[^0-9]/g, "");

  const sanitized = corrected.replace(/^0+(\d)/, "$1");

  const numeric = sanitized ? Number(sanitized) : null;
  return {
    raw: trimmed,
    corrected: sanitized,
    numeric: numeric != null && Number.isFinite(numeric) ? numeric : null,
    hadLetters
  };
}

function isLikelyVehicleReg(value: string) {
  if (!value) return false;
  return /^[A-Z0-9]{1,3}-[A-Z0-9]{2,5}$/.test(value) || /^\d{1,2}-\d{3,5}$/.test(value);
}

function buildDuplicateKey(weekEnding: string, vehicleReg: string) {
  return weekEnding && vehicleReg ? `${weekEnding}::${normalizeVehicleReg(vehicleReg)}` : "";
}

export function parseExtractedData(rows: ExtractedMileageRow[]): MileagePreviewRow[] {
  return rows.map((row, index) => {
    const odometer = normalizeOdometerInput(row.odometer_reading);
    const weekEnding = parseDateToken(String(row.week_ending ?? ""));
    const vehicleReg = normalizeVehicleReg(String(row.vehicle_reg ?? ""));

    return {
      id: crypto.randomUUID(),
      week_ending: weekEnding,
      driver_name: normalizeWhitespace(String(row.driver_name ?? "")),
      driver_id: "",
      vehicle_reg: vehicleReg,
      odometer_reading: odometer.corrected || odometer.raw,
      source_image_name: normalizeWhitespace(String(row.source_image_name ?? "")) || `Image ${index + 1}`,
      source_index: Number(row.source_index ?? index),
      ignored: false,
      matched_driver: false,
      duplicate_key: buildDuplicateKey(weekEnding, vehicleReg),
      duplicate_entry_id: null,
      duplicate_with_existing: false,
      duplicate_with_upload: false,
      duplicate_resolution: "skip" as DuplicateResolution,
      issues: (row.notes ?? []).filter(Boolean),
      status: "valid" as MileageRowStatus
    };
  });
}

export function matchDrivers(rows: MileagePreviewRow[], drivers: Driver[]): MileagePreviewRow[] {
  const exactNameMap = new Map<string, Driver[]>();
  const vehicleMap = new Map<string, Driver[]>();

  for (const driver of drivers) {
    const nameKey = normalizeName(driver.name);
    const vehicleKey = normalizeVehicleReg(driver.vehicle_reg);

    if (nameKey) {
      exactNameMap.set(nameKey, [...(exactNameMap.get(nameKey) ?? []), driver]);
    }
    if (vehicleKey) {
      vehicleMap.set(vehicleKey, [...(vehicleMap.get(vehicleKey) ?? []), driver]);
    }
  }

  return rows.map((row) => {
    const nameMatches = exactNameMap.get(normalizeName(row.driver_name)) ?? [];
    const vehicleMatches = vehicleMap.get(normalizeVehicleReg(row.vehicle_reg)) ?? [];

    const matchedDriver =
      (vehicleMatches.length === 1 ? vehicleMatches[0] : null) ??
      (nameMatches.length === 1 ? nameMatches[0] : null) ??
      null;

    return {
      ...row,
      driver_id: matchedDriver?.id ?? row.driver_id,
      driver_name: matchedDriver?.name ?? row.driver_name,
      matched_driver: Boolean(matchedDriver)
    };
  });
}

export function detectDuplicates(
  rows: MileagePreviewRow[],
  existingEntries: WeeklyMileageEntry[]
): MileagePreviewRow[] {
  const existingByKey = new Map<string, WeeklyMileageEntry>();
  for (const entry of existingEntries) {
    const key = buildDuplicateKey(entry.week_ending, entry.vehicle_reg);
    if (key && !existingByKey.has(key)) {
      existingByKey.set(key, entry);
    }
  }

  const seenUploadKeys = new Map<string, string>();

  return rows.map((row) => {
    const duplicateKey = buildDuplicateKey(row.week_ending, row.vehicle_reg);
    const existingDuplicate = duplicateKey ? existingByKey.get(duplicateKey) ?? null : null;
    const uploadDuplicate = duplicateKey ? seenUploadKeys.has(duplicateKey) : false;

    if (duplicateKey && !seenUploadKeys.has(duplicateKey)) {
      seenUploadKeys.set(duplicateKey, row.id);
    }

    return {
      ...row,
      duplicate_key: duplicateKey,
      duplicate_entry_id: existingDuplicate?.id ?? null,
      duplicate_with_existing: Boolean(existingDuplicate),
      duplicate_with_upload: uploadDuplicate,
      duplicate_resolution:
        existingDuplicate || uploadDuplicate ? row.duplicate_resolution ?? "skip" : "skip"
    };
  });
}

export function validateMileageRows(
  rows: MileagePreviewRow[],
  existingEntries: WeeklyMileageEntry[]
): MileagePreviewRow[] {
  const historyByVehicle = new Map<string, WeeklyMileageEntry[]>();

  for (const entry of existingEntries) {
    const key = normalizeVehicleReg(entry.vehicle_reg);
    historyByVehicle.set(key, [...(historyByVehicle.get(key) ?? []), entry]);
  }

  return rows.map((row) => {
    if (row.ignored) {
      return { ...row, status: "ignored" as MileageRowStatus, issues: [] };
    }

    const issues = [...row.issues];
    const blockingIssues: string[] = [];
    const warnings: string[] = [];

    if (!row.week_ending) blockingIssues.push("Week ending is required.");
    if (!row.driver_id) blockingIssues.push("Driver selection is required before saving.");
    if (!row.vehicle_reg) blockingIssues.push("Vehicle reg is required.");
    if (row.vehicle_reg && !isLikelyVehicleReg(row.vehicle_reg)) {
      warnings.push("Vehicle reg format looks unusual. Check that OCR did not mix columns.");
    }

    const odometer = normalizeOdometerInput(row.odometer_reading);

    if (!odometer.corrected) {
      blockingIssues.push("Odometer reading is required.");
    } else if (odometer.numeric == null) {
      blockingIssues.push("Odometer reading must be numeric.");
    } else if (!/^\d{5,7}$/.test(String(odometer.numeric))) {
      warnings.push("Odometer should usually be a 5 to 7 digit number.");
    }

    if (odometer.hadLetters && odometer.numeric != null) {
      warnings.push("OCR corrected letters inside the odometer reading.");
    }

    if (odometer.numeric != null && odometer.numeric < MIN_ODOMETER) {
      warnings.push("Odometer looks unusually small.");
    }

    if (odometer.numeric != null && odometer.numeric > MAX_ODOMETER) {
      warnings.push("Odometer looks unusually large.");
    }

    if (row.duplicate_with_existing) {
      if (row.duplicate_resolution === "keep-both") {
        warnings.push("Keep both cannot be saved because the database prevents exact duplicate vehicle/week rows.");
      } else {
        warnings.push("Duplicate already exists for this vehicle and week.");
      }
    }

    if (row.duplicate_with_upload) {
      warnings.push("Duplicate also appears in this upload batch.");
    }

    const vehicleHistory = historyByVehicle.get(normalizeVehicleReg(row.vehicle_reg)) ?? [];
    const previousEntry = vehicleHistory
      .filter((entry) => entry.week_ending < row.week_ending)
      .sort((a, b) => new Date(b.week_ending).getTime() - new Date(a.week_ending).getTime())[0];

    if (previousEntry && odometer.numeric != null && odometer.numeric < Number(previousEntry.mileage ?? 0)) {
      blockingIssues.push("Odometer is lower than the previous saved reading for this vehicle.");
    }

    if (
      previousEntry &&
      odometer.numeric != null &&
      odometer.numeric >= Number(previousEntry.mileage ?? 0) &&
      odometer.numeric - Number(previousEntry.mileage ?? 0) > HIGH_WEEKLY_JUMP_KM
    ) {
      warnings.push("Odometer jumped by more than 2,000 km from the previous week.");
    }

    return {
      ...row,
      odometer_reading: odometer.corrected || row.odometer_reading,
      issues: [...issues, ...blockingIssues, ...warnings],
      status: blockingIssues.length > 0 ? "error" : warnings.length > 0 ? "warning" : "valid"
    };
  });
}

export function revalidateMileageRows(
  rows: MileagePreviewRow[],
  drivers: Driver[],
  existingEntries: WeeklyMileageEntry[]
): MileagePreviewRow[] {
  return validateMileageRows(detectDuplicates(matchDrivers(rows, drivers), existingEntries), existingEntries);
}

export function canSaveMileageRow(row: MileagePreviewRow) {
  if (row.ignored || row.status === "error") return false;
  if (row.duplicate_with_existing && row.duplicate_resolution === "skip") return false;
  if (row.duplicate_with_existing && row.duplicate_resolution === "keep-both") return false;
  return true;
}
