import * as XLSX from "xlsx";
import { FINANCIAL_COLUMNS, type SourceRow } from "@/lib/vehicle-financial-draft";

export const MAX_FINANCIAL_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_XLSX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
export const MAX_XLSX_ENTRIES = 512;
export const MAX_WORKSHEETS = 20;
export const MAX_WORKSHEET_ROWS = 5_000;
export const MAX_WORKSHEET_COLUMNS = 100;
export const MAX_WORKSHEET_CELLS = 50_000;
export const MAX_TOTAL_WORKSHEET_ROWS = 10_000;
export const MAX_TOTAL_WORKSHEET_CELLS = 150_000;

export class FinancialWorkbookError extends Error {
  constructor(readonly code: string) { super(code); this.name = "FinancialWorkbookError"; }
}

const headerAliases: Record<string, string[]> = {
  registration: ["Vehicle Registration", "Registration", "Vehicle", "ทะเบียนรถ", "ทะเบียน"],
  salary: ["Salary", "เงินเดือน"], jobs: ["Jobs", "Jobs Completed", "จำนวนงาน"],
  tripPayments: ["Trip Payments", "Trip Payment", "ค่าเที่ยว"],
  expenses: ["Expenses", "Expense", "ค่าใช้จ่าย"],
  parking: ["Parking Fees", "Parking", "ค่าจอดรถ"],
  totalReceived: ["Total Received", "รวมรับ"], fuel: ["Fuel", "น้ำมัน"],
  lpg: ["LPG", "แก๊ส"], maintenance: ["Maintenance", "ค่าซ่อมบำรุง"]
};
const key = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

function zipDirectory(bytes: Uint8Array) {
  if (bytes.length < 22) throw new FinancialWorkbookError("malformed_xlsx");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstEocd = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= firstEocd; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new FinancialWorkbookError("malformed_xlsx");
  const disk = view.getUint16(eocd + 4, true);
  const directoryDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);
  if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entries || entries === 0xffff ||
      directorySize === 0xffffffff || directoryOffset === 0xffffffff || eocd + 22 + commentLength !== bytes.length ||
      directoryOffset + directorySize > eocd || entries > MAX_XLSX_ENTRIES) {
    throw new FinancialWorkbookError("xlsx_archive_limits");
  }
  let offset = directoryOffset;
  let uncompressedTotal = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > directoryOffset + directorySize || view.getUint32(offset, true) !== 0x02014b50) {
      throw new FinancialWorkbookError("malformed_xlsx");
    }
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const fileCommentLength = view.getUint16(offset + 32, true);
    const recordLength = 46 + nameLength + extraLength + fileCommentLength;
    if (offset + recordLength > directoryOffset + directorySize || (flags & 0x0001) !== 0 ||
        (compression !== 0 && compression !== 8) || uncompressed === 0xffffffff || compressed === 0xffffffff) {
      throw new FinancialWorkbookError("xlsx_archive_limits");
    }
    const name = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name.startsWith("/") || name.split(/[\\/]/).includes("..")) throw new FinancialWorkbookError("malformed_xlsx");
    if (uncompressed > MAX_XLSX_UNCOMPRESSED_BYTES || (compressed === 0 ? uncompressed > 0 : uncompressed / compressed > 100)) {
      throw new FinancialWorkbookError("xlsx_archive_limits");
    }
    uncompressedTotal += uncompressed;
    if (uncompressedTotal > MAX_XLSX_UNCOMPRESSED_BYTES) throw new FinancialWorkbookError("xlsx_archive_limits");
    offset += recordLength;
  }
  if (offset !== directoryOffset + directorySize) throw new FinancialWorkbookError("malformed_xlsx");
}

export function validateFinancialFileSignature(bytes: Uint8Array, format: "xlsx" | "csv") {
  if (bytes.length < 1 || bytes.length > MAX_FINANCIAL_FILE_BYTES) throw new FinancialWorkbookError("file_size_limit");
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(bytes[2]) && [0x04, 0x06, 0x08].includes(bytes[3]);
  if (format === "xlsx") {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) throw new FinancialWorkbookError("xlsx_signature_mismatch");
    zipDirectory(bytes);
  } else if (isZip || bytes.includes(0)) {
    throw new FinancialWorkbookError("csv_signature_mismatch");
  }
}

function readFinancialWorkbook(bytes: Uint8Array) {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    validateFinancialFileSignature(bytes, "xlsx");
    try { return XLSX.read(bytes, { type: "array", cellDates: false, cellNF: true, raw: true, WTF: true }); }
    catch { throw new FinancialWorkbookError("malformed_xlsx"); }
  }
  validateFinancialFileSignature(bytes, "csv");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch {
    try { text = new TextDecoder("windows-874", { fatal: true }).decode(bytes); }
    catch { throw new FinancialWorkbookError("unsupported_csv_encoding"); }
  }
  try { return XLSX.read(text, { type: "string", cellDates: false, raw: true, WTF: true }); }
  catch { throw new FinancialWorkbookError("malformed_csv"); }
}

