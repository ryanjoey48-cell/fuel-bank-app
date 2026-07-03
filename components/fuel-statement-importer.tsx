"use client";

import { AlertTriangle, FileUp, Trash2, UploadCloud, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  getExistingFuelLogDuplicateKeys,
  getImportDuplicateKey,
  parseFuelStatementFile,
  validateImportRow,
  type FuelStatementImportRow,
  type FuelStatementPageDebug,
  type FuelStatementType
} from "@/lib/fuel-statement-import";
import { useLanguage } from "@/lib/language-provider";
import { saveFuelLog } from "@/lib/data";
import { formatCurrency, formatNumber } from "@/lib/utils";
import type { Driver, FuelLogWithDriver } from "@/types/database";

type ImportSummary = {
  importedRows: number;
  skippedDuplicates: number;
  invalidRowsNotImported: number;
  rowsNeedingReview: number;
  totalLitres: number;
  totalCost: number;
};

type EditableField = keyof Pick<
  FuelStatementImportRow,
  | "date"
  | "time"
  | "vehicleReg"
  | "driverId"
  | "fuelStation"
  | "originalLocation"
  | "receiptNo"
  | "mileage"
  | "fuelType"
  | "litres"
  | "pricePerLitre"
  | "totalCost"
  | "paymentMethod"
  | "entrySource"
  | "notes"
>;

