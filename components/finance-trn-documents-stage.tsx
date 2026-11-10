"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { EESLogo } from "@/components/ees-logo";
import FinanceActivityHistory from "@/components/finance-activity-history";
import { useFinanceFixture } from "@/components/finance-fixture-provider";
import { FinanceStatusChip } from "@/components/finance-status-chip";
import { downloadCsv } from "@/components/finance-arrange-stage";
import { sheetErrorText, type FlowRun, type FlowT } from "@/components/finance-billing-flow";
import { EXTRA_COLUMNS } from "@/components/finance-billing-sheet-stage";
import { EES_COMPANY } from "@/lib/ees-company";
import { isFinanceFixtureMode } from "@/lib/finance-fixture-mode";
import { canApproveFinanceBilling, canViewFinanceActivity } from "@/lib/finance-intake-access";
import { financeRecordsCopy } from "@/lib/finance-records-copy";
import { batchActivity, sheetLifecycle } from "@/lib/finance-records";
import { useAccountAccess } from "@/lib/use-account-access";
import { displayVehicle, formatBangkokDateTime, formatDocDate, formatPeriod, formatThb } from "@/lib/finance-display";
import { downloadTrnStatementPdf } from "@/lib/finance-trn-pdf";
import FinanceDocumentViewer from "@/components/finance-document-viewer";
import FinanceInvoicePreview from "@/components/finance-invoice-preview";
import { downloadInvoicePdf } from "@/lib/finance-invoice-pdf";
import { FUEL_CALC_CSV_HEADER, fuelCalculation, fuelCalculationRow } from "@/lib/finance-pricing-evidence";
import { invoiceFromSheet, previewProfileForSheet } from "@/lib/finance-invoice-from-sheet";
import {
  bangkokDate,
  confirmedWorkOrder,
  customerJobReference,
  highestLocalTrn,
  proposeOfficialTrn,
  satangToThb,
  sheetFileReference,
  sheetRowTotals,
  sheetSummary,
  sheetTrnLabel,
  type BillingSheet,
  type Booking,
  type State
} from "@/lib/finance-demo-centre";

type DocId = "statement" | "summary" | "invoice" | "breakdown" | "checklist" | "evidence";
const DOCS: { id: DocId; en: string; th: string; landscape: boolean }[] = [
  { id: "statement", en: "TRN statement", th: "ใบสรุปค่าขนส่ง (TRN)", landscape: true },
  { id: "summary", en: "Billing summary", th: "สรุปยอดวางบิล", landscape: false },
  { id: "invoice", en: "Draft invoice", th: "ร่างใบแจ้งหนี้", landscape: false },
  { id: "breakdown", en: "Work-order breakdown", th: "รายละเอียดตามใบงาน", landscape: true },
  { id: "checklist", en: "Supporting documents", th: "รายการเอกสารแนบ", landscape: false },
  { id: "evidence", en: "Pricing evidence (internal)", th: "หลักฐานการคิดราคา (ภายใน)", landscape: true }
];
const money = (satang: number | null) => formatThb(satangToThb(satang));

function DocHeader({ title, sheet, period }: { title: string; sheet: BillingSheet; period: string }) {
  return (
    <header>
      <p className="ees-doc-watermark">DRAFT / TEST — NOT AN ISSUED DOCUMENT · ร่าง / ทดสอบ — ไม่ใช่เอกสารที่ออกจริง{sheet.simulatedTrn ? " · SIMULATED TRN FOR LOCAL TESTING · เลข TRN จำลองเพื่อทดสอบ" : ""}</p>
      <div className="ees-doc-head">
        <div className="ees-doc-company">
          <EESLogo size={52} alt="EES" />
          <div>
            <p className="ees-doc-company-th">{EES_COMPANY.nameTh}</p>
            <p className="ees-doc-company-en">{EES_COMPANY.nameEn}</p>
            <p className="ees-doc-small">{EES_COMPANY.addressTh}</p>
            <p className="ees-doc-small">{EES_COMPANY.addressEn}</p>
            <p className="ees-doc-small">เลขประจำตัวผู้เสียภาษีอากร / Tax ID {EES_COMPANY.taxId}{EES_COMPANY.phone ? ` · โทร / Tel ${EES_COMPANY.phone}` : ""}</p>
          </div>
        </div>
        <div className="ees-doc-title-block">
          <p className="ees-doc-title">{title}</p>
          {sheet.simulatedTrn ? (
            <>
              <p><strong>TRN:</strong> <span className="ees-doc-trn" data-testid="doc-trn">{sheet.simulatedTrn}</span></p>
              <p className="ees-doc-trn-note">จำลองเพื่อทดสอบ / Simulated for testing — not issued · official TRN pending confirmation</p>
            </>
          ) : (
            <p><strong>TRN:</strong> Official TRN pending confirmation · รอยืนยันเลข TRN</p>
          )}
          <p><strong>Draft ref / เลขอ้างอิงร่าง:</strong> {sheet.draftReference}</p>
        </div>
      </div>
      <div className="ees-doc-info">
        <p><span>ลูกค้า / Customer</span><strong>{sheet.client}</strong></p>
        <p><span>รอบวางบิล / Billing period</span><strong>{period}</strong></p>
        <p><span>วันที่จัดทำร่าง / Draft prepared</span><strong>{formatDocDate(bangkokDate(sheet.updatedAt))}</strong></p>
        <p><span>วันที่วางบิล / Billing date</span><strong>Not issued · ยังไม่ออก</strong></p>
      </div>
    </header>
  );
}

