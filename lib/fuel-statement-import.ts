"use client";

import * as XLSX from "xlsx";
import { normalizeFuelLogLocation } from "@/lib/fuel-log-location";
import { normalizeFuelTypeKey, normalizePaymentMethodKey } from "@/lib/localized-values";
import { normalizeVehicleRegistration } from "@/lib/utils";
import type { Driver, FuelLogEntrySource, FuelLogWithDriver } from "@/types/database";

export type FuelStatementType = "auto" | "shell" | "bangchak" | "manual";

export type FuelStatementImportRow = {
  id: string;
  sourcePage?: number;
  date: string;
  time: string;
  vehicleReg: string;
  driverId: string;
  driverName: string;
  fuelStation: string;
  originalLocation: string;
  receiptNo: string;
  mileage: string;
  fuelType: string;
  litres: string;
  pricePerLitre: string;
  totalCost: string;
  paymentMethod: string;
  entrySource: FuelLogEntrySource;
  notes: string;
  status: "Ready" | "Needs Review" | "Invalid" | "Duplicate";
  issues: string[];
  reviewReasons: string[];
};

export type FuelStatementPageDebug = {
  page: number;
  orientation: number;
  textPreview: string;
  vehicleGroupsDetected: number;
  transactionDateLines: number;
  extractedRows: number;
  reason: string;
};

export type FuelStatementParseResult = {
  rows: FuelStatementImportRow[];
  statementType: Exclude<FuelStatementType, "auto">;
  warnings: string[];
  debugPages: FuelStatementPageDebug[];
};

type RawStatementRow = Partial<{
  date: unknown;
  time: unknown;
  vehicleReg: unknown;
  fuelStation: unknown;
  originalLocation: unknown;
  receiptNo: unknown;
  mileage: unknown;
  fuelType: unknown;
  litres: unknown;
  pricePerLitre: unknown;
  totalCost: unknown;
  paymentMethod: unknown;
  notes: unknown;
  reviewReasons: unknown;
}>;

const HEADER_ALIASES: Record<keyof RawStatementRow, string[]> = {
  date: ["date", "transaction date", "sale date", "doc date", "วันที่"],
  time: ["time", "transaction time", "เวลา"],
  vehicleReg: ["vehicle reg", "vehicle registration", "vehicle", "plate", "license plate", "ทะเบียนรถ"],
  fuelStation: ["fuel station", "station", "brand", "petrol station"],
  originalLocation: ["original location", "station location", "location", "site", "merchant", "address"],
  receiptNo: ["receipt no", "receipt number", "invoice no", "slip no", "document no", "เลขที่ใบเสร็จ"],
  mileage: ["mileage", "km", "odometer", "เลขไมล์"],
  fuelType: ["fuel type", "product", "product name", "น้ำมัน"],
  litres: ["litres", "liters", "qty", "quantity", "volume", "ลิตร"],
  pricePerLitre: ["price per litre", "price/litre", "unit price", "price", "ราคา/ลิตร"],
  totalCost: ["total cost", "amount", "total", "net amount", "บาท", "ยอดรวม"],
  paymentMethod: ["payment method", "payment", "card type"],
  notes: ["notes", "remark", "remarks", "description"],
  reviewReasons: []
};

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toNumberText(value: unknown) {
  const text = cleanText(value).replace(/,/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? match[0] : "";
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9ก-๙]+/g, " ").trim();
}

function getHeaderKey(header: string): keyof RawStatementRow | null {
  const normalized = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[keyof RawStatementRow, string[]]>) {
    if (aliases.some((alias) => normalized === normalizeHeader(alias))) {
      return field;
    }
  }
  return null;
}

function parseExcelDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 20000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }

  const text = cleanText(value);
  if (!text) return "";

  const iso = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const local = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (local) {
    const year = local[3].length === 2 ? `20${local[3]}` : local[3];
    return `${year}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
  }

  return "";
}

function detectStatementType(text: string, requested: FuelStatementType): Exclude<FuelStatementType, "auto"> {
  if (requested !== "auto") return requested;
  const lower = text.toLowerCase();
  if (lower.includes("bangchak") || lower.includes("บางจาก")) return "bangchak";
  if (lower.includes("shell")) return "shell";
  return "manual";
}

export function getStatementStation(location: string, statementType: Exclude<FuelStatementType, "auto">) {
  const lower = location.toLowerCase();
  if (lower.includes("shell")) return "Shell";
  if (lower.includes("bangchak") || location.includes("บางจาก")) return "Bangchak";
  if (statementType === "shell") return "Shell";
  if (statementType === "bangchak") return "Bangchak";
  return normalizeFuelLogLocation(location) || "";
}

function buildDriverLookup(drivers: Driver[]) {
  return new Map(
    drivers
      .map((driver) => [normalizeVehicleRegistration(driver.vehicle_reg), driver] as const)
      .filter(([vehicleReg]) => Boolean(vehicleReg))
  );
}

export function getImportDuplicateKey(row: Pick<FuelStatementImportRow, "date" | "vehicleReg" | "receiptNo" | "litres" | "totalCost">) {
  return [
    row.date,
    normalizeVehicleRegistration(row.vehicleReg),
    cleanText(row.receiptNo).toLowerCase(),
    Number(toNumberText(row.litres) || 0).toFixed(2),
    Number(toNumberText(row.totalCost) || 0).toFixed(2)
  ].join("::");
}

export function getExistingFuelLogDuplicateKeys(logs: FuelLogWithDriver[]) {
  const keys = new Set<string>();
  for (const log of logs) {
    const receiptNo = extractReceiptNo(log.notes ?? "");
    if (!receiptNo) continue;
    keys.add(
      getImportDuplicateKey({
        date: log.date,
        vehicleReg: log.vehicle_reg,
        receiptNo,
        litres: String(log.litres ?? ""),
        totalCost: String(log.total_cost ?? "")
      })
    );
  }
  return keys;
}

export function extractReceiptNo(notes: string) {
  return notes.match(/Receipt No:\s*([^|\n]+)/i)?.[1]?.trim() ?? "";
}

export function validateImportRow(row: FuelStatementImportRow, duplicateKeys: Set<string>) {
  const issues: string[] = [];
  if (!row.date) issues.push("Date required");
  if (!row.vehicleReg.trim()) issues.push("Vehicle Reg required");
  if (!toNumberText(row.litres) || Number(toNumberText(row.litres)) <= 0) issues.push("Litres required");
  if (!toNumberText(row.totalCost) || Number(toNumberText(row.totalCost)) <= 0) issues.push("Total Cost required");
  const reviewReasons = Array.from(new Set([
    ...row.reviewReasons,
    !row.driverId ? "Driver not matched" : "",
    !row.receiptNo ? "Receipt No missing" : "",
    !row.mileage ? "Mileage missing" : "",
    !row.pricePerLitre ? "Price per litre missing" : ""
  ].filter(Boolean)));

  const duplicate = row.date && row.vehicleReg && row.receiptNo && duplicateKeys.has(getImportDuplicateKey(row));
  if (duplicate) issues.push("Duplicate");

  return {
    ...row,
    issues,
    reviewReasons,
    status: issues.includes("Duplicate")
      ? "Duplicate"
      : issues.length
        ? "Invalid"
        : reviewReasons.length
          ? "Needs Review"
          : "Ready"
  } satisfies FuelStatementImportRow;
}

function normalizeRawRow(
  raw: RawStatementRow,
  drivers: Driver[],
  statementType: Exclude<FuelStatementType, "auto">,
  duplicateKeys: Set<string>,
  sourcePage?: number
) {
  const driverLookup = buildDriverLookup(drivers);
  const originalLocation = cleanText(raw.originalLocation ?? raw.fuelStation);
  const vehicleReg = normalizeVehicleRegistration(cleanText(raw.vehicleReg));
  const matchedDriver = driverLookup.get(vehicleReg);
  const fuelTypeText = cleanText(raw.fuelType);
  const productCode = fuelTypeText.match(/\b(22|23|30)\b/)?.[1] ?? "";
  const defaultFuelType =
    productCode === "22"
      ? "gasohol_91"
      : productCode === "23" || /gasohol|petrol/i.test(fuelTypeText)
        ? "gasohol_95"
        : "diesel";
  const litres = toNumberText(raw.litres);
  const totalCost = toNumberText(raw.totalCost);
  const pricePerLitre = toNumberText(raw.pricePerLitre) || (litres && totalCost ? String(Number(totalCost) / Number(litres)) : "");
  const station = getStatementStation(originalLocation || cleanText(raw.fuelStation), statementType);
  const notes = [
    originalLocation ? `Original statement location: ${originalLocation}` : "",
    cleanText(raw.receiptNo) ? `Receipt No: ${cleanText(raw.receiptNo)}` : "",
    "Statement import",
    cleanText(raw.notes)
  ].filter(Boolean).join(" | ");
  const reviewReasons = Array.isArray(raw.reviewReasons)
    ? raw.reviewReasons.map(cleanText).filter(Boolean)
    : cleanText(raw.reviewReasons)
      ? [cleanText(raw.reviewReasons)]
      : [];
  if (fuelTypeText && !productCode && !normalizeFuelTypeKey(fuelTypeText)) {
    reviewReasons.push("Fuel type defaulted to Diesel");
  }

  return validateImportRow(
    {
      id: crypto.randomUUID(),
      sourcePage,
      date: parseExcelDate(raw.date),
      time: cleanText(raw.time),
      vehicleReg,
      driverId: matchedDriver ? String(matchedDriver.id) : "",
      driverName: matchedDriver?.name ?? "",
      fuelStation: station,
      originalLocation,
      receiptNo: cleanText(raw.receiptNo),
      mileage: toNumberText(raw.mileage),
      fuelType: normalizeFuelTypeKey(fuelTypeText) ?? defaultFuelType,
      litres,
      pricePerLitre: pricePerLitre ? Number(pricePerLitre).toFixed(2) : "",
      totalCost,
      paymentMethod: normalizePaymentMethodKey(cleanText(raw.paymentMethod)) ?? "company_card",
      entrySource: "statement_import",
      notes,
      status: "Ready",
      issues: [],
      reviewReasons
    },
    duplicateKeys
  );
}

function rowsFromWorksheet(sheet: XLSX.WorkSheet) {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  const headerIndex = matrix.findIndex((row) => row.some((cell) => getHeaderKey(cleanText(cell))));
  if (headerIndex < 0) return [];

  const headers = matrix[headerIndex].map((cell) => cleanText(cell));
  return matrix.slice(headerIndex + 1).map((cells) => {
    const raw: RawStatementRow = {};
    headers.forEach((header, index) => {
      const key = getHeaderKey(header);
      if (key) raw[key] = cells[index];
    });
    return raw;
  }).filter((row) => Object.values(row).some((value) => cleanText(value)));
}

function parseDelimitedFile(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  return workbook.SheetNames.flatMap((sheetName) => rowsFromWorksheet(workbook.Sheets[sheetName]));
}

const VEHICLE_REG_PATTERN = /\b\d{2}\s*[-–—]\s*\d{2,4}\b/g;
const TRANSACTION_DATE_PATTERN = /\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/g;
const NUMBER_TOKEN_PATTERN = /\b\d{1,3}(?:,\d{3})+(?:\.\d{1,3})?\b|\b\d+(?:\.\d{1,3})\b|\b\d+\b/g;

type ParsedStatementText = {
  rows: RawStatementRow[];
  vehicleGroupsDetected: number;
  transactionDateLines: number;
  currentVehicleReg: string;
  reason: string;
};

function normalizeOcrText(text: string) {
  return text
    .replace(/[|¦]/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeStatementVehicleReg(value: string) {
  const match = value.match(/\b(\d{2})\s*[-–—]\s*(\d{2,4})\b/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function extractVehicleGroupRegistration(line: string) {
  const looksLikeCardHeader =
    /\d{6,}\s*\*{3,}\s*\d{3,}/.test(line) ||
    /\b(?:HINO|TOYOTA|ISUZU|MITSUBISHI|FUSO)\b/i.test(line);
  if (!looksLikeCardHeader) return "";

  const exactRegistration = normalizeStatementVehicleReg(line);
  if (exactRegistration) return exactRegistration;

  const compactShortRegistration = line.match(/\b[A-Z]{1,4}\s*[-–—]\s*(\d{4})\b/i)?.[1];
  return compactShortRegistration
    ? `${compactShortRegistration.slice(0, 2)}-${compactShortRegistration.slice(2)}`
    : "";
}

function getNumericTokens(text: string) {
  return Array.from(text.matchAll(NUMBER_TOKEN_PATTERN)).map((match) => ({
    raw: match[0],
    value: Number(match[0].replace(/,/g, "")),
    index: match.index ?? 0,
    decimal: match[0].includes(".") || match[0].includes(",")
  })).filter((token) => Number.isFinite(token.value));
}

function interpretPriceToken<T extends ReturnType<typeof getNumericTokens>[number]>(token: T) {
  if (token.value >= 20 && token.value <= 60) return token;
  if (token.decimal || !/^\d{4,5}$/.test(token.raw)) return null;

  const divisor = token.raw.length === 5 ? 1000 : 100;
  const recoveredValue = token.value / divisor;
  return recoveredValue >= 20 && recoveredValue <= 60
    ? { ...token, raw: recoveredValue.toFixed(token.raw.length === 5 ? 3 : 2), value: recoveredValue, recovered: true }
    : null;
}

function extractStatementLocation(block: string) {
  const lines = block.split("\n").map(cleanText).filter(Boolean);
  const locationLine = lines.find((line) => /\b(?:SHELL|BANGCHAK)\b|บางจาก/i.test(line));
  if (!locationLine) return "";

  const marker = locationLine.search(/\b(?:SHELL|BANGCHAK)\b|บางจาก/i);
  const candidate = locationLine.slice(Math.max(marker, 0));
  return candidate
    .replace(/\s+\d{5,6}\s+\d{1,7}\s+(?:22|23|30)\b.*$/i, "")
    .replace(/\s+(?:22|23|30)\s+\d.*$/i, "")
    .trim();
}

function extractTransactionBlock(block: string, vehicleReg: string): RawStatementRow | null {
  const normalized = normalizeOcrText(block);
  const date = normalized.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/)?.[0] ?? "";
  if (!date) return null;

  const time = normalized.match(/\b(?:[01]?\d|2[0-3])[:.]\d{2}(?::\d{2})?\b/)?.[0]?.replace(".", ":") ?? "";
  const productMatch = Array.from(normalized.matchAll(/\b(22|23|30)\b/g)).at(-1);
  const productCode = productMatch?.[1] ?? "";
  const productIndex = productMatch?.index ?? -1;
  const tokens = getNumericTokens(normalized);
  const transactionTail = productIndex >= 0 ? tokens.filter((token) => token.index > productIndex) : tokens;

  const grossCandidates = transactionTail.filter((token) => token.decimal && token.value >= 100);
  const grossToken = grossCandidates.at(-1) ?? transactionTail.filter((token) => token.value >= 100).at(-1);
  const priceCandidates = transactionTail
    .filter((token) => token !== grossToken && (!grossToken || token.index < grossToken.index))
    .map(interpretPriceToken)
    .filter((token): token is NonNullable<typeof token> => Boolean(token));
  const priceToken = priceCandidates.at(-1);
  const litreCandidates = transactionTail.filter((token) =>
    token !== grossToken &&
    token.index !== priceToken?.index &&
    token.value > 0 &&
    token.value < 1000 &&
    (!priceToken || token.index < priceToken.index)
  );
  let litreToken = litreCandidates.at(-1);
  let litresInferred = false;

  if (!litreToken && grossToken && priceToken && priceToken.value > 0) {
    const calculatedLitres = grossToken.value / priceToken.value;
    if (calculatedLitres > 0 && calculatedLitres < 1000) {
      litreToken = { raw: calculatedLitres.toFixed(3), value: calculatedLitres, index: priceToken.index - 1, decimal: true };
      litresInferred = true;
    }
  }

  const prefixEnd = productIndex >= 0 ? productIndex : (priceToken?.index ?? grossToken?.index ?? normalized.length);
  const prefix = normalized.slice(0, prefixEnd)
    .replace(date, " ")
    .replace(time, " ")
    .replace(VEHICLE_REG_PATTERN, " ");
  const prefixIntegers = getNumericTokens(prefix).filter((token) =>
    !token.decimal &&
    token.value >= 0 &&
    token.value < 10_000_000 &&
    ![22, 23, 30, 2024, 2025, 2026, 2027].includes(token.value)
  );
  const receiptCandidates = prefixIntegers.filter((token) => /^\d{5,6}$/.test(token.raw));
  const lastPrefixToken = prefixIntegers.at(-1);
  const previousPrefixToken = prefixIntegers.at(-2);
  const receiptToken =
    previousPrefixToken && /^\d{5,6}$/.test(previousPrefixToken.raw)
      ? previousPrefixToken
      : receiptCandidates.at(-1);
  const mileageToken =
    lastPrefixToken && lastPrefixToken !== receiptToken && lastPrefixToken.index > (receiptToken?.index ?? -1)
      ? lastPrefixToken
      : undefined;
  const location = extractStatementLocation(normalized);
  const reviewReasons = [
    !receiptToken ? "Receipt No missing" : "",
    !mileageToken ? "Mileage missing" : "",
    !priceToken ? "Price per litre missing" : "",
    priceToken && "recovered" in priceToken ? "Price per litre decimal recovered from OCR" : "",
    litresInferred ? "Litres inferred from gross amount and price" : "",
    !productCode ? "Product code missing; fuel type defaulted to Diesel" : "",
    !location ? "Station location missing" : ""
  ].filter(Boolean);

  return {
    date,
    time,
    vehicleReg,
    fuelStation: location,
    originalLocation: location,
    receiptNo: receiptToken?.raw ?? "",
    mileage: mileageToken?.raw ?? "",
    fuelType: productCode || "30",
    litres: litreToken?.raw ?? "",
    pricePerLitre: priceToken?.raw ?? "",
    totalCost: grossToken?.raw ?? "",
    paymentMethod: "company_card",
    notes: `OCR transaction: ${normalized.slice(0, 500)}`,
    reviewReasons
  };
}

function parseRowsFromText(text: string, initialVehicleReg = ""): ParsedStatementText {
  const normalized = normalizeOcrText(text);
  const transactionSeparatedText = normalized.replace(
    /(\S)\s+(?=\d{1,2}[/-]\d{1,2}[/-]\d{4}\b)/g,
    "$1\n",
  );
  const lines = transactionSeparatedText.split("\n").map(cleanText).filter(Boolean);
  const rows: RawStatementRow[] = [];
  const vehicleGroups = new Set<string>();
  let currentVehicleReg = initialVehicleReg;
  let currentBlock: string[] = [];
  let currentBlockVehicle = currentVehicleReg;
  let transactionDateLines = 0;

  const flushBlock = () => {
    if (!currentBlock.length) return;
    const row = extractTransactionBlock(currentBlock.join("\n"), currentBlockVehicle);
    if (row) rows.push(row);
    currentBlock = [];
  };

  for (const line of lines) {
    const vehicleMatches = Array.from(line.matchAll(VEHICLE_REG_PATTERN));
    const dateMatches = Array.from(line.matchAll(TRANSACTION_DATE_PATTERN));
    const groupVehicle = extractVehicleGroupRegistration(line);
    if (dateMatches.length) transactionDateLines += dateMatches.length;

    if (groupVehicle && !dateMatches.length) {
      flushBlock();
      currentVehicleReg = groupVehicle;
      currentBlockVehicle = groupVehicle;
      vehicleGroups.add(groupVehicle);
      continue;
    }

    if (dateMatches.length) {
      flushBlock();
      const inlineVehicle = normalizeStatementVehicleReg(vehicleMatches.at(-1)?.[0] ?? "");
      currentBlockVehicle = inlineVehicle || currentVehicleReg;
      if (inlineVehicle) vehicleGroups.add(inlineVehicle);
      currentBlock = [line];
      continue;
    }

    if (currentBlock.length) {
      currentBlock.push(line);
    }
  }
  flushBlock();

  return {
    rows,
    vehicleGroupsDetected: vehicleGroups.size,
    transactionDateLines,
    currentVehicleReg,
    reason: rows.length
      ? `Extracted ${rows.length} transaction rows.`
      : transactionDateLines
        ? `Found ${transactionDateLines} transaction date lines but required numeric fields could not be separated.`
        : vehicleGroups.size
          ? "Vehicle groups were found, but no DD/MM/YYYY transaction lines were detected."
          : "No vehicle group or DD/MM/YYYY transaction pattern was detected."
  };
}

function getOrientationScore(text: string, parsed: ParsedStatementText) {
  const normalized = normalizeOcrText(text);
  const shellMatches = (normalized.match(/\bSHELL\b/gi) ?? []).length;
  const bangchakMatches = (normalized.match(/\bBANGCHAK\b|บางจาก/gi) ?? []).length;
  const detailMatches = (normalized.match(/CARD\s+TRANSACTION\s+DETAILS/gi) ?? []).length;
  return (
    parsed.rows.length * 100 +
    parsed.vehicleGroupsDetected * 15 +
    parsed.transactionDateLines * 8 +
    shellMatches * 3 +
    bangchakMatches * 3 +
    detailMatches * 10
  );
}

async function renderPageToCanvas(page: any, rotation = 0) {
  const viewport = page.getViewport({ scale: 2, rotation });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to prepare PDF page for OCR.");
  await page.render({ canvasContext: context, canvas, viewport }).promise;
  return canvas;
}

async function parsePdfRowsWithOcr(
  buffer: ArrayBuffer,
  onProgress?: (message: string) => void
) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  const tesseract = await import("tesseract.js");
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await task.promise;
  const rawRows: Array<RawStatementRow & { sourcePage?: number }> = [];
  const pageTexts: string[] = [];
  const warnings: string[] = [];
  const debugPages: FuelStatementPageDebug[] = [];
  let currentVehicleReg = "";

  const recognizePage = async (page: any, pageNumber: number, rotation: number) => {
    onProgress?.(
      rotation
        ? `Processing page ${pageNumber} of ${pdf.numPages} at ${rotation} degrees`
        : `Processing page ${pageNumber} of ${pdf.numPages} with OCR`
    );
    const canvas = await renderPageToCanvas(page, rotation);
    const ocrResult = await tesseract.recognize(canvas, "eng", {
      logger: (message) => {
        if (message.status === "recognizing text" && typeof message.progress === "number") {
          onProgress?.(
            `Processing page ${pageNumber} of ${pdf.numPages}${rotation ? ` at ${rotation} degrees` : ""} OCR ${Math.round(message.progress * 100)}%`
          );
        }
      }
    });
    const text = ocrResult.data.text;
    const parsed = parseRowsFromText(text, currentVehicleReg);
    return { rotation, text, parsed, score: getOrientationScore(text, parsed) };
  };

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.(`Processing page ${pageNumber} of ${pdf.numPages}`);
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const embeddedText = textContent.items
      .map((item: unknown) => (typeof item === "object" && item && "str" in item ? String((item as { str?: unknown }).str ?? "") : ""))
      .filter(Boolean)
      .join("\n");
    const embeddedParsed = parseRowsFromText(embeddedText, currentVehicleReg);
    const candidates = [{
      rotation: 0,
      text: embeddedText,
      parsed: embeddedParsed,
      score: getOrientationScore(embeddedText, embeddedParsed)
    }];

    try {
      candidates.push(await recognizePage(page, pageNumber, 0));
      const bestAtZero = [...candidates].sort((left, right) => right.score - left.score)[0];
      if (!bestAtZero.parsed.rows.length) {
        for (const rotation of [90, 180, 270]) {
          candidates.push(await recognizePage(page, pageNumber, rotation));
        }
      }
    } catch (error) {
      warnings.push(`Page ${pageNumber} OCR failed: ${error instanceof Error ? error.message : "Unable to read scanned page."}`);
    }

    const best = candidates.sort((left, right) => right.score - left.score)[0];
    currentVehicleReg = best.parsed.currentVehicleReg || currentVehicleReg;
    pageTexts.push(best.text);
    rawRows.push(...best.parsed.rows.map((row) => ({ ...row, sourcePage: pageNumber })));
    debugPages.push({
      page: pageNumber,
      orientation: best.rotation,
      textPreview: normalizeOcrText(best.text).slice(0, 2500),
      vehicleGroupsDetected: best.parsed.vehicleGroupsDetected,
      transactionDateLines: best.parsed.transactionDateLines,
      extractedRows: best.parsed.rows.length,
      reason: best.parsed.reason
    });
    console.groupCollapsed(`Fuel statement OCR page ${pageNumber}`);
    console.log({
      orientation: best.rotation,
      vehicleGroupsDetected: best.parsed.vehicleGroupsDetected,
      transactionDateLines: best.parsed.transactionDateLines,
      extractedRows: best.parsed.rows.length,
      reason: best.parsed.reason,
      textPreview: normalizeOcrText(best.text).slice(0, 2500)
    });
    console.groupEnd();

    if (!best.parsed.rows.length) {
      warnings.push(`Page ${pageNumber}: ${best.parsed.reason}`);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  return { rawRows, textForDetection: pageTexts.join(" ").slice(0, 5000), warnings, debugPages };
}

export async function parseFuelStatementFile({
  file,
  statementType,
  drivers,
  existingLogs,
  onProgress
}: {
  file: File;
  statementType: FuelStatementType;
  drivers: Driver[];
  existingLogs: FuelLogWithDriver[];
  onProgress?: (message: string) => void;
}): Promise<FuelStatementParseResult> {
  const buffer = await file.arrayBuffer();
  const duplicateKeys = getExistingFuelLogDuplicateKeys(existingLogs);
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const warnings: string[] = [];
  let debugPages: FuelStatementPageDebug[] = [];
  let rawRows: Array<RawStatementRow & { sourcePage?: number }> = [];
  let textForDetection = file.name;

  if (extension === "pdf" || file.type === "application/pdf") {
    try {
      const pdfResult = await parsePdfRowsWithOcr(buffer, onProgress);
      rawRows = pdfResult.rawRows;
      warnings.push(...pdfResult.warnings);
      debugPages = pdfResult.debugPages;
      textForDetection += ` ${pdfResult.textForDetection}`;
    } catch (error) {
      console.error("Fuel statement PDF extraction failed:", error);
      throw new Error(
        `Unable to process PDF "${file.name}". Check that the file is a valid, unlocked PDF and try again.`
      );
    }
  } else if (extension === "xlsx" || extension === "csv" || file.type.includes("spreadsheet") || file.type.includes("csv")) {
    onProgress?.("Reading statement file");
    rawRows = parseDelimitedFile(buffer);
    textForDetection += ` ${JSON.stringify(rawRows.slice(0, 10))}`;
  } else {
    throw new Error("Unsupported file type. Upload PDF, XLSX, or CSV.");
  }

  const detectedType = detectStatementType(textForDetection, statementType);
  const rows = rawRows.map((row) => normalizeRawRow(row, drivers, detectedType, duplicateKeys, row.sourcePage));

  if (!rows.length) {
    warnings.push("No transactions were detected. Review the statement format or use the Excel/CSV template.");
  }

  return { rows, statementType: detectedType, warnings, debugPages };
}
