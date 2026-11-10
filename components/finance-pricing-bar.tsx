"use client";

import { useState } from "react";
import Link from "next/link";
import { sheetErrorText, type FlowRun, type FlowT } from "@/components/finance-billing-flow";
import { DIESEL_B7_SOURCE_URL, diagnoseRate, ownerTransportDecision, fuelReferenceFor, fuelStatusOf, type BillingSheet, type Booking, type State } from "@/lib/finance-demo-centre";
import { formatDocDate } from "@/lib/finance-display";
import { useFinanceVerifiedPrices } from "@/lib/use-finance-verified-prices";
export { useCanManagePricing } from "@/lib/use-finance-pricing-access";
import { transportEvidenceState } from "@/lib/finance-workspace-view";
import { sourceLookup } from "@/lib/finance-pricing-evidence";


const input = "min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-950";
const btn = "rounded-lg border border-violet-400 bg-violet-50 px-2.5 py-1 text-sm font-semibold text-violet-950 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Administrator-only pricing controls: one Diesel B7 line per job date and an expandable verification summary.
 * Previously displayed in Customer Billing; now mounted only in Pricing Administration.
 * A single "N things need
 * attention" summary that expands into the exceptions (with their actions), and the one-click Apply verified prices.
 * Long price tables, the owner review checklist and contract approvals live in the owner-only Price setup.
 */
