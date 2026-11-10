"use client";

import FinancePricingAdmin from "@/components/finance-pricing-admin";
import { Suspense } from "react";
import { usesFinanceLocalDemoScreens } from "@/lib/finance-fixture-mode";

/** Owner-only Finance pricing administration (rate agreements + historical Diesel B7). Local Finance workspace only. */
export default function FinancePricingAdminPage() {
  if (!usesFinanceLocalDemoScreens()) return <main className="ees-fc ees-fc-shell"><p className="p-4 text-sm">Finance pricing administration is available in the local Finance workspace only.</p></main>;
  return <Suspense fallback={<main className="ees-fc ees-fc-shell p-4" role="status">Loading pricing administration… / กำลังโหลดหน้าตั้งค่าราคา…</main>}><FinancePricingAdmin /></Suspense>;
}