export function listFinancialWorkbookSheets(bytes: Uint8Array) {
  const workbook = readFinancialWorkbook(bytes);
  if (workbook.SheetNames.length > MAX_WORKSHEETS) throw new FinancialWorkbookError("worksheet_limit");
  return workbook.SheetNames;
}

function isDateFormat(cell: XLSX.CellObject) {
  if (cell.t === "d") return true;
  if (!cell.z || cell.z === "General") return false;
  return /(^|[^\\])(?:d{1,2}|m{1,4}|y{2,4}|h{1,2}|s{1,2})(?=[^a-z]|$)/i.test(String(cell.z));
}

function isFormulaLikeText(value: unknown) {
  return typeof value === "string" && /^[\s]*[=+\-@]/.test(value.normalize("NFKC"));
}

function sourceCell(cell: XLSX.CellObject | undefined, value: unknown) {
  if (cell?.f) return { formula: cell.f, cachedValue: value ?? null };
  if (cell && isDateFormat(cell)) return { dateFormattedValue: value ?? null };
  if (isFormulaLikeText(value)) return { rejectedFormulaText: value };
  return value ?? "";
}

export function parseFinancialWorkbook(bytes: Uint8Array, selectedSheets: string[], annotations: Record<string, { employeeId?: string; lpgTreatment?: SourceRow["lpgTreatment"]; assignmentEffectiveFrom?: string; assignmentEffectiveTo?: string }> = {}) {
  const workbook = readFinancialWorkbook(bytes);
  if (workbook.SheetNames.length > MAX_WORKSHEETS) throw new FinancialWorkbookError("worksheet_limit");
  const wanted = new Set(selectedSheets);
  const issues: string[] = [];
  const rows: SourceRow[] = [];
  const controls: SourceRow[] = [];
  let totalRows = 0;
  let totalCells = 0;
  for (const sheetName of workbook.SheetNames.filter(name => wanted.has(name))) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) { issues.push("selected_sheet_missing"); continue; }
    if (Object.keys(sheet).some(address => address[0] !== "!" && sheet[address]?.f)) issues.push(`formula_cells_present:${sheetName}`);
    let data: unknown[][];
    try {
      const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"] as string) : null;
      const rowCount = range ? range.e.r - range.s.r + 1 : 0;
      const colCount = range ? range.e.c - range.s.c + 1 : 0;
      totalRows += rowCount;
      totalCells += rowCount * colCount;
      if (rowCount > MAX_WORKSHEET_ROWS || colCount > MAX_WORKSHEET_COLUMNS || rowCount * colCount > MAX_WORKSHEET_CELLS) {
        issues.push(`worksheet_limits:${sheetName}`);
        continue;
      }
      if (totalRows > MAX_TOTAL_WORKSHEET_ROWS || totalCells > MAX_TOTAL_WORKSHEET_CELLS) {
        issues.push("workbook_total_limits");
        break;
      }
      data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: false });
    } catch { throw new FinancialWorkbookError("malformed_xlsx"); }
    let headerRow = -1;
    let indexes: number[] = [];
    for (let i = 0; i < Math.min(data.length, 30); i++) {
      const candidate = FINANCIAL_COLUMNS.map(([field]) => data[i].findIndex(value => headerAliases[field]?.some(alias => key(alias) === key(value))));
      if (candidate.every(index => index >= 0) && new Set(candidate).size === candidate.length) { headerRow = i; indexes = candidate; break; }
    }
    if (headerRow < 0) { issues.push(`standard_headers_missing:${sheetName}`); continue; }
    for (let i = headerRow + 1; i < data.length; i++) {
      const rowValues = data[i];
      const cells = indexes.map(index => {
        const address = XLSX.utils.encode_cell({ r: i, c: index });
        return sourceCell(sheet[address] as XLSX.CellObject | undefined, rowValues[index]);
      });
      if (cells.every(value => String(value ?? "").trim() === "")) continue;
      if (cells.some(value => value && typeof value === "object" && ("formula" in value || "dateFormattedValue" in value || "rejectedFormulaText" in value))) {
        issues.push(`unsafe_source_cell:${sheetName}:${i + 1}`);
      }
      const registration = key(cells[0]);
      const annotation = annotations[`${sheetName}:${i + 1}`] ?? {};
      const row: SourceRow = { cells, rawCells: cells, sheet: sheetName, row: i + 1,
        employeeId: annotation.employeeId?.trim(), lpgTreatment: annotation.lpgTreatment,
        assignmentEffectiveFrom: annotation.assignmentEffectiveFrom, assignmentEffectiveTo: annotation.assignmentEffectiveTo };
      if (["total", "grand total", "รวม", "รวมทั้งหมด"].includes(registration)) controls.push(row);
      else rows.push(row);
    }
  }
  if (wanted.size === 0 || [...wanted].some(name => !workbook.SheetNames.includes(name))) issues.push("selected_sheet_missing");
  return { headers: FINANCIAL_COLUMNS.map(column => column[1]), rows, controls, issues, sheetNames: workbook.SheetNames };
}
