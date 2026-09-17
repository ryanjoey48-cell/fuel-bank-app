"use client";

import { AlertTriangle, Check, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { calculateCustomTripSnapshot, getActiveFuelAllocationConflicts, getFuelLogMileage, type CustomTripCalculationSnapshot } from "@/lib/custom-trip-calculations";
import { saveFuelEfficiencyTripCalculation } from "@/lib/data";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { FuelEfficiencyTripCalculationWithLogs, FuelEfficiencyTripExclusionReason, FuelLogWithDriver } from "@/types/database";

const reasonOptions: Array<{ value: "" | FuelEfficiencyTripExclusionReason; en: string; th: string }> = [
  { value: "", en: "No reason", th: "ไม่ระบุเหตุผล" },
  { value: "different_job", en: "Different job", th: "งานอื่น" },
  { value: "before_trip", en: "Before trip", th: "ก่อนทริป" },
  { value: "after_trip", en: "After trip", th: "หลังทริป" },
  { value: "incorrect_for_calculation", en: "Incorrect for this calculation", th: "ไม่ถูกต้องสำหรับการคำนวณนี้" },
  { value: "other", en: "Other", th: "อื่น ๆ" }
];

export function CustomTripCalculation({
  calculations,
  driverId,
  driverName,
  language,
  logs,
  onSaved,
  onSnapshotChange,
  vehicleReg
}: {
  calculations: FuelEfficiencyTripCalculationWithLogs[];
  driverId: string;
  driverName: string;
  language: "en" | "th";
  logs: FuelLogWithDriver[];
  onSaved: () => Promise<void>;
  onSnapshotChange: (snapshot: CustomTripCalculationSnapshot | null) => void;
  vehicleReg: string;
}) {
  const copy = language === "th" ? {
    mileagePeriod: "ช่วงเลขไมล์", start: "เลขไมล์เริ่มต้น", end: "เลขไมล์สิ้นสุด", distance: "ระยะทางที่คำนวณ",
    fuelUsed: "บันทึกน้ำมันที่ใช้", selectedFuel: "น้ำมันที่เลือก", save: "บันทึกการคำนวณ", saving: "กำลังบันทึก",
    saved: "บันทึกการคำนวณแบบกำหนดเองแล้ว", checked: "ตรวจแล้ว", review: "ต้องตรวจสอบ", excluded: "ไม่รวม",
    usedIn: "ใช้ใน", duplicate: "บันทึกน้ำมันนี้ถูกใช้ในการคำนวณทริปอื่นแล้ว", continueWarning: "อนุญาตให้บันทึกซ้ำได้หากตั้งใจ",
    notes: "หมายเหตุ", result: "ผลการคำนวณทริป", chooseMileage: "เลือกบันทึกเลขไมล์", noLogs: "เลือกพนักงานขับรถ รถ และช่วงวันที่เพื่อดูบันทึกน้ำมัน",
    selectFuel: "เลือกอย่างน้อยหนึ่งบันทึกน้ำมัน", invalidMileage: "เลขไมล์สิ้นสุดต้องมากกว่าเลขไมล์เริ่มต้น", custom: "การคำนวณแบบกำหนดเอง"
  } : {
    mileagePeriod: "Mileage period", start: "Start mileage", end: "End mileage", distance: "Calculated distance",
    fuelUsed: "Fuel logs used", selectedFuel: "Selected fuel", save: "Save calculation", saving: "Saving",
    saved: "Custom calculation saved", checked: "Checked", review: "Needs review", excluded: "Excluded",
    usedIn: "Used in", duplicate: "This fuel log is already used in another trip calculation.", continueWarning: "You may continue if the reuse is intentional.",
    notes: "Notes", result: "Trip calculation", chooseMileage: "Select mileage reading", noLogs: "Select a driver, vehicle, and date range to view fuel logs.",
    selectFuel: "Select at least one fuel log", invalidMileage: "End mileage must be higher than start mileage", custom: "Custom calculation"
  };
  const mileageLogs = useMemo(() => logs.filter((log) => getFuelLogMileage(log) != null), [logs]);
  const matchingCalculation = useMemo(() => calculations.find((calculation) =>
    calculation.status === "active" &&
    (!driverId || calculation.driver_id === driverId) &&
    (!vehicleReg || calculation.vehicle_reg === vehicleReg)
  ) ?? null, [calculations, driverId, vehicleReg]);
  const [calculationId, setCalculationId] = useState<string | null>(null);
  const [startLogId, setStartLogId] = useState("");
  const [endLogId, setEndLogId] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, FuelEfficiencyTripExclusionReason | "">>({});
  const [notes, setNotes] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const key = `${driverId}|${vehicleReg}|${matchingCalculation?.id ?? "new"}|${logs.map((log) => log.id).join(",")}`;
    if (key === loadedKey) return;
    setLoadedKey(key);
    if (matchingCalculation) {
      setCalculationId(matchingCalculation.id);
      setStartLogId(matchingCalculation.start_mileage_fuel_log_id);
      setEndLogId(matchingCalculation.end_mileage_fuel_log_id);
      setSelectedIds(new Set(matchingCalculation.allocations.filter((row) => row.allocation_status === "included").map((row) => row.fuel_log_id)));
      setReasons(Object.fromEntries(matchingCalculation.allocations.filter((row) => row.allocation_status === "excluded").map((row) => [row.fuel_log_id, row.exclusion_reason ?? ""])));
      setNotes(matchingCalculation.notes ?? "");
      return;
    }
    setCalculationId(null);
    setStartLogId(mileageLogs[0]?.id ?? "");
    setEndLogId(mileageLogs[mileageLogs.length - 1]?.id ?? "");
    setSelectedIds(new Set(logs.map((log) => log.id)));
    setReasons({});
    setNotes("");
  }, [driverId, loadedKey, logs, matchingCalculation, mileageLogs, vehicleReg]);

  const selectedLogs = useMemo(() => logs.filter((log) => selectedIds.has(String(log.id))), [logs, selectedIds]);
  const excludedLogs = useMemo(() => logs.filter((log) => !selectedIds.has(String(log.id))), [logs, selectedIds]);
  const snapshot = useMemo(() => calculateCustomTripSnapshot({
    calculationId, driverId: driverId || null, driver: driverName, vehicleReg,
    startLog: logs.find((log) => String(log.id) === startLogId) ?? null,
    endLog: logs.find((log) => String(log.id) === endLogId) ?? null,
    selectedLogs, excludedLogs, notes
  }), [calculationId, driverId, driverName, endLogId, excludedLogs, logs, notes, selectedLogs, startLogId, vehicleReg]);
  useEffect(() => onSnapshotChange(snapshot), [onSnapshotChange, snapshot]);
  const conflicts = useMemo(() => getActiveFuelAllocationConflicts(selectedIds, calculations, calculationId), [calculationId, calculations, selectedIds]);

  const toggleFuelLog = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const save = async () => {
    setError(null); setMessage(null);
    if (!selectedIds.size) { setError(copy.selectFuel); return; }
    if (!snapshot) { setError(copy.invalidMileage); return; }
    setSaving(true);
    try {
      const saved = await saveFuelEfficiencyTripCalculation({
        id: calculationId, driverId: driverId || null, driver: driverName, vehicleReg: snapshot.vehicleReg,
        startMileageFuelLogId: snapshot.startLog.id, endMileageFuelLogId: snapshot.endLog.id, notes,
        allocations: logs.map((log) => ({
          fuelLogId: String(log.id), allocationStatus: selectedIds.has(String(log.id)) ? "included" : "excluded",
          exclusionReason: selectedIds.has(String(log.id)) ? null : reasons[String(log.id)] || null
        }))
      });
      setCalculationId(saved.id);
      setMessage(copy.saved);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save custom trip calculation.");
    } finally { setSaving(false); }
  };

  if (!logs.length) return <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">{copy.noLogs}</div>;
  return (
    <section className="mt-5 rounded-2xl border border-brand-200 bg-white p-4 shadow-sm" aria-label={copy.custom}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h4 className="font-bold text-slate-950">{copy.custom}</h4><p className="text-sm text-slate-500">{copy.mileagePeriod} + {copy.fuelUsed}</p></div>
        {matchingCalculation ? <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-800">{copy.saved}</span> : null}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div><label className="form-label">{copy.start}</label><select className="form-input bg-white" value={startLogId} onChange={(event) => setStartLogId(event.target.value)}><option value="">{copy.chooseMileage}</option>{mileageLogs.map((log) => <option key={log.id} value={log.id}>{formatDate(log.date, language)} | {formatNumber(getFuelLogMileage(log), language, 0)} km</option>)}</select></div>
        <div><label className="form-label">{copy.end}</label><select className="form-input bg-white" value={endLogId} onChange={(event) => setEndLogId(event.target.value)}><option value="">{copy.chooseMileage}</option>{mileageLogs.map((log) => <option key={log.id} value={log.id}>{formatDate(log.date, language)} | {formatNumber(getFuelLogMileage(log), language, 0)} km</option>)}</select></div>
      </div>
      <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs font-semibold uppercase text-slate-500">{copy.distance}</p><p className="mt-1 text-xl font-bold text-slate-950">{snapshot ? `${formatNumber(snapshot.distanceKm, language, 0)} km` : "-"}</p></div>
      <h5 className="mt-5 font-bold text-slate-950">{copy.fuelUsed}</h5>
      <div className="mt-2 space-y-2">
        {logs.map((log) => {
          const id = String(log.id); const selected = selectedIds.has(id); const usedBy = conflicts.get(id) ?? [];
          return <div key={id} className={`rounded-xl border p-3 ${selected ? "border-brand-200 bg-brand-50/40" : "border-slate-200 bg-slate-50"}`}>
            <div className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-4 w-4 accent-brand-700" checked={selected} onChange={() => toggleFuelLog(id)} /><div className="min-w-0 flex-1"><p className="font-semibold text-slate-950">{formatDate(log.date, language)} | {formatNumber(Number(log.litres), language, 2)} L | {formatCurrency(Number(log.total_cost), language)}</p><p className="mt-1 text-xs text-slate-500">{log.receipt_checked ? copy.checked : copy.review} | {log.vehicle_reg || "-"}</p>{usedBy.length ? <p className="mt-2 text-xs font-semibold text-amber-800"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{copy.duplicate} {copy.usedIn}: {usedBy.map((row) => `${row.driver || "-"} ${row.calculation_start_date}-${row.calculation_end_date}`).join(", ")}. {copy.continueWarning}</p> : null}</div>{selected ? <Check className="h-4 w-4 text-brand-700" /> : <span className="text-xs font-semibold text-slate-500">{copy.excluded}</span>}</div>
            {!selected ? <select className="form-input mt-2 bg-white text-sm" value={reasons[id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [id]: event.target.value as FuelEfficiencyTripExclusionReason | "" }))}>{reasonOptions.map((option) => <option key={option.value} value={option.value}>{language === "th" ? option.th : option.en}</option>)}</select> : null}
          </div>;
        })}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="subtle-panel p-3"><p className="text-xs text-slate-500">{copy.selectedFuel}</p><p className="font-bold">{snapshot ? formatNumber(snapshot.totalLitres, language, 2) : "0.00"} L</p></div><div className="subtle-panel p-3"><p className="text-xs text-slate-500">{copy.distance}</p><p className="font-bold">{snapshot ? formatNumber(snapshot.distanceKm, language, 0) : "-"} km</p></div><div className="subtle-panel p-3"><p className="text-xs text-slate-500">KM/L</p><p className="font-bold text-brand-700">{snapshot ? formatNumber(snapshot.kmPerLitre, language, 2) : "-"}</p></div></div>
      <label className="form-label mt-4">{copy.notes}</label><textarea className="form-input min-h-20 bg-white" value={notes} onChange={(event) => setNotes(event.target.value)} />
      {error ? <p className="form-error mt-3">{error}</p> : null}{message ? <p className="mt-3 text-sm font-semibold text-emerald-700">{message}</p> : null}
      <button type="button" onClick={() => void save()} disabled={saving || !snapshot} className="btn-primary mt-4 gap-2 disabled:opacity-50"><Save className="h-4 w-4" />{saving ? copy.saving : copy.save}</button>
    </section>
  );
}
