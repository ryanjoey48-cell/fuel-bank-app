"use client";

import { useEffect, useState } from "react";
import FinanceInvoicePreview from "@/components/finance-invoice-preview";
import { downloadInvoicePdf } from "@/lib/finance-invoice-pdf";
import { integraReferenceInvoice } from "@/lib/finance-invoice-fixture";
import { isFinanceFixtureMode } from "@/lib/finance-fixture-mode";
import { useLanguage } from "@/lib/language-provider";

/** Fixture-mode only: renders the owner's example invoice (TRN649/2026) from isolated data so it can be compared, printed and downloaded. */
export default function InvoiceFixturePage() {
  const { language } = useLanguage();
  const [query, setQuery] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQuery(new URLSearchParams(window.location.search)); }, []);
  if (!query) return null;
  if (!isFinanceFixtureMode()) return <p className="p-6 text-sm text-slate-600">Not available.</p>;
  const { doc } = integraReferenceInvoice();
  const draftView = query.get("draft") === "1";
  const variant = query.get("variant") === "modern" ? "modern" : "reference";
  const shown = draftView ? { ...doc, draft: true, invoiceNoKind: "draft_reference" as const } : doc;
  return (
    <main className="ees-fc ees-fc-shell space-y-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <h1 className="text-lg font-bold">Invoice fixture · INTEGRA · TRN649/2026 (isolated test data)</h1>
        <button type="button" className="ees-fc-btn-secondary" onClick={() => void downloadInvoicePdf(shown, `fixture-integra-TRN649-${variant}.pdf`, variant)}>Download PDF</button>
        <button type="button" className="ees-fc-btn-secondary" onClick={() => window.print()}>Print</button>
      </div>
      <div className="ees-doc-page ees-doc-page--letter" data-testid="doc-preview"><FinanceInvoicePreview doc={shown} language={language} variant={variant} /></div>
    </main>
  );
}
