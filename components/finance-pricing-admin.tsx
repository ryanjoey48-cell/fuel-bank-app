"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import FinanceAplPriceSetup from "@/components/finance-apl-price-setup";
import FinanceCustomerProfileAdmin from "@/components/finance-customer-profile-admin";
import { sheetErrorText, type FlowRun, type FlowT } from "@/components/finance-billing-flow";
import { useFinanceFixture } from "@/components/finance-fixture-provider";
import FinancePricingBar from "@/components/finance-pricing-bar";
import FinanceRatePanel from "@/components/finance-rate-panel";
import FinanceActivityHistory from "@/components/finance-activity-history";
import { useCanManagePricing } from "@/lib/use-finance-pricing-access";
import { getAccessToken } from "@/lib/account-management";
import { batchActivity } from "@/lib/finance-records";
import {
  CUSTOMER_RATE_SCHEDULES, DIESEL_B7_SOURCE_URL, activeRateMappings, applyAction, fuelStatusOf, confirmedWorkOrder, ownerTransportDecision, sheetTrnLabel, type BillingSheet, type Booking, type FuelReference, type State
} from "@/lib/finance-demo-centre";
import { buildPricingVerificationReport } from "@/lib/finance-pricing-verification";
import { formatBangkokDateTime, formatDocDate } from "@/lib/finance-display";
import { financeActionActor } from "@/lib/finance-intake-access";
import { isFinanceFixtureMode } from "@/lib/finance-fixture-mode";
import { useAccountAccess } from "@/lib/use-account-access";
import { useLanguage } from "@/lib/language-provider";

/** Finance operations start here (agreed cutover): older jobs are historical and never counted as missing fuel work. */
const OPERATIONAL_START = "2026-11-01";
const input = "min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-950";
const btn = "rounded-lg border border-violet-400 bg-violet-50 px-2.5 py-1 text-sm font-semibold text-violet-950 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40";
const FUEL_ACTIONS = new Set(["record_fuel_reference", "verify_fuel_reference", "dispute_fuel_reference"]);
const RATE_ACTIONS = new Set(["confirm_rate_mapping", "propose_rate_mapping", "approve_proposed_rate_mapping", "revoke_rate_mapping"]);

/**
 * Owner-only Finance pricing administration. Everything configurable about pricing lives here, not in daily Customer Billing:
 *  - Customer Rate Agreements: imported schedules, approved route mappings, source and approval history.
 *  - Historical Diesel B7: the one approved source website, verified exact-date records, missing dates, corrections and audit.
 * Values saved here are EES records. Nothing on this page is a live feed from the website.
 */
