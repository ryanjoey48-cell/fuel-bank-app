"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowUpRight, ChevronDown, Heart, Info, LoaderCircle, MapPin, Pencil, Plus, RefreshCw, Search, X } from "lucide-react";
import { EESLogo } from "@/components/ees-logo";
import { useAccountAccess } from "@/lib/use-account-access";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";
import {
  buildGoogleMapsSearchUrl,
  getDispatchRestriction,
  getLocationDisplayName,
  getLocationMapUrl,
  matchesLocationFilter,
  matchesLocationSearch,
  parseAlternativeNames,
  safeGoogleMapsUrl,
  validateLocationForm,
  type LocationFormError
} from "@/lib/locations-directory";
import type { Translation } from "@/lib/translations";

type Location = {
  id: string;
  company_name: string;
  thai_name: string | null;
  alternative_names: string[];
  address: string;
  province: string | null;
  destination_type: string;
  google_maps_url: string | null;
  truck_entrance_url: string | null;
  verification_status: "verified" | "needs_check";
  verified_at: string | null;
  notes: string | null;
  source_info: string | null;
  created_at: string;
  updated_at: string;
};

type Activity = { location_id: string; is_favourite: boolean; last_used_at: string | null };
type Filter = "all" | "favourites" | "recent";
type ApiErrorKey = "load" | "save" | "favourite" | "sessionExpired" | "accessDenied" | "invalidMapUrl" | "verificationEvidenceRequired";
type SuccessKey = "locationSaved" | "favouriteAdded" | "favouriteRemoved";
type LocationCopy = Translation["locations"];
type FormValues = {
  company_name: string;
  thai_name: string;
  alternative_names: string;
  address: string;
  province: string;
  destination_type: string;
  google_maps_url: string;
  truck_entrance_url: string;
  verification_status: "verified" | "needs_check";
  verified_at: string;
  notes: string;
  source_info: string;
  verification_evidence: string;
};

const destinationTypes = ["Factory", "Warehouse", "Airport", "Port", "Customer", "Depot", "Other"] as const;
const categoryKeyByType: Record<(typeof destinationTypes)[number], keyof LocationCopy["destinationTypes"]> = {
  Factory: "factory",
  Warehouse: "warehouse",
  Airport: "airport",
  Port: "port",
  Customer: "customer",
  Depot: "depot",
  Other: "other"
};
const verificationEvidencePrefix = "Verification evidence: ";
const inputClass = "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-base text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const textareaClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-base text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

function emptyForm(): FormValues {
  return {
    company_name: "",
    thai_name: "",
    alternative_names: "",
    address: "",
    province: "",
    destination_type: "Customer",
    google_maps_url: "",
    truck_entrance_url: "",
    verification_status: "needs_check",
    verified_at: "",
    notes: "",
    source_info: "",
    verification_evidence: ""
  };
}

function extractVerificationEvidence(sourceInfo: string | null) {
  return sourceInfo?.split(/\r?\n/).find((line) => line.startsWith(verificationEvidencePrefix))?.slice(verificationEvidencePrefix.length) ?? "";
}

function sourceInfoWithoutVerificationEvidence(sourceInfo: string | null) {
  return sourceInfo?.split(/\r?\n/).filter((line) => !line.startsWith(verificationEvidencePrefix)).join("\n").trim() ?? "";
}

function formFromLocation(location: Location): FormValues {
  return {
    company_name: location.company_name,
    thai_name: location.thai_name ?? "",
    alternative_names: location.alternative_names.join(", "),
    address: location.address,
    province: location.province ?? "",
    destination_type: location.destination_type,
    google_maps_url: location.google_maps_url ?? "",
    truck_entrance_url: location.truck_entrance_url ?? "",
    verification_status: location.verification_status,
    verified_at: location.verified_at ?? "",
    notes: location.notes ?? "",
    source_info: sourceInfoWithoutVerificationEvidence(location.source_info),
    verification_evidence: extractVerificationEvidence(location.source_info)
  };
}

