"use client";

import { useLanguage } from "@/lib/language-provider";
import { maintenanceDue, requirementApplies } from "@/lib/maintenance";
import type { MaintenanceData, MaintenanceItemInput, MaintenanceRecordInput } from "@/lib/maintenance-types";
import { formatDate, formatNumber } from "@/lib/utils";
import { MaintenanceField as Field } from "./maintenance-fields";

export type ItemForm = MaintenanceItemInput & { mode: string };
export const modeFor = (item: MaintenanceItemInput) => item.reminder_months && item.reminder_km ? "both"
  : item.reminder_months ? "months" : item.reminder_km ? "mileage"
  : item.override_date ? "date" : item.override_km !== null ? "odometer" : "none";

export function MaintenanceReminderFields({ item, form, data, onChange }: {
  item: ItemForm; form: MaintenanceRecordInput; data: MaintenanceData; onChange: (patch: Partial<ItemForm>) => void;
}) {
  const { t, language } = useLanguage(), c = t.maintenance;
  const vehicle = data.vehicles.find(v => v.id === form.vehicle_id);
  const due = maintenanceDue(item, form);
  const selected = data.requirements.find(r => r.id === item.requirement_id);
  const schedule = (months: number | null, km: number | null) => [
    months ? `${months} ${c.everyMonths}` : "", km ? `${formatNumber(km, language)} ${c.everyKm}` : ""
  ].filter(Boolean).join(` / `) + (months && km ? ` · ${c.whicheverFirst}` : "");
  const modeOptions = [["none", c.noReminder], ["months", c.repeatMonths], ["mileage", c.repeatKm], ["both", c.repeatBoth], ["date", c.customDate], ["odometer", c.customMileage]];
  const dateField = <Field label={c.overrideDate}><input className="form-input" type="date" required={item.mode === "date"} min={form.service_date} value={item.override_date ?? ""} onChange={e => onChange({ override_date: e.target.value || null })}/></Field>;
  const mileageField = <Field label={c.overrideMileage}><input className="form-input" type="number" required={item.mode === "odometer"} min={form.odometer ?? 0} max="9999999999.99" step="0.01" value={item.override_km ?? ""} onChange={e => onChange({ override_km: e.target.value === "" ? null : Number(e.target.value) })}/></Field>;
  return <details className="rounded-xl border border-slate-200 bg-white p-3">
    <summary className="cursor-pointer py-2 text-sm font-semibold">{c.reminderOptional}<span className="mt-1 block text-xs font-normal text-slate-500">{selected ? `${selected.name}: ` : ""}{item.mode === "none" ? c.noReminder : schedule(item.reminder_months, item.reminder_km) || (due.date ? formatDate(due.date, language) : `${formatNumber(due.km ?? 0, language)} km`)}</span></summary>
    <div className="mt-3 space-y-3">
      <Field label={c.standardRule}><select className="form-input" value={item.requirement_id ?? ""} onChange={e => {
        const req = data.requirements.find(r => r.id === e.target.value);
        if (!req) { onChange({ requirement_id: null }); return; }
        const patch = { requirement_id: req.id, category: req.category, reminder_months: req.frequency_months, reminder_km: req.mileage_interval, warning_days: req.warning_days, warning_km: req.warning_km, override_date: null, override_km: null };
        onChange({ ...patch, mode: modeFor({ ...item, ...patch }) });
      }}><option value="">{c.ownRule}</option>{data.requirements.filter(r => vehicle && requirementApplies(r, vehicle, data) && (r.active || r.id === item.requirement_id)).map(r => <option key={r.id} value={r.id}>{r.name}: {schedule(r.frequency_months, r.mileage_interval)}{!r.active ? ` (${c.requirementDisabled})` : ""}</option>)}</select></Field>
      <p className="text-xs text-slate-500">{c.standardRuleHelp}</p>
      <Field label={c.reminder}><select className="form-input" value={item.mode} onChange={e => {
        const mode = e.target.value;
        onChange({ mode, reminder_months: mode === "months" || mode === "both" ? item.reminder_months || 12 : null, reminder_km: mode === "mileage" || mode === "both" ? item.reminder_km || 10000 : null, override_date: null, override_km: null });
      }}>{modeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {(item.mode === "months" || item.mode === "both") && <Field label={c.months}><input required className="form-input" type="number" min={1} max={1200} step={1} value={item.reminder_months ?? ""} onChange={e => onChange({ reminder_months: e.target.value ? Number(e.target.value) : null })}/></Field>}
        {(item.mode === "mileage" || item.mode === "both") && <Field label={c.mileageInterval}><input required className="form-input" type="number" min="0.01" max="9999999999.99" step="0.01" value={item.reminder_km ?? ""} onChange={e => onChange({ reminder_km: e.target.value ? Number(e.target.value) : null })}/></Field>}
        {item.mode === "date" && dateField}{item.mode === "odometer" && mileageField}
      </div>
      {item.mode !== "none" ? <>
        <div className="rounded-xl bg-violet-50 p-3 text-sm"><p>{c.nextDate}: {due.date ? formatDate(due.date, language) : "—"}</p><p>{c.nextMileage}: {due.km === null ? "—" : `${formatNumber(due.km, language)} km`}</p></div>
        <details><summary className="cursor-pointer py-2 text-sm">{c.reminderAdjust}</summary><div className="mt-2 grid gap-3 sm:grid-cols-2">
          {item.mode !== "date" && dateField}{item.mode !== "odometer" && mileageField}
          <Field label={c.warningDays}><input required className="form-input" type="number" min={0} max={3650} step={1} value={item.warning_days} onChange={e => onChange({ warning_days: Number(e.target.value) })}/></Field>
          <Field label={c.warningKm}><input required className="form-input" type="number" min={0} max="9999999999.99" step="0.01" value={item.warning_km} onChange={e => onChange({ warning_km: Number(e.target.value) })}/></Field>
        </div></details>
      </> : <p className="text-xs text-slate-500">{c.reminderNoneHelp}</p>}
    </div>
  </details>;
}
