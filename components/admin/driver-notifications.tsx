"use client";
import { useCallback, useEffect, useState } from "react";
import { getAccessToken } from "@/lib/account-management";
import type { OperationalNotificationsResult } from "@/lib/driver-operations";
import { useLanguage } from "@/lib/language-provider";

export function useDriverNotifications(enabled: boolean) {
  const [data, setData] = useState<OperationalNotificationsResult | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!enabled) return;
    try { const token = await getAccessToken(); const response = await fetch("/api/admin/driver-notifications", { signal, cache: "no-store", headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error(); const payload = await response.json(); if (!signal?.aborted) { setData(payload); setError(false); } }
    catch { if (!signal?.aborted) setError(true); }
  }, [enabled]);
  useEffect(() => { const controller = new AbortController(); if (!enabled) { setData(null); setError(false); return; } void load(controller.signal); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(controller.signal); }, 60000); return () => { controller.abort(); window.clearInterval(timer); }; }, [enabled, load]);
  const markRead = async (id?: string) => {
    if (!enabled || busy) return false;
    setBusy(true);
    try { const token = await getAccessToken(); const response = await fetch("/api/admin/driver-notifications", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(id ? { id } : { all: true }) }); if (!response.ok) throw new Error(); await load(); return true; }
    catch { setError(true); return false; } finally { setBusy(false); }
  };
  return { data, error, busy, markRead, load };
}
export function DriverNotificationList({ state, onOpen }: { state: ReturnType<typeof useDriverNotifications>; onOpen: (href: string) => void }) {
  const { language } = useLanguage(); const th = language === "th";
  const format = (value: string) => new Intl.DateTimeFormat(th ? "th-TH" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value));
  return <>{state.error ? <div role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800">{th ? "โหลดการแจ้งเตือนไม่สำเร็จ" : "Operational notifications unavailable"}<button className="ml-2 underline" onClick={() => void state.load()}>{th ? "ลองอีกครั้ง" : "Retry"}</button></div> : null}{state.data?.items.length ? <section className="border-b border-slate-100 pb-2"><div className="flex justify-between gap-2 px-2 py-2"><h3 className="text-xs font-black text-slate-600">{th ? "ปฏิบัติการคนขับ" : "Driver operations"}</h3><button className="min-h-11 text-xs font-bold text-brand-700 disabled:opacity-50 sm:min-h-0" disabled={state.busy || !state.data.unreadCount} onClick={() => void state.markRead()}>{th ? "อ่านทั้งหมด" : "Mark all read"}</button></div>{state.data.items.map((item) => <article key={item.id} className={`mb-1 rounded-xl border p-3 ${item.readAt ? "border-slate-100 bg-white" : "border-amber-100 bg-amber-50/60"}`}><button type="button" className="min-h-11 w-full break-words text-left" onClick={() => { void state.markRead(item.id); onOpen(`/admin/driver-operations?job=${encodeURIComponent(item.bookingId)}`); }}><p className="text-xs font-black text-slate-900">{th ? "คนขับรอเกิน 30 นาที" : "Driver waiting over 30 minutes"}{!item.readAt ? <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}</p><p className="mt-1 text-xs text-slate-600">{item.driverName} · {item.vehicle || "—"}</p><p className="mt-1 text-xs text-slate-600">{item.customer || "—"} · {item.pickup}</p><p className="mt-1 text-[11px] text-slate-500">{th ? "มาถึง" : "Arrived"} {format(item.arrivedAt)}</p><p className="mt-1 text-[11px] text-slate-400">{format(item.createdAt)} · {item.resolvedAt ? th ? "สิ้นสุดการรอแล้ว" : "Resolved" : th ? "ยังรออยู่" : "Waiting"}</p></button>{!item.readAt ? <button className="mt-1 min-h-11 text-xs font-bold text-brand-700 sm:mt-2 sm:min-h-8" disabled={state.busy} onClick={() => void state.markRead(item.id)}>{th ? "อ่านแล้ว" : "Mark as read"}</button> : null}</article>)}</section> : null}</>;
}