function categoryTerms(type: string, copy: LocationCopy) {
  const key = categoryKeyByType[type as keyof typeof categoryKeyByType];
  if (!key) return [type];
  return [type, copy.destinationTypes[key], ...copy.categorySearchAliases[key]];
}

function apiErrorKey(error: unknown, fallback: Extract<ApiErrorKey, "load" | "save" | "favourite">): ApiErrorKey {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("session has expired")) return "sessionExpired";
  if (message.includes("do not have access") || message.includes("forbidden")) return "accessDenied";
  if (message.includes("map links") || message.includes("google maps over https")) return "invalidMapUrl";
  if (message.includes("verification evidence")) return "verificationEvidenceRequired";
  return fallback;
}

function apiErrorMessage(error: ApiErrorKey, copy: LocationCopy) {
  if (error === "sessionExpired") return copy.sessionExpired;
  if (error === "accessDenied") return copy.accessDenied;
  if (error === "invalidMapUrl") return copy.invalidMapUrl;
  if (error === "verificationEvidenceRequired") return copy.verificationEvidenceRequired;
  return error === "load" ? copy.loadError : error === "favourite" ? copy.favouriteError : copy.saveError;
}

function validationMessage(error: LocationFormError, copy: LocationCopy) {
  if (error === "companyName") return copy.requiredCompanyName;
  if (error === "address") return copy.requiredAddress;
  if (error === "verificationEvidence") return copy.verificationEvidenceRequired;
  return copy.invalidMapUrl;
}

