"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Heart, LoaderCircle, MapPin, Pencil, Plus, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccountAccess } from "@/lib/use-account-access";
import { EESLogo } from "@/components/ees-logo";

type Location = {
  id: string; company_name: string; thai_name: string | null; alternative_names: string[];
  address: string; province: string | null; destination_type: string; google_maps_url: string | null;
  truck_entrance_url: string | null; verification_status: "verified" | "needs_check";
  verified_at: string | null; notes: string | null; source_info: string | null;
  created_at: string; updated_at: string;
};
type Activity = { location_id: string; is_favourite: boolean; last_used_at: string | null };
type Filter = "all" | "verified" | "needs_check" | "favourites" | "recent";
const types = ["Factory", "Warehouse", "Airport", "Port", "Customer", "Depot", "Other"];
const blank = { company_name: "", thai_name: "", alternative_names: "", address: "", province: "", destination_type: "Customer", google_maps_url: "", truck_entrance_url: "", verification_status: "needs_check", notes: "", source_info: "", verification_evidence: "" };
const labels: Record<Filter, string> = { all: "All locations", verified: "Verified", needs_check: "Needs check", favourites: "Favourites", recent: "Recently used" };
const verificationEvidencePrefix = "Verification evidence: ";

function extractVerificationEvidence(sourceInfo: string | null) {
  return sourceInfo?.split(/\r?\n/).find((line) => line.startsWith(verificationEvidencePrefix))?.slice(verificationEvidencePrefix.length) ?? "";
}

function sourceInfoWithoutVerificationEvidence(sourceInfo: string | null) {
  return sourceInfo?.split(/\r?\n/).filter((line) => !line.startsWith(verificationEvidencePrefix)).join("\n").trim() ?? "";
}

