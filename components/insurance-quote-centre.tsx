"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Plus, X, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, FileText, Clock3, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Asset = {
  id: string; vehicle_registration: string; vehicle_make?: string | null;
  vehicle_year?: number | null; chassis_number?: string | null;
  insurance_expiry_date?: string | null; insurance_class?: string | null;
  insured_value?: number | null; insurance_premium?: number | null;
  repair_type?: string | null; policy_number?: string | null;
  insurer_en?: string | null; insurer_th?: string | null;
};
type BrokerProfile = { insurance_record_id: string; gross_weight_kg: number | null; permitted_load_kg: number | null; vehicle_usage: string | null; cargo_type: string | null; operating_routes: string | null; cross_border: boolean | null; claims_history: string | null; driver_restrictions: string | null; coverage_requirements: string | null; updated_at?: string; };
type BrokerDraft = { gross_weight_kg: string; permitted_load_kg: string; vehicle_usage: string; cargo_type: string; operating_routes: string; cross_border: string; claims_history: string; driver_restrictions: string; coverage_requirements: string; };
const blankBroker: BrokerDraft = { gross_weight_kg: "", permitted_load_kg: "", vehicle_usage: "", cargo_type: "", operating_routes: "", cross_border: "", claims_history: "", driver_restrictions: "", coverage_requirements: "" };
const toBrokerDraft = (p?: BrokerProfile): BrokerDraft => p ? { gross_weight_kg: p.gross_weight_kg == null ? "" : String(p.gross_weight_kg), permitted_load_kg: p.permitted_load_kg == null ? "" : String(p.permitted_load_kg), vehicle_usage: p.vehicle_usage ?? "", cargo_type: p.cargo_type ?? "", operating_routes: p.operating_routes ?? "", cross_border: p.cross_border == null ? "" : String(p.cross_border), claims_history: p.claims_history ?? "", driver_restrictions: p.driver_restrictions ?? "", coverage_requirements: p.coverage_requirements ?? "" } : {...blankBroker};
const brokerGaps = (p?: BrokerProfile) => !p ? 7 : [p.gross_weight_kg, p.permitted_load_kg, p.vehicle_usage, p.cargo_type, p.operating_routes, p.cross_border, p.claims_history].filter(v => v == null || v === "").length;
type Quote = {
  id: string; insurance_record_id: string; insurer_name: string; quoted_premium: number;
  insurance_class: string | null; insured_value: number | null;
  deductible: number | null; coverage_confirmed: boolean;
  status: "requested" | "received" | "rejected" | "selected";
  quote_date: string | null; expiry_date: string | null; notes: string | null;
};
type Draft = { insurer_name: string; quoted_premium: string; insurance_class: string;
  insured_value: string; deductible: string; coverage_confirmed: boolean;
  status: Quote["status"]; notes: string; };
