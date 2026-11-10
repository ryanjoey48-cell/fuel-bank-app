"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import FinanceInvoicePreview from "@/components/finance-invoice-preview";
import type { InvoiceDocument } from "@/lib/finance-invoice-model";
import { invoiceDisplayWidth } from "@/lib/finance-workspace-view";

type Fit = "auto" | "width" | "page" | "zoom";
type Variant = "reference" | "modern";

/** A measured, scrollable screen workspace around the unchanged invoice rendering engine. */
export default function FinanceDocumentViewer({ doc, language, variant, onVariant, fit, onFit, zoom, onZoom, onFullscreen, fullscreen = false }: {
  doc: InvoiceDocument; language: "en" | "th"; variant: Variant; onVariant: (value: Variant) => void;
  fit: Fit; onFit: (value: Fit) => void; zoom: number; onZoom: (value: number) => void; onFullscreen?: () => void; fullscreen?: boolean;
}) {
  const t = (en: string, th: string) => language === "th" ? th : en;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => {
      if (!fullscreen) element.style.height = `${Math.max(320, window.innerHeight - element.getBoundingClientRect().top - 42)}px`;
      setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", measure); };
  }, [fullscreen]);
  const documentKey = JSON.stringify(doc);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, [documentKey, variant]);
  const changeZoom = (delta: number) => {
    const current = fit === "zoom" ? zoom : Math.round(invoiceDisplayWidth(size.width, size.height, fit, zoom) / 816 * 100);
    onFit("zoom"); onZoom(Math.max(10, Math.min(400, current + delta)));
  };
  const width = invoiceDisplayWidth(size.width, size.height, fit, zoom);
  return <div className={`fc6-viewer ${fullscreen ? "fc6-viewer--fullscreen" : ""}`} data-testid="document-viewer">
    <div className="fc6-viewer-toolbar print:hidden">
      <div className="fc6-segment" role="group" aria-label={t("Invoice format", "รูปแบบใบแจ้งหนี้")}>
        {(["reference", "modern"] as const).map(value => <button key={value} type="button" aria-pressed={variant === value} data-testid={`invoice-variant-${value}`} onClick={() => onVariant(value)}>{value === "reference" ? t("Original EES format", "รูปแบบ EES เดิม") : t("Modern EES proposal", "รูปแบบ EES ใหม่ (เสนอ)")}</button>)}
      </div>
      <div className="fc6-view-controls" role="group" aria-label={t("Document view", "การแสดงเอกสาร")}>
        {(["auto", "page", "width"] as const).map(value => <button key={value} type="button" aria-pressed={fit === value} data-testid={`invoice-fit-${value}`} onClick={() => onFit(value)}>{value === "auto" ? t("Reading view", "มุมมองอ่าน") : value === "page" ? t("Fit Page", "พอดีหน้า") : t("Fit Width", "พอดีความกว้าง")}</button>)}
        <button type="button" aria-label={t("Zoom out", "ซูมออก")} data-testid="invoice-zoom-out" disabled={width / 816 * 100 <= 10} onClick={() => changeZoom(-10)}>−</button>
        <output data-testid="invoice-zoom-level" aria-live="polite">{Math.round(width / 816 * 100)}%</output>
        <button type="button" aria-label={t("Zoom in", "ซูมเข้า")} data-testid="invoice-zoom-in" disabled={width / 816 * 100 >= 400} onClick={() => changeZoom(10)}>+</button>
        {onFullscreen ? <button type="button" data-testid="invoice-fullscreen" onClick={onFullscreen}>⤢ {t("Full Screen", "เต็มจอ")}</button> : null}
      </div>
    </div>
    {variant === "modern" ? <p className="fc6-viewer-notice print:hidden">{t("Modern proposal · branding approval pending. Download remains a draft, not issuance.", "รูปแบบใหม่ (เสนอ) · รออนุมัติแบรนด์ ดาวน์โหลดเป็นร่าง ไม่ใช่การออกใบแจ้งหนี้")}</p> : null}
    <div ref={scrollRef} className="fc6-document-scroll" data-testid="invoice-scroll-region" tabIndex={0} role="region" aria-label={t("Invoice pages — scroll to review", "หน้าใบแจ้งหนี้ — เลื่อนเพื่อตรวจสอบ")}
      style={{ "--fc6-page-width": `${width}px` } as CSSProperties}
      onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === "+" || event.key === "=") { event.preventDefault(); changeZoom(10); } if (event.key === "-") { event.preventDefault(); changeZoom(-10); } if (event.key === "Home") { event.preventDefault(); event.currentTarget.scrollTo({ top: 0, left: 0 }); } }}>
      <FinanceInvoicePreview doc={doc} language={language} variant={variant} fit={fit === "auto" ? "width" : fit} zoom={zoom} />
    </div>
    <div className="fc6-viewer-footer print:hidden"><span>{t("Draft / test preview · not an issued invoice", "ตัวอย่างร่าง / ทดสอบ · ยังไม่ออกใบแจ้งหนี้")}</span><span>{t("Scroll to review · + / − to zoom · Home for first page", "เลื่อนเพื่อตรวจสอบ · + / − ซูม · Home กลับหน้าแรก")}</span></div>
  </div>;
}
