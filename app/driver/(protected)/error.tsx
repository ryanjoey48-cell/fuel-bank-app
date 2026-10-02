"use client";
import { useLanguage } from "@/lib/language-provider";
export default function DriverError({ reset }: { reset: () => void }) {
  const { language } = useLanguage();
  return <main className="mx-auto max-w-3xl p-5"><div role="alert" className="rounded-2xl border border-rose-200 bg-white p-5"><h1 className="text-lg font-bold">{language === "th" ? "โหลดข้อมูลไม่ได้" : "Unable to load driver data"}</h1><p className="mt-2 text-sm text-slate-600">{language === "th" ? "กรุณาลองอีกครั้งหรือติดต่อฝ่ายปฏิบัติการ" : "Please retry or contact operations."}</p><button className="btn-primary mt-4" onClick={reset}>{language === "th" ? "ลองอีกครั้ง" : "Retry"}</button></div></main>;
}
