"use client";

import { ArrowLeft, MapPinned } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/lib/language-provider";

export default function DriverJobNotFound() {
  const { language } = useLanguage();
  const copy = language === "th"
    ? { title: "ไม่พบงานนี้", detail: "งานนี้ไม่ได้ถูกมอบหมายให้คุณ หรืออาจถูกลบแล้ว", back: "กลับไปยังงานของฉัน" }
    : { title: "Job not found", detail: "This job is not assigned to you, or it may have been removed.", back: "Back to my jobs" };

  return (
    <main className="mx-auto flex min-h-[65dvh] w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6">
      <section className="w-full rounded-[1.25rem] border border-[var(--driver-border)] bg-[var(--driver-surface)] p-7 text-center shadow-[0_14px_36px_rgba(57,40,24,0.08)]">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <MapPinned className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-xl font-black text-[var(--driver-text)]">{copy.title}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--driver-text-muted)]">{copy.detail}</p>
        <Link href="/driver" className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 text-sm font-bold text-white hover:bg-brand-800">
          <ArrowLeft className="h-4 w-4" />
          {copy.back}
        </Link>
      </section>
    </main>
  );
}