export function LocationsDirectory() {
  const { can } = useAccountAccess();
  const canEdit = can("business:write");
  const [locations, setLocations] = useState<Location[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Location | "new" | false>(false);
  const [saving, setSaving] = useState(false);

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Your session has expired. Please sign in again.");
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, ...init?.headers } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Unable to load locations.");
    return body;
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const data = await request("/api/locations"); setLocations(data.locations); setActivity(data.activity); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load locations."); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);

  const activityById = useMemo(() => new Map(activity.map((item) => [item.location_id, item])), [activity]);
  const visible = useMemo(() => locations.filter((location) => {
    const words = [location.company_name, location.thai_name, ...location.alternative_names, location.address, location.province, location.destination_type].filter(Boolean).join(" ").toLocaleLowerCase();
    if (query.trim() && !words.includes(query.trim().toLocaleLowerCase())) return false;
    const item = activityById.get(location.id);
    if (filter === "verified" && location.verification_status !== "verified") return false;
    if (filter === "needs_check" && location.verification_status !== "needs_check") return false;
    if (filter === "favourites" && !item?.is_favourite) return false;
    if (filter === "recent" && !item?.last_used_at) return false;
    return true;
  }).sort((a, b) => filter === "recent" ? (activityById.get(b.id)?.last_used_at ?? "").localeCompare(activityById.get(a.id)?.last_used_at ?? "") : a.company_name.localeCompare(b.company_name)), [locations, activityById, query, filter]);

  async function markUsed(location: Location) {
    try { await request(`/api/locations/${location.id}`, { method: "POST", body: JSON.stringify({ action: "use" }) });
      setActivity((current) => [...current.filter((item) => item.location_id !== location.id), { location_id: location.id, is_favourite: activityById.get(location.id)?.is_favourite ?? false, last_used_at: new Date().toISOString() }]); }
    catch { /* Navigation remains available when activity tracking is temporarily unavailable. */ }
  }
  async function toggleFavourite(location: Location) {
    const value = !activityById.get(location.id)?.is_favourite;
    try { await request(`/api/locations/${location.id}`, { method: "POST", body: JSON.stringify({ action: "favourite", value }) });
      setActivity((current) => [...current.filter((item) => item.location_id !== location.id), { location_id: location.id, is_favourite: value, last_used_at: activityById.get(location.id)?.last_used_at ?? null }]); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save favourite."); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    payload.alternative_names = String(payload.alternative_names ?? "").split(/[\n,;]/).map((name) => name.trim()).filter(Boolean).join(",");
    setSaving(true); setError("");
    try {
      const item = { ...payload, alternative_names: String(payload.alternative_names).split(",").filter(Boolean) };
      const data = await request(editing && editing !== "new" ? `/api/locations/${editing.id}` : "/api/locations", { method: editing && editing !== "new" ? "PATCH" : "POST", body: JSON.stringify(item) });
      setLocations((current) => editing && editing !== "new" ? current.map((row) => row.id === data.location.id ? data.location : row) : [...current, data.location]);
      setEditing(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save location."); }
    finally { setSaving(false); }
  }

  const formData = editing && editing !== "new" ? {
    ...blank,
    ...editing,
    alternative_names: editing.alternative_names.join(", "),
    verification_status: editing.verification_status,
    source_info: sourceInfoWithoutVerificationEvidence(editing.source_info),
    verification_evidence: extractVerificationEvidence(editing.source_info)
  } : blank;

  return <main className="mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-6 sm:pb-12 sm:pt-8">
    <header className="mb-5 flex items-center gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white"><EESLogo alt="EES" size={48} className="h-12 w-12 object-contain" priority /></div>
      <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[.2em] text-[#E86B24]">EES Fuel Bank</p><h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Locations Directory</h1></div>
      {canEdit && <button onClick={() => setEditing("new")} className="flex min-h-12 items-center gap-2 rounded-2xl bg-[#E86B24] px-4 font-semibold text-white shadow-sm hover:bg-orange-700"><Plus className="h-5 w-5" /><span className="hidden sm:inline">Add location</span></button>}
    </header>

    <section className="sticky top-0 z-20 -mx-4 border-y border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:rounded-3xl sm:border sm:p-4">
      <label className="flex h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-100"><Search className="h-5 w-5 shrink-0 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, address or province" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400" aria-label="Search locations" />{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X className="h-5 w-5 text-slate-400" /></button>}</label>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5" role="group" aria-label="Filter locations">{(Object.keys(labels) as Filter[]).map((key) => <button key={key} onClick={() => setFilter(key)} className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold transition ${filter === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{labels[key]}</button>)}</div>
    </section>

    {error && <div role="alert" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}{error.includes("migration") && <p className="mt-1">Apply <code>supabase/migrations/20261019100000_ees_locations_directory.sql</code> and reload.</p>}</div>}
    <div className="mb-3 mt-5 flex items-center justify-between text-sm text-slate-500"><span>{loading ? "Loading locations…" : `${visible.length} ${visible.length === 1 ? "location" : "locations"}`}</span>{!loading && <button onClick={() => void load()} className="font-semibold text-slate-600">Refresh</button>}</div>
    {loading ? <div className="flex min-h-48 items-center justify-center text-slate-500"><LoaderCircle className="mr-2 h-5 w-5 animate-spin" />Loading directory…</div> : visible.length ? <div className="grid gap-3 lg:grid-cols-2">{visible.map((location) => {
      const item = activityById.get(location.id); const map = location.google_maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`;
      return <article key={location.id} className="rounded-[1.4rem] border border-slate-200 bg-white p-4 shadow-[0_3px_14px_rgba(15,23,42,.045)] sm:p-5">
        <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold leading-snug text-slate-900">{location.company_name}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${location.verification_status === "verified" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{location.verification_status === "verified" ? "Verified" : "Needs check"}</span></div>{location.thai_name && <p className="mt-0.5 text-sm text-slate-500">{location.thai_name}</p>}</div><button onClick={() => void toggleFavourite(location)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-400 hover:text-rose-500" aria-label={item?.is_favourite ? "Remove favourite" : "Add favourite"}><Heart className={`h-5 w-5 ${item?.is_favourite ? "fill-rose-500 text-rose-500" : ""}`} /></button></div>
        <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">{location.address}{location.province ? `, ${location.province}` : ""}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="rounded-lg bg-slate-100 px-2.5 py-1.5 font-medium text-slate-700">{location.destination_type}</span>{location.verification_status === "verified" && location.verified_at && <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-emerald-600" />Checked {new Date(location.verified_at).toLocaleDateString()}</span>}</div>
        {location.notes && <p className="mt-3 rounded-xl bg-orange-50/70 px-3 py-2.5 text-sm leading-5 text-slate-700">{location.notes}</p>}
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2"><a href={map} target="_blank" rel="noreferrer" onClick={() => void markUsed(location)} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#E86B24] px-3 text-sm font-bold text-white hover:bg-orange-700"><MapPin className="h-4 w-4" />Open in Google Maps<ArrowUpRight className="h-4 w-4" /></a>{location.truck_entrance_url && <a href={location.truck_entrance_url} target="_blank" rel="noreferrer" onClick={() => void markUsed(location)} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 text-sm font-semibold text-orange-800">Truck entrance<ArrowUpRight className="h-4 w-4" /></a>}</div>
        {location.verification_status === "needs_check" && <p className="mt-2 text-xs text-slate-500">{location.google_maps_url ? "Stored map link is not verified; confirm the pin before travel." : "Address search link; map pin has not been confirmed."}</p>}
        {canEdit && <button onClick={() => setEditing(location)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"><Pencil className="h-4 w-4" />Edit location</button>}
      </article>;
    })}</div> : <div className="mt-2 rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><MapPin className="h-6 w-6" /></div><h2 className="mt-4 text-lg font-bold text-slate-900">{locations.length ? "No matching locations" : "Your locations directory is ready"}</h2><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">{locations.length ? "Try another search or filter." : "Add your first destination, or import the historical directory after reviewing the supplied workbook."}</p>{canEdit && !locations.length && <button onClick={() => setEditing("new")} className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#E86B24] px-5 font-semibold text-white"><Plus className="h-5 w-5" />Add a location</button>}</div>}

    {editing !== false && <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 p-3 sm:flex sm:items-center sm:justify-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(false); }}><section role="dialog" aria-modal="true" aria-labelledby="location-form-title" className="mx-auto my-2 max-h-[calc(100dvh-1rem)] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:my-0 sm:p-7"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-[#E86B24]">EES Locations</p><h2 id="location-form-title" className="mt-1 text-xl font-bold">{editing && editing !== "new" ? "Edit location" : "Add location"}</h2></div><button onClick={() => setEditing(false)} aria-label="Close form" className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100"><X className="h-5 w-5" /></button></div>
      <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2"><input type="hidden" name="source_info" value={formData.source_info ?? ""} />{[["company_name", "Company / destination name", true], ["thai_name", "Thai name", false], ["alternative_names", "Alternative names (comma separated)", false], ["address", "Full address", true], ["province", "Province", false], ["google_maps_url", "Google Maps link (optional)", false], ["truck_entrance_url", "Truck entrance link (optional)", false]].map(([name, label, required]) => <label key={String(name)} className={`grid gap-1.5 text-sm font-semibold text-slate-700 ${name === "address" ? "sm:col-span-2" : ""}`}>{label}{name === "address" ? <textarea name={String(name)} required={Boolean(required)} defaultValue={String(formData[name as keyof typeof formData] ?? "")} rows={3} className="rounded-xl border border-slate-200 px-3.5 py-3 font-normal outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" /> : <input name={String(name)} required={Boolean(required)} type={String(name).includes("url") ? "url" : "text"} defaultValue={String(formData[name as keyof typeof formData] ?? "")} className="min-h-11 rounded-xl border border-slate-200 px-3.5 font-normal outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" />}</label>)}
      <label className="grid gap-1.5 text-sm font-semibold text-slate-700">Destination type<select name="destination_type" defaultValue={formData.destination_type} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3"><option value="Customer">Customer</option>{types.filter((item) => item !== "Customer").map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="grid gap-1.5 text-sm font-semibold text-slate-700">Verification status<select name="verification_status" defaultValue={formData.verification_status} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3"><option value="needs_check">Needs check</option><option value="verified">Verified</option></select></label>
      <label className="grid gap-1.5 text-sm font-semibold text-slate-700 sm:col-span-2">Destination notes<textarea name="notes" defaultValue={formData.notes ?? ""} rows={3} className="rounded-xl border border-slate-200 px-3.5 py-3 font-normal outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" /></label>
      <label className="grid gap-1.5 text-sm font-semibold text-slate-700 sm:col-span-2">Verification evidence reference<input name="verification_evidence" defaultValue={formData.verification_evidence} maxLength={2048} placeholder="Official source URL or site/pin check reference" className="min-h-11 rounded-xl border border-slate-200 px-3.5 font-normal outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" /></label>
      <p className="text-xs leading-5 text-slate-500 sm:col-span-2">A reference is required to mark Verified. Check the address and exact map pin; a historical source or address search link alone is not confirmation.</p>
      <div className="flex gap-3 pt-1 sm:col-span-2"><button type="button" onClick={() => setEditing(false)} className="min-h-12 flex-1 rounded-xl border border-slate-200 font-semibold text-slate-700">Cancel</button><button disabled={saving} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#E86B24] font-bold text-white disabled:opacity-60">{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}{saving ? "Saving…" : "Save location"}</button></div></form></section></div>}
  </main>;
}
