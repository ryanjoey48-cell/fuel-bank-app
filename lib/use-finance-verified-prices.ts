"use client";

import { useEffect, useRef } from "react";
import { useFinanceFixture } from "@/components/finance-fixture-provider";
import { useAccountAccess } from "@/lib/use-account-access";
import { diagnoseRate, ownerTransportDecision, type State, type BillingSheet, type Booking } from "@/lib/finance-demo-centre";
import type { FlowRun } from "@/components/finance-billing-flow";

/** Existing verified-price synchronization, independent of where its administration controls are displayed. */
export function useFinanceVerifiedPrices(state: State, sheet: BillingSheet, jobs: Booking[], run: FlowRun) {
  const { role } = useFinanceFixture();
  const { access } = useAccountAccess();
  const locked = !!sheet.readyForApprovalAt;
  const suggestable = jobs.map(job => ({ job, d: diagnoseRate(state, job), line: sheet.lines[job.id] }))
    .filter(x => x.d.kind === "suggested" && !x.line?.transport && !ownerTransportDecision(x.job));
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    if (locked) return;
    for (const x of suggestable) {
      if (x.d.kind !== "suggested" || ownerTransportDecision(x.job)) continue;
      const key = `${sheet.id}|${x.job.id}|${x.d.mappingId}|${x.d.amountThb}`;
      if (attempted.current.has(key)) continue;
      attempted.current.add(key);
      const result = run({ type: "sheet_apply_rate", sheetId: sheet.id, jobId: x.job.id, mappingId: x.d.mappingId, amountThb: x.d.amountThb, overrideReason: "", routeVehicleConfirmed: true, confirmOverwrite: false });
      if (!result.ok) attempted.current.delete(key);
    }
    // Inputs and retry semantics match the pre-existing pricing-bar effect; never overwrite an entered price.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, sheet.id, role, access, suggestable.map(x => x.job.id + (x.d.kind === "suggested" ? x.d.amountThb : "")).join(",")]);
}
