"use client";

import { useEffect, useState } from "react";
import { renderInvoiceCanvases } from "@/lib/finance-invoice-pdf";
import type { InvoiceDocument } from "@/lib/finance-invoice-model";
import type { InvoiceVariant } from "@/lib/finance-invoice-render";

/**
 * Fixed-geometry EES invoice. The bitmap is always drawn at US Letter proportions; the browser only scales the finished
 * image, so a wider screen can never stretch or re-flow the invoice. Prints at exactly 8.5 × 11 in.
 */
export default function FinanceInvoicePreview({ doc, language, variant = "reference", fit = "width", zoom = 100 }: { doc: InvoiceDocument; language: "en" | "th"; variant?: InvoiceVariant; fit?: "width" | "page" | "zoom"; zoom?: number }) {
  const [pages, setPages] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify(doc) + variant;
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setPages([]);
    renderInvoiceCanvases(doc, 3, variant)
      .then((canvases) => { if (!cancelled) setPages(canvases.map((canvas) => canvas.toDataURL("image/png"))); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (failed) return <p role="alert" className="text-sm font-semibold text-rose-800">{language === "th" ? "แสดงตัวอย่างใบแจ้งหนี้ไม่สำเร็จ" : "The invoice preview could not be drawn."}</p>;
  if (!pages.length) return <p role="status" className="ees-fc-empty" aria-busy="true">{language === "th" ? "กำลังเตรียมตัวอย่างใบแจ้งหนี้…" : "Preparing invoice preview…"}</p>;
  return (
    <div className="ees-invoice-preview" data-testid="invoice-preview" data-invoice-pages={pages.length} data-invoice-variant={variant} data-fit={fit} style={{ ["--inv-zoom" as string]: zoom / 100 }}>
      {pages.map((src, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={index} src={src} alt={`${language === "th" ? "ใบแจ้งหนี้" : "Invoice"} ${index + 1}/${pages.length}`} className="ees-invoice-page-img" width={816} height={1056} />
      ))}
    </div>
  );
}
