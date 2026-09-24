"use client";

import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { AlertTriangle, CheckCircle2, FileUp, X } from "lucide-react";
import { useLanguage } from "@/lib/language-provider";
import { saveMaintenanceRecord } from "@/lib/maintenance-data";
import {
  maintenanceImportCalculatedTotal,
  maintenanceImportDifference,
  maintenanceImportItemCalculationDiffers,
  matchMaintenanceImportVehicle,
  parseMaintenanceReceiptCsv,
  validateMaintenanceImportDraft,
  type MaintenanceImportDraft,
  type MaintenanceImportItemDraft
} from "@/lib/maintenance-import";
import { MAINTENANCE_CATEGORIES, type MaintenanceData, type MaintenanceItemInput, type MaintenanceRecord, type MaintenanceRecordInput } from "@/lib/maintenance-types";
import { maintenanceCategoryLabels } from "@/lib/maintenance-translations";
import { formatCurrency, formatDate } from "@/lib/utils";
import { MaintenanceField as Field } from "./maintenance-fields";

type Success = { record: MaintenanceRecord; vehicleRegistration: string; itemCount: number; total: number };

export function MaintenanceReceiptImport({ data, onClose, onImported, onViewRecord }: {
  data: MaintenanceData;
  onClose: () => void;
  onImported: () => Promise<void>;
  onViewRecord: (record: MaintenanceRecord) => void;
}) {
  const { t, language } = useLanguage(), c = t.maintenance;
  const inputRef = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const recordId = useRef(crypto.randomUUID());
  const [draft, setDraft] = useState<MaintenanceImportDraft | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mismatchConfirmed, setMismatchConfirmed] = useState(false);
  const [duplicateApproved, setDuplicateApproved] = useState(false);
  const [success, setSuccess] = useState<Success | null>(null);

  const validation = useMemo(() => draft ? validateMaintenanceImportDraft(draft, data.vehicles) : null, [data.vehicles, draft]);
  const calculated = draft ? maintenanceImportCalculatedTotal(draft) : null;
  const difference = draft ? maintenanceImportDifference(draft) : null;
  const duplicate = useMemo(() => {
    if (!draft || !validation?.vehicle || draft.receiptTotal === null) return null;
    return data.records.find(record => !record.is_deleted && record.vehicle_id === validation.vehicle?.id && record.service_date === draft.serviceDate && record.receipt_total !== null && Math.round(Number(record.receipt_total) * 100) === Math.round(draft.receiptTotal! * 100)) ?? null;
  }, [data.records, draft, validation?.vehicle]);

  const reset = () => { recordId.current = crypto.randomUUID(); setDraft(null); setFileError(null); setMismatchConfirmed(false); setDuplicateApproved(false); setSuccess(null); };
  const readFile = async (file?: File) => {
    if (!file) return;
    setFileError(null); setSuccess(null); setMismatchConfirmed(false); setDuplicateApproved(false);
    if (!/\.csv$/i.test(file.name)) { setFileError(c.csvOnly); return; }
    try {
      const parsed = parseMaintenanceReceiptCsv(await file.text(), file.name);
      if (parsed.length !== 1) { setFileError(c.oneReceiptOnly); return; }
      const next = parsed[0], vehicle = matchMaintenanceImportVehicle(next.vehicleRegistration, data.vehicles);
      setDraft({ ...next, vehicleId: vehicle?.id ?? null });
    } catch (error) {
      const details = error && typeof error === "object" && "details" in error ? (error as { details?: string[] }).details : [];
      setFileError(details?.length ? `${c.csvColumns}: ${details.join(", ")}` : c.invalidCsv);
    }
  };
  const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); void readFile(event.dataTransfer.files[0]); };
  const selectFile = (event: ChangeEvent<HTMLInputElement>) => { void readFile(event.target.files?.[0]); event.target.value = ""; };
  const patchDraft = (patch: Partial<MaintenanceImportDraft>) => { setDraft(current => current ? { ...current, ...patch } : current); setMismatchConfirmed(false); setDuplicateApproved(false); };
  const patchItem = (id: string, patch: Partial<MaintenanceImportItemDraft>) => { setDraft(current => current ? { ...current, items: current.items.map(item => item.id === id ? { ...item, ...patch } : item) } : current); setMismatchConfirmed(false); };
  const issueFor = (item: MaintenanceImportItemDraft) => validation?.issues.filter(issue => issue.row === item.sourceRow) ?? [];
  const translationWarning = (item: MaintenanceImportItemDraft) => item.notes.toLocaleLowerCase().includes("translation needs review");

  const confirm = async () => {
    if (!draft || !validation?.valid || !validation.vehicle || calculated === null || lock.current) return;
    if (difference !== 0 && !mismatchConfirmed) return;
    if (duplicate && !duplicateApproved) return;
    const payload: MaintenanceRecordInput = {
      id: recordId.current, vehicle_id: validation.vehicle.id, service_date: draft.serviceDate,
      odometer: null, garage: draft.garageSupplier || null, receipt_reference: null,
      receipt_total: draft.receiptTotal, mismatch_confirmed: difference !== 0 && mismatchConfirmed,
      notes: null, off_road_at: null, returned_at: null
    };
    const items: MaintenanceItemInput[] = draft.items.map(item => ({
      id: item.id, description: item.description.trim(), description_th: item.descriptionTh.trim() || null,
      category: item.category as MaintenanceItemInput["category"], quantity: item.quantity!, unit_price: item.unitPrice!, line_total: item.lineTotal,
      notes: item.notes.trim() || null, requirement_id: null, reminder_months: null, reminder_km: null,
      warning_days: 30, warning_km: 1000, override_date: null, override_km: null
    }));
    lock.current = true; setBusy(true); setFileError(null);
    try {
      const record = await saveMaintenanceRecord(payload, items, null);
      await onImported();
      setSuccess({ record, vehicleRegistration: validation.vehicle.vehicle_reg, itemCount: items.length, total: calculated });
    } catch (error) {
      setFileError(`${c.importFailed} ${error instanceof Error ? error.message : ""}`.trim());
    } finally { setBusy(false); lock.current = false; }
  };

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 p-2 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="maintenance-import-title">
    <div className="mx-auto my-2 max-w-7xl rounded-2xl bg-[#f8f7fb] shadow-2xl sm:my-6">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 rounded-t-2xl border-b border-slate-200 bg-white px-4 py-3 sm:px-5"><div><p className="text-[11px] font-bold uppercase tracking-[.16em] text-violet-600">CSV</p><h2 id="maintenance-import-title" className="text-lg font-bold text-slate-950">{success ? c.importSuccessful : draft ? c.reviewImport : c.importReceipt}</h2></div><button type="button" disabled={busy} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40" onClick={onClose} aria-label={c.close}><X className="h-5 w-5" /></button></header>
      <div className="space-y-4 p-3 sm:p-5">
        {fileError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{fileError}</p>}
        {success ? <SuccessPanel success={success} language={language} labels={c} onView={() => onViewRecord(success.record)} onAnother={reset} onDone={onClose} /> : !draft ? <div onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop} className={`rounded-2xl border-2 border-dashed p-8 text-center transition sm:p-12 ${dragging ? "border-violet-500 bg-violet-50" : "border-slate-300 bg-white"}`}><FileUp className="mx-auto h-10 w-10 text-violet-600" /><h3 className="mt-3 font-bold text-slate-950">{c.uploadCsv}</h3><p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">{c.uploadCsvHelp}</p><input ref={inputRef} className="sr-only" type="file" accept=".csv,text/csv" onChange={selectFile} /><button type="button" className="btn-primary mt-5" onClick={() => inputRef.current?.click()}>{c.chooseCsv}</button><p className="mt-4 text-xs text-slate-400">{c.csvColumns}: vehicle, service_date, garage_supplier, receipt_total, description, category, quantity, unit_price, line_total, original_thai, notes</p></div> : <>
          <section className="rounded-2xl border border-violet-100 bg-white p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Field label={c.vehicle}><select className={`form-input ${validation?.issues.some(issue => issue.field === "vehicle") ? "border-rose-300" : ""}`} value={draft.vehicleId ?? ""} onChange={event => { const vehicle = data.vehicles.find(value => value.id === event.target.value); patchDraft({ vehicleId: event.target.value || null, vehicleRegistration: vehicle?.vehicle_reg ?? draft.vehicleRegistration }); }}><option value="">{c.vehicleNotFound}: {draft.vehicleRegistration}</option>{data.vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicle_reg}</option>)}</select></Field><Field label={c.serviceDate}><input className="form-input" type="date" value={draft.serviceDate} onChange={event => patchDraft({ serviceDate: event.target.value })} /></Field><Field label={c.garage}><input className="form-input" value={draft.garageSupplier} onChange={event => patchDraft({ garageSupplier: event.target.value })} /></Field><Field label={c.receiptTotal}><input className="form-input" type="number" min="0" step="0.01" value={draft.receiptTotal ?? ""} onChange={event => patchDraft({ receiptTotal: event.target.value === "" ? null : Number(event.target.value) })} /></Field><div className="rounded-xl bg-violet-50 p-3"><p className="text-xs text-slate-500">{c.importItems}</p><p className="mt-1 text-xl font-bold text-violet-950">{draft.items.length}</p></div></div></section>
          <ImportItems draft={draft} validation={validation} language={language} labels={c} patchItem={patchItem} issueFor={issueFor} translationWarning={translationWarning} />
          <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3"><Total label={c.receiptTotal} value={draft.receiptTotal} language={language}/><Total label={c.calculatedItems} value={calculated} language={language}/><Total label={c.difference} value={difference} language={language}/><div className={`sm:col-span-3 flex items-center gap-2 rounded-xl p-3 text-sm font-bold ${difference === 0 ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{difference === 0 ? <CheckCircle2 className="h-5 w-5"/> : <AlertTriangle className="h-5 w-5"/>}{difference === 0 ? c.totalsMatch : c.totalsDoNotMatch}</div>{difference !== null && difference !== 0 && <label className="sm:col-span-3 flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={mismatchConfirmed} onChange={event => setMismatchConfirmed(event.target.checked)} />{c.confirmMismatchImport}</label>}</section>
          {duplicate && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="font-bold text-amber-900">{c.possibleDuplicate}</p><p className="mt-1 text-sm text-amber-800">{data.vehicles.find(vehicle => vehicle.id === duplicate.vehicle_id)?.vehicle_reg} · {formatDate(duplicate.service_date, language)} · {formatCurrency(Number(duplicate.receipt_total), language)}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={onClose}>{c.cancelImport}</button><button type="button" className="btn-secondary" onClick={() => onViewRecord(duplicate)}>{c.reviewExisting}</button><button type="button" className="btn-secondary" onClick={() => setDuplicateApproved(true)}>{c.importAnyway}</button></div>{duplicateApproved && <p className="mt-2 text-xs font-semibold text-amber-900">✓ {c.importAnyway}</p>}</section>}
          {validation && !validation.valid && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{c.invalidCsv} ({validation.issues.length} {c.errors})</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between"><button type="button" className="btn-secondary" onClick={reset}>{c.changeFile}</button><button type="button" className="btn-primary" disabled={busy || !validation?.valid || calculated === null || difference !== 0 && !mismatchConfirmed || Boolean(duplicate && !duplicateApproved)} onClick={() => void confirm()}>{busy ? t.common.loading : c.confirmImport}</button></div>
        </>}
      </div>
    </div>
  </div>;
}

