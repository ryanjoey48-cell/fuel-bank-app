"use client";

import { useState } from "react";
import FinanceAplPriceSetup from "@/components/finance-apl-price-setup";
import FinanceFuelPricesPanel from "@/components/finance-fuel-prices-panel";
import FinanceOwnerReview from "@/components/finance-owner-review";
import { sheetErrorText, type FlowRun, type FlowT } from "@/components/finance-billing-flow";
import { useFinanceFixture } from "@/components/finance-fixture-provider";
import {
  DIESEL_B7_SOURCE_URL,
  activeRateMappings,
  confirmedWorkOrder,
  diagnoseRate,
  type BillingSheet,
  type Booking,
  type State
} from "@/lib/finance-demo-centre";
import { hasAuthenticatedFinanceAdminIntake } from "@/lib/finance-intake-access";
import { formatThb } from "@/lib/finance-display";
import { useAccountAccess } from "@/lib/use-account-access";

const input = "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-950";
const btn = "rounded-lg border border-violet-400 bg-violet-50 px-3 py-1.5 text-sm font-semibold text-violet-950 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Customer pricing set-up for one billing batch: approve which customer route + vehicle class uses which schedule row,
 * verify the exact-date Diesel B7 once per date, and apply every matching suggestion in one click. Nothing here invents a
 * price: a job with no approved route match, no verified fuel date or an out-of-band fuel price stays unpriced and says why.
 */
export default function FinancePricingSetup({ state, sheet, jobs, run, t }: { state: State; sheet: BillingSheet; jobs: Booking[]; run: FlowRun; t: FlowT }) {
  const { role } = useFinanceFixture();
  const { access } = useAccountAccess();
  const canApprove = role === "approver" || role === "super_admin" || hasAuthenticatedFinanceAdminIntake(access);
  const locked = !!sheet.readyForApprovalAt;
  const clientId = sheet.clientId;
  const mappings = activeRateMappings(state).filter((item) => item.clientId === clientId);
  const rows = jobs.map((job) => ({ job, d: diagnoseRate(state, job), line: sheet.lines[job.id] }));
  const proposedDates = [...new Set(jobs.map((job) => job.date))].filter((date) => { const ref = (state.fuelReferences || []).find((item) => item.date === date && !item.supersededAt); return !!ref && (ref.status ?? "verified") !== "verified"; });
  const suggestable = rows.filter((x) => x.d.kind === "suggested" && !x.line?.transport);
  const needFuelDates = [...new Set(rows.filter((x) => x.d.kind === "unavailable" && x.d.code === "needs_fuel").map((x) => x.job.date))].sort();
  const verifiedDates = [...new Set(jobs.map((job) => job.date))].filter((date) => (state.fuelReferences || []).some((ref) => ref.date === date && !ref.supersededAt)).sort();

  const [message, setMessage] = useState("");
  // Open when there is something to do at first sight; afterwards the user's choice sticks (it must not collapse while approving).
  const [open, setOpen] = useState(true);
  const [fuel, setFuel] = useState<Record<string, { price: string; evidence: string }>>({});
  const report = (result: ReturnType<FlowRun>, ok: string) => { setMessage(result.ok ? ok : sheetErrorText(result.code, result.detail, t)); return result.ok; };

  const applyAll = () => {
    let done = 0;
    for (const x of suggestable) {
      if (x.d.kind !== "suggested") continue;
      const result = run({ type: "sheet_apply_rate", sheetId: sheet.id, jobId: x.job.id, mappingId: x.d.mappingId, amountThb: x.d.amountThb, overrideReason: "", routeVehicleConfirmed: true, confirmOverwrite: false });
      if (result.ok) done += 1;
    }
    setMessage(t(`${done} suggested prices applied. Jobs that already had a price were not touched.`, `ใช้ราคาที่แนะนำแล้ว ${done} รายการ งานที่มีราคาอยู่แล้วไม่ถูกแก้`));
  };

  return (
    <details className="ees-fc-card px-4 py-2" open={open} onToggle={(event) => setOpen(event.currentTarget.open)} data-testid="pricing-setup">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1">
        <strong className="text-base text-violet-950">{t("Pricing & fuel", "ราคาและน้ำมัน")}</strong>
        <span className="text-sm text-slate-700">{t(`${mappings.length} approved route rate(s)`, `ราคาเส้นทางที่อนุมัติ ${mappings.length} รายการ`)}</span>
        {needFuelDates.length ? <span className="text-sm font-semibold text-amber-800" data-testid="fuel-needed-count">⚠ {t(`Fuel price needs verification: ${needFuelDates.length} date(s)`, `ต้องยืนยันราคาน้ำมัน ${needFuelDates.length} วัน`)}</span> : null}
        {proposedDates.length ? <span className="text-sm font-semibold text-amber-800" data-testid="fuel-proposed-count">⚠ {t(`${proposedDates.length} fuel value(s) awaiting owner verification`, `ค่าน้ำมันรอเจ้าของยืนยัน ${proposedDates.length} วัน`)}</span> : null}
        {suggestable.length ? <span className="text-sm font-semibold text-emerald-800">{t(`${suggestable.length} suggested price(s) ready`, `มีราคาแนะนำพร้อมใช้ ${suggestable.length} รายการ`)}</span> : null}
        <span className="ml-auto text-xs text-slate-500">{t("Open / close", "เปิด/ปิด")} ▾</span>
      </summary>

      <div className="mt-3"><FinanceFuelPricesPanel state={state} sheet={sheet} jobs={jobs} run={run} t={t} locked={locked} /></div>
      <div className="mt-3"><FinanceOwnerReview state={state} sheet={sheet} jobs={jobs} t={t} /></div>
      <div className="mt-3 grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-violet-50 p-3">
            <p className="text-sm text-violet-950">{t(`${suggestable.length} unpriced job(s) have a verified suggestion.`, `มี ${suggestable.length} งานที่ยังไม่มีราคาและมีราคาแนะนำที่ยืนยันแล้ว`)}</p>
            <button type="button" className="ees-fc-btn-primary !py-1.5" data-testid="setup-apply-all" disabled={locked || !suggestable.length} onClick={applyAll}>{t("Apply verified prices", "ใช้ราคาที่ยืนยันแล้ว")} ({suggestable.length})</button>
            <span className="text-xs text-slate-600">{t("Existing prices are never overwritten here. Parking and toll receipts are not added.", "ไม่ทับราคาที่มีอยู่ ค่าจอดและทางด่วนจากใบเสร็จไม่ถูกบวกให้ลูกค้า")}</span>
          </div>

          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-800">{t("Why each job has / lacks a price", "สถานะราคาของแต่ละงาน")}</p>
            <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-xs" data-testid="pricing-status-list">
              {rows.map(({ job, d, line }) => (
                <li key={job.id} className="flex gap-2">
                  <b className="w-16 shrink-0">{confirmedWorkOrder(job)}</b>
                  <span className="min-w-0 flex-1 truncate">{d.kind === "suggested" ? `${formatThb(d.amountThb)} · ${d.bandLabel} · ฿${d.fuelPriceThb.toFixed(2)}/L` : t(d.en, d.th)}</span>
                  {line?.transport ? <span className="shrink-0 font-semibold text-emerald-800">{t("applied", "ใช้แล้ว")} {formatThb(line.transport.amount)}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <FinanceAplPriceSetup state={state} jobs={jobs} clientId={clientId} client={sheet.client} run={run} t={t} canApprove={canApprove} />
      </div>
      {message ? <p role="status" className="mt-2 text-sm font-semibold text-violet-950" data-testid="pricing-setup-message">{message}</p> : null}
    </details>
  );
}