export default function FinanceTrnDocumentsStage({ state, allStates, sheet, run, t, language, backToBilling, openAdminIntake }: {
  state: State; allStates: State[]; sheet: BillingSheet; run: FlowRun; t: FlowT; language: "en" | "th"; backToBilling: () => void; openAdminIntake: (jobId?: string) => void;
}) {
  const [doc, setDoc] = useState<DocId>("invoice");
  useEffect(() => { const wanted = new URLSearchParams(window.location.search).get("doc"); if (wanted && DOCS.some((item) => item.id === wanted)) setDoc(wanted as DocId); }, []);
  const [reopenReason, setReopenReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [message, setMessage] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [invoiceFit, setInvoiceFit] = useState<"auto" | "width" | "page" | "zoom">("auto");
  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [sheet.id]);
  const [zoom, setZoom] = useState(100);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    fullscreenRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
      if (event.key !== "Tab") return;
      const controls = fullscreenRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [href], [tabindex='0']");
      const first = controls?.[0], last = controls?.[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === fullscreenRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", handleKey); previous?.focus(); };
  }, [fullscreen]);
  const [invoiceVariant, setInvoiceVariant] = useState<"reference" | "modern">("reference");
  const { role } = useFinanceFixture();
  const { access } = useAccountAccess();
  const records = financeRecordsCopy[language];
  const lifecycle = sheetLifecycle(state, sheet);
  const canViewActivity = canViewFinanceActivity(access, role, isFinanceFixtureMode());
  const canApprove = canApproveFinanceBilling(access, role, isFinanceFixtureMode());
  const summary = sheetSummary(state, sheet);
  const jobs = sheet.jobIds.map((id) => state.bookings.find((item) => item.id === id)).filter(Boolean) as Booking[];
  const rows = jobs.map((job) => ({ job, totals: sheetRowTotals(state, sheet, job.id) }));
  const period = formatPeriod(summary.periodStart, summary.periodEnd, "doc");
  const localTrn = highestLocalTrn(allStates);
  const official = proposeOfficialTrn(null, Number(bangkokDate().slice(0, 4)));
  const columnTotal = (kind: (typeof EXTRA_COLUMNS)[number]["kind"]) => rows.reduce((sum, row) => sum + (row.totals.extrasSatang[kind] ?? 0), 0);
  const current = DOCS.find((item) => item.id === doc)!;
  // Customer-specific EES invoice: only an owner-approved profile selects it; an unapproved one can be previewed for testing.
  // The EES invoice is always the invoice shown. A customer's own profile is used when one exists (approved or pending); otherwise a placeholder with every registered detail marked pending — never another customer's details.
  const { profile: customerProfile, kind: profileKind } = previewProfileForSheet(sheet);
  const invoiceDoc = invoiceFromSheet(state, sheet, customerProfile);
  const eesInvoice = true;
  const pageClass = (id: DocId, landscape: boolean) => (id === "invoice" && eesInvoice ? "ees-doc-page--letter" : landscape ? "ees-doc-page--landscape" : "ees-doc-page--portrait");

  const checks: { ok: boolean; text: string; fix?: { label: string; go: () => void } }[] = [
    summary.missingPrices
      ? { ok: false, text: t(`${summary.missingPrices} work order(s) have no transport charge`, `ใบงาน ${summary.missingPrices} รายการยังไม่มีค่าขนส่ง`), fix: { label: t("Open billing sheet", "เปิดตารางวางบิล"), go: backToBilling } }
      : { ok: true, text: t("All prices entered", "ใส่ราคาครบแล้ว") },
    ...(summary.needsChecking.length ? [{ ok: false, text: t(`${summary.needsChecking.length} work order(s) flagged for checking`, `ใบงาน ${summary.needsChecking.length} รายการถูกแจ้งให้ตรวจสอบ`), fix: { label: t("Open Admin Intake", "เปิดหน้ารับใบงาน"), go: () => openAdminIntake(summary.needsChecking[0]) } }] : []),
    ...(summary.missingPapers ? [{ ok: false, text: t(`${summary.missingPapers} paper(s) on the desk have no record`, `ใบงาน ${summary.missingPapers} ใบไม่มีข้อมูลในระบบ`) }] : []),
    ...(summary.pendingExtras ? [{ ok: true, text: t(`${summary.pendingExtras} driver receipt(s) not billed to the customer (check if intended)`, `ใบเสร็จคนขับ ${summary.pendingExtras} รายการยังไม่เรียกเก็บลูกค้า (ตรวจว่าตั้งใจหรือไม่)`), fix: { label: t("Review extras", "ตรวจค่าใช้จ่ายเพิ่ม"), go: backToBilling } }] : [])
  ];
  const hasWarnings = !!summary.pendingExtras;

  const print = (scope: "documents" | "pack") => {
    document.body.classList.add("ees-finance-printing");
    document.body.dataset.eesPrint = scope;
    const done = () => { document.body.classList.remove("ees-finance-printing"); delete document.body.dataset.eesPrint; window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
  };

  const extrasFor = (totals: (typeof rows)[number]["totals"]) => EXTRA_COLUMNS.map((c) => (totals.extrasSatang[c.kind] === null ? "—" : money(totals.extrasSatang[c.kind])));
  const downloadPdf = async () => {
    setPdfBusy(true); setMessage("");
    try {
      await downloadTrnStatementPdf({
        title: "ใบสรุปค่าขนส่ง / TRANSPORT BILLING STATEMENT", customer: sheet.client, period, draftReference: sheet.draftReference, simulatedTrn: sheet.simulatedTrn ?? null,
        preparedDate: formatDocDate(bangkokDate(sheet.updatedAt)), jobCount: summary.jobCount,
        extraHeaders: EXTRA_COLUMNS.map((c) => c.en.replace(" Charges", "").replace(" Fees", "").replace("Container Pickup", "Container")),
        rows: rows.map(({ job, totals }) => ({ position: totals.position, date: formatDocDate(job.date), customerJob: customerJobReference(job) || "—", workOrder: confirmedWorkOrder(job),
          pickup: job.pickup, delivery: job.delivery, vehicle: displayVehicle(job.vehicle), driver: job.driver, trip: money(totals.transportSatang), extras: extrasFor(totals),
          total: totals.totalSatang === null ? "MISSING PRICE" : money(totals.totalSatang) })),
        totals: { trip: money(summary.transportSatang), extras: EXTRA_COLUMNS.map((c) => money(columnTotal(c.kind))), total: money(summary.totalSatang) },
        warning: summary.missingPrices ? `${summary.missingPrices} work order(s) have no price — total is incomplete · ยอดรวมยังไม่ครบ` : undefined
      }, `DRAFT-TRN-${sheetFileReference(sheet)}.pdf`);
    } catch {
      setMessage(t("PDF could not be created. Use Print → Save as PDF instead.", "สร้าง PDF ไม่สำเร็จ ใช้ พิมพ์ → บันทึกเป็น PDF แทน"));
    } finally { setPdfBusy(false); }
  };

  const downloadInvoice = async (invoiceDocument: NonNullable<typeof invoiceDoc>) => {
    setPdfBusy(true); setMessage("");
    try { await downloadInvoicePdf(invoiceDocument, `DRAFT-INVOICE-${sheetFileReference(sheet)}${invoiceVariant === "modern" ? "-modern" : ""}.pdf`, invoiceVariant); }
    catch { setMessage(t("PDF could not be created. Use Print → Save as PDF instead.", "สร้าง PDF ไม่สำเร็จ ใช้ พิมพ์ → บันทึกเป็น PDF แทน")); }
    finally { setPdfBusy(false); }
  };

  const exportCsv = () => {
    const out = [["DRAFT/TEST", sheetTrnLabel(sheet), sheet.simulatedTrn ? "Simulated TRN — local test only, not issued (official TRN pending confirmation)" : "Official TRN pending confirmation", sheet.client, period],
      ["No.", "Date", "Customer Job No.", "Work Order", "Pickup", "Delivery", "Vehicle", "Driver", "Trip Charge", ...EXTRA_COLUMNS.map((c) => c.en), "Total"]];
    for (const { job, totals } of rows) out.push([String(totals.position), formatDocDate(job.date), customerJobReference(job), confirmedWorkOrder(job), job.pickup, job.delivery, displayVehicle(job.vehicle), job.driver,
      totals.transportSatang === null ? "" : (totals.transportSatang / 100).toFixed(2), ...EXTRA_COLUMNS.map((c) => totals.extrasSatang[c.kind] === null ? "" : (totals.extrasSatang[c.kind]! / 100).toFixed(2)),
      totals.totalSatang === null ? "MISSING PRICE" : (totals.totalSatang / 100).toFixed(2)]);
    out.push(["", "", "", "", "", "", "", "TOTAL", (summary.transportSatang / 100).toFixed(2), ...EXTRA_COLUMNS.map((c) => (columnTotal(c.kind) / 100).toFixed(2)), (summary.totalSatang / 100).toFixed(2)]);
    downloadCsv(out, `DRAFT-TRN-pack-${sheetFileReference(sheet)}.csv`);
  };

  const statement = (
    <article className="ees-doc">
      <DocHeader title="ใบสรุปค่าขนส่ง / TRANSPORT BILLING STATEMENT" sheet={sheet} period={period} />
      <table className="ees-doc-table ees-doc-table--wide">
        <colgroup><col style={{ width: "3%" }} /><col style={{ width: "6.5%" }} /><col style={{ width: "6%" }} /><col style={{ width: "5.5%" }} /><col style={{ width: "11%" }} /><col style={{ width: "11%" }} /><col style={{ width: "6%" }} /><col style={{ width: "7%" }} /><col style={{ width: "6.5%" }} />{EXTRA_COLUMNS.map((c) => <col key={c.kind} style={{ width: "5.3%" }} />)}<col style={{ width: "7.7%" }} /></colgroup>
        <thead><tr>
          <th>ลำดับ<br />No.</th><th>วันที่<br />Date</th><th>เลขที่งานลูกค้า<br />Cust. Job</th><th>ใบงาน<br />W/O</th><th>ต้นทาง<br />Pickup</th><th>ปลายทาง<br />Delivery</th><th>ทะเบียน<br />Vehicle</th><th>คนขับ<br />Driver</th>
          <th className="num">ค่าขนส่ง<br />Trip</th>{EXTRA_COLUMNS.map((c) => <th key={c.kind} className="num">{c.th}<br />{c.en}</th>)}<th className="num">รวม<br />Total</th>
        </tr></thead>
        <tbody>{rows.map(({ job, totals }) => <tr key={job.id}>
          <td>{totals.position}</td><td className="nowrap">{formatDocDate(job.date)}</td><td><span className="clamp2">{customerJobReference(job) || "—"}</span></td><td className="strong">{confirmedWorkOrder(job)}</td>
          <td><span className="clamp2" title={job.pickup}>{job.pickup}</span></td><td><span className="clamp2" title={job.delivery}>{job.delivery}</span></td><td className="nowrap">{displayVehicle(job.vehicle)}</td><td><span className="clamp2">{job.driver}</span></td>
          <td className="num">{money(totals.transportSatang)}</td>{extrasFor(totals).map((value, index) => <td key={index} className="num">{value}</td>)}
          <td className="num strong">{totals.totalSatang === null ? "MISSING PRICE" : money(totals.totalSatang)}</td>
        </tr>)}</tbody>
        <tfoot><tr><td colSpan={8} className="num">รวมทั้งสิ้น / TOTAL ({summary.jobCount})</td><td className="num">{money(summary.transportSatang)}</td>{EXTRA_COLUMNS.map((c) => <td key={c.kind} className="num">{money(columnTotal(c.kind))}</td>)}<td className="num strong">{money(summary.totalSatang)}</td></tr></tfoot>
      </table>
      {summary.missingPrices ? <p className="ees-doc-warning">{summary.missingPrices} work order(s) have no price — total is incomplete · ยอดรวมยังไม่ครบ</p> : null}
    </article>
  );

  const summaryDoc = (
    <article className="ees-doc">
      <DocHeader title="สรุปยอดวางบิล / CUSTOMER BILLING SUMMARY" sheet={sheet} period={period} />
      <table className="ees-doc-table ees-doc-table--narrow">
        <tbody>
          <tr><th>จำนวนใบงาน / Number of work orders</th><td className="num strong">{summary.jobCount}</td></tr>
          <tr><th>ค่าขนส่ง / Transport charges</th><td className="num">{money(summary.transportSatang)}</td></tr>
          {EXTRA_COLUMNS.map((c) => <tr key={c.kind}><th>{c.th} / {c.en}</th><td className="num">{money(columnTotal(c.kind))}</td></tr>)}
          <tr><th>ค่าใช้จ่ายเพิ่มเติมที่อนุมัติ / Approved extras</th><td className="num">{money(summary.approvedExtrasSatang)}</td></tr>
          <tr className="total"><th>ยอดรวมวางบิล / Batch total</th><td className="num strong">{money(summary.totalSatang)}</td></tr>
        </tbody>
      </table>
      <p className="ees-doc-small mt-3">ใบงาน / Work orders: {rows.map(({ job }) => confirmedWorkOrder(job)).join(", ")}</p>
      <p className="ees-doc-small">ร่างนี้ยังไม่คำนวณภาษีมูลค่าเพิ่มและภาษีหัก ณ ที่จ่าย · VAT and withholding tax are not calculated in this draft.</p>
    </article>
  );

  const invoice = (
    <div>
      {profileKind !== "approved" ? <p className="fc6-profile-notice print:hidden" data-testid="invoice-profile-note">{profileKind === "no_profile"
        ? t("Billing details pending: customer address, tax ID, withholding and payment terms are unverified. No deduction is applied.", "รอยืนยันข้อมูลวางบิล: ที่อยู่ เลขผู้เสียภาษี ภาษีหัก ณ ที่จ่าย และเงื่อนไขชำระ ยังไม่มีการหักภาษี")
        : t("Customer billing profile awaits owner approval. Preview only.", "โปรไฟล์วางบิลลูกค้ารอเจ้าของอนุมัติ ใช้ดูตัวอย่างเท่านั้น")}</p> : null}
      {summary.missingPrices ? <p role="alert" className="fc6-attention print:hidden" data-testid="invoice-incomplete">{summary.missingPrices} {t("work orders have no transport price. Finish pricing in Customer Billing.", "รายการยังไม่มีค่าขนส่ง กรุณาใส่ราคาในหน้าวางบิลลูกค้า")}</p> : null}
      <FinanceDocumentViewer doc={invoiceDoc} language={language} variant={invoiceVariant} onVariant={setInvoiceVariant} fit={invoiceFit} onFit={setInvoiceFit} zoom={zoom} onZoom={setZoom} onFullscreen={() => setFullscreen(true)} />
    </div>
  );

  const breakdown = (
    <article className="ees-doc">
      <DocHeader title="รายละเอียดตามใบงาน / WORK-ORDER BREAKDOWN" sheet={sheet} period={period} />
      {rows.map(({ job, totals }) => {
        const line = sheet.lines[job.id];
        return (
          <section key={job.id} className="ees-doc-card">
            <p className="ees-doc-card-title">#{totals.position} · W/O {confirmedWorkOrder(job)} <span>· {formatDocDate(job.date)} · {displayVehicle(job.vehicle)} · {job.driver}</span></p>
            <p className="ees-doc-small">{job.pickup} → {job.delivery}{customerJobReference(job) ? ` · Cust. Job ${customerJobReference(job)}` : ""}</p>
            <p className="ees-doc-small">ค่าขนส่ง / Trip {money(totals.transportSatang)}
              {EXTRA_COLUMNS.filter((c) => totals.extrasSatang[c.kind] !== null).map((c) => ` · ${c.th} / ${c.en} ${money(totals.extrasSatang[c.kind])}${line?.extras[c.kind]?.note ? ` (${line.extras[c.kind]!.note})` : ""}`).join("")}
              {" · "}<strong>รวม / Total {totals.totalSatang === null ? "MISSING PRICE" : money(totals.totalSatang)}</strong></p>
            {line?.transport?.source === "schedule" ? <p className="ees-doc-small">Rate: {line.transport.rateLabel} · Diesel B7 ฿{line.transport.fuelPriceThb?.toFixed(2)}/L</p> : null}
          </section>
        );
      })}
    </article>
  );

  const checklist = (
    <article className="ees-doc">
      <DocHeader title="รายการเอกสารแนบ / SUPPORTING DOCUMENTS CHECKLIST" sheet={sheet} period={period} />
      <table className="ees-doc-table">
        <thead><tr><th style={{ width: "7%" }}>ลำดับ<br />No.</th><th style={{ width: "12%" }}>ใบงาน<br />W/O</th><th style={{ width: "18%" }}>ใบงานสีเขียวต้นฉบับ<br />Original green paper</th><th>ใบเสร็จที่ต้องแนบ<br />Receipts to attach</th><th style={{ width: "10%" }}>ตรวจแล้ว<br />Checked</th></tr></thead>
        <tbody>{rows.map(({ job, totals }) => {
          const receipts = EXTRA_COLUMNS.filter((c) => totals.extrasSatang[c.kind] !== null && (job.adminReceipts?.amounts[c.kind] ?? 0) > 0);
          return <tr key={job.id}><td>{totals.position}</td><td className="strong">{confirmedWorkOrder(job)}</td><td>☐</td><td>{receipts.length ? receipts.map((c) => `☐ ${c.th} / ${c.en} ${formatThb(job.adminReceipts?.amounts[c.kind])}`).join("   ") : "—"}</td><td>☐</td></tr>;
        })}</tbody>
      </table>
      {sheet.missingPapers.length ? <p className="ees-doc-warning">Papers with no record: {sheet.missingPapers.map((m) => m.workOrder).join(", ")}</p> : null}
    </article>
  );

  const calcs = jobs.map((job) => fuelCalculation(state, sheet, job));
  const extrasBilled = summary.approvedExtrasSatang;
  const exportEvidenceCsv = () => {
    const out: string[][] = [["INTERNAL PRICING EVIDENCE — DRAFT/TEST", sheetTrnLabel(sheet), sheet.client, period], FUEL_CALC_CSV_HEADER, ...calcs.map(fuelCalculationRow)];
    out.push([], ["Transport subtotal THB", (summary.transportSatang / 100).toFixed(2)], ["Customer-billable extras recorded THB", (extrasBilled / 100).toFixed(2)], ["Batch total THB", (summary.totalSatang / 100).toFixed(2)]);
    downloadCsv(out, `DRAFT-pricing-evidence-${sheetFileReference(sheet)}.csv`);
  };
  const evidence = (
    <article className="ees-doc">
      <DocHeader title="หลักฐานการคิดราคา (ภายใน) / PRICING EVIDENCE (INTERNAL)" sheet={sheet} period={period} />
      <p className="ees-doc-small">วันงาน → ราคาน้ำมันดีเซล B7 ของวันนั้น → ช่วงราคา → ค่าขนส่งตามตารางราคา · Job date → Diesel B7 that day → fuel band → exact table charge. Not part of the customer invoice.</p>
      <table className="ees-doc-table ees-doc-table--wide">
        <thead><tr><th>ใบงาน<br />W/O</th><th>วันที่<br />Date</th><th>เส้นทาง / ทะเบียน<br />Route / Reg.</th><th className="num">B7 ฿/L</th><th>สถานะน้ำมัน<br />Fuel status</th><th>ช่วงราคา<br />Band</th><th>ตาราง<br />Schedule</th><th className="num">ตามตาราง<br />Table</th><th className="num">ใช้จริง<br />Applied</th><th>หมายเหตุ<br />Note</th></tr></thead>
        <tbody>{calcs.map((c) => <tr key={c.workOrder}>
          <td className="strong">{c.workOrder}</td><td className="nowrap">{formatDocDate(c.jobDate)}</td><td><span className="clamp2">{c.route} · {c.registration}</span></td>
          <td className="num">{c.fuel.priceThb === null ? "—" : c.fuel.priceThb.toFixed(2)}</td><td>{c.fuel.status}{c.fuel.verifiedBy ? ` · ${c.fuel.verifiedBy}` : ""}</td><td>{c.band || "—"}</td>
          <td><span className="clamp2">{c.schedule ? `${c.schedule} v${c.scheduleVersion} p.${c.sourcePage}` : "—"}</span></td>
          <td className="num">{c.tableCharge === null ? "—" : money(Math.round(c.tableCharge * 100))}</td><td className="num strong">{c.applied === null ? "—" : money(Math.round(c.applied * 100))}</td>
          <td><span className="clamp2">{c.overrideReason ? `Override: ${c.overrideReason}` : c.note}</span></td>
        </tr>)}</tbody>
      </table>
      <p className="ees-doc-small mt-2">ค่าขนส่งรวม / Transport subtotal {money(summary.transportSatang)} · ค่าใช้จ่ายเพิ่มที่เรียกเก็บ / Billable extras {money(extrasBilled)} · ยอดรวม / Total {money(summary.totalSatang)}</p>
      <p className="ees-doc-small">แหล่งราคาน้ำมันย้อนหลัง / Fuel source: {calcs[0]?.fuel.sourceUrl} (ป้อนด้วยมือ / entered manually)</p>
    </article>
  );

  const documents: Record<DocId, ReactElement> = { statement, summary: summaryDoc, invoice, breakdown, checklist, evidence };

  return (
    <section className="fc6-documents space-y-3">
      <details className="fc6-document-status print:hidden" data-testid="docs-summary-row">
        <summary data-testid="docs-summary-line"><span className="fc6-status-heading">{t("Document review", "ตรวจสอบเอกสาร")}</span>{summary.missingPrices ? <span className="text-orange-800 font-semibold" data-testid="incomplete-chip">{t("Incomplete", "ยังไม่สมบูรณ์")}</span> : <FinanceStatusChip status={lifecycle} language={language} />}
          <span>{period}</span><span className="fc6-status-total" data-testid="docs-summary-total">{money(summary.totalSatang)}</span>
          <span className={summary.blockers.length ? "text-orange-800" : "text-slate-600"}>{summary.blockers.length ? summary.blockers.length + " " + t("blockers", "รายการที่ต้องแก้") : t("Review checks", "รายการตรวจสอบ")} ▾</span>
        </summary>
        <div className="fc6-review-checks" data-testid="trn-status"><ul>{checks.map((item, index) => <li key={index}><span aria-hidden="true">{item.ok && !item.fix ? "✓" : "!"}</span><span>{item.text}</span>{item.fix ? <button type="button" className="ees-fc-btn-quiet" onClick={item.fix.go}>{item.fix.label} →</button> : null}</li>)}</ul>
          <p>{t("Official TRN pending confirmation. Downloads are drafts and do not issue or reserve a number.", "รอยืนยัน TRN จริง ดาวน์โหลดเป็นร่าง ไม่ออกหรือจองเลขจริง")}</p>
          <FinanceActivityHistory entries={batchActivity(state, sheet)} canView={canViewActivity} language={language} popover />
        </div>
      </details>

      <div className="fc6-document-actions print:hidden">
        <details className="relative" data-testid="additional-documents">
          <summary className="ees-fc-btn-secondary cursor-pointer list-none">{doc === "invoice" ? t("Additional documents", "เอกสารเพิ่มเติม") : t(current.en, current.th)} ▾</summary>
          <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-xl bg-white p-1 shadow-lg ring-1 ring-slate-200" role="menu">
            {DOCS.map((item) => (
              <button key={item.id} type="button" role="menuitem" onClick={(event) => { setDoc(item.id); (event.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open"); }}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${doc === item.id ? "bg-violet-50 font-semibold text-violet-900" : "text-slate-700 hover:bg-slate-50"}`}>
                {item.id === "invoice" ? t("EES invoice (main)", "ใบแจ้งหนี้ EES (หลัก)") : t(item.en, item.th)}
              </button>
            ))}
          </div>
        </details>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {!sheet.readyForApprovalAt && !sheet.approvedAt ? (
            <button type="button" className="ees-fc-btn-secondary" disabled={summary.blockers.length > 0} data-testid="mark-completed" onClick={() => {
              const result = run({ type: "sheet_mark_ready", sheetId: sheet.id });
              setMessage(result.ok ? t("Submitted for management review. Still DRAFT/TEST — not issued.", "ส่งให้ผู้บริหารตรวจสอบแล้ว ยังเป็นร่าง/ทดสอบ — ยังไม่ออกจริง") : sheetErrorText(result.code, result.detail, t));
            }}>{t("Submit for review", "ส่งตรวจสอบ")}</button>
          ) : null}
          {sheet.readyForApprovalAt && !sheet.approvedAt && canApprove ? (
            <>
              <button type="button" className="ees-fc-btn-secondary" data-testid="approve-billing" disabled={approveBusy || summary.blockers.length > 0} onClick={() => {
                if (approveBusy) return;
                setApproveBusy(true);
                const result = run({ type: "sheet_approve", sheetId: sheet.id });
                setApproveBusy(false);
                setMessage(result.ok
                  ? t("Approved. Amounts are locked. Still DRAFT/TEST — no official TRN or tax invoice.", "อนุมัติแล้ว ล็อกยอดแล้ว ยังเป็นร่าง/ทดสอบ — ไม่มี TRN จริงหรือใบกำกับภาษี")
                  : sheetErrorText(result.code, result.detail, t));
              }}>{t("Approve figures", "อนุมัติตัวเลข")}</button>
              {rejectOpen ? (
                <span className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-2 py-1" data-testid="reject-approval-panel">
                  <input className="min-w-[14rem] rounded-lg px-2 py-1 text-sm ring-1 ring-amber-300" value={rejectReason} placeholder={t("Reason (min 10 chars)", "เหตุผล (อย่างน้อย 10 ตัว)")} onChange={(e) => setRejectReason(e.target.value)} />
                  <button type="button" className="rounded-lg bg-amber-800 px-3 py-1 text-sm font-semibold text-white disabled:opacity-40" data-testid="reject-approval" disabled={rejectReason.trim().length < 10} onClick={() => {
                    const result = run({ type: "sheet_reject_approval", sheetId: sheet.id, reason: rejectReason });
                    if (!result.ok) { setMessage(sheetErrorText(result.code, result.detail, t)); return; }
                    setRejectOpen(false); setRejectReason(""); setMessage(t("Returned for correction.", "ส่งกลับเพื่อแก้ไขแล้ว")); backToBilling();
                  }}>{t("Return", "ส่งกลับ")}</button>
                  <button type="button" className="text-sm text-slate-600" onClick={() => setRejectOpen(false)}>{t("Cancel", "ยกเลิก")}</button>
                </span>
              ) : (
                <button type="button" className="ees-fc-btn-secondary" data-testid="reject-approval-open" onClick={() => setRejectOpen(true)}>{t("Return for correction", "ส่งกลับแก้ไข")}</button>
              )}
            </>
          ) : null}
          {sheet.approvedAt ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-900" data-testid="approved-badge">
              {t("Approved (not issued)", "อนุมัติแล้ว (ยังไม่ออก)")}{sheet.approvedBy ? ` · ${sheet.approvedBy}` : ""}
            </span>
          ) : null}
          {sheet.readyForApprovalAt || sheet.approvedAt ? (
            <button type="button" className="ees-fc-btn-secondary" data-testid="edit-draft" onClick={() => {
              const reason = sheet.approvedAt ? (reopenReason.trim().length >= 10 ? reopenReason.trim() : "Material correction after management approval (local test)") : "Edited by owner (local test)";
              const result = run({ type: "sheet_reopen", sheetId: sheet.id, reason });
              if (!result.ok) { setMessage(sheetErrorText(result.code, result.detail, t)); return; }
              setMessage(""); setReopenReason(""); backToBilling();
            }}>{t("Reopen for correction", "เปิดแก้ไข")}</button>
          ) : null}
          {doc === "invoice" ? <button type="button" className="ees-fc-btn-primary" data-testid="download-invoice-pdf" disabled={pdfBusy} onClick={() => void downloadInvoice(invoiceDoc)}>{pdfBusy ? t("Creating PDF…", "กำลังสร้าง PDF…") : t("Download invoice PDF", "ดาวน์โหลดใบแจ้งหนี้ PDF")}</button> : null}
          {doc === "statement" ? <button type="button" className="ees-fc-btn-primary" disabled={pdfBusy} onClick={() => void downloadPdf()}>{pdfBusy ? t("Creating PDF…", "กำลังสร้าง PDF…") : t("Download statement PDF", "ดาวน์โหลดใบสรุป PDF")}</button> : null}
          {doc === "evidence" ? <button type="button" className="ees-fc-btn-primary" data-testid="export-evidence-csv" onClick={exportEvidenceCsv}>{t("Export pricing evidence CSV", "ส่งออกหลักฐานการคิดราคา CSV")}</button> : null}
          <details className="fc6-utilities"><summary className="ees-fc-btn-secondary">{t("Print & export", "พิมพ์และส่งออก")} ▾</summary><div>
          <button type="button" className="ees-fc-btn-secondary" onClick={() => print("documents")}>{doc === "invoice" ? t("Print invoice", "พิมพ์ใบแจ้งหนี้") : t("Print", "พิมพ์")}</button>
          <button type="button" className="ees-fc-btn-secondary" onClick={() => print("pack")}>{t("Print full pack", "พิมพ์ทั้งชุด")}</button>
          <button type="button" className="ees-fc-btn-quiet" onClick={exportCsv}>{t("Export CSV", "ส่งออก CSV")}</button>
          <Link className="ees-fc-btn-quiet" href={`/finance-records?view=batches&batch=${encodeURIComponent(sheet.id)}`}>{records.nav} →</Link>
          </div></details>
        </span>
      </div>

      <div className="fc6-document-area" data-print-scope="documents" data-testid="doc-preview">
        <div className={`ees-doc-page ${pageClass(doc, current.landscape)}`}>{documents[doc]}</div>
      </div>
      {fullscreen && doc === "invoice" ? (
        <div ref={fullscreenRef} tabIndex={-1} className="ees-fc-fullscreen fc6-fullscreen fixed inset-0 z-[70] print:hidden" role="dialog" aria-modal="true" aria-label={t("Invoice full screen", "ใบแจ้งหนี้เต็มจอ")} data-testid="invoice-fullscreen-view">
          <div className="fc6-fullscreen-heading"><strong>{sheetTrnLabel(sheet)} · {sheet.client}</strong><button type="button" className="ees-fc-btn-primary" disabled={pdfBusy} onClick={() => void downloadInvoice(invoiceDoc)}>{t("Download invoice PDF", "ดาวน์โหลดใบแจ้งหนี้ PDF")}</button><button type="button" className="ees-fc-btn-secondary" data-testid="invoice-fullscreen-close" onClick={() => setFullscreen(false)}>✕ {t("Close", "ปิด")}</button></div>
          <FinanceDocumentViewer fullscreen doc={invoiceDoc} language={language} variant={invoiceVariant} onVariant={setInvoiceVariant} fit={invoiceFit} onFit={setInvoiceFit} zoom={zoom} onZoom={setZoom} />
        </div>
      ) : null}
      <div className="hidden" data-print-scope="pack" aria-hidden="true">
        {DOCS.map((item) => <div key={item.id} className={`ees-doc-page ${pageClass(item.id, item.landscape)}`}>{item.id === "invoice" ? <FinanceInvoicePreview doc={invoiceDoc} language={language} variant={invoiceVariant} /> : documents[item.id]}</div>)}
      </div>
    </section>
  );
}
