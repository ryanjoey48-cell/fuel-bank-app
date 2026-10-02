"use client";

import Image from "next/image";
import { useState } from "react";
import type { OperationStatus } from "@/lib/driver-operations";

export const driverStatusCopy = {
  en: { ready: "Ready", pickup: "At pickup", en_route: "En route", delivery: "At delivery", completed: "Completed" },
  th: { ready: "พร้อม", pickup: "อยู่ที่จุดรับ", en_route: "กำลังเดินทาง", delivery: "อยู่ที่จุดส่ง", completed: "จบงานแล้ว" }
} satisfies Record<"en" | "th", Record<OperationStatus, string>>;

export function driverJobAction(language: "en" | "th", status: OperationStatus) {
  if (status === "completed") return language === "th" ? "ดูงานที่จบแล้ว" : "View completed job";
  if (status === "ready") return language === "th" ? "เริ่มงาน" : "Start job";
  return language === "th" ? "ดำเนินงานต่อ" : "Continue job";
}

export function DriverStatusBadge({ language, status }: { language: "en" | "th"; status: OperationStatus }) {
  return <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${status === "completed" ? "bg-emerald-50 text-emerald-800" : status === "ready" ? "bg-orange-50 text-orange-800" : "bg-slate-100 text-[#152638]"}`}>{driverStatusCopy[language][status]}</span>;
}

function AvatarImage({ src, name }: { src: string; name: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <Image unoptimized src={src} alt={name} fill sizes="80px" className={`object-cover transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />;
}

/** Keep initials visible while loading; a newly signed URL gets a fresh attempt. */
export function DriverAvatar({ src, name, className = "h-9 w-9 rounded-full" }: { src?: string | null; name: string; className?: string }) {
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => Array.from(part)[0]).join("").toUpperCase() || "EES";
  return <span role="img" aria-label={name} className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-[#e8edf1] font-bold text-[#152638] ${className}`}><span aria-hidden="true">{initials}</span>{src ? <AvatarImage key={src} src={src} name={name} /> : null}</span>;
}
