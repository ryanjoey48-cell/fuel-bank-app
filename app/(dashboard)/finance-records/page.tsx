"use client";

import Link from "next/link";
import FinanceRecordsWorkspace from "@/components/finance-records-workspace";
import { usesFinanceLocalDemoScreens } from "@/lib/finance-fixture-mode";
import { financeRecordsCopy } from "@/lib/finance-records-copy";
import { useLanguage } from "@/lib/language-provider";

/**
 * Finance Records reads the saved Finance workspace. Until shared, authenticated Finance storage is enabled (see
 * docs/finance-records-shared-storage-plan.md) only the local test workspace exists, so a production deployment shows
 * a notice instead of anything that could be mistaken for production records.
 */
export default function FinanceRecordsPage() {
  const { language } = useLanguage();
  if (usesFinanceLocalDemoScreens()) return <FinanceRecordsWorkspace />;
  const copy = financeRecordsCopy[language];
  return (
    <main className="ees-fc ees-fc-shell space-y-3 text-slate-900">
      <h1 className="text-2xl font-bold text-slate-950">{copy.title}</h1>
      <section className="ees-fc-card"><div className="ees-fc-empty" data-testid="records-shared-not-ready">
        <p className="text-lg font-bold text-slate-900">{copy.sharedNotReadyTitle}</p>
        <p className="max-w-lg text-sm">{copy.sharedNotReadyBody}</p>
        <Link className="ees-fc-btn-secondary mt-2 !py-1.5" href="/finance-centre">← {copy.backToFinance}</Link>
      </div></section>
    </main>
  );
}
