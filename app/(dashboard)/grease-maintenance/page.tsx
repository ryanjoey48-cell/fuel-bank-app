"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Wrench } from "lucide-react";
import { Header } from "@/components/header";
import { fetchDrivers } from "@/lib/data";
import { buildGreaseRows, greaseItemTotal, greaseNextDue, greaseToday, greaseTotal, isGreaseDate, type GreaseStatus } from "@/lib/grease-maintenance";
import { fetchGreaseRecords, fetchGreaseVehicles, saveGreaseRecord } from "@/lib/grease-maintenance-data";
import { useLanguage } from "@/lib/language-provider";
import { useAccountAccess } from "@/lib/use-account-access";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { Driver, GreaseMaintenanceRecord, Vehicle } from "@/types/database";

const tones: Record<GreaseStatus, string> = {
  ok: "bg-emerald-50 text-emerald-800 border-emerald-200",
  dueSoon: "bg-amber-50 text-amber-800 border-amber-200",
  overdue: "bg-rose-50 text-rose-800 border-rose-200",
  noRecord: "bg-slate-100 text-slate-700 border-slate-200"
};
const statuses: GreaseStatus[] = ["overdue", "dueSoon", "noRecord", "ok"];
const newForm = (vehicleId = "") => ({ vehicle_id: vehicleId, service_date: greaseToday(), odometer: "", garage: "", notes: "", is_void: false, items: [] as { key: string; description: string; quantity: string; unit_cost: string }[] });