const emptyDraft: Draft = { insurer_name: "", quoted_premium: "", insurance_class: "", insured_value: "", deductible: "", coverage_confirmed: false, status: "received", notes: "" };
const THB = (n: number | null | undefined) => n == null ? "—" : `฿${n.toLocaleString("en-TH", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const decimalOrNull = (s: string) => s.trim() === "" ? null : Number(s);
function saveCSV(name: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (value: string | number | null | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function needed(record: Asset, hasDocument: boolean) {
  const fields: string[] = [];
  if (!record.vehicle_make) fields.push("Vehicle make");
  if (!record.vehicle_year) fields.push("Vehicle year");
  if (!record.chassis_number) fields.push("Chassis / VIN");
  if (!record.insurance_class) fields.push("Current insurance class");
  if (record.insured_value == null) fields.push("Current insured value");
  if (record.insurance_premium == null) fields.push("Current premium");
  if (!hasDocument) fields.push("Existing policy document");
  return fields;
}
export function InsuranceQuoteCentre({ records, insuranceDocumentIds, isThai }: {
  records: Asset[]; insuranceDocumentIds: string[]; isThai: boolean;
}) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [profiles, setProfiles] = useState<BrokerProfile[]>([]);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [brokerEditing, setBrokerEditing] = useState<string | null>(null);
  const [brokerDraft, setBrokerDraft] = useState<BrokerDraft>(blankBroker);
  const [brokerSaving, setBrokerSaving] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Asset | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [priorityOnly, setPriorityOnly] = useState(true);
  const [selectedFleetIds, setSelectedFleetIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"all" | "missing" | "quoted" | "ready">("all");
  const documents = useMemo(() => new Set(insuranceDocumentIds), [insuranceDocumentIds]);
  const refresh = useCallback(async () => {
    setBusy(true);
    const result = await supabase.from("vehicle_insurance_quotes").select("*").order("created_at", { ascending: false });
    if (result.error) {
      setError(result.error.message + " — Run the provided quote-centre SQL migration first.");
      setQuotes([]);
    } else { setQuotes((result.data ?? []) as Quote[]); setError(null); }
    const profileResult = await supabase.from("vehicle_insurance_broker_profiles").select("*");
    if (profileResult.error) { setProfileError(profileResult.error.message); setProfiles([]); }
    else { setProfileError(null); setProfiles((profileResult.data ?? []) as BrokerProfile[]); }
    setBusy(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const quoteMap = useMemo(() => {
    const m = new Map<string, Quote[]>();
    for (const q of quotes) m.set(q.insurance_record_id, [...(m.get(q.insurance_record_id) ?? []), q]);
    return m;
  }, [quotes]);
  const profileMap = useMemo(() => new Map(profiles.map(p => [p.insurance_record_id, p])), [profiles]);
  const editBroker = (r: Asset) => { setBrokerEditing(r.id); setBrokerDraft(toBrokerDraft(profileMap.get(r.id))); setProfileError(null); };
  const saveBroker = async () => {
    if (!brokerEditing || brokerSaving) return;
    const weight = decimalOrNull(brokerDraft.gross_weight_kg);
    const load = decimalOrNull(brokerDraft.permitted_load_kg);
    if ([weight, load].some(v => v != null && (!Number.isFinite(v) || v <= 0))) { setProfileError(isThai ? "น้ำหนักรถต้องมากกว่าศูนย์" : "Weights must be positive numbers."); return; }
    setBrokerSaving(true); setProfileError(null);
    const payload = { insurance_record_id: brokerEditing, gross_weight_kg: weight, permitted_load_kg: load, vehicle_usage: brokerDraft.vehicle_usage.trim() || null, cargo_type: brokerDraft.cargo_type.trim() || null, operating_routes: brokerDraft.operating_routes.trim() || null, cross_border: brokerDraft.cross_border === "" ? null : brokerDraft.cross_border === "true", claims_history: brokerDraft.claims_history.trim() || null, driver_restrictions: brokerDraft.driver_restrictions.trim() || null, coverage_requirements: brokerDraft.coverage_requirements.trim() || null, updated_at: new Date().toISOString() };
    const result = await supabase.from("vehicle_insurance_broker_profiles").upsert(payload, {onConflict: "insurance_record_id"}).select("*").single();
    setBrokerSaving(false);
    if (result.error) { setProfileError(result.error.message); return; }
    setProfiles(current => [...current.filter(p => p.insurance_record_id !== brokerEditing), result.data as BrokerProfile]); setBrokerEditing(null);
  };
  const approved = (r: Asset) => (quoteMap.get(r.id) ?? []).filter(q => q.status === "received" || q.status === "selected");
  const comparable = (r: Asset) => approved(r).filter(q => q.coverage_confirmed && q.quoted_premium >= 0 && (r.insurance_class ?? "").trim().toLowerCase() === (q.insurance_class ?? "").trim().toLowerCase() && r.insured_value != null && q.insured_value != null && q.insured_value >= r.insured_value);
  const lowest = (r: Asset) => comparable(r).sort((a, b) => a.quoted_premium - b.quoted_premium)[0] ?? null;
  const todayLocal = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };
  const plus90Local = () => {
    const next = new Date();
    next.setDate(next.getDate() + 90);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  };
  const rows = useMemo(() => records.filter(r => {
    const term = search.trim().toLowerCase();
    if (term && ![r.vehicle_registration, r.vehicle_make, r.insurer_en, r.insurer_th].some(v => (v ?? "").toLowerCase().includes(term))) return false;
    if (filter === "missing" && needed(r, documents.has(r.id)).length === 0) return false;
    if (filter === "quoted" && !(quoteMap.get(r.id) ?? []).length) return false;
    if (filter === "ready" && needed(r, documents.has(r.id)).length > 0) return false;
    if (priorityOnly && (!r.insurance_expiry_date || r.insurance_expiry_date < todayLocal() || r.insurance_expiry_date > plus90Local())) return false;
    return true;
  }).sort((a, b) => (a.insurance_expiry_date || "9999").localeCompare(b.insurance_expiry_date || "9999")), [records, search, filter, documents, quoteMap, priorityOnly]);
  const ready = records.filter(r => needed(r, documents.has(r.id)).length === 0).length;
  const offers = quotes.filter(q => q.status === "received" || q.status === "selected").length;
  const verifiedSavings = records.reduce((sum, r) => {
    const quote = lowest(r);
    return sum + (quote != null && r.insurance_premium != null ? Math.max(0, r.insurance_premium - quote.quoted_premium) : 0);
  }, 0);
  const selectedFleetSet = new Set(selectedFleetIds);
  const exportFleetRecords = records.filter(r => selectedFleetSet.has(r.id));
  const selectUpcoming = () => {
    const today = todayLocal();
    const until = plus90Local();
    setSelectedFleetIds(records.filter(r => r.insurance_expiry_date && r.insurance_expiry_date >= today && r.insurance_expiry_date <= until).map(r => r.id));
  };
  const selectVisible = () => setSelectedFleetIds(current => Array.from(new Set([...current, ...rows.map(r => r.id)])));
  const toggleFleetVehicle = (id: string) => setSelectedFleetIds(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
  const exportBroker = () => {
    if (!exportFleetRecords.length) { window.alert(isThai ? "กรุณาเลือกรถก่อนส่งออก" : "Select at least one vehicle before exporting."); return; }
    const registrations = exportFleetRecords.map(r => r.vehicle_registration).join(", ");
    const confirmMessage = isThai
      ? `ส่งออกเฉพาะรถ ${exportFleetRecords.length} คันนี้หรือไม่?\n\n${registrations}`
      : `Export ONLY these ${exportFleetRecords.length} selected vehicles?\n\n${registrations}`;
    if (!window.confirm(confirmMessage)) return;
    saveCSV(`EES-fleet-quote-${exportFleetRecords.length}-vehicles.csv`, [
    "Registration", "Make", "Year", "Chassis/VIN", "Current insurer", "Policy number",
    "Expiry date", "Insurance class", "Sum insured THB", "Current premium THB", "Repair type", "Policy scan on file", "Information to verify", "Gross vehicle weight (broker to confirm)", "Cargo / route / cross-border operations (broker to confirm)", "Claims history (broker to confirm)", "Requested quote THB", "Quoted coverage", "Deductible THB", "Gross weight kg", "Permitted load kg", "Vehicle usage", "Cargo", "Routes", "Cross border", "Claims history", "Driver restrictions", "Coverage requirements"
  ], exportFleetRecords.map(r => [r.vehicle_registration, r.vehicle_make, r.vehicle_year, r.chassis_number,
    r.insurer_en || r.insurer_th, r.policy_number, r.insurance_expiry_date, r.insurance_class,
    r.insured_value, r.insurance_premium, r.repair_type, documents.has(r.id) ? "Yes" : "No",
    needed(r, documents.has(r.id)).join("; "), "", "", "", "", "", "", profileMap.get(r.id)?.gross_weight_kg, profileMap.get(r.id)?.permitted_load_kg, profileMap.get(r.id)?.vehicle_usage, profileMap.get(r.id)?.cargo_type, profileMap.get(r.id)?.operating_routes, profileMap.get(r.id)?.cross_border == null ? "" : profileMap.get(r.id)?.cross_border ? "Yes" : "No", profileMap.get(r.id)?.claims_history, profileMap.get(r.id)?.driver_restrictions, profileMap.get(r.id)?.coverage_requirements]));
  };
  const exportComparison = () => saveCSV("EES-insurance-quote-comparison.csv", ["Registration", "Expiry", "Current premium THB", "Insurer quoted", "Quoted premium THB", "Coverage class", "Sum insured THB", "Deductible THB", "Coverage verified", "Status", "Potential saving THB", "Notes"],
    records.flatMap(r => (quoteMap.get(r.id) ?? []).map(q => [r.vehicle_registration, r.insurance_expiry_date,
      r.insurance_premium, q.insurer_name, q.quoted_premium, q.insurance_class, q.insured_value,
      q.deductible, q.coverage_confirmed ? "Yes" : "No", q.status,
      comparable(r).some(x => x.id === q.id) && r.insurance_premium != null ? r.insurance_premium - q.quoted_premium : "Not comparable", q.notes])));
  const save = async () => {
    if (!selected || !draft.insurer_name.trim()) { setError(isThai ? "ระบุชื่อบริษัทประกัน" : "Enter the insurer name."); return; }
    const premium = decimalOrNull(draft.quoted_premium);
    const value = decimalOrNull(draft.insured_value);
    const deductible = decimalOrNull(draft.deductible);
    if (draft.status !== "requested" && (premium == null || !Number.isFinite(premium) || premium < 0)) { setError(isThai ? "ระบุเบี้ยประกันที่ถูกต้อง" : "Enter a valid quoted premium."); return; }
    if ([value, deductible].some(n => n != null && (!Number.isFinite(n) || n < 0))) { setError("Invalid insured value or deductible."); return; }
    setSaving(true); setError(null);
    const result = await supabase.from("vehicle_insurance_quotes").insert({
      insurance_record_id: selected.id, insurer_name: draft.insurer_name.trim(), quoted_premium: premium,
      insurance_class: draft.insurance_class.trim() || null, insured_value: value,
      deductible, coverage_confirmed: draft.coverage_confirmed, status: draft.status,
      quote_date: draft.status === "requested" ? null : new Date().toISOString().slice(0, 10),
      notes: draft.notes.trim() || null
    });
    setSaving(false);
    if (result.error) { setError(result.error.message); return; }
    setSelected(null); setDraft(emptyDraft); await refresh();
  };
  const clearQuote = async (id: string) => {
    if (!window.confirm(isThai ? "ลบใบเสนอราคานี้?" : "Delete this quotation?")) return;
    const result = await supabase.from("vehicle_insurance_quotes").delete().eq("id", id);
    if (result.error) setError(result.error.message); else await refresh();
  };
  const requests = quotes.filter(q => q.status === "requested").length;
  const dueSoon = records.filter(r => r.insurance_expiry_date && r.insurance_expiry_date >= todayLocal() && r.insurance_expiry_date <= plus90Local()).length;
  const fmtDate = (v?: string | null) => { if (!v) return "—"; const d = new Date(`${v.slice(0,10)}T00:00:00`); return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString(isThai ? "th-TH" : "en-GB", {day:"2-digit",month:"short",year:"numeric"}); };
  const needsVerification = (r: Asset) => ["Gross vehicle weight / permitted load", "Cargo type and business use", "Routes and cross-border use", "Claims history", "Driver and usage restrictions", "Excess, exclusions and repair conditions"];
  const startQuote = (r: Asset) => {setSelected(r); setDraft({...emptyDraft,insurance_class:r.insurance_class??"",insured_value:r.insured_value == null ? "" : String(r.insured_value)}); setError(null);};
  return <div className="space-y-4 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[10px] font-bold uppercase tracking-[.17em] text-violet-600">{isThai?"เปรียบเทียบประกันภัยกองรถ":"FLEET INSURANCE · QUOTATIONS"}</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{isThai?"ศูนย์ขอราคาและเปรียบเทียบ":"Insurance Quote Centre"}</h2>
        <p className="mt-1 text-sm text-slate-500">{isThai?"เตรียมข้อมูลรถ ส่งขอราคา ติดตามข้อเสนอ และเปรียบเทียบความคุ้มครอง":"Prepare vehicle details, request prices, track broker responses and compare equivalent cover."}</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={exportBroker} className="btn-secondary inline-flex items-center gap-2 text-xs"><Download className="h-4 w-4" />{isThai?"ส่งออกข้อมูลขอราคา":`Export selected (${exportFleetRecords.length})`}</button><button type="button" onClick={exportComparison} className="btn-secondary inline-flex items-center gap-2 text-xs"><Download className="h-4 w-4" />{isThai?"ส่งออกผลเปรียบเทียบ":"Export comparison CSV"}</button></div>
    </div>
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-100 bg-[#f8f6fc] p-3">
      <span className="text-xs font-semibold text-slate-700">{isThai ? "เลือกคันสำหรับขอราคา" : "Select vehicles for fleet quote"}</span>
      <button type="button" onClick={selectUpcoming} className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-800">{isThai ? "เลือกต่ออายุ 90 วัน" : "Select next 90 days"}</button>
      <button type="button" onClick={selectVisible} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">{isThai ? "เลือกทั้งหมดที่แสดง" : "Select visible"}</button>
      <button type="button" onClick={() => setSelectedFleetIds([])} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">{isThai ? "ล้างที่เลือก" : "Clear selection"}</button>
      <span className="ml-auto text-xs font-semibold text-violet-700">{exportFleetRecords.length} {isThai ? "คันที่เลือก" : "vehicles selected"}</span>
      {exportFleetRecords.length > 0 && <p className="w-full text-[11px] font-medium text-violet-800">{isThai ? "รถที่จะส่งออก" : "Vehicles to export"}: {exportFleetRecords.map(r => r.vehicle_registration).join(", ")}</p>}
      <p className="w-full text-[11px] text-slate-500">{isThai ? "ไฟล์ CSV ไม่รวมไฟล์ PDF ประกันเดิม กรุณาแนบเอกสารเองก่อนส่งให้โบรกเกอร์" : "CSV exports vehicle information only; attach relevant existing policy PDFs separately before emailing brokers."}</p>
    </div>
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
      {[
        {label:isThai?"ต่ออายุใน 90 วัน":"Due within 90 days",value:dueSoon},
        {label:isThai?"ข้อมูลหลักครบ":"Basic records ready",value:ready},
        {label:isThai?"ขอราคาแล้ว":"Requests awaiting reply",value:requests},
        {label:isThai?"ได้รับราคา":"Offers received",value:offers},
        {label:isThai?"ประหยัดที่เปรียบเทียบได้":"Potential comparable saving",value:THB(verifiedSavings)}
      ].map(m=><div key={m.label} className="rounded-xl border border-[#e9e4ef] bg-[#faf9fd] px-3 py-3"><p className="text-[11px] text-slate-500">{m.label}</p><p className="mt-1 text-lg font-semibold tabular-nums text-slate-950">{m.value}</p></div>)}
    </div>
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-xs leading-relaxed text-amber-950"><strong>{isThai?"สำคัญ":"Important"}:</strong> {isThai?"'ข้อมูลหลักครบ' หมายถึงมีข้อมูลพื้นฐานและกรมธรรม์เดิมเท่านั้น ยังต้องตรวจสอบน้ำหนักรถ ลักษณะสินค้า เส้นทาง ประวัติเคลม และเงื่อนไขก่อนส่งขอราคา":"Basic records ready means existing policy information is present — not that the vehicle is fully broker-ready. Gross weight, cargo use, routes, claims history and terms still need checking before a comparable quote can be requested."}</div>
    {profileError && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{isThai?"ข้อมูลแบบฟอร์มโบรกเกอร์: ":"Broker form: "}{profileError}</div>}
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <input aria-label={isThai?"ค้นหารถ":"Search vehicles"} value={search} onChange={e=>setSearch(e.target.value)} className="form-input min-w-[200px] flex-1" placeholder={isThai?"ค้นหาทะเบียนรถ บริษัทประกัน หรือยี่ห้อ":"Search registration, insurer or make"}/>
      <select aria-label="Quote filter" value={filter} onChange={e=>setFilter(e.target.value as typeof filter)} className="form-input w-auto min-w-[165px]"><option value="all">{isThai?"รถทั้งหมด":"All statuses"}</option><option value="missing">{isThai?"ข้อมูลหลักไม่ครบ":"Missing core details"}</option><option value="ready">{isThai?"ข้อมูลหลักครบ":"Core data ready"}</option><option value="quoted">{isThai?"มีใบเสนอราคา":"Has requests / offers"}</option></select>
      <label className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-2 py-2 text-xs text-slate-600"><input type="checkbox" checked={priorityOnly} onChange={e=>setPriorityOnly(e.target.checked)}/>{isThai?"เฉพาะ 90 วัน":"Next 90 days"}</label>
      <button type="button" onClick={()=>void refresh()} className="btn-secondary inline-flex items-center gap-2 text-xs" disabled={busy}><RefreshCw className={`h-4 w-4 ${busy?"animate-spin":""}`}/>{isThai?"รีเฟรช":"Refresh"}</button>
    </div>
    <div className="flex items-center justify-between gap-2"><div><h3 className="font-semibold text-slate-950">{isThai?"รายการรถและการขอราคา":"Vehicles & quotation progress"}</h3><p className="text-xs text-slate-500">{isThai?"กดดูรายละเอียดเพื่อดูข้อมูลประกันเดิมและข้อมูลที่ต้องจัดเตรียม":"Open a vehicle to see its policy, missing details, outstanding checks and offers."}</p></div><span className="text-xs text-slate-500">{rows.length} {isThai?"คัน":"vehicles"}</span></div>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="hidden grid-cols-[28px_1.2fr_1.3fr_1fr_1fr_1.1fr_auto] gap-3 border-b border-slate-100 bg-[#f8f6fc] px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 lg:grid"><span aria-label="Select" /><span>{isThai?"รถ / วันหมดอายุ":"Vehicle / expiry"}</span><span>{isThai?"บริษัท / ชั้นประกัน":"Current insurance"}</span><span>{isThai?"เบี้ยเดิม":"Current premium"}</span><span>{isThai?"สถานะข้อมูล":"Data status"}</span><span>{isThai?"ราคาใหม่":"Best comparable offer"}</span><span></span></div>
      <div className="divide-y divide-slate-100">{rows.map(r=>{ const missing=needed(r,documents.has(r.id)); const best=lowest(r);const allQuotes=quoteMap.get(r.id)??[];const open=expanded===r.id;
        return <div key={r.id} className="bg-white">
          <div className="grid items-center gap-2 px-4 py-3 lg:grid-cols-[28px_1.2fr_1.3fr_1fr_1fr_1.1fr_auto] lg:gap-3">
            <label className="flex items-center" aria-label={`${isThai ? "เลือกรถ" : "Select vehicle"} ${r.vehicle_registration}`}><input type="checkbox" checked={selectedFleetIds.includes(r.id)} onChange={() => toggleFleetVehicle(r.id)} className="h-4 w-4 accent-violet-700" /></label>
            <div><p className="font-semibold text-slate-950">{r.vehicle_registration}</p><p className="mt-0.5 text-xs text-slate-500">{fmtDate(r.insurance_expiry_date)}</p></div>
            <div className="min-w-0"><p className="truncate text-xs font-medium text-slate-800" title={r.insurer_en??r.insurer_th??""}>{r.insurer_en||r.insurer_th||"—"}</p><p className="mt-0.5 text-xs text-slate-500">{r.insurance_class|| (isThai?"ไม่ระบุชั้นประกัน":"Class not recorded")}</p></div>
            <div className="text-sm font-semibold tabular-nums text-slate-900">{THB(r.insurance_premium)}</div>
            <div>{missing.length===0?<span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4"/>{isThai?"ข้อมูลหลักครบ":"Basic data ready"}</span>:<span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><AlertCircle className="h-4 w-4"/>{missing.length} {isThai?"รายการต้องเติม":"fields missing"}</span>}<p className="mt-0.5 text-[11px] text-slate-400">{allQuotes.length} {isThai?"รายการติดต่อ/เสนอราคา":"requests / quotes"}</p></div>
            <div><p className="text-sm font-semibold tabular-nums text-emerald-700">{best?THB(best.quoted_premium):"—"}</p>{best&&r.insurance_premium!=null?<p className="text-[11px] text-slate-500">{isThai?"ส่วนต่าง":"Difference"}: {THB(r.insurance_premium-best.quoted_premium)}</p>:null}</div>
            <button type="button" onClick={()=>setExpanded(open?null:r.id)} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-700 hover:bg-violet-100">{isThai?"รายละเอียด":"Details"}{open?<ChevronUp className="h-4 w-4"/>:<ChevronDown className="h-4 w-4"/>}</button>
          </div>
          {open && <div className="border-t border-violet-100 bg-[#fbfafd] px-4 py-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><FileText className="h-4 w-4 text-violet-700"/><h4 className="text-sm font-semibold">{isThai?"รายละเอียดกรมธรรม์เดิม":"Existing policy details"}</h4></div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 text-xs">{[[isThai?"ยี่ห้อ":"Make",r.vehicle_make],[isThai?"ปีรถ":"Year",r.vehicle_year],[isThai?"เลขตัวถัง":"Chassis / VIN",r.chassis_number],[isThai?"เลขกรมธรรม์":"Policy number",r.policy_number],[isThai?"ชั้นประกัน":"Insurance class",r.insurance_class],[isThai?"ทุนประกัน":"Sum insured",THB(r.insured_value)],[isThai?"ประเภทซ่อม":"Repair type",r.repair_type],[isThai?"มีเอกสาร":"Policy document",documents.has(r.id)?(isThai?"มี":"On file"):(isThai?"ไม่มี":"Not on file")]].map(([label,value],i)=><div key={i}><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 break-words font-medium text-slate-900">{value??"—"}</dd></div>)}</dl>
              </section>
              <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-amber-700"/><h4 className="text-sm font-semibold">{isThai?"เตรียมข้อมูลเพื่อขอราคา":"Quote preparation checklist"}</h4></div>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{isThai?"ข้อมูลพื้นฐานที่ยังขาด":"Missing core information"}</p>
                <div className="mt-1 space-y-1">{missing.length?missing.map(m=><p key={m} className="text-xs text-amber-800">• {m}</p>):<p className="text-xs text-emerald-700">{isThai?"ข้อมูลพื้นฐานครบ":"Existing policy data complete"}</p>}</div>
                <div className="mt-3 flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-800">{isThai?"ข้อมูลสำหรับโบรกเกอร์":"Broker information"}</p><span className={`text-[11px] ${brokerGaps(profileMap.get(r.id)) === 0 ? "text-emerald-700" : "text-amber-700"}`}>{brokerGaps(profileMap.get(r.id)) === 0 ? (isThai?"กรอกข้อมูลหลักครบ":"7/7 core fields complete") : `${7-brokerGaps(profileMap.get(r.id))}/7 ${isThai?"ข้อมูลหลัก":"core fields"}`}</span></div>
                <div className="mt-2 space-y-1 text-xs text-slate-600">
                  {[[isThai?"น้ำหนักรวมรถ":"Gross weight",profileMap.get(r.id)?.gross_weight_kg ? `${profileMap.get(r.id)?.gross_weight_kg} kg` : null],[isThai?"น้ำหนักบรรทุก":"Permitted load",profileMap.get(r.id)?.permitted_load_kg ? `${profileMap.get(r.id)?.permitted_load_kg} kg` : null],[isThai?"ลักษณะงาน":"Usage",profileMap.get(r.id)?.vehicle_usage],[isThai?"สินค้า":"Cargo",profileMap.get(r.id)?.cargo_type],[isThai?"เส้นทาง":"Routes",profileMap.get(r.id)?.operating_routes],[isThai?"ข้ามแดน":"Cross-border",profileMap.get(r.id)?.cross_border == null ? null : profileMap.get(r.id)?.cross_border ? (isThai?"ใช่":"Yes") : (isThai?"ไม่":"No")],[isThai?"ประวัติเคลม":"Claims",profileMap.get(r.id)?.claims_history]].map(([label,value],i)=><div key={i} className="flex justify-between gap-2"><span>{label}</span><span className={value?"font-medium text-slate-800":"text-amber-700"}>{value || (isThai?"ยังไม่ระบุ":"Not recorded")}</span></div>)}
                </div>
                <button type="button" onClick={()=>editBroker(r)} className="mt-3 w-full rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700">{isThai?"แก้ไขข้อมูลสำหรับโบรกเกอร์":"Edit broker information"}</button>
                <p className="mt-2 text-[11px] text-slate-500">{isThai?"ต้องตรวจสอบส่วนแรก ข้อยกเว้น และเงื่อนไขการซ่อมก่อนเลือกกรมธรรม์":"Also verify excess, exclusions and repair conditions before accepting any offer."}</p>
              </section>
              <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-violet-700"/><h4 className="text-sm font-semibold">{isThai?"คำขอราคาและข้อเสนอ":"Requests & offers"}</h4></div>
                <div className="mt-3 space-y-2">{allQuotes.length?allQuotes.map(q=><div key={q.id} className="rounded-lg border border-slate-100 bg-[#faf9fd] p-2.5"><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold text-slate-900">{q.insurer_name}</p><p className="text-[11px] text-slate-500">{q.status} · {q.quote_date?fmtDate(q.quote_date): (isThai?"รอราคา":"Awaiting offer")}</p></div><button type="button" onClick={()=>void clearQuote(q.id)} aria-label="Delete quotation" className="rounded p-1 text-rose-600 hover:bg-rose-50"><X className="h-4 w-4"/></button></div><p className="mt-1 text-sm font-semibold">{THB(q.quoted_premium)}</p><p className="text-[11px] text-slate-500">{q.insurance_class??"—"} · {isThai?"ทุนประกัน":"Sum insured"} {THB(q.insured_value)} · {isThai?"ส่วนแรก":"Deductible"} {THB(q.deductible)}</p><p className={`mt-1 text-[11px] ${comparable(r).some(v=>v.id===q.id)?"text-emerald-700":"text-amber-700"}`}>{comparable(r).some(v=>v.id===q.id)?(isThai?"ผ่านเงื่อนไขพื้นฐานเพื่อเปรียบเทียบ":"Meets basic comparison rules"):(isThai?"ยังไม่ยืนยันความเทียบเท่า":"Equivalence not confirmed")}</p>{q.notes&&<p className="mt-1 text-[11px] text-slate-600">{q.notes}</p>}</div>):<p className="text-xs text-slate-500">{isThai?"ยังไม่มีการขอราคาหรือข้อเสนอ":"No quote requests or offers recorded yet."}</p>}</div>
                <button type="button" onClick={()=>startQuote(r)} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-700 px-3 py-2.5 text-xs font-semibold text-white hover:bg-violet-800"><Plus className="h-4 w-4"/>{isThai?"บันทึกการขอราคา / ใบเสนอราคา":"Record request or offer"}</button>
              </section>
            </div>
          </div>}
        </div>})}
        {!rows.length&&<p className="px-4 py-8 text-center text-sm text-slate-500">{isThai?"ไม่พบรถตามตัวกรอง":"No vehicles match these filters."}</p>}
      </div>
    </div>
    {brokerEditing && <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/50 p-3" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setBrokerEditing(null);}}>
      <div role="dialog" aria-modal="true" aria-label={isThai?"แบบฟอร์มข้อมูลโบรกเกอร์":"Broker information form"} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-2"><div><h3 className="text-lg font-semibold text-slate-950">{isThai?"ข้อมูลรถเพื่อขอราคา":"Broker quotation information"}</h3><p className="text-xs text-slate-500">{records.find(r=>r.id===brokerEditing)?.vehicle_registration} · {isThai?"บันทึกครั้งเดียว ใช้ได้ในปีต่อไป":"Save once and reuse for future renewals"}</p></div><button onClick={()=>setBrokerEditing(null)} aria-label="Close"><X className="h-5 w-5"/></button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {([["gross_weight_kg",isThai?"น้ำหนักรวมรถ (กก.)":"Gross vehicle weight (kg)"],["permitted_load_kg",isThai?"น้ำหนักบรรทุกที่อนุญาต (กก.)":"Permitted load (kg)"]] as const).map(([field,label])=><label key={field} className="text-xs font-semibold text-slate-600">{label}<input type="number" min="1" step="0.01" className="form-input mt-1 w-full" placeholder={isThai?"ดูจากเล่มทะเบียน":"From registration book"} value={brokerDraft[field]} onChange={e=>setBrokerDraft(d=>({...d,[field]:e.target.value}))}/></label>)}
          <label className="text-xs font-semibold text-slate-600">{isThai?"ลักษณะการใช้รถ":"Vehicle usage"}<select className="form-input mt-1 w-full" value={brokerDraft.vehicle_usage} onChange={e=>setBrokerDraft(d=>({...d,vehicle_usage:e.target.value}))}><option value="">{isThai?"เลือก":"Select"}</option><option value="Commercial goods transport">Commercial goods transport</option><option value="Own goods transport">Own goods transport</option><option value="Other">Other</option></select></label>
          <label className="text-xs font-semibold text-slate-600">{isThai?"ประวัติเคลม":"Claims history (typically 3 years)"}<select className="form-input mt-1 w-full" value={brokerDraft.claims_history} onChange={e=>setBrokerDraft(d=>({...d,claims_history:e.target.value}))}><option value="">{isThai?"ยังไม่ยืนยัน":"To confirm"}</option><option value="No claims">No claims</option><option value="Claims reported">Claims reported</option><option value="Unknown">Unknown / request claims certificate</option></select></label>
          <label className="text-xs font-semibold text-slate-600">{isThai?"ประเภทสินค้าที่ขน":"Cargo carried"}<input className="form-input mt-1 w-full" value={brokerDraft.cargo_type} placeholder="e.g. General cargo, machinery" onChange={e=>setBrokerDraft(d=>({...d,cargo_type:e.target.value}))}/></label>
          <label className="text-xs font-semibold text-slate-600">{isThai?"เส้นทางปฏิบัติงาน":"Operating routes"}<input className="form-input mt-1 w-full" value={brokerDraft.operating_routes} placeholder="e.g. Bangkok and nationwide" onChange={e=>setBrokerDraft(d=>({...d,operating_routes:e.target.value}))}/></label>
          <label className="text-xs font-semibold text-slate-600">{isThai?"เดินทางข้ามประเทศ":"Cross-border operations"}<select className="form-input mt-1 w-full" value={brokerDraft.cross_border} onChange={e=>setBrokerDraft(d=>({...d,cross_border:e.target.value}))}><option value="">{isThai?"ยังไม่ยืนยัน":"To confirm"}</option><option value="false">{isThai?"ไม่":"No"}</option><option value="true">{isThai?"ใช่":"Yes"}</option></select></label>
          <label className="text-xs font-semibold text-slate-600">{isThai?"ข้อจำกัดผู้ขับ":"Driver / use restrictions"}<input className="form-input mt-1 w-full" value={brokerDraft.driver_restrictions} onChange={e=>setBrokerDraft(d=>({...d,driver_restrictions:e.target.value}))}/></label>
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">{isThai?"เงื่อนไขที่ต้องการ / ข้อยกเว้น":"Requested cover / exclusions to check"}<textarea rows={3} className="form-input mt-1 w-full" value={brokerDraft.coverage_requirements} onChange={e=>setBrokerDraft(d=>({...d,coverage_requirements:e.target.value}))}/></label>
        </div>
        {profileError&&<p className="mt-3 text-xs text-rose-700">{profileError}</p>}
        <div className="mt-4 flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setBrokerEditing(null)}>{isThai?"ยกเลิก":"Cancel"}</button><button className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={brokerSaving} onClick={()=>void saveBroker()}>{brokerSaving?"...":isThai?"บันทึกข้อมูลรถ":"Save broker details"}</button></div>
      </div>
    </div>}
    {selected && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-3" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null);}}>
      <div role="dialog" aria-modal="true" aria-label={isThai?"เพิ่มใบเสนอราคา":"Add insurance quotation"} className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between"><div><h3 className="text-lg font-semibold">{isThai?"บันทึกใบเสนอราคา":"Record a quotation"}</h3><p className="text-sm text-slate-500">{selected.vehicle_registration} · {isThai?"เบี้ยเดิม":"Existing"} {THB(selected.insurance_premium)}</p></div><button onClick={()=>setSelected(null)} aria-label="Close"><X className="h-5 w-5" /></button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">{isThai?"บริษัทประกัน / โบรกเกอร์":"Insurer / broker"}<input className="form-input mt-1 w-full" value={draft.insurer_name} onChange={e=>setDraft(d=>({...d,insurer_name:e.target.value}))} /></label>
          <label className="text-xs font-semibold text-slate-600">{isThai?"สถานะ":"Status"}<select className="form-input mt-1 w-full" value={draft.status} onChange={e=>setDraft(d=>({...d,status:e.target.value as Quote["status"]}))}><option value="requested">{isThai?"ขอราคาแล้ว":"Requested"}</option><option value="received">{isThai?"ได้รับราคาแล้ว":"Received"}</option><option value="rejected">{isThai?"ไม่เลือก":"Rejected"}</option><option value="selected">{isThai?"เลือกแล้ว":"Selected"}</option></select></label>
          <label className="text-xs font-semibold text-slate-600">{isThai?"เบี้ยที่เสนอ (บาท)":"Quoted premium (THB)"}<input type="number" min="0" step="0.01" className="form-input mt-1 w-full" value={draft.quoted_premium} onChange={e=>setDraft(d=>({...d,quoted_premium:e.target.value}))}/></label>
          <label className="text-xs font-semibold text-slate-600">{isThai?"ประเภทประกัน":"Coverage class"}<input className="form-input mt-1 w-full" placeholder={selected.insurance_class ?? "e.g. Class 1"} value={draft.insurance_class} onChange={e=>setDraft(d=>({...d,insurance_class:e.target.value}))}/></label>
          <label className="text-xs font-semibold text-slate-600">{isThai?"ทุนประกัน":"Sum insured (THB)"}<input type="number" min="0" className="form-input mt-1 w-full" value={draft.insured_value} onChange={e=>setDraft(d=>({...d,insured_value:e.target.value}))}/></label>
          <label className="text-xs font-semibold text-slate-600">{isThai?"ค่าเสียหายส่วนแรก":"Deductible (THB)"}<input type="number" min="0" className="form-input mt-1 w-full" value={draft.deductible} onChange={e=>setDraft(d=>({...d,deductible:e.target.value}))}/></label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 sm:col-span-2"><input type="checkbox" checked={draft.coverage_confirmed} onChange={e=>setDraft(d=>({...d,coverage_confirmed:e.target.checked}))}/>{isThai?"ตรวจสอบเงื่อนไขความคุ้มครองกับกรมธรรม์เดิมแล้ว":"I have checked coverage terms against the existing policy"}</label>
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">{isThai?"หมายเหตุ / ข้อยกเว้น":"Notes / exclusions"}<textarea className="form-input mt-1 w-full" rows={3} value={draft.notes} onChange={e=>setDraft(d=>({...d,notes:e.target.value}))}/></label>
        </div>
        <div className="mt-4 flex justify-end gap-2"><button onClick={()=>setSelected(null)} className="btn-secondary">{isThai?"ยกเลิก":"Cancel"}</button><button disabled={saving} onClick={()=>void save()} className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "..." : isThai?"บันทึก":"Save quote"}</button></div>
      </div>
    </div>}
  </div>;
}