function Total({ label, value, language }: { label: string; value: number | null; language: "en" | "th" }) { return <div><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-lg font-bold text-slate-950">{value === null ? "—" : formatCurrency(value, language)}</p></div>; }

function ImportItems({ draft, validation, language, labels: c, patchItem, issueFor, translationWarning }: { draft: MaintenanceImportDraft; validation: ReturnType<typeof validateMaintenanceImportDraft> | null; language: "en" | "th"; labels: ReturnType<typeof useLanguage>["t"]["maintenance"]; patchItem: (id: string, patch: Partial<MaintenanceImportItemDraft>) => void; issueFor: (item: MaintenanceImportItemDraft) => ReturnType<typeof validateMaintenanceImportDraft>["issues"]; translationWarning: (item: MaintenanceImportItemDraft) => boolean }) {
  return <section className="space-y-2" role="table" aria-label={c.importItems}><div className="hidden grid-cols-[1.4fr_1.2fr_150px_90px_120px_120px_1fr_100px] gap-2 px-3 text-[11px] font-bold uppercase text-slate-500 lg:grid" role="row">{[c.descriptionLabel,c.thaiDescription,c.category,c.quantity,c.unitPrice,c.lineTotal,c.itemNotes,c.rowStatus].map(label => <span key={label} role="columnheader">{label}</span>)}</div>{draft.items.map((item, index) => { const issues = issueFor(item), translation = translationWarning(item), calculation = maintenanceImportItemCalculationDiffers(item); return <div key={item.id} className={`grid gap-3 rounded-2xl border bg-white p-3 lg:grid-cols-[1.4fr_1.2fr_150px_90px_120px_120px_1fr_100px] lg:items-start ${issues.length ? "border-rose-200" : translation || calculation ? "border-amber-200" : "border-slate-200"}`} role="row"><label className="text-xs"><span className="mb-1 block text-slate-500 lg:hidden">{c.descriptionLabel}</span><input className="form-input" value={item.description} onChange={event => patchItem(item.id,{description:event.target.value})}/></label><label className="text-xs"><span className="mb-1 block text-slate-500 lg:hidden">{c.thaiDescription}</span><input className="form-input" value={item.descriptionTh} onChange={event => patchItem(item.id,{descriptionTh:event.target.value})}/></label><label className="text-xs"><span className="mb-1 block text-slate-500 lg:hidden">{c.category}</span><select className="form-input" value={item.category} onChange={event => patchItem(item.id,{category:event.target.value})}>{!MAINTENANCE_CATEGORIES.includes(item.category as never) && <option value={item.category}>{item.category || "—"}</option>}{MAINTENANCE_CATEGORIES.map(category => <option key={category} value={category}>{maintenanceCategoryLabels[language][category]}</option>)}</select></label>{(["quantity","unitPrice","lineTotal"] as const).map(field => <label key={field} className="text-xs"><span className="mb-1 block text-slate-500 lg:hidden">{field === "quantity" ? c.quantity : field === "unitPrice" ? c.unitPrice : c.lineTotal}</span><input className="form-input" type="number" min={field === "quantity" ? "0.01" : "0"} step={field === "unitPrice" ? "0.0001" : "0.01"} value={item[field] ?? ""} onChange={event => patchItem(item.id,{[field]:event.target.value === "" ? null : Number(event.target.value)})}/>{field !== "quantity" && item[field] !== null && <span className="mt-1 block text-slate-400">{formatCurrency(item[field] as number,language)}</span>}</label>)}<label className="text-xs"><span className="mb-1 block text-slate-500 lg:hidden">{c.itemNotes}</span><input className="form-input" value={item.notes} onChange={event => patchItem(item.id,{notes:event.target.value})}/></label><div className="text-xs"><span className="font-bold text-slate-500">#{index + 1}</span>{issues.length ? <p className="mt-1 font-semibold text-rose-700">{issues.map(issue => issue.field).join(", ")}</p> : <p className="mt-1 font-semibold text-emerald-700">{c.ready}</p>}{translation && <p className="mt-1 font-semibold text-amber-800">{c.translationNeedsReview}</p>}{calculation && <p className="mt-1 text-amber-800" title={c.lineTotalWarning}>{c.lineTotalWarning}</p>}</div></div>; })}{validation?.issues.some(issue => issue.row === undefined) && <p className="text-sm text-rose-700">{validation.issues.filter(issue => issue.row === undefined).map(issue => `${issue.field}: ${issue.code}`).join(" · ")}</p>}</section>;
}

function SuccessPanel({ success, language, labels: c, onView, onAnother, onDone }: { success: Success; language: "en" | "th"; labels: ReturnType<typeof useLanguage>["t"]["maintenance"]; onView: () => void; onAnother: () => void; onDone: () => void }) { return <section className="rounded-2xl border border-emerald-200 bg-white p-5"><CheckCircle2 className="h-10 w-10 text-emerald-600"/><h3 className="mt-3 text-lg font-bold text-slate-950">{c.importSuccessful}</h3><dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-xs text-slate-500">{c.vehicle}</dt><dd className="font-bold">{success.vehicleRegistration}</dd></div><div><dt className="text-xs text-slate-500">{c.serviceDate}</dt><dd className="font-bold">{formatDate(success.record.service_date,language)}</dd></div><div><dt className="text-xs text-slate-500">{c.importItems}</dt><dd className="font-bold">{success.itemCount}</dd></div><div><dt className="text-xs text-slate-500">{c.receiptTotal}</dt><dd className="font-bold">{formatCurrency(success.total,language)}</dd></div></dl><div className="mt-5 flex flex-wrap gap-2"><button type="button" className="btn-primary" onClick={onView}>{c.viewRecord}</button><button type="button" className="btn-secondary" onClick={onAnother}>{c.importAnother}</button><button type="button" className="btn-secondary" onClick={onDone}>{c.done}</button></div></section>; }