export default function GreaseMaintenancePage() {
  const { t, language } = useLanguage();
  const c = t.grease;
  const { can } = useAccountAccess();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [records, setRecords] = useState<GreaseMaintenanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<"saveError" | "conflict" | "invalid" | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [today, setToday] = useState(greaseToday);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<GreaseStatus | "all">("all");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [editing, setEditing] = useState<GreaseMaintenanceRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(newForm);
  const formRef = useRef<HTMLFormElement>(null);
  const canWrite = can("business:write");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [v, d, r] = await Promise.all([fetchGreaseVehicles(), fetchDrivers(), fetchGreaseRecords()]);
      setVehicles(v); setDrivers(d); setRecords(r); setLoadFailed(false);
    } catch { setLoadFailed(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const update = () => setToday(greaseToday());
    const timer = window.setInterval(update, 60000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  useEffect(() => {
    if (formOpen) { formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); formRef.current?.querySelector("select")?.focus(); }
  }, [formOpen, editing]);

  const rows = useMemo(() => buildGreaseRows(vehicles, drivers, records, today), [vehicles, drivers, records, today]);
  const fleet = rows.filter(row => includeInactive || row.vehicle.active !== false);
  const visible = fleet.filter(row => (filter === "all" || row.status === filter) && `${row.vehicle.vehicle_reg} ${row.driver}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a, b) => statuses.indexOf(a.status) - statuses.indexOf(b.status) || (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.vehicle.vehicle_reg.localeCompare(b.vehicle.vehicle_reg));
  const history = records.filter(record => record.vehicle_id === historyId).sort((a, b) => b.service_date.localeCompare(a.service_date) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const items = form.items.map(item => ({ description: item.description.trim(), quantity: item.quantity === "" ? null : Number(item.quantity), unit_cost: item.unit_cost === "" ? null : Number(item.unit_cost) }));
  const date = (value: string | null) => value ? formatDate(value, language) : "—";
  const money = (value: number) => formatCurrency(value, language);
  const startForm = (vehicleId = "", record?: GreaseMaintenanceRecord) => {
    setEditing(record ?? null); setError(null); setSaved(false);
    setForm(record ? { vehicle_id: record.vehicle_id, service_date: record.service_date, odometer: record.odometer?.toString() ?? "", garage: record.garage ?? "", notes: record.notes ?? "", is_void: record.is_void, items: record.items.map(item => ({ key: crypto.randomUUID(), description: item.description, quantity: item.quantity?.toString() ?? "", unit_cost: item.unit_cost?.toString() ?? "" })) } : newForm(vehicleId));
    setFormOpen(true);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canWrite || savingRef.current) return;
    const validNumber = (value: number | null, max: number) => value === null || (Number.isFinite(value) && value >= 0 && value <= max && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001);
    const odometer = form.odometer === "" ? null : Number(form.odometer);
    if (!vehicles.some(v => v.id === form.vehicle_id) || !isGreaseDate(form.service_date) || form.service_date > greaseToday() || !validNumber(odometer, 9999999999.99) || items.some(item => !item.description || !validNumber(item.quantity, 1000000) || !validNumber(item.unit_cost, 100000000)) || greaseTotal(items) > 999999999999.99) {
      setError("invalid"); return;
    }
    savingRef.current = true; setSaving(true); setError(null); setSaved(false);
    try {
      const record = await saveGreaseRecord({ vehicle_id: form.vehicle_id, service_date: form.service_date, odometer, items, garage: form.garage.trim() || null, notes: form.notes.trim() || null, is_void: form.is_void }, editing ?? undefined);
      setRecords(previous => [...previous.filter(row => row.id !== record.id), record]);
      setHistoryId(record.vehicle_id); setFormOpen(false); setSaved(true);
    } catch (err) { setError(err instanceof Error && err.message === "GREASE_CONFLICT" ? "conflict" : "saveError"); }
    finally { savingRef.current = false; setSaving(false); }
  };

  return <div className="space-y-4">
    <Header title={c.title} description={c.description} />
    <section className="surface-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="section-title flex items-center gap-2"><Wrench className="h-5 w-5" />{c.title}</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary gap-2" disabled={loading || saving} onClick={() => void load()}><RefreshCw className="h-4 w-4" />{c.refresh}</button>
          {canWrite && <button type="button" className="btn-primary gap-2" disabled={loading || loadFailed || saving} onClick={() => startForm()}><Plus className="h-4 w-4" />{c.add}</button>}
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-500">{c.annualHint}</p>
      {!canWrite && <p className="mt-2 text-sm text-slate-500">{c.readOnly}</p>}
      {saved && <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-emerald-800">{c.saved}</p>}
      {loading && <p role="status" className="mt-3">{t.common.loading}</p>}
      {loadFailed && <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-amber-900">{c.loadError}</p>}
    </section>

    {formOpen && <form ref={formRef} onSubmit={submit} className="surface-card scroll-mt-24 space-y-4 p-4 sm:p-5">
      <h3 className="section-title">{editing ? c.edit : c.add}</h3>
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-800">{c[error]}</p>}
      <fieldset disabled={saving || !canWrite} className="space-y-4 disabled:opacity-60">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">{c.vehicle} *<select required className="form-input mt-1" value={form.vehicle_id} onChange={event => setForm({ ...form, vehicle_id: event.target.value })}><option value="">{c.selectVehicle}</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicle_reg}{vehicle.active === false ? ` (${c.inactive})` : ""}</option>)}</select></label>
          <div className="text-sm"><p className="font-medium">{c.driver}</p><p className="mt-2 rounded-xl bg-slate-50 p-3">{rows.find(row => row.vehicle.id === form.vehicle_id)?.driver || c.unassigned}</p></div>
          <label className="text-sm font-medium">{c.serviceDate} *<input className="form-input mt-1" type="date" required min="1900-01-01" max={today} value={form.service_date} onChange={event => setForm({ ...form, service_date: event.target.value })} /></label>
          <div className="text-sm"><p className="font-medium">{c.dueDate}</p><p className="mt-2 p-3">{date(greaseNextDue(form.service_date))}</p></div>
          <label className="text-sm font-medium">{c.odometer}<input className="form-input mt-1" type="number" min="0" max="9999999999.99" step="0.01" value={form.odometer} onChange={event => setForm({ ...form, odometer: event.target.value })} /></label>
          <label className="text-sm font-medium">{c.garage}<input className="form-input mt-1" maxLength={500} value={form.garage} onChange={event => setForm({ ...form, garage: event.target.value })} /></label>
        </div>
        <div className="space-y-3 rounded-2xl border border-slate-200 p-3 sm:p-4">
          <h4 className="font-semibold">{c.items}</h4><p className="text-xs text-slate-500">{c.costHint}</p>
          {form.items.map((item, index) => <div key={item.key} className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-sm lg:col-span-2">{c.item} *<input required maxLength={500} className="form-input mt-1" value={item.description} onChange={event => setForm({ ...form, items: form.items.map((entry, i) => i === index ? { ...entry, description: event.target.value } : entry) })} /></label>
            <label className="text-sm">{c.quantity}<input type="number" min="0" max="1000000" step="0.01" className="form-input mt-1" value={item.quantity} onChange={event => setForm({ ...form, items: form.items.map((entry, i) => i === index ? { ...entry, quantity: event.target.value } : entry) })} /></label>
            <label className="text-sm">{c.cost}<input type="number" min="0" max="100000000" step="0.01" className="form-input mt-1" value={item.unit_cost} onChange={event => setForm({ ...form, items: form.items.map((entry, i) => i === index ? { ...entry, unit_cost: event.target.value } : entry) })} /></label>
            <div className="flex flex-col justify-between gap-2 text-sm"><span>{c.lineTotal}: {money(greaseItemTotal(items[index]))}</span><button type="button" className="btn-secondary text-rose-700" onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}>{c.removeItem}</button></div>
          </div>)}
          <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" className="btn-secondary" disabled={form.items.length >= 100} onClick={() => setForm({ ...form, items: [...form.items, { key: crypto.randomUUID(), description: "", quantity: "", unit_cost: "" }] })}>{c.addItem}</button><output className="text-lg font-bold" aria-live="polite">{c.total}: {money(greaseTotal(items))}</output></div>
        </div>
        <label className="block text-sm font-medium">{c.notes}<textarea className="form-input mt-1" rows={3} maxLength={10000} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
        {editing && <div className="rounded-xl bg-amber-50 p-3 text-sm"><label className="flex items-start gap-2"><input type="checkbox" className="mt-1 !h-4 !w-4 shrink-0" checked={form.is_void} onChange={event => setForm({ ...form, is_void: event.target.checked })} />{c.voidLabel}</label><p className="mt-2 text-slate-600">{c.voidHint}</p></div>}
        <div className="flex flex-wrap gap-2"><button className="btn-primary" type="submit">{saving ? t.common.saving : t.common.save}</button><button className="btn-secondary" type="button" onClick={() => { setFormOpen(false); setError(null); }}>{t.common.cancel}</button></div>
      </fieldset>
    </form>}

    {!loading && !loadFailed && <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{statuses.map(status => <button key={status} type="button" aria-pressed={filter === status} onClick={() => setFilter(filter === status ? "all" : status)} className={`rounded-2xl border p-4 text-left ${tones[status]} ${filter === status ? "ring-2 ring-violet-500" : ""}`}><p className="text-sm font-semibold">{c[status]}</p><p className="mt-1 text-3xl font-bold">{formatNumber(fleet.filter(row => row.status === status).length, language, 0)}</p></button>)}</div>
      <section className="surface-card space-y-4 p-4 sm:p-5">
        <div className="grid items-end gap-3 sm:grid-cols-3">
          <label className="text-sm">{c.search}<input type="search" className="form-input mt-1" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label className="text-sm">{c.status}<select className="form-input mt-1" value={filter} onChange={event => setFilter(event.target.value as GreaseStatus | "all")}><option value="all">{c.all}</option>{statuses.map(status => <option key={status} value={status}>{c[status]}</option>)}</select></label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="!h-4 !w-4 shrink-0" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} />{c.includeInactive}</label>
        </div>
        {!visible.length && <p className="py-8 text-center text-slate-500">{c.empty}</p>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map(row => <article key={row.vehicle.id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-lg font-bold">{row.vehicle.vehicle_reg}</h4><p className="text-sm text-slate-500">{c.driver}: {row.driver || c.unassigned}</p>{row.vehicle.active === false && <p className="text-xs text-slate-500">{c.inactive}</p>}</div><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tones[row.status]}`}>{c[row.status]}</span></div>
          <dl className="space-y-2 text-sm">{[[c.latestService, date(row.latest?.service_date ?? null)], [c.dueDate, date(row.dueDate)], [c.days, row.days === null ? "—" : formatNumber(row.days, language, 0)]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-slate-500">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl>
          <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={() => { setHistoryId(row.vehicle.id); window.setTimeout(() => document.getElementById("grease-history")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }}>{c.history}</button>{canWrite && <button disabled={saving} type="button" className="btn-primary" onClick={() => startForm(row.vehicle.id)}>{c.add}</button>}</div>
        </article>)}</div>
      </section>
      {historyId && <section id="grease-history" className="surface-card scroll-mt-24 space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap justify-between gap-3"><h3 className="section-title">{c.history} · {vehicles.find(v => v.id === historyId)?.vehicle_reg}</h3><button type="button" className="btn-secondary" onClick={() => setHistoryId(null)}>{c.back}</button></div>
        {!history.length && <p className="text-slate-500">{c.noHistory}</p>}
        {history.map(record => <article key={record.id} className="space-y-3 rounded-2xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-bold">{date(record.service_date)} {record.is_void && <span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-xs">{c.voided}</span>}</h4><p className="text-sm text-slate-500">{c.dueDate}: {date(record.next_due_date)}</p></div><div className="flex items-center gap-3"><strong>{money(record.total_cost)}</strong>{canWrite && <button disabled={saving} type="button" className="btn-secondary" onClick={() => startForm(record.vehicle_id, record)}>{t.common.edit}</button>}</div></div>
          <p className="text-sm">{c.odometer}: {record.odometer === null ? "—" : formatNumber(record.odometer, language)} · {c.garage}: {record.garage || "—"}</p>
          {record.items.length > 0 && <div className="space-y-2">{record.items.map((item, index) => <div key={index} className="flex flex-wrap justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm"><span className="min-w-0 break-words">{item.description}</span><span>{item.quantity === null ? "—" : formatNumber(item.quantity, language)} × {item.unit_cost === null ? "—" : money(item.unit_cost)} · {money(greaseItemTotal(item))}</span></div>)}</div>}
          {record.notes && <p className="whitespace-pre-wrap break-words text-sm">{record.notes}</p>}
          <dl className="grid gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 sm:grid-cols-2">{[[c.createdBy, record.created_by], [c.updatedBy, record.updated_by], [c.createdAt, new Date(record.created_at).toLocaleString(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok" })], [c.updatedAt, new Date(record.updated_at).toLocaleString(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok" })]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="break-all">{value}</dd></div>)}</dl>
        </article>)}
      </section>}
    </>}
  </div>;
}
