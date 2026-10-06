"use client";
import { useLanguage } from "@/lib/language-provider";
export default function DriverError({ reset }: { reset: () => void }) {
  const { language } = useLanguage();
  return <main className="mx-auto max-w-3xl p-5"><div role="alert" className="rounded-2xl border border-[var(--driver-border)] bg-[var(--driver-surface)] p-5"><h1 className="text-lg font-bold">{language === "th" ? "โหลดข้อมูลไม่ได้" : "Unable to load driver data"}</h1><p className="mt-2 text-sm text-[var(--driver-text-muted)]">{language === "th" ? "กรุณาลองอีกครั้งหรือติดต่อฝ่ายปฏิบัติการ" : "Please retry or contact operations."}</p><button className="driver-primary-action min-h-11 rounded-xl px-4 mt-4" onClick={reset}>{language === "th" ? "ลองอีกครั้ง" : "Retry"}</button></div></main>;
}