export default function FinancePricingAdmin() {
  const { language } = useLanguage();
  const t: FlowT = (en, th) => (language === "th" ? th : en);
  const { state, role, dispatch, hydrateReady, persistStatus, saveCurrentWorkspace } = useFinanceFixture();
  const { access } = useAccountAccess();
  const params = useSearchParams();
  const canManage = useCanManagePricing();
  const [tab, setTab] = useState<"review" | "rates" | "fuel" | "profiles">(params.get("tab") === "review" ? "review" : "fuel");
  const [reviewSheetId, setReviewSheetId] = useState(params.get("sheet") || "");
  const reviewSheet = state.billingSheets?.find(sheet => sheet.id === reviewSheetId) ?? state.billingSheets?.find(sheet => sheet.clientId === params.get("customer")) ?? state.billingSheets?.[0];
  const backQuery = new URLSearchParams({ section: "sheet" });
  if (reviewSheet) { backQuery.set("customer", reviewSheet.clientId); backQuery.set("sheet", reviewSheet.id); }
  const backHref = `/finance-centre?${backQuery.toString()}`;
  const [permission, setPermission] = useState<"loading" | "allowed" | "denied" | "error">("loading");
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!canManage) { setPermission("denied"); return; }
    let active = true;
    setPermission("loading");
    void (async () => {
      try {
        const token = isFinanceFixtureMode() ? null : await getAccessToken();
        const response = await fetch("/api/finance-pricing-admin/access", { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const result = response.ok ? await response.json() : null;
        if (active) setPermission(response.ok && result?.allowed === true ? "allowed" : response.status === 401 || response.status === 403 ? "denied" : "error");
      } catch { if (active) setPermission("error"); }
    })();
    return () => { active = false; };
  }, [canManage, access?.userId, accessAttempt]);

  const run: FlowRun = (action) => {
    if (!canManage || permission !== "allowed") return { ok: false, code: "DEMO_ROLE_REQUIRED", detail: "" };
    const actor = financeActionActor(access, role, isFinanceFixtureMode(), action.type);
    try { applyAction(state, action, actor); } catch (caught) {
      const text = caught instanceof Error ? caught.message : "BLOCKED";
      const [code, ...rest] = text.split(":");
      return { ok: false, code, detail: rest.join(":") };
    }
    return dispatch(action) ? { ok: true } : { ok: false, code: "BLOCKED", detail: "" };
  };
  const report = (result: ReturnType<FlowRun>, ok: string) => { setMessage(result.ok ? ok : sheetErrorText(result.code, result.detail, t)); return result.ok; };

  if (!hydrateReady || canManage && permission === "loading") return <main className="ees-fc ees-fc-shell p-4" role="status">{t("Checking administrator access…", "กำลังตรวจสิทธิ์ผู้ดูแล…")}</main>;

  if (!canManage || permission !== "allowed") {
    return (
      <main className="ees-fc ees-fc-shell space-y-3 text-slate-900">
        <h1 className="text-2xl font-bold text-slate-950">{t("Pricing administration", "ตั้งค่าราคา")}</h1>
        <section className="ees-fc-card px-4 py-6" data-testid="pricing-admin-denied">
          <p className="font-semibold">{permission === "error" ? t("Administrator access could not be verified. Try again.", "ตรวจสิทธิ์ผู้ดูแลไม่สำเร็จ โปรดลองอีกครั้ง") : t("This area requires an authorised administrator account.", "พื้นที่นี้ต้องใช้บัญชีผู้ดูแลที่ได้รับสิทธิ์")}</p>
          <button type="button" className="ees-fc-btn-secondary mt-3" onClick={() => setAccessAttempt(value => value + 1)}>{t("Retry access check", "ตรวจสิทธิ์อีกครั้ง")}</button>
          <Link className="ees-fc-btn-secondary mt-3 inline-block !py-1.5" href={backHref}>← {t("Back to Finance Centre", "กลับไปศูนย์การเงิน")}</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="ees-fc ees-fc-shell space-y-3 text-slate-900" data-testid="pricing-admin">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-950">{t("Pricing administration", "ตั้งค่าราคา")}</h1>
        <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-bold text-violet-900">{t("Owner only", "เฉพาะเจ้าของ")}</span>
        <span role="status" className="text-sm text-slate-600">{persistStatus === "saving" ? t("Saving…", "กำลังบันทึก…") : persistStatus === "error" || persistStatus === "conflict" ? t("Not saved — retry", "ยังไม่บันทึก — ลองอีกครั้ง") : persistStatus === "saved" ? t("Saved", "บันทึกแล้ว") : ""}</span>
        <button type="button" className="ees-fc-btn-secondary" onClick={() => void saveCurrentWorkspace().catch(() => setMessage(t("Not saved. Keep this page open and retry.", "ยังไม่บันทึก เปิดหน้านี้ไว้แล้วลองอีกครั้ง")))}>{t("Save", "บันทึก")}</button>
        <Link className="ml-auto ees-fc-btn-secondary !py-1.5" href={backHref} data-testid="pricing-admin-back">← {t("Customer Billing", "วางบิลลูกค้า")}</Link>
      </div>
      <div role="tablist" className="flex flex-wrap gap-2">
        {([["review", t("Invoice pricing & evidence", "ราคาและหลักฐานใบแจ้งหนี้")], ["fuel", t("Historical Diesel B7", "ดีเซล B7 ย้อนหลัง")], ["rates", t("Customer Rate Agreements", "ข้อตกลงราคาลูกค้า")], ["profiles", t("Billing profiles", "โปรไฟล์วางบิล")]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} data-testid={`admin-tab-${id}`} onClick={() => setTab(id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === id ? "bg-violet-700 text-white" : "bg-white text-violet-900 ring-1 ring-violet-200"}`}>{label}</button>
        ))}
      </div>
      {message ? <p role="status" className="text-sm font-semibold text-violet-950" data-testid="pricing-admin-message">{message}</p> : null}
      {tab === "review" ? <>
        <label className="block text-sm font-semibold">{t("Invoice group", "กลุ่มใบแจ้งหนี้")}<select className={`${input} ml-2 max-w-full`} aria-label={t("Invoice group", "กลุ่มใบแจ้งหนี้")} value={reviewSheet?.id || ""} onChange={event => setReviewSheetId(event.target.value)}>{(state.billingSheets || []).map(sheet => <option key={sheet.id} value={sheet.id}>{sheet.client} · {sheetTrnLabel(sheet)}{sheet.label ? ` · ${sheet.label}` : ""}</option>)}</select></label>
        {reviewSheet ? <InvoicePricingReview key={reviewSheet.id} state={state} sheet={reviewSheet} run={run} t={t} language={language} focusJobId={params.get("job") || ""} /> : <p className="ees-fc-card p-4">{t("No invoice groups yet. Arrange work orders first.", "ยังไม่มีกลุ่มใบแจ้งหนี้ กรุณาจัดเรียงใบงานก่อน")}</p>}
      </> : null}
      {tab === "fuel" ? <FuelAdmin t={t} run={run} report={report} /> : null}
      {tab === "rates" ? <RateAdmin t={t} run={run} report={report} /> : null}
      {tab === "profiles" ? <FinanceCustomerProfileAdmin t={t} run={run} report={report} /> : null}
    </main>
  );
}

function InvoicePricingReview({ state, sheet, run, t, language, focusJobId }: { state: State; sheet: BillingSheet; run: FlowRun; t: FlowT; language: "en" | "th"; focusJobId: string }) {
  const jobs = sheet.jobIds.map(id => state.bookings.find(job => job.id === id)).filter(Boolean) as Booking[];
  const locked = !!sheet.readyForApprovalAt;
  const [message, setMessage] = useState("");
  const report = (result: ReturnType<FlowRun>) => setMessage(result.ok ? "" : sheetErrorText(result.code, result.detail, t));
  return <section className="space-y-3" data-testid="invoice-pricing-review">
    <FinancePricingBar state={state} sheet={sheet} jobs={jobs} run={run} t={t} canManagePricing />
    {message ? <p role="alert" className="text-sm text-rose-800">{message}</p> : null}
    {jobs.map(job => {
      const previous = sheet.lines[job.id]?.priceHistory?.at(-1)?.transport;
      const decision = ownerTransportDecision(job);
      const current = sheet.lines[job.id]?.transport;
      const ownerDecisionNeeded = decision && (!current || current.source === "schedule" && Math.round(current.amount * 100) !== Math.round(decision.amountThb * 100));
      return <details key={job.id} open={focusJobId === job.id || jobs.length === 1} className="ees-fc-card p-4" data-testid="admin-work-order-evidence"><summary className="cursor-pointer font-semibold">WO {confirmedWorkOrder(job)} · {job.pickup} → {job.delivery}</summary>
        <div className="mt-3"><FinanceRatePanel state={state} sheet={sheet} job={job} run={run} t={t} locked={locked} /></div>
        {previous ? <button type="button" disabled={locked} className="ees-fc-btn-secondary mt-2" onClick={() => report(run({ type: "sheet_set_transport", sheetId: sheet.id, jobId: job.id, transport: { amount: previous.amount, source: "manual", overrideReason: "Restored earlier price" } }))}>{t("Restore earlier price", "คืนราคาก่อนหน้า")} · {previous.amount.toLocaleString()}</button> : null}
        {decision && ownerDecisionNeeded ? <button type="button" disabled={locked} className="ees-fc-btn-secondary mt-2" onClick={() => report(run({ type: "sheet_set_transport", sheetId: sheet.id, jobId: job.id, transport: { amount: decision.amountThb, source: "manual", suggestedThb: decision.suggestedThb, overrideReason: decision.reason } }))}>{t("Apply recorded owner decision", "ใช้ราคาที่เจ้าของตัดสินไว้")} · {decision.amountThb.toLocaleString()}</button> : null}
      </details>;
    })}
    <FinanceActivityHistory entries={batchActivity(state, sheet)} canView language={language} />
  </section>;
}

function FuelAdmin({ t, run, report }: { t: FlowT; run: FlowRun; report: (r: ReturnType<FlowRun>, ok: string) => boolean }) {
  const { state } = useFinanceFixture();
  const refs = (state.fuelReferences || []).slice().sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const current = (date: string): FuelReference | undefined => refs.find((r) => r.date === date && !r.supersededAt);
  // Dates that jobs from the operational start onwards depend on, and that have no VERIFIED value yet.
  const missing = useMemo(() => {
    const dates = new Set<string>();
    for (const job of state.bookings as Booking[]) if (job.date >= OPERATIONAL_START || (state.billingSheets || []).some((s) => s.jobIds.includes(job.id))) dates.add(job.date);
    return [...dates].filter((d) => { const r = (state.fuelReferences || []).find((x) => x.date === d && !x.supersededAt); return !r || fuelStatusOf(r) !== "verified"; }).sort();
  }, [state]);
  const [date, setDate] = useState("");
  const [price, setPrice] = useState("");
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [proposed, setProposed] = useState(true);
  const [batch, setBatch] = useState("");
  const [local, setLocal] = useState("");

  const save = (d: string, p: string, ev: string, asProposed: boolean, why: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return t("Date must be YYYY-MM-DD.", "วันที่ต้องเป็น YYYY-MM-DD");
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(p.trim())) return t("Price must be a Diesel B7 THB/L value such as 43.54.", "ราคาต้องเป็นดีเซล B7 บาท/ลิตร เช่น 43.54");
    const result = run({ type: "record_fuel_reference", date: d, priceThb: Number(p), evidence: ev.trim() || `Approved EES history page, ${d}, column ดีเซล B7 = ${p}`, sourceUrl: DIESEL_B7_SOURCE_URL, proposed: asProposed, ...(why.trim() ? { revisionReason: why.trim() } : {}) });
    return result.ok ? "" : sheetErrorText(result.code, result.detail, t);
  };
  const submit = () => {
    const err = save(date, price, evidence, proposed, reason);
    if (err) { setLocal(err); return; }
    setLocal(""); report({ ok: true }, t(`Saved Diesel B7 for ${date} (${proposed ? "proposed — needs verification" : "verified"}).`, `บันทึกดีเซล B7 ของ ${date} แล้ว`));
    setDate(""); setPrice(""); setEvidence(""); setReason("");
  };
  // Batch entry: one "YYYY-MM-DD,price" per line. Always saved as PROPOSED; verification stays a separate deliberate step. Duplicates/conflicts are reported, never overwritten.
  const submitBatch = () => {
    const lines = batch.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let ok = 0; const problems: string[] = [];
    for (const [i, line] of lines.entries()) {
      const [d, p] = line.split(/[,\t;]/).map((x) => (x || "").trim());
      const err = save(d, p, "", true, "");
      if (err) problems.push(`#${i + 1} ${d || "?"}: ${err}`); else ok += 1;
    }
    setLocal(problems.length ? problems.join(" · ") : "");
    report({ ok: true }, t(`${ok} of ${lines.length} line(s) saved as proposed. Verify each one against the approved source.`, `บันทึก ${ok} จาก ${lines.length} บรรทัดเป็นค่าที่เสนอ โปรดยืนยันกับแหล่งข้อมูล`));
    if (!problems.length) setBatch("");
  };
  const audit = state.audit.filter((a) => FUEL_ACTIONS.has(a.action)).slice(-30).reverse();

  return (
    <div className="space-y-3" data-testid="fuel-admin">
      <section className="ees-fc-card space-y-1 px-4 py-3">
        <p className="text-sm"><b>{t("Approved source", "แหล่งข้อมูลที่อนุมัติ")}:</b> <a className="font-semibold text-violet-900 underline" href={DIESEL_B7_SOURCE_URL} target="_blank" rel="noreferrer">{DIESEL_B7_SOURCE_URL}</a> ↗</p>
        <p className="text-sm text-slate-700">{t("Product: Diesel B7 (Bangkok). These are EES-stored records entered and verified by people; this page does not pull live data from the website, and no other fuel source is accepted.", "ผลิตภัณฑ์: ดีเซล B7 (กรุงเทพ) ค่าที่เก็บใน EES บันทึกและยืนยันโดยเจ้าหน้าที่ หน้านี้ไม่ได้ดึงข้อมูลสดจากเว็บไซต์ และไม่รับแหล่งน้ำมันอื่น")}</p>
      </section>

      <section className="ees-fc-card px-4 py-3" data-testid="fuel-missing">
        <h2 className="text-base font-bold">{t("Dates needing a verified value", "วันที่ต้องมีราคาที่ยืนยันแล้ว")} ({missing.length})</h2>
        {missing.length ? (
          <ul className="mt-1 flex flex-wrap gap-2 text-sm">{missing.map((d) => {
            const r = current(d); const st = r ? fuelStatusOf(r) : "missing";
            return <li key={d}><button type="button" className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-950 ring-1 ring-amber-300" onClick={() => setDate(d)}>{formatDocDate(d)} · {st === "missing" ? t("Historical Diesel B7 unavailable — verification required", "ไม่มีราคาดีเซล B7 ย้อนหลัง — ต้องยืนยัน") : st === "proposed" ? t("proposed", "เสนอ") : t("disputed", "โต้แย้ง")}</button></li>;
          })}</ul>
        ) : <p className="mt-1 text-sm font-semibold text-emerald-800">✓ {t("Every date in use has a verified value.", "ทุกวันที่ใช้งานมีราคาที่ยืนยันแล้ว")}</p>}
      </section>

      <section className="ees-fc-card grid gap-3 px-4 py-3 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-base font-bold">{t("Add or correct one date", "เพิ่มหรือแก้ไขรายวัน")}</h2>
          <div className="flex flex-wrap gap-2">
            <input className={`${input} w-36`} type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
            <input className={`${input} w-28`} inputMode="decimal" placeholder="฿/L" aria-label="Diesel B7" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <input className={`${input} w-full`} placeholder={t("Source evidence (row/column read from the approved page)", "หลักฐาน (แถว/คอลัมน์ที่อ่านจากหน้าที่อนุมัติ)")} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          {date && current(date) ? <input className={`${input} w-full`} placeholder={t("Correction reason (10+ characters) — the earlier value is kept in history", "เหตุผลการแก้ไข (10 ตัวอักษรขึ้นไป) ค่าเดิมเก็บไว้ในประวัติ")} value={reason} onChange={(e) => setReason(e.target.value)} /> : null}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={proposed} onChange={(e) => setProposed(e.target.checked)} />{t("Save as proposed (needs a separate verification)", "บันทึกเป็นค่าที่เสนอ (ต้องยืนยันแยก)")}</label>
          <button type="button" className="ees-fc-btn-primary !py-1" data-testid="fuel-admin-save" disabled={!date || !price} onClick={submit}>{t("Save", "บันทึก")}</button>
        </div>
        <div className="space-y-2">
          <h2 className="text-base font-bold">{t("Batch entry / import", "บันทึกหลายวัน / นำเข้า")}</h2>
          <textarea className={`${input} h-28 w-full font-mono`} placeholder={"2026-11-03,40.69\n2026-11-04,40.69"} value={batch} onChange={(e) => setBatch(e.target.value)} />
          <p className="text-xs text-slate-600">{t("One date,price per line (CSV paste). Lines are saved as PROPOSED only; duplicates and invalid lines are rejected, never overwritten.", "หนึ่งบรรทัดต่อวัน: วันที่,ราคา บันทึกเป็นค่าที่เสนอเท่านั้น ข้อมูลซ้ำหรือไม่ถูกต้องจะถูกปฏิเสธ")}</p>
          <button type="button" className={btn} data-testid="fuel-admin-batch" disabled={!batch.trim()} onClick={submitBatch}>{t("Save as proposed", "บันทึกเป็นค่าที่เสนอ")}</button>
        </div>
        {local ? <p role="alert" className="text-sm font-semibold text-rose-800 lg:col-span-2" data-testid="fuel-admin-error">{local}</p> : null}
      </section>

      <section className="ees-fc-card overflow-x-auto px-4 py-3">
        <h2 className="text-base font-bold">{t("Records", "รายการ")}</h2>
        <table className="mt-1 w-full text-left text-sm" data-testid="fuel-admin-table">
          <thead><tr className="text-slate-600"><th className="py-1 pr-3">{t("Date", "วันที่")}</th><th className="pr-3">฿/L</th><th className="pr-3">{t("Status", "สถานะ")}</th><th className="pr-3">{t("Evidence", "หลักฐาน")}</th><th className="pr-3">{t("By / when", "โดย / เมื่อ")}</th><th /></tr></thead>
          <tbody>{refs.length ? refs.map((r) => {
            const st = fuelStatusOf(r); const superseded = !!r.supersededAt;
            return (
              <tr key={r.id} className={`border-t border-slate-100 ${superseded ? "text-slate-400 line-through" : ""}`}>
                <td className="py-1 pr-3 font-semibold">{formatDocDate(r.date)}</td><td className="pr-3 tabular-nums">{r.priceThb.toFixed(2)}</td>
                <td className="pr-3">{superseded ? t("Superseded", "ถูกแทนที่") : st === "verified" ? t("Verified", "ยืนยันแล้ว") : st === "proposed" ? t("Proposed", "เสนอ") : t("Disputed", "โต้แย้ง")}</td>
                <td className="max-w-md truncate pr-3" title={r.evidence}>{r.evidence}</td>
                <td className="pr-3 whitespace-nowrap">{r.verifiedBy ?? r.reviewer} · {formatBangkokDateTime(r.verifiedAt ?? r.retrievedAt)}</td>
                <td className="whitespace-nowrap">{!superseded && st !== "verified" ? <button type="button" className={btn} onClick={() => report(run({ type: "verify_fuel_reference", date: r.date }), t(`Verified ${r.date}.`, `ยืนยัน ${r.date} แล้ว`))}>{t("Verify", "ยืนยัน")}</button> : null}
                  {!superseded && st === "verified" ? <button type="button" className="text-xs font-semibold text-rose-800 underline" onClick={() => { const why = window.prompt(t("Why is this value disputed?", "เหตุผลที่โต้แย้ง")); if (why) report(run({ type: "dispute_fuel_reference", date: r.date, reason: why }), t("Marked disputed.", "ทำเครื่องหมายโต้แย้งแล้ว")); }}>{t("Dispute", "โต้แย้ง")}</button> : null}</td>
              </tr>
            );
          }) : <tr><td colSpan={6} className="py-3 text-slate-600">{t("No Diesel B7 records saved yet.", "ยังไม่มีราคาดีเซล B7 ที่บันทึก")}</td></tr>}</tbody>
        </table>
      </section>

      <section className="ees-fc-card px-4 py-3">
        <h2 className="text-base font-bold">{t("Audit history", "ประวัติการแก้ไข")}</h2>
        <ul className="mt-1 space-y-0.5 text-xs" data-testid="fuel-admin-audit">{audit.length ? audit.map((a) => <li key={a.step}><b>{formatBangkokDateTime(a.at)}</b> · {a.actor} · {a.action.replace(/_/g, " ")} · {a.detail.slice(0, 180)}</li>) : <li className="text-slate-600">—</li>}</ul>
      </section>
    </div>
  );
}

function RateAdmin({ t, run, report }: { t: FlowT; run: FlowRun; report: (r: ReturnType<FlowRun>, ok: string) => boolean }) {
  const { state } = useFinanceFixture();
  const clients = useMemo(() => {
    const seen = new Map<string, { clientId: string; client: string; jobs: Booking[] }>();
    for (const job of state.bookings as Booking[]) {
      const entry = seen.get(job.clientId) ?? { clientId: job.clientId, client: job.client, jobs: [] };
      entry.jobs.push(job); seen.set(job.clientId, entry);
    }
    return [...seen.values()];
  }, [state.bookings]);
  const mappings = activeRateMappings(state);
  const reportCard = useMemo(() => buildPricingVerificationReport(state), [state]);
  const audit = state.audit.filter((a) => RATE_ACTIONS.has(a.action)).slice(-30).reverse();
  return (
    <div className="space-y-3" data-testid="rate-admin">
      <section className="ees-fc-card space-y-2 px-4 py-3" data-testid="rate-verification-summary">
        <h2 className="text-base font-bold">{t("Verification summary", "สรุปการยืนยัน")}</h2>
        <ul className="grid gap-1 text-sm md:grid-cols-2">
          <li><b>{t("Owner-approved mappings", "การผูกเส้นทางที่เจ้าของอนุมัติ")}:</b> {reportCard.approvedMappings.length}</li>
          <li className="text-amber-900"><b>{t("Proposed (not pricing)", "เสนอแล้ว (ยังไม่คิดราคา)")}:</b> {reportCard.proposedMappings.length}</li>
          <li className="text-amber-900"><b>{t("Imported rows still unmapped", "แถวที่นำเข้ายังไม่ผูก")}:</b> {reportCard.unmappedScheduleRows.length}</li>
          <li className={reportCard.conflicts.length ? "font-semibold text-rose-800" : ""}><b>{t("Effective-date conflicts", "ช่วงวันทับซ้อน")}:</b> {reportCard.conflicts.length}</li>
          <li className="text-amber-900"><b>{t("Jobs with mapping gaps", "งานที่ขาดการผูกสัญญา")}:</b> {reportCard.effectiveGaps.length}</li>
          <li className="text-amber-900"><b>{t("Ambiguous matches", "จับคู่คลุมเครือ")}:</b> {reportCard.ambiguousJobs.length}</li>
        </ul>
        <p className="text-xs text-slate-600">{t("Imported schedules are never auto-approved. Proposed mappings do not price jobs until an owner confirms them. Past Diesel B7 prices are never inferred from today.", "ตารางที่นำเข้าไม่อนุมัติอัตโนมัติ การผูกที่เสนอยังไม่คิดราคาจนกว่าเจ้าของยืนยัน และไม่ใช้ราคาวันนี้แทนราคาวันงานย้อนหลัง")}</p>
        {reportCard.proposedMappings.length ? (
          <div className="overflow-x-auto">
            <table className="mt-1 w-full text-left text-sm" data-testid="proposed-mappings-table">
              <thead><tr className="text-slate-600"><th className="py-1 pr-3">Id</th><th className="pr-3">{t("Contract", "สัญญา")}</th><th className="pr-3">{t("Effective", "มีผล")}</th><th /></tr></thead>
              <tbody>{reportCard.proposedMappings.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="py-1 pr-3 font-mono text-xs">{m.id}</td>
                  <td className="pr-3">{m.contractReference}</td>
                  <td className="pr-3">{m.effectiveFrom} → {m.effectiveTo || "open"}</td>
                  <td><button type="button" className={btn} data-testid="approve-proposed-mapping" onClick={() => report(run({ type: "approve_proposed_rate_mapping", mappingId: m.id }), t(`Approved ${m.id}.`, `อนุมัติ ${m.id} แล้ว`))}>{t("Owner approve", "เจ้าของอนุมัติ")}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}
        {reportCard.conflicts.length ? (
          <ul className="text-sm text-rose-800" data-testid="rate-conflicts">{reportCard.conflicts.map((c) => (
            <li key={c.mappingIds.join("-")}>⚠ {c.clientId}: {c.mappingIds.join(" ↔ ")} ({c.effectiveFrom} → {c.effectiveTo || "open"})</li>
          ))}</ul>
        ) : null}
        {reportCard.effectiveGaps.length ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-amber-950">{t("Effective-date / route gaps", "ช่องว่างวันที่มีผล / เส้นทาง")} ({reportCard.effectiveGaps.length})</summary>
            <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs" data-testid="rate-gaps">
              {reportCard.effectiveGaps.slice(0, 40).map((g) => (
                <li key={g.jobId}>{g.date} · {g.client} · {g.workOrder} · {g.code}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
      <section className="ees-fc-card overflow-x-auto px-4 py-3">
        <h2 className="text-base font-bold">{t("Imported customer price schedules", "ตารางราคาลูกค้าที่นำเข้า")}</h2>
        <table className="mt-1 w-full text-left text-sm" data-testid="rate-schedules">
          <thead><tr className="text-slate-600"><th className="py-1 pr-3">{t("Schedule", "ตาราง")}</th><th className="pr-3">{t("Routes", "เส้นทาง")}</th><th className="pr-3">{t("Rates", "ราคา")}</th><th className="pr-3">{t("Source PDF", "ไฟล์ต้นทาง")}</th><th>{t("Approved routes", "เส้นทางที่อนุมัติ")}</th></tr></thead>
          <tbody>{CUSTOMER_RATE_SCHEDULES.map((s) => (
            <tr key={s.id} className="border-t border-slate-100">
              <td className="py-1 pr-3 font-semibold">{s.name}</td><td className="pr-3">{s.rows.length}</td>
              <td className="pr-3 tabular-nums">{s.rows.reduce((n, r) => n + r.bands.length, 0)}</td><td className="pr-3">{s.sourceFilename}</td>
              <td>{mappings.filter((m) => m.scheduleId === s.id).length}</td>
            </tr>
          ))}</tbody>
        </table>
        <p className="mt-1 text-xs text-slate-600">{t("Rates are read from these imported tables exactly as printed. Approve a route once below and it prices every matching booking.", "ราคาอ่านจากตารางที่นำเข้าตามที่พิมพ์ อนุมัติเส้นทางครั้งเดียวใช้กับทุกงานที่ตรงกัน")}</p>
      </section>
      {clients.map((c) => (
        <FinanceAplPriceSetup key={c.clientId} state={state} jobs={c.jobs} clientId={c.clientId} client={c.client} run={run} t={t} canApprove />
      ))}
      <section className="ees-fc-card px-4 py-3">
        <h2 className="text-base font-bold">{t("Approval & revocation history", "ประวัติการอนุมัติและการยกเลิก")}</h2>
        <ul className="mt-1 space-y-0.5 text-xs" data-testid="rate-admin-audit">{audit.length ? audit.map((a) => <li key={a.step}><b>{formatBangkokDateTime(a.at)}</b> · {a.actor} · {a.action.replace(/_/g, " ")} · {a.detail.slice(0, 180)}</li>) : <li className="text-slate-600">—</li>}</ul>
      </section>
    </div>
  );
}
