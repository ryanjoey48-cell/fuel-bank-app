"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import FinanceCentreWorkspace from "@/components/finance-centre-workspace";
import { useLanguage } from "@/lib/language-provider";
import { usesFinanceLocalDemoScreens } from "@/lib/finance-fixture-mode";
import { supabase } from "@/lib/supabase";
import { loadFinanceReadyJobs, type ReadyJob } from "@/lib/finance-ready-jobs";
import { verificationCopy } from "@/lib/job-verification";
import { DEMO_VERIFICATIONS } from "@/lib/job-verification-demo";
import { historicalDemoRecords, historicalWorkbook } from "@/lib/job-verification-historical-demo";

function LiveFinanceCentrePage() {
  const { language } = useLanguage();
  const copy = verificationCopy[language];
  const [demo, setDemo] = useState(false);
  const [historicalDemo, setHistoricalDemo] = useState(false);
  const [ready, setReady] = useState<ReadyJob[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") { setDemo(true); return; }
    if (params.get("demo") === "historical" || process.env.NEXT_PUBLIC_EES_FINANCE_PREVIEW === "1") { setHistoricalDemo(true); return; }
    let active = true;
    void (async () => {
      try {
        const rows = await loadFinanceReadyJobs(supabase);
        if (!active) return;
        setReady(rows);
        setError("");
      } catch {
        if (!active) return;
        setReady([]);
        setError(verificationCopy[language].saveError);
      }
    })();
    return () => { active = false; };
  }, [language]);
  return <main className="finance-centre-workspace w-full max-w-none space-y-5"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">{copy.overview}</h1><p className="text-sm text-slate-600">{language === "th" ? "งานที่ตรวจแล้วและพร้อมส่งฝ่ายการเงิน (ดูอย่างเดียว)" : "Verified jobs ready for finance handover (read only)."}</p></div><div className="flex flex-wrap gap-2"><Link className="btn-secondary" href="/job-verification">{copy.title}</Link><Link className="btn-secondary" href="/finance-cost-pricing">{language === "th" ? "ค่าใช้จ่ายและราคาขาย" : "Expenses & Pricing"}</Link><Link className="btn-secondary" href="/weekly-billing">{language === "th" ? "วางบิลรายสัปดาห์" : "Weekly Billing"}</Link><Link className="btn-secondary" href="/invoice-approval">{language === "th" ? "อนุมัติใบแจ้งหนี้ร่าง" : "Invoice Approval"}</Link><Link className="btn-secondary" href="/document-packs">{language === "th" ? "ชุดเอกสารลูกค้า" : "Document Packs"}</Link>{process.env.NODE_ENV !== "production" ? <Link className="btn-secondary" href="/finance-demo">{language === "th" ? "ตัวอย่างขั้นตอนทั้งหมด" : "Full workflow demo"}</Link> : null}</div></header>
    {historicalDemo ? <section className="surface-card p-5"><strong className="text-amber-700">{language === "th" ? "ข้อมูลจากสมุดงานจริง + สถานะส่งต่อจำลอง" : "SOURCE WORKBOOK FACTS + SIMULATED HANDOVER"}</strong><p className="mt-1 text-xs">{historicalWorkbook.file} · SHA-256 {historicalWorkbook.sha256}</p>{historicalDemoRecords.filter((item) => item.simulation.handover === "ready").map((item) => <article key={`${item.source.sheet}-${item.source.row}`} className="mt-3 rounded border p-3"><p className="font-semibold">{item.source.sheet}!{item.source.row} · {String(item.source.cells.G)} · {copy.ready}</p><p className="text-sm">{item.source.cells.B} → {item.source.cells.C}</p><p className="text-xs text-amber-800">{item.simulation[language]}</p></article>)}</section> : demo ? <section className="surface-card p-5"><strong className="text-amber-700">{copy.demo}</strong>{DEMO_VERIFICATIONS.filter((item) => item.handover_status === "ready").map((item) => <p key={item.id} className="mt-3 rounded border p-3">{item.booking_id} · {item.client} · {copy.ready}</p>)}</section> : <section className="surface-card p-5">{error ? <p role="alert" className="text-red-700">{error}</p> : null}{!ready.length && !error ? <p>{copy.noReady}</p> : ready.map((item) => <article key={item.booking_id} className="border-b py-3"><Link className="font-semibold text-indigo-700 underline" href={`/job-verification?booking=${encodeURIComponent(item.booking_id)}`}>{item.booking.booking_id || item.booking_id}</Link><p className="text-sm">{item.booking.client_name || "—"} · {item.booking.booking_date} · {item.booking.pickup || "—"} → {item.booking.dropoff || "—"}</p><p className="text-sm">{copy.vehicle}: {item.booking.vehicle_registration || item.booking.vehicle || "—"} · {copy.driver}: {item.booking.driver || "—"}</p><p className="text-xs text-slate-500">{item.checked_at} · {item.checked_by} · {language === "th" ? "ครั้งที่" : "Revision"} {item.revision}</p><Link className="text-sm font-semibold text-violet-800 underline" href={`/finance-cost-pricing?booking=${encodeURIComponent(item.booking_id)}`}>{language === "th" ? "บันทึกค่าใช้จ่ายและราคาขาย" : "Record expenses and customer price"}</Link></article>)}</section>}
  </main>;
}

export default function FinanceCentrePage() {
  if (usesFinanceLocalDemoScreens()) return <FinanceCentreWorkspace initialSection="arrange" />;
  return <LiveFinanceCentrePage />;
}