export function LocationsDirectory() {
  const { can } = useAccountAccess();
  const canEdit = can("business:write");
  const { language, t } = useLanguage();
  const copy = t.locations;
  const [locations, setLocations] = useState<Location[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<ApiErrorKey | "">("");
  const [success, setSuccess] = useState<SuccessKey | "">("");
  const [editing, setEditing] = useState<Location | "new" | false>(false);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [formErrors, setFormErrors] = useState<Partial<Record<LocationFormError, true>>>({});
  const [formAlert, setFormAlert] = useState<ApiErrorKey | "">("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingActivity, setPendingActivity] = useState<Set<string>>(() => new Set());
  const dialogRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const dismissEditor = useCallback(() => {
    if (editing === false) return;
    if (dirty && !window.confirm(copy.unsavedChanges)) return;
    setEditing(false);
    setDirty(false);
    setFormAlert("");
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, [editing, dirty, copy.unsavedChanges]);

  const request = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Your session has expired. Please sign in again.");

    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...init?.headers
      }
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error || "Unable to access locations.");
    return body as T;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setPageError("");
    setSuccess("");
    try {
      const data = await request<{ locations: Location[]; activity: Activity[] }>("/api/locations");
      setLocations(Array.isArray(data.locations) ? data.locations : []);
      setActivity(Array.isArray(data.activity) ? data.activity : []);
    } catch (error) {
      setPageError(apiErrorKey(error, "load"));
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (editing === false) return;
    const title = dialogRef.current?.querySelector<HTMLElement>("[data-dialog-title]");
    title?.focus();
  }, [editing]);

  useEffect(() => {
    if (editing === false) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissEditor();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        "a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])"
      )].filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const dialogTitle = dialogRef.current.querySelector("[data-dialog-title]");
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogTitle || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [editing, dirty, dismissEditor]);

  const activityById = useMemo(() => new Map(activity.map((item) => [item.location_id, item])), [activity]);
  const visibleLocations = useMemo(() => locations
    .filter((location) => matchesLocationSearch(location, query, language, categoryTerms(location.destination_type, copy)))
    .filter((location) => {
      return matchesLocationFilter(filter, activityById.get(location.id));
    })
    .sort((a, b) => {
      if (filter === "recent") {
        return (activityById.get(b.id)?.last_used_at ?? "").localeCompare(activityById.get(a.id)?.last_used_at ?? "");
      }
      return getLocationDisplayName(a, language).localeCompare(getLocationDisplayName(b, language), language === "th" ? "th-TH" : "en");
    }), [locations, activityById, query, filter, language, copy]);

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: copy.allLocations },
    { id: "favourites", label: copy.favourites },
    { id: "recent", label: copy.recentlyUsed }
  ];
  const mapPreviewUrl = form.google_maps_url.trim()
    ? safeGoogleMapsUrl(form.google_maps_url)
    : buildGoogleMapsSearchUrl(form.address);

  function openEditor(value: Location | "new", trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    setEditing(value);
    setForm(value === "new" ? emptyForm() : formFromLocation(value));
    setFormErrors({});
    setFormAlert("");
    setDirty(false);
    setPageError("");
    setSuccess("");
  }

  function setFormValue<Key extends keyof FormValues>(key: Key, value: FormValues[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    const errorKey: Partial<Record<keyof FormValues, LocationFormError>> = {
      company_name: "companyName",
      address: "address",
      google_maps_url: "googleMapsUrl",
      truck_entrance_url: "truckEntranceUrl",
      verification_evidence: "verificationEvidence",
      verification_status: "verificationEvidence"
    };
    const keyToClear = errorKey[key];
    if (keyToClear) setFormErrors((current) => ({ ...current, [keyToClear]: undefined }));
  }

  async function markUsed(location: Location) {
    try {
      await request(`/api/locations/${location.id}`, { method: "POST", body: JSON.stringify({ action: "use" }) });
      setActivity((current) => [
        ...current.filter((item) => item.location_id !== location.id),
        { location_id: location.id, is_favourite: activityById.get(location.id)?.is_favourite ?? false, last_used_at: new Date().toISOString() }
      ]);
    } catch {
      // Keep the map link available if activity tracking is temporarily unavailable.
    }
  }

  async function toggleFavourite(location: Location) {
    if (pendingActivity.has(location.id)) return;
    const value = !activityById.get(location.id)?.is_favourite;
    setPendingActivity((current) => new Set(current).add(location.id));
    setPageError("");
    try {
      await request(`/api/locations/${location.id}`, { method: "POST", body: JSON.stringify({ action: "favourite", value }) });
      setActivity((current) => [
        ...current.filter((item) => item.location_id !== location.id),
        { location_id: location.id, is_favourite: value, last_used_at: activityById.get(location.id)?.last_used_at ?? null }
      ]);
      setSuccess(value ? "favouriteAdded" : "favouriteRemoved");
    } catch (error) {
      setPageError(apiErrorKey(error, "favourite"));
    } finally {
      setPendingActivity((current) => {
        const next = new Set(current);
        next.delete(location.id);
        return next;
      });
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setFormAlert("");
    const errors = validateLocationForm(form);
    if (errors.length) {
      setFormErrors(Object.fromEntries(errors.map((error) => [error, true])) as Partial<Record<LocationFormError, true>>);
      const inputId: Record<LocationFormError, string> = {
        companyName: "location-field-companyName",
        address: "location-field-address",
        googleMapsUrl: "location-field-google-maps",
        truckEntranceUrl: "location-field-truck-entrance",
        verificationEvidence: "location-field-evidence"
      };
      document.getElementById(inputId[errors[0]])?.focus();
      return;
    }

    setSaving(true);
    try {
      const isEditing = editing !== false && editing !== "new";
      const payload = {
        ...form,
        company_name: form.company_name.trim(),
        thai_name: form.thai_name.trim(),
        alternative_names: parseAlternativeNames(form.alternative_names),
        address: form.address.trim(),
        province: form.province.trim(),
        google_maps_url: form.google_maps_url.trim(),
        truck_entrance_url: form.truck_entrance_url.trim(),
        notes: form.notes.trim(),
        source_info: form.source_info.trim(),
        verification_evidence: form.verification_evidence.trim(),
        verified_at: form.verified_at || null
      };
      const url = isEditing ? `/api/locations/${editing.id}` : "/api/locations";
      const data = await request<{ location: Location }>(url, {
        method: isEditing ? "PATCH" : "POST",
        body: JSON.stringify(payload)
      });

      setLocations((current) => isEditing
        ? current.map((location) => location.id === data.location.id ? data.location : location)
        : [...current, data.location]);
      setEditing(false);
      setDirty(false);
      setFormErrors({});
      setSuccess("locationSaved");
      requestAnimationFrame(() => returnFocusRef.current?.focus());
    } catch (error) {
      setFormAlert(apiErrorKey(error, "save"));
    } finally {
      setSaving(false);
    }
  }

  function openMapPreview() {
    if (mapPreviewUrl) window.open(mapPreviewUrl, "_blank", "noopener,noreferrer");
  }

  const resultCount = new Intl.NumberFormat(language === "th" ? "th-TH" : "en").format(visibleLocations.length);
  const title = editing === "new" ? copy.addTitle : copy.editTitle;

  return <main className="mx-auto w-full max-w-7xl pb-8 text-slate-800">
    <header className="mb-5 flex items-center gap-3 sm:mb-6 sm:gap-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm sm:h-14 sm:w-14">
        <EESLogo alt="Expert Express Sender" size={52} className="h-11 w-11 object-contain sm:h-[52px] sm:w-[52px]" priority />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[.16em] text-brand-700">EES Fuel Bank</p>
        <h1 className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{copy.title}</h1>
        <p className="mt-0.5 hidden text-sm text-slate-500 sm:block">{copy.subtitle}</p>
      </div>
      {canEdit && <button type="button" onClick={(event) => openEditor("new", event.currentTarget)} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-brand-700 px-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:px-4">
        <Plus className="h-4 w-4" aria-hidden="true" /><span>{copy.addLocation}</span>
      </button>}
    </header>

    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" role="search" aria-label={copy.searchLabel}>
      <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100 sm:px-4">
        <Search className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400" aria-label={copy.searchLabel} />
        {query && <button type="button" onClick={() => setQuery("")} aria-label={copy.clearSearch} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"><X className="h-4 w-4" aria-hidden="true" /></button>}
      </label>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5" role="group" aria-label={copy.filtersLabel}>
        {filters.map((item) => <button key={item.id} type="button" onClick={() => setFilter(item.id)} aria-pressed={filter === item.id} className={`min-h-10 shrink-0 rounded-xl px-4 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${filter === item.id ? "bg-brand-700 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800"}`}>
          {item.label}
        </button>)}
      </div>
    </section>

    {locations.some((location) => location.verification_status === "needs_check") && <p className="mt-3 flex items-start gap-2 rounded-xl bg-brand-50 px-3.5 py-2.5 text-sm leading-5 text-brand-900" role="note">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />{copy.checkPinBeforeDispatch}
    </p>}

    {pageError && <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-900">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p className="min-w-0 flex-1">{apiErrorMessage(pageError, copy)}</p>
      {loading && <LoaderCircle className="h-4 w-4 animate-spin" aria-label={copy.loading} />}
      {!loading && <button type="button" onClick={() => void load()} className="shrink-0 font-bold underline underline-offset-2">{copy.retry}</button>}
    </div>}
    {success && <p role="status" aria-live="polite" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-800">{copy[success]}</p>}

    <div className="mb-3 mt-4 flex min-h-9 items-center justify-between gap-3 text-sm text-slate-500">
      <span aria-live="polite">{loading ? copy.loading : `${resultCount} ${visibleLocations.length === 1 ? copy.oneLocation : copy.manyLocations}`}</span>
      {!loading && <button type="button" onClick={() => void load()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{copy.refresh}
      </button>}
    </div>

    {loading ? <div className="grid gap-3 lg:grid-cols-2" aria-label={copy.loading} aria-busy="true">
      {[1, 2, 3, 4].map((item) => <div key={item} className="h-56 animate-pulse rounded-2xl border border-slate-200 bg-white p-5"><div className="h-5 w-2/3 rounded bg-slate-100" /><div className="mt-4 h-4 w-full rounded bg-slate-100" /><div className="mt-2 h-4 w-4/5 rounded bg-slate-100" /><div className="mt-8 h-11 rounded-xl bg-slate-100" /></div>)}
    </div> : visibleLocations.length > 0 ? <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
      {visibleLocations.map((location) => {
        const item = activityById.get(location.id);
        const mapUrl = getLocationMapUrl(location);
        const truckUrl = safeGoogleMapsUrl(location.truck_entrance_url);
        const restriction = getDispatchRestriction(location);
        const displayName = getLocationDisplayName(location, language);
        const secondaryName = language === "th" && displayName !== location.company_name ? location.company_name : location.thai_name && language === "en" ? location.thai_name : "";
        const category = categoryTerms(location.destination_type, copy)[1] ?? location.destination_type;

        return <article key={location.id} className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_10px_rgba(35,25,55,.035)] transition hover:border-brand-200 hover:shadow-[0_6px_18px_rgba(35,25,55,.07)] sm:p-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="break-words text-lg font-bold leading-snug text-slate-950">{displayName}</h2>
                <span className="rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">{category}</span>
              </div>
              {secondaryName && <p className="mt-1 break-words text-sm text-slate-500">{secondaryName}</p>}
            </div>
            <button type="button" onClick={() => void toggleFavourite(location)} disabled={pendingActivity.has(location.id)} aria-pressed={item?.is_favourite === true} aria-label={item?.is_favourite ? copy.removeFavourite : copy.addFavourite} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-60">
              <Heart className={`h-5 w-5 ${item?.is_favourite ? "fill-rose-500 text-rose-500" : ""}`} aria-hidden="true" />
            </button>
          </div>

          <p className="mt-3 whitespace-pre-line break-words text-sm leading-6 text-slate-700">{location.address}</p>
          {location.province && <p className="mt-1 text-sm text-slate-500">{location.province}</p>}

          {restriction && <div role="note" className="mt-3 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 text-sm leading-5 text-rose-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" aria-hidden="true" />
            <p className="break-words"><strong>{copy.dispatchRestriction}:</strong> {restriction}</p>
          </div>}

          <div className="mt-auto grid gap-2 pt-4 sm:grid-cols-2">
            {mapUrl ? <a href={mapUrl} target="_blank" rel="noopener noreferrer" onClick={() => void markUsed(location)} aria-label={`${copy.map}: ${displayName}`} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-700 px-3 text-sm font-bold text-white transition hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{copy.map}</span><ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </a> : <button type="button" disabled className="min-h-12 rounded-xl bg-slate-100 text-sm font-semibold text-slate-400">{copy.map}</button>}
            {truckUrl && <a href={truckUrl} target="_blank" rel="noopener noreferrer" onClick={() => void markUsed(location)} aria-label={`${copy.truckEntrance}: ${displayName}`} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 text-sm font-semibold text-brand-800 transition hover:bg-brand-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{copy.truckEntrance}</span><ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </a>}
          </div>

          <details className="group mt-3 border-t border-slate-100 pt-2.5">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-1 text-sm font-semibold text-brand-800 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [&::-webkit-details-marker]:hidden">
              <span>{copy.details}</span><ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="grid gap-2.5 px-1 pb-1 pt-2 text-sm">
              <div><p className="font-semibold text-slate-700">{copy.verificationStatus}</p><p className="mt-0.5 text-slate-600">{location.verification_status === "verified" ? copy.verified : copy.needsCheck}{location.verification_status === "verified" && location.verified_at ? ` · ${copy.verifiedOn} ${new Date(location.verified_at).toLocaleDateString(language === "th" ? "th-TH" : "en-GB", { dateStyle: "medium" })}` : ""}</p></div>
              {location.verification_status !== "verified" && <p className="text-xs leading-5 text-slate-500">{copy.mapPinNotConfirmed}</p>}
              <div><p className="font-semibold text-slate-700">{copy.alternativeNames}</p><p className="mt-0.5 break-words text-slate-600">{location.alternative_names.length ? location.alternative_names.join(", ") : copy.noAlternativeNames}</p></div>
              <div><p className="font-semibold text-slate-700">{copy.internalNotes}</p><p className="mt-0.5 whitespace-pre-line break-words text-slate-600">{location.notes || copy.notProvided}</p></div>
              <div><p className="font-semibold text-slate-700">{copy.sourceInformation}</p><p className="mt-0.5 whitespace-pre-line break-words text-slate-600">{location.source_info || copy.notProvided}</p></div>
            </div>
          </details>

          {canEdit && <button type="button" onClick={(event) => openEditor(location, event.currentTarget)} className="mt-2 inline-flex min-h-10 w-fit items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
            <Pencil className="h-4 w-4" aria-hidden="true" />{t.common.edit}
          </button>}
        </article>;
      })}
    </div> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center sm:py-14">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><MapPin className="h-6 w-6" aria-hidden="true" /></div>
      <h2 className="mt-4 text-lg font-bold text-slate-950">{locations.length ? copy.noMatchesTitle : copy.emptyTitle}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">{locations.length ? copy.noMatchesDescription : copy.emptyDescription}</p>
      {canEdit && locations.length === 0 && <button type="button" onClick={(event) => openEditor("new", event.currentTarget)} className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-700 px-5 font-semibold text-white transition hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"><Plus className="h-5 w-5" aria-hidden="true" />{copy.addFirstLocation}</button>}
    </div>}

    {editing !== false && <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-950/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) dismissEditor(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="location-form-title" className="my-auto flex max-h-[100dvh] min-h-[82dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[min(90dvh,900px)] sm:min-h-0 sm:rounded-3xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[.14em] text-brand-700">EES Fuel Bank</p>
            <h2 id="location-form-title" data-dialog-title tabIndex={-1} className="mt-0.5 text-xl font-bold text-slate-950 outline-none">{title}</h2>
          </div>
          <button type="button" onClick={dismissEditor} aria-label={copy.closeForm} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"><X className="h-5 w-5" aria-hidden="true" /></button>
        </header>

        <form onSubmit={save} onChange={() => setDirty(true)} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label htmlFor="location-field-companyName" className="grid min-w-0 gap-1.5 text-sm font-semibold text-slate-700">
                <span>{copy.companyName}<span className="ml-1 text-xs font-medium text-slate-500">· {copy.required}</span></span>
                <input id="location-field-companyName" value={form.company_name} onChange={(event) => setFormValue("company_name", event.target.value)} required autoComplete="organization" aria-invalid={Boolean(formErrors.companyName)} aria-describedby={formErrors.companyName ? "location-error-companyName" : undefined} className={inputClass} />
                {formErrors.companyName && <span id="location-error-companyName" className="text-xs font-medium text-rose-700">{validationMessage("companyName", copy)}</span>}
              </label>

              <label htmlFor="location-field-thai-name" className="grid min-w-0 gap-1.5 text-sm font-semibold text-slate-700">
                <span>{copy.thaiCompanyName}<span className="ml-1 text-xs font-normal text-slate-500">· {copy.optional}</span></span>
                <input id="location-field-thai-name" value={form.thai_name} onChange={(event) => setFormValue("thai_name", event.target.value)} autoComplete="organization" className={inputClass} />
              </label>

              <label htmlFor="location-field-address" className="grid min-w-0 gap-1.5 text-sm font-semibold text-slate-700 sm:col-span-2">
                <span>{copy.fullAddress}<span className="ml-1 text-xs font-medium text-slate-500">· {copy.required}</span></span>
                <textarea id="location-field-address" value={form.address} onChange={(event) => setFormValue("address", event.target.value)} required rows={3} aria-invalid={Boolean(formErrors.address)} aria-describedby={formErrors.address ? "location-error-address" : undefined} className={textareaClass} />
                {formErrors.address && <span id="location-error-address" className="text-xs font-medium text-rose-700">{validationMessage("address", copy)}</span>}
              </label>

              <label htmlFor="location-field-province" className="grid min-w-0 gap-1.5 text-sm font-semibold text-slate-700">
                <span>{copy.province}<span className="ml-1 text-xs font-normal text-slate-500">· {copy.optional}</span></span>
                <input id="location-field-province" value={form.province} onChange={(event) => setFormValue("province", event.target.value)} autoComplete="address-level1" className={inputClass} />
              </label>

              <label htmlFor="location-field-type" className="grid min-w-0 gap-1.5 text-sm font-semibold text-slate-700">
                <span>{copy.category}</span>
                <select id="location-field-type" value={form.destination_type} onChange={(event) => setFormValue("destination_type", event.target.value)} className={inputClass}>
                  {destinationTypes.map((type) => <option key={type} value={type}>{copy.destinationTypes[categoryKeyByType[type]]}</option>)}
                </select>
              </label>

              <label htmlFor="location-field-google-maps" className="grid min-w-0 gap-1.5 text-sm font-semibold text-slate-700 sm:col-span-2">
                <span>{copy.googleMapsLink}<span className="ml-1 text-xs font-normal text-slate-500">· {copy.optional}</span></span>
                <input id="location-field-google-maps" type="url" inputMode="url" value={form.google_maps_url} onChange={(event) => setFormValue("google_maps_url", event.target.value)} placeholder="https://www.google.com/maps/..." aria-invalid={Boolean(formErrors.googleMapsUrl)} aria-describedby={formErrors.googleMapsUrl ? "location-error-googleMapsUrl" : "location-help-google-maps"} className={inputClass} />
                {formErrors.googleMapsUrl && <span id="location-error-googleMapsUrl" className="text-xs font-medium text-rose-700">{validationMessage("googleMapsUrl", copy)}</span>}
                {!formErrors.googleMapsUrl && <span id="location-help-google-maps" className="text-xs font-normal leading-5 text-slate-500">{copy.mapLinkHelp}</span>}
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={openMapPreview} disabled={!mapPreviewUrl} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 text-sm font-semibold text-brand-800 hover:bg-brand-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50"><MapPin className="h-4 w-4" aria-hidden="true" />{copy.testMapLink}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></button>
                </div>
              </label>

              <details className="group rounded-xl border border-slate-200 bg-slate-50/70 sm:col-span-2">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-sm font-semibold text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [&::-webkit-details-marker]:hidden">
                  <span>{copy.advancedDetails}</span><ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="grid gap-4 border-t border-slate-200 px-3.5 py-4 sm:grid-cols-2">
                  <label htmlFor="location-field-truck-entrance" className="grid min-w-0 gap-1.5 text-sm font-semibold text-slate-700 sm:col-span-2">
                    <span>{copy.truckEntrance}<span className="ml-1 text-xs font-normal text-slate-500">· {copy.optional}</span></span>
                    <input id="location-field-truck-entrance" type="url" inputMode="url" value={form.truck_entrance_url} onChange={(event) => setFormValue("truck_entrance_url", event.target.value)} placeholder="https://www.google.com/maps/..." aria-invalid={Boolean(formErrors.truckEntranceUrl)} aria-describedby={formErrors.truckEntranceUrl ? "location-error-truckEntranceUrl" : undefined} className={inputClass} />
                    {formErrors.truckEntranceUrl && <span id="location-error-truckEntranceUrl" className="text-xs font-medium text-rose-700">{validationMessage("truckEntranceUrl", copy)}</span>}
                  </label>

                  <label htmlFor="location-field-alternatives" className="grid min-w-0 gap-1.5 text-sm font-semibold text-slate-700 sm:col-span-2">
                    <span>{copy.alternativeNames}<span className="ml-1 text-xs font-normal text-slate-500">· {copy.optional}</span></span>
                    <textarea id="location-field-alternatives" value={form.alternative_names} onChange={(event) => setFormValue("alternative_names", event.target.value)} rows={2} aria-describedby="location-help-alternatives" className={textareaClass} />
                    <span id="location-help-alternatives" className="text-xs font-normal text-slate-500">{copy.alternativeNamesHelp}</span>
                  </label>

                  <label htmlFor="location-field-notes" className="grid min-w-0 gap-1.5 text-sm font-semibold text-slate-700 sm:col-span-2">
                    <span>{copy.internalNotes}<span className="ml-1 text-xs font-normal text-slate-500">· {copy.optional}</span></span>
                    <textarea id="location-field-notes" value={form.notes} onChange={(event) => setFormValue("notes", event.target.value)} rows={3} className={textareaClass} />
                  </label>

                  <label htmlFor="location-field-source" className="grid min-w-0 gap-1.5 text-sm font-semibold text-slate-700 sm:col-span-2">
                    <span>{copy.sourceReference}<span className="ml-1 text-xs font-normal text-slate-500">· {copy.optional}</span></span>
                    <textarea id="location-field-source" value={form.source_info} onChange={(event) => setFormValue("source_info", event.target.value)} rows={2} className={textareaClass} />
                  </label>

                  <label htmlFor="location-field-verification" className="grid min-w-0 gap-1.5 text-sm font-semibold text-slate-700">
                    <span>{copy.verificationStatus}</span>
                    <select id="location-field-verification" value={form.verification_status} onChange={(event) => setFormValue("verification_status", event.target.value as FormValues["verification_status"])} className={inputClass}>
                      <option value="needs_check">{copy.needsCheckOption}</option>
                      <option value="verified">{copy.verifiedOption}</option>
                    </select>
                    <span className="text-xs font-normal leading-5 text-slate-500">{copy.verificationStatusHelp}</span>
                  </label>

                  <label htmlFor="location-field-evidence" className="grid min-w-0 gap-1.5 text-sm font-semibold text-slate-700">
                    <span>{copy.verificationEvidence}<span className="ml-1 text-xs font-normal text-slate-500">· {copy.optional}</span></span>
                    <input id="location-field-evidence" value={form.verification_evidence} onChange={(event) => setFormValue("verification_evidence", event.target.value)} maxLength={2048} placeholder={copy.sourceReference} aria-invalid={Boolean(formErrors.verificationEvidence)} aria-describedby={formErrors.verificationEvidence ? "location-error-verificationEvidence" : undefined} className={inputClass} />
                    {formErrors.verificationEvidence && <span id="location-error-verificationEvidence" className="text-xs font-medium text-rose-700">{validationMessage("verificationEvidence", copy)}</span>}
                  </label>
                  <input type="hidden" name="verified_at" value={form.verified_at} />
                </div>
              </details>
            </div>

            {formAlert && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-900">{apiErrorMessage(formAlert, copy)}</p>}
          </div>

          <footer className="sticky bottom-0 flex shrink-0 gap-3 border-t border-slate-200 bg-white px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-4">
            <button type="button" onClick={dismissEditor} className="min-h-12 flex-1 rounded-xl border border-slate-200 bg-white font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">{copy.cancel}</button>
            <button type="submit" disabled={saving} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 font-bold text-white transition hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-wait disabled:opacity-65">
              {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}{saving ? copy.saving : copy.saveLocation}
            </button>
          </footer>
        </form>
      </section>
    </div>}
  </main>;
}
