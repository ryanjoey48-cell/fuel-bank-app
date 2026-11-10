"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/language-provider";
import { financePreviewRoutes, isFinanceLocalPreview } from "@/lib/finance-local-preview";

export function FinancePreviewBanner() {
  const { language } = useLanguage();
  if (!isFinanceLocalPreview()) return null;
  return (
    <div className="sticky top-0 z-50 border-b-4 border-amber-500 bg-amber-100 px-3 py-3 text-amber-950 shadow-md">
      <p className="text-center text-sm font-black tracking-wide">
        {language === "th"
          ? "ตัวอย่างภายในเท่านั้น · ไม่มีฐานข้อมูล · ไม่ใช่ข้อมูลจริง · ห้ามออกใบแจ้งหนี้"
          : "LOCAL FIXTURE PREVIEW ONLY · NO DATABASE · NOT LIVE RECORDS · NO INVOICE ISSUANCE"}
      </p>
      <nav className="mx-auto mt-2 flex max-w-6xl flex-wrap justify-center gap-2">
        {financePreviewRoutes.map((route) => (
          <Link key={route.href} href={route.href} className="rounded bg-white px-2 py-1 text-xs font-semibold text-violet-900 underline">
            {language === "th" ? route.labelTh : route.labelEn}
          </Link>
        ))}
      </nav>
    </div>
  );
}