function toNumber(value: string) {
  const parsed = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getStatusClass(status: FuelStatementImportRow["status"]) {
  if (status === "Ready") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "Duplicate") return "border-slate-200 bg-slate-100 text-slate-600";
  if (status === "Invalid") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function getReviewStatusLabel(row: FuelStatementImportRow) {
  if (row.status === "Duplicate") return "Duplicate";
  if (!row.vehicleReg.trim()) return "Missing vehicle";
  if (!toNumber(row.litres) || !toNumber(row.totalCost)) return "Missing litres/cost";
  if (!row.driverId) return "Missing driver";
  if (row.status === "Ready") return "Matched";
  if (row.status === "Invalid") return "Needs Review";
  return "Needs Review";
}

function getDriverName(drivers: Driver[], driverId: string) {
  return drivers.find((driver) => String(driver.id) === String(driverId))?.name ?? "";
}

export function FuelStatementImporter({
  drivers,
  existingLogs,
  onImported
}: {
  drivers: Driver[];
  existingLogs: FuelLogWithDriver[];
  onImported: () => Promise<void> | void;
}) {
  const { language, t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [statementType, setStatementType] = useState<FuelStatementType>("auto");
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [debugPages, setDebugPages] = useState<FuelStatementPageDebug[]>([]);
  const [rows, setRows] = useState<FuelStatementImportRow[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copy = {
    importStatement: language === "th" ? "นำเข้า Statement" : "Import Statement",
    title: language === "th" ? "นำเข้า Fuel Statement" : "Fuel Statement Bulk Import",
    subtitle:
      language === "th"
        ? "อัปโหลด PDF, Excel หรือ CSV แล้วตรวจรายการก่อนบันทึก"
        : "Upload one PDF, Excel, or CSV statement, review the rows, then import to Fuel Logs.",
    type: language === "th" ? "ประเภท Statement" : "Statement type",
    auto: language === "th" ? "ตรวจจับอัตโนมัติ" : "Auto-detect",
    shell: "Shell",
    bangchak: "Bangchak",
    manual: language === "th" ? "ไม่ทราบ/แก้ไขเอง" : "Unknown/manual mapping",
    chooseFile: language === "th" ? "เลือกไฟล์" : "Choose file",
    importReady: language === "th" ? "นำเข้ารายการที่พร้อม" : "Import ready rows",
    close: language === "th" ? "ปิด" : "Close",
    preview: language === "th" ? "ตารางตัวอย่าง" : "Preview rows",
    noRows: language === "th" ? "ยังไม่มีรายการตัวอย่าง" : "No preview rows yet.",
    importedRows: language === "th" ? "รายการที่นำเข้า" : "Imported rows",
    skippedDuplicates: language === "th" ? "ข้ามรายการซ้ำ" : "Skipped duplicates",
    invalidRowsNotImported: language === "th" ? "รายการ Invalid ที่ไม่นำเข้า" : "Invalid rows not imported",
    rowsNeedingReview: language === "th" ? "ต้องตรวจสอบ" : "Rows needing review",
    totalLitres: language === "th" ? "ลิตรรวม" : "Total litres",
    totalCost: language === "th" ? "ยอดรวม" : "Total cost",
    delete: language === "th" ? "ลบ" : "Delete",
    invalidHint:
      language === "th"
        ? "แก้รายการที่ Invalid ก่อนนำเข้า รายการ Needs Review นำเข้าได้แต่ไม่มีคนขับ"
        : "Fix Invalid rows before importing. Needs Review rows can import with no driver.",
    pdfNote:
      language === "th"
        ? "PDF ทุกหน้าจะถูกประมวลผลอัตโนมัติ และหน้าแบบสแกนจะใช้ OCR"
        : "Every PDF page is processed automatically. Scanned/image pages use OCR."
  };

  const duplicateKeys = useMemo(() => getExistingFuelLogDuplicateKeys(existingLogs), [existingLogs]);
  const importableRows = rows.filter((row) => row.status !== "Invalid" && row.status !== "Duplicate");

  const revalidateRows = (nextRows: FuelStatementImportRow[]) => {
    setRows(nextRows.map((row) => validateImportRow(row, duplicateKeys)));
  };

  const updateRow = (id: string, field: EditableField, value: string) => {
    revalidateRows(
      rows.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, [field]: value };
        if (field === "driverId") {
          next.driverName = getDriverName(drivers, value);
        }
        return next;
      })
    );
  };

  const handleFile = async (file: File) => {
    setProcessing(true);
    setError(null);
    setWarnings([]);
    setDebugPages([]);
    setSummary(null);
    setProgress("");
    try {
      const result = await parseFuelStatementFile({
        file,
        statementType,
        drivers,
        existingLogs,
        onProgress: setProgress
      });
      setRows(result.rows);
      setWarnings(result.warnings);
      setDebugPages(result.debugPages);
      setStatementType(result.statementType);
      setProgress(result.rows.length ? `${result.rows.length} rows ready for review` : "");
    } catch (err) {
      setRows([]);
      setError(err instanceof Error && err.message ? err.message : "Unable to process statement.");
    } finally {
      setProcessing(false);
    }
  };

  const handleImport = async () => {
    setSaving(true);
    setError(null);
    setSummary(null);
    try {
      let importedRows = 0;
      let skippedDuplicates = rows.filter((row) => row.status === "Duplicate").length;
      const invalidRowsNotImported = rows.filter((row) => row.status === "Invalid").length;
      let rowsNeedingReview = 0;
      let totalLitres = 0;
      let totalCost = 0;
      const seenKeys = new Set<string>();

      for (const row of importableRows) {
        const duplicateKey = getImportDuplicateKey(row);
        if (seenKeys.has(duplicateKey)) {
          skippedDuplicates += 1;
          continue;
        }
        seenKeys.add(duplicateKey);
        if (row.status === "Needs Review") rowsNeedingReview += 1;
        totalLitres += toNumber(row.litres);
        totalCost += toNumber(row.totalCost);

        await saveFuelLog({
          date: row.date,
          driver_id: row.driverId || undefined,
          driver: row.driverName || "",
          vehicle_reg: row.vehicleReg,
          odometer: row.mileage ? toNumber(row.mileage) : null,
          mileage: row.mileage ? toNumber(row.mileage) : null,
          litres: toNumber(row.litres),
          total_cost: toNumber(row.totalCost),
          price_per_litre: row.pricePerLitre ? toNumber(row.pricePerLitre) : null,
          location: row.fuelStation,
          station: row.fuelStation,
          fuel_type: row.fuelType,
          payment_method: row.paymentMethod || "company_card",
          entry_source: row.entrySource,
          receipt_checked: false,
          notes: [
            row.time ? `Statement time: ${row.time}` : "",
            row.notes,
            row.sourcePage ? `Statement page: ${row.sourcePage}` : ""
          ].filter(Boolean).join(" | ")
        });
        importedRows += 1;
      }

      setSummary({ importedRows, skippedDuplicates, invalidRowsNotImported, rowsNeedingReview, totalLitres, totalCost });
      setRows(rows.filter((row) => row.status === "Invalid"));
      if (fileInputRef.current) fileInputRef.current.value = "";
      await onImported();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Unable to import statement rows.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary w-full gap-2 sm:w-auto">
        <FileUp className="h-4 w-4" />
        {copy.importStatement}
      </button>
    );
  }

  return (
    <section className="surface-card mt-5 p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="section-title">{copy.title}</h3>
          <p className="section-subtitle">{copy.subtitle}</p>
          <p className="mt-2 text-xs text-slate-500">{copy.pdfNote}</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary w-full gap-2 sm:w-auto">
          <X className="h-4 w-4" />
          {copy.close}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-12">
        <div className="md:col-span-3">
          <label className="form-label">{copy.type}</label>
          <select value={statementType} onChange={(event) => setStatementType(event.target.value as FuelStatementType)} className="form-input bg-white">
            <option value="auto">{copy.auto}</option>
            <option value="shell">{copy.shell}</option>
            <option value="bangchak">{copy.bangchak}</option>
            <option value="manual">{copy.manual}</option>
          </select>
        </div>
        <div className="md:col-span-6">
          <label className="form-label">PDF / XLSX / CSV</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.xlsx,.csv,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
            className="form-input bg-white"
          />
        </div>
        <div className="flex items-end md:col-span-3">
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={processing} className="btn-primary w-full gap-2 disabled:opacity-60">
            <UploadCloud className="h-4 w-4" />
            {processing ? progress || "Processing..." : copy.chooseFile}
          </button>
        </div>
      </div>

      {progress ? <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-800">{progress}</div> : null}
      {error ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {warnings.length ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
          </div>
        </div>
      ) : null}
      {debugPages.length ? (
        <details className="mt-4 rounded-2xl border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
            OCR and parser debug ({debugPages.length} pages)
          </summary>
          <div className="space-y-3 border-t border-slate-200 p-4">
            {debugPages.map((page) => (
              <details key={page.page} className="rounded-xl border border-slate-200 bg-slate-50">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-800">
                  Page {page.page}: {page.extractedRows} rows, {page.vehicleGroupsDetected} vehicle groups,
                  {" "}{page.transactionDateLines} date lines, {page.orientation} degrees
                </summary>
                <div className="border-t border-slate-200 p-3">
                  <p className="text-xs font-medium text-slate-700">{page.reason}</p>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
                    {page.textPreview || "No OCR text returned."}
                  </pre>
                </div>
              </details>
            ))}
          </div>
        </details>
      ) : null}

      {summary ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <SummaryTile label={copy.importedRows} value={formatNumber(summary.importedRows, language)} />
          <SummaryTile label={copy.skippedDuplicates} value={formatNumber(summary.skippedDuplicates, language)} />
          <SummaryTile label={copy.invalidRowsNotImported} value={formatNumber(summary.invalidRowsNotImported, language)} />
          <SummaryTile label={copy.rowsNeedingReview} value={formatNumber(summary.rowsNeedingReview, language)} />
          <SummaryTile label={copy.totalLitres} value={formatNumber(summary.totalLitres, language, 2)} />
          <SummaryTile label={copy.totalCost} value={formatCurrency(summary.totalCost, language)} />
        </div>
      ) : null}

      <div className="mt-5">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-slate-950">{copy.preview}</h4>
            <p className="mt-1 text-xs text-slate-500">{copy.invalidHint}</p>
          </div>
          <button type="button" onClick={() => void handleImport()} disabled={!importableRows.length || saving} className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
            {saving ? "Importing..." : copy.importReady}
          </button>
        </div>

        {!rows.length ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">{copy.noRows}</div>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {rows.map((row) => (
                <div key={row.id} className={`rounded-2xl border p-4 ${row.status === "Invalid" ? "border-rose-200 bg-rose-50/70" : row.status === "Needs Review" ? "border-amber-200 bg-amber-50/70" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{row.vehicleReg || "-"}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.date || "-"} | {row.fuelStation || "-"}</p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusClass(row.status)}`}>{getReviewStatusLabel(row)}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <MobileInput label="Log Date" type="date" value={row.date} onChange={(value) => updateRow(row.id, "date", value)} />
                    <MobileInput label="Time" value={row.time} onChange={(value) => updateRow(row.id, "time", value)} />
                    <MobileInput label="Vehicle Reg" value={row.vehicleReg} onChange={(value) => updateRow(row.id, "vehicleReg", value)} />
                    <label><span className="form-label">Driver Match</span><select value={row.driverId} onChange={(event) => updateRow(row.id, "driverId", event.target.value)} className="form-input bg-white"><option value="">No driver</option>{drivers.map((driver) => <option key={driver.id} value={String(driver.id)}>{driver.name}</option>)}</select></label>
                    <MobileInput label="Fuel Station / Location" value={row.fuelStation} onChange={(value) => updateRow(row.id, "fuelStation", value)} />
                    <MobileInput label="Original Location" value={row.originalLocation} onChange={(value) => updateRow(row.id, "originalLocation", value)} />
                    <MobileInput label="Receipt No" value={row.receiptNo} onChange={(value) => updateRow(row.id, "receiptNo", value)} />
                    <MobileInput label="Mileage" type="number" value={row.mileage} onChange={(value) => updateRow(row.id, "mileage", value)} />
                    <label><span className="form-label">Fuel Type</span><select value={row.fuelType} onChange={(event) => updateRow(row.id, "fuelType", event.target.value)} className="form-input bg-white"><option value="diesel">{t.fuel.type.diesel}</option><option value="gasohol_91">{t.fuel.type.gasohol_91}</option><option value="gasohol_95">{t.fuel.type.gasohol_95}</option><option value="premium_diesel">{t.fuel.type.premium_diesel}</option><option value="other">{t.fuel.type.other}</option></select></label>
                    <MobileInput label="Litres" type="number" value={row.litres} onChange={(value) => updateRow(row.id, "litres", value)} />
                    <MobileInput label="Price Per Litre" type="number" value={row.pricePerLitre} onChange={(value) => updateRow(row.id, "pricePerLitre", value)} />
                    <MobileInput label="Total Cost" type="number" value={row.totalCost} onChange={(value) => updateRow(row.id, "totalCost", value)} />
                    <label><span className="form-label">Payment Method</span><select value={row.paymentMethod} onChange={(event) => updateRow(row.id, "paymentMethod", event.target.value)} className="form-input bg-white"><option value="company_card">{t.payment.method.company_card}</option><option value="cash">{t.payment.method.cash}</option><option value="bank_transfer">{t.payment.method.bank_transfer}</option><option value="other">{t.payment.method.other}</option></select></label>
                    <label><span className="form-label">Entry Source</span><select value={row.entrySource} onChange={(event) => updateRow(row.id, "entrySource", event.target.value)} className="form-input bg-white"><option value="statement_import">Statement import</option><option value="line_message">Line message</option><option value="direct_from_receipt">Direct from receipt</option><option value="other">Other</option></select></label>
                    <label className="sm:col-span-2"><span className="form-label">Notes</span><textarea rows={3} value={row.notes} onChange={(event) => updateRow(row.id, "notes", event.target.value)} className="form-textarea bg-white" /></label>
                  </div>
                  {row.issues.length || row.reviewReasons.length ? <p className="mt-2 text-xs font-medium text-amber-800">{[...row.issues, ...row.reviewReasons].join(", ")}</p> : null}
                  <button type="button" onClick={() => revalidateRows(rows.filter((item) => item.id !== row.id))} className="btn-secondary mt-3 w-full gap-2"><Trash2 className="h-4 w-4" />{copy.delete}</button>
                </div>
              ))}
            </div>

            <div className="hidden md:block">
              <div className="table-shell rounded-2xl">
                <div className="table-scroll overflow-x-auto">
                  <table className="min-w-[2100px] w-full text-xs">
                    <thead className="bg-slate-50/95 text-slate-600">
                      <tr>
                        {["Log Date", "Time", "Vehicle Reg", "Driver Match", "Fuel Station / Location", "Original Location", "Receipt No", "Mileage/KM", "Fuel Type", "Litres", "Price/L", "Total Cost", "Payment", "Entry Source", "Notes", "Status", ""].map((header) => (
                          <th key={header} className="table-head-cell text-left">{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} className={`enterprise-table-row ${row.status === "Invalid" ? "bg-rose-50/70" : row.status === "Needs Review" ? "bg-amber-50/70" : ""}`}>
                          <PreviewInput type="date" value={row.date} onChange={(value) => updateRow(row.id, "date", value)} />
                          <PreviewInput value={row.time} onChange={(value) => updateRow(row.id, "time", value)} />
                          <PreviewInput value={row.vehicleReg} onChange={(value) => updateRow(row.id, "vehicleReg", value)} />
                          <td className="table-body-cell min-w-[180px]"><select value={row.driverId} onChange={(event) => updateRow(row.id, "driverId", event.target.value)} className="form-input h-9 bg-white text-xs"><option value="">No driver</option>{drivers.map((driver) => <option key={driver.id} value={String(driver.id)}>{driver.name}</option>)}</select></td>
                          <PreviewInput value={row.fuelStation} onChange={(value) => updateRow(row.id, "fuelStation", value)} />
                          <PreviewInput value={row.originalLocation} onChange={(value) => updateRow(row.id, "originalLocation", value)} wide />
                          <PreviewInput value={row.receiptNo} onChange={(value) => updateRow(row.id, "receiptNo", value)} />
                          <PreviewInput type="number" value={row.mileage} onChange={(value) => updateRow(row.id, "mileage", value)} />
                          <td className="table-body-cell min-w-[140px]"><select value={row.fuelType} onChange={(event) => updateRow(row.id, "fuelType", event.target.value)} className="form-input h-9 bg-white text-xs"><option value="diesel">{t.fuel.type.diesel}</option><option value="gasohol_91">{t.fuel.type.gasohol_91}</option><option value="gasohol_95">{t.fuel.type.gasohol_95}</option><option value="premium_diesel">{t.fuel.type.premium_diesel}</option><option value="other">{t.fuel.type.other}</option></select></td>
                          <PreviewInput type="number" value={row.litres} onChange={(value) => updateRow(row.id, "litres", value)} />
                          <PreviewInput type="number" value={row.pricePerLitre} onChange={(value) => updateRow(row.id, "pricePerLitre", value)} />
                          <PreviewInput type="number" value={row.totalCost} onChange={(value) => updateRow(row.id, "totalCost", value)} />
                          <td className="table-body-cell min-w-[150px]"><select value={row.paymentMethod} onChange={(event) => updateRow(row.id, "paymentMethod", event.target.value)} className="form-input h-9 bg-white text-xs"><option value="company_card">{t.payment.method.company_card}</option><option value="cash">{t.payment.method.cash}</option><option value="bank_transfer">{t.payment.method.bank_transfer}</option><option value="other">{t.payment.method.other}</option></select></td>
                          <td className="table-body-cell min-w-[150px]"><select value={row.entrySource} onChange={(event) => updateRow(row.id, "entrySource", event.target.value)} className="form-input h-9 bg-white text-xs"><option value="statement_import">Statement import</option><option value="line_message">Line message</option><option value="direct_from_receipt">Direct from receipt</option><option value="other">Other</option></select></td>
                          <PreviewInput value={row.notes} onChange={(value) => updateRow(row.id, "notes", value)} wide />
                          <td className="table-body-cell min-w-[190px]"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusClass(row.status)}`}>{getReviewStatusLabel(row)}</span>{row.issues.length || row.reviewReasons.length ? <p className="mt-1 text-[11px] text-slate-500">{[...row.issues, ...row.reviewReasons].join(", ")}</p> : null}</td>
                          <td className="table-body-cell"><button type="button" onClick={() => revalidateRows(rows.filter((item) => item.id !== row.id))} className="table-action-danger"><Trash2 className="h-3.5 w-3.5" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function PreviewInput({ value, onChange, type = "text", wide = false }: { value: string; onChange: (value: string) => void; type?: string; wide?: boolean }) {
  return (
    <td className={`table-body-cell ${wide ? "min-w-[260px]" : "min-w-[120px]"}`}>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="form-input h-9 bg-white text-xs" />
    </td>
  );
}

function MobileInput({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label>
      <span className="form-label">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="form-input bg-white" />
    </label>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="subtle-panel p-4">
      <p className="metric-label">{label}</p>
      <p className="mt-2 text-lg font-bold text-slate-950">{value}</p>
    </div>
  );
}