export default function FinancePricingBar({ state, sheet, jobs, run, t, canManagePricing }: {
  state: State; sheet: BillingSheet; jobs: Booking[]; run: FlowRun; t: FlowT; canManagePricing: boolean;
}) {
  const locked = !!sheet.readyForApprovalAt;
  const rows = jobs.map((job) => ({ job, d: diagnoseRate(state, job), line: sheet.lines[job.id] }));
  const dates = [...new Set(jobs.map((job) => job.date))].sort();
  const suggestable = rows.filter((x) => x.d.kind === "suggested" && !x.line?.transport && !ownerTransportDecision(x.job));
  const fuelIssues = dates.filter((date) => { const ref = fuelReferenceFor(state, date); return !ref || fuelStatusOf(ref) !== "verified"; });
  const routeIssues = [...new Set(rows.filter((x) => x.d.kind === "unavailable" && ["no_mapping", "route_mismatch", "mapping_not_effective", "ambiguous", "review_required", "out_of_band"].includes(x.d.code)).map((x) => `${x.job.pickup} → ${x.job.delivery}`))];
  const categories = [fuelIssues.length ? t("historical fuel price", "ราคาน้ำมันย้อนหลัง") : "", routeIssues.length ? t("contract mapping", "การอนุมัติสัญญา/เส้นทาง") : ""].filter(Boolean);
  const [open, setOpen] = useState(false);
  useFinanceVerifiedPrices(state, sheet, jobs, run);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const report = (result: ReturnType<FlowRun>, ok: string) => { setMessage(result.ok ? ok : sheetErrorText(result.code, result.detail, t)); return result.ok; };

  const applyAll = () => {
    let done = 0;
    for (const x of suggestable) {
      if (x.d.kind !== "suggested") continue;
      if (run({ type: "sheet_apply_rate", sheetId: sheet.id, jobId: x.job.id, mappingId: x.d.mappingId, amountThb: x.d.amountThb, overrideReason: "", routeVehicleConfirmed: true, confirmOverwrite: false }).ok) done += 1;
    }
    setMessage(t(`${done} price(s) applied from the approved agreement. Existing prices were not touched.`, `ใช้ราคาจากข้อตกลงที่อนุมัติ ${done} รายการ ไม่แก้ราคาที่มีอยู่`));
  };
  const enter = (date: string, proposed: boolean) => {
    const price = (draft[date] || "").trim();
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(price)) { setMessage(t("Enter the Diesel B7 price shown for that date (e.g. 43.54).", "กรอกราคาดีเซล B7 ของวันนั้น (เช่น 43.54)")); return; }
    const evidence = `Approved EES history page, row "${sourceLookup(date).rowText}", column ดีเซล B7 = ${price}`;
    if (report(run({ type: "record_fuel_reference", date, priceThb: Number(price), evidence, sourceUrl: DIESEL_B7_SOURCE_URL, proposed }), proposed ? t(`Saved for ${date} as proposed.`, `บันทึก ${date} เป็นค่าที่เสนอ`) : t(`Diesel B7 for ${date} saved and confirmed.`, `บันทึกและยืนยันดีเซล B7 ของ ${date} แล้ว`))) setDraft((prev) => ({ ...prev, [date]: "" }));
  };

  return (
    <section className="ees-fc-card fc6-verification" data-testid="pricing-bar" aria-label={t("Pricing status", "สถานะราคา")}>
      <div className="fc6-verification-heading"><div><h3>{t("Pricing & evidence", "ราคาและหลักฐาน")}</h3><p>{rows.filter(x => transportEvidenceState(x.line?.transport) === "verified").length} {t("verified", "ยืนยันแล้ว")} · {rows.filter(x => transportEvidenceState(x.line?.transport) === "manual").length} {t("manual", "กรอกเอง")} · {rows.filter(x => !x.line?.transport).length} {t("unpriced", "ยังไม่มีราคา")}</p></div>
        <button type="button" className="ees-fc-btn-secondary" aria-expanded={open} data-testid="verification-toggle" onClick={() => setOpen(value => !value)}>{open ? t("Hide verification", "ซ่อนการตรวจสอบ") : t("Review verification", "ตรวจสอบหลักฐาน")} {categories.length ? "· " + categories.length : ""}</button>
      </div>
      {open ? <div className="fc6-fuel-records">
        {dates.map((date) => {
          const ref = fuelReferenceFor(state, date);
          const status = ref ? fuelStatusOf(ref) : "missing";
          return (
            <span key={date} className="inline-flex flex-wrap items-baseline gap-x-1.5 text-sm" data-testid="fuel-line" data-status={status}>
              <b className="tabular-nums">{formatDocDate(date)}</b>
              {status === "verified" ? <>
                <span>Diesel B7: <b className="tabular-nums">฿{ref!.priceThb.toFixed(2)}/L</b></span><span className="font-semibold text-emerald-800">· {t("Verified", "ยืนยันแล้ว")}</span>
                <a className="font-semibold text-violet-900 underline" href={DIESEL_B7_SOURCE_URL} target="_blank" rel="noreferrer">{t("View source", "ดูแหล่งข้อมูล")}</a>
              </> : status === "proposed" ? <>
                <span>Diesel B7: <b className="tabular-nums">฿{ref!.priceThb.toFixed(2)}/L</b></span><span className="font-semibold text-amber-800">· {t("Proposed", "เสนอ")}</span>
                <a className="font-semibold text-violet-900 underline" href={DIESEL_B7_SOURCE_URL} target="_blank" rel="noreferrer">{t("View source", "ดูแหล่งข้อมูล")}</a>
                {!locked ? <button type="button" className={btn} data-testid="fuel-confirm" onClick={() => report(run({ type: "verify_fuel_reference", date }), t(`Confirmed Diesel B7 for ${date}.`, `ยืนยันดีเซล B7 ของ ${date} แล้ว`))}>{t("Confirm price", "ยืนยันราคา")}</button> : null}
              </> : <>
                <span className="font-semibold text-amber-800" data-testid="fuel-needed">{status === "disputed" ? t("Fuel verification needed (disputed)", "ต้องยืนยันราคาน้ำมัน (ถูกโต้แย้ง)") : t("Fuel verification needed", "ต้องยืนยันราคาน้ำมัน")}</span>
                <a className="font-semibold text-violet-900 underline" href={DIESEL_B7_SOURCE_URL} target="_blank" rel="noreferrer" title={`${sourceLookup(date).enMonth} ${sourceLookup(date).gregorianYear} → "${sourceLookup(date).rowText}"`}>{t("Open source", "เปิดแหล่งข้อมูล")} ↗</a>
                {!locked ? <>
                  <input className={`${input} w-20`} inputMode="decimal" placeholder="฿/L" aria-label={`Diesel B7 ${date}`} value={draft[date] || ""} onChange={(event) => setDraft((prev) => ({ ...prev, [date]: event.target.value }))} />
                  <button type="button" className={btn} data-testid="fuel-enter-confirm" onClick={() => enter(date, false)}>{t("Save & confirm", "บันทึกและยืนยัน")}</button>
                  <button type="button" className="text-xs font-semibold text-slate-600 underline" onClick={() => enter(date, true)}>{t("save as proposed", "บันทึกเป็นค่าที่เสนอ")}</button>
                </> : null}
              </>}
            </span>
          );
        })}
      </div> : null}
      <div className="fc6-verification-actions">
        {categories.length ? (
          <button type="button" className="rounded-lg bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-950 ring-1 ring-amber-300" aria-expanded={open} data-testid="attention-summary" onClick={() => setOpen((value) => !value)}>
            ⚠ {t(`${categories.length} thing(s) need attention: ${categories.join(" and ")}`, `ต้องดำเนินการ ${categories.length} เรื่อง: ${categories.join(" และ ")}`)} {open ? "▴" : "▾"}
          </button>
        ) : <span className="text-sm font-semibold text-emerald-800" data-testid="pricing-ready">✓ {t("Contract / fuel checks complete; review each line’s price evidence", "ตรวจสัญญา / น้ำมันครบแล้ว โปรดตรวจหลักฐานราคาของแต่ละรายการ")}</span>}
        <button type="button" className="ees-fc-btn-secondary !py-1" data-testid="apply-all-suggestions" disabled={locked || !suggestable.length} onClick={applyAll}>{t("Apply verified prices", "ใช้ราคาที่ยืนยันแล้ว")} ({suggestable.length})</button>
        {canManagePricing ? <Link className="ml-auto text-sm font-semibold text-violet-900 underline" data-testid="open-price-setup" href="/finance-pricing-admin">{t("Pricing administration (owner)", "ตั้งค่าราคา (เจ้าของ)")} ↗</Link> : null}
      </div>

      {open && categories.length ? (
        <div className="space-y-1.5 rounded-lg bg-amber-50/60 p-2 text-sm" data-testid="attention-details">
          {fuelIssues.length ? <p><b>{t("Historical fuel price", "ราคาน้ำมันย้อนหลัง")}:</b> {fuelIssues.map((d) => formatDocDate(d)).join(", ")} — {t("enter or confirm the Diesel B7 value above (one value per date serves every invoice).", "กรอกหรือยืนยันราคาดีเซล B7 ด้านบน (หนึ่งค่าต่อวัน ใช้ได้กับทุกใบแจ้งหนี้)")}</p> : null}
          {routeIssues.length ? (
            <div>
              <p><b>{t("Contract mapping", "การอนุมัติสัญญา/เส้นทาง")}:</b> {t("these routes are not covered by an approved pricing agreement yet. Approve each route once and it applies to every matching job.", "เส้นทางเหล่านี้ยังไม่อยู่ในข้อตกลงราคาที่อนุมัติ อนุมัติครั้งเดียวใช้กับงานที่ตรงกันทั้งหมด")}</p>
              <ul className="list-disc pl-5">{routeIssues.map((r) => <li key={r}>{r}</li>)}</ul>
              {canManagePricing ? <Link className={`${btn} mt-1 inline-block`} href="/finance-pricing-admin">{t("Open Rate Agreements", "เปิดข้อตกลงราคา")}</Link> : <p className="text-xs text-slate-600">{t("The owner approves routes in Price setup.", "เจ้าของอนุมัติเส้นทางในตั้งค่าราคา")}</p>}
            </div>
          ) : null}
        </div>
      ) : null}
      {message ? <p role="status" className="text-sm font-semibold text-violet-950" data-testid="pricing-bar-message">{message}</p> : null}
      {rows.some((x) => !x.line?.transport) ? <p className="text-xs text-slate-600">{t("Unpriced work orders are not charged: each one shows “Price needed”.", "ใบงานที่ยังไม่มีราคาจะไม่ถูกเรียกเก็บ และแสดง “ต้องใส่ราคา”")} </p> : null}
    </section>
  );
}
