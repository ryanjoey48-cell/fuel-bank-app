/**
 * Read-only sheet / invoice reconciliation helpers for local safety checks and migration rehearsal.
 * Never mutates state.
 */
import { confirmedWorkOrder, sheetRowTotals, type BillingSheet, type State } from "@/lib/finance-demo-centre";
import { profileRequiredGaps, profilesForLookup } from "@/lib/finance-customer-profiles";
import { findCustomerProfile } from "@/lib/finance-customer-profiles";
import { buildPricingVerificationReport } from "@/lib/finance-pricing-verification";

export type ReconciliationFinding = {
  code: string;
  severity: "error" | "warning" | "info";
  subject: string;
  detail: string;
};

const SIMULATED_TRN_RE = /^TRN(\d{3,})\/(\d{4})$/i;

export function reconcileFinanceState(state: State): ReconciliationFinding[] {
  const findings: ReconciliationFinding[] = [];
  const woOwners = new Map<string, string[]>();

  for (const sheet of state.billingSheets || []) {
    for (const jobId of sheet.jobIds) {
      const job = state.bookings.find((b) => b.id === jobId);
      const wo = job ? confirmedWorkOrder(job) || job.workOrder || jobId : jobId;
      const key = wo.trim().toLowerCase();
      const list = woOwners.get(key) || [];
      list.push(sheet.id);
      woOwners.set(key, list);
    }

    let transportSatang = 0;
    let extrasSatang = 0;
    let incomplete = false;
    for (const jobId of sheet.jobIds) {
      const totals = sheetRowTotals(state, sheet, jobId);
      if (totals.transportSatang === null) incomplete = true;
      else transportSatang += totals.transportSatang;
      for (const value of Object.values(totals.extrasSatang)) {
        if (value === null) continue;
        extrasSatang += value;
      }
      if (totals.pendingExtras) {
        findings.push({
          code: "pending_extras",
          severity: "warning",
          subject: sheet.id,
          detail: `Sheet ${sheet.id} job ${jobId} still has undecided extras.`
        });
      }
    }
    const totalSatang = transportSatang + extrasSatang;
    if (sheet.approvedAt && incomplete) {
      findings.push({
        code: "approved_incomplete_lines",
        severity: "error",
        subject: sheet.id,
        detail: `Approved sheet ${sheet.id} still has blank transport lines (THB ${(totalSatang / 100).toFixed(2)} priced so far).`
      });
    }

    if (sheet.officialTrn != null) {
      findings.push({
        code: "official_trn_on_local_sheet",
        severity: "error",
        subject: sheet.id,
        detail: `Local sheet ${sheet.id} carries an officialTrn value; local testing must keep officialTrn null.`
      });
    }

    const profile = findCustomerProfile(sheet.client, profilesForLookup(state.customerProfiles));
    if (!profile) {
      findings.push({
        code: "missing_customer_profile",
        severity: "warning",
        subject: sheet.client,
        detail: `No customer billing profile matched for "${sheet.client}". Draft documents stay on the pending placeholder.`
      });
    } else {
      const gaps = profileRequiredGaps(profile);
      if (gaps.length || profile.reviewStatus !== "approved") {
        findings.push({
          code: "customer_profile_unverified",
          severity: "warning",
          subject: profile.id,
          detail: `Profile ${profile.id} status=${profile.reviewStatus}; gaps=${gaps.join(",") || "none"}.`
        });
      }
    }

    // Lifecycle sanity for local stages (arrange | billing | documents). Approval is tracked by approvedAt, not stage name.
    if (sheet.approvedAt && sheet.stage !== "documents") {
      findings.push({
        code: "unsupported_lifecycle",
        severity: "warning",
        subject: sheet.id,
        detail: `Sheet ${sheet.id} has approvedAt but stage=${sheet.stage} (expected documents after approval).`
      });
    }
    if (sheet.approvedAt) {
      const hasAudit = state.audit.some((a) => a.action === "sheet_approve" && (a.subject.includes(sheet.id) || a.detail.includes(sheet.id) || a.subject.includes(sheet.simulatedTrn || "___")));
      if (!hasAudit) {
        findings.push({
          code: "missing_approval_audit",
          severity: "warning",
          subject: sheet.id,
          detail: `Approved sheet ${sheet.id} has no sheet_approve audit entry.`
        });
      }
    }
  }

  for (const [wo, sheets] of woOwners) {
    const unique = [...new Set(sheets)];
    if (unique.length > 1) {
      findings.push({
        code: "duplicate_work_order_association",
        severity: "error",
        subject: wo,
        detail: `Work order ${wo} appears on multiple sheets: ${unique.join(", ")}.`
      });
    }
  }

  // Orphan work orders: confirmed WO not on any sheet and not in removedPapers of open sheets
  const allocated = new Set<string>();
  for (const sheet of state.billingSheets || []) {
    for (const id of sheet.jobIds) allocated.add(id);
    for (const removed of sheet.removedPapers || []) allocated.add(removed.jobId);
  }
  for (const job of state.bookings) {
    const wo = confirmedWorkOrder(job);
    if (!wo) continue;
    if (!allocated.has(job.id) && job.origin === "booking_diary_local_test") {
      findings.push({
        code: "orphan_work_order",
        severity: "info",
        subject: wo,
        detail: `Confirmed work order ${wo} is not allocated to any billing sheet.`
      });
    }
  }

  // Simulated vs official numbering: local simulated TRNs must not claim official issuance
  const seenSim = new Map<string, string>();
  for (const sheet of state.billingSheets || []) {
    const trn = sheet.simulatedTrn;
    if (!trn) continue;
    const m = SIMULATED_TRN_RE.exec(trn);
    if (!m) {
      findings.push({
        code: "simulated_trn_format",
        severity: "warning",
        subject: sheet.id,
        detail: `Unexpected simulated TRN format: ${trn}`
      });
      continue;
    }
    const prior = seenSim.get(trn);
    if (prior) {
      findings.push({
        code: "simulated_trn_conflict",
        severity: "error",
        subject: trn,
        detail: `Simulated TRN ${trn} used by both ${prior} and ${sheet.id}.`
      });
    } else seenSim.set(trn, sheet.id);
  }

  const pricing = buildPricingVerificationReport(state);
  for (const date of pricing.missingFuelDates) {
    findings.push({
      code: "missing_rate_verification",
      severity: "warning",
      subject: date,
      detail: `No verified Diesel B7 reference for job date ${date}.`
    });
  }
  for (const conflict of pricing.conflicts) {
    findings.push({
      code: "pricing_conflict",
      severity: "error",
      subject: conflict.clientId,
      detail: `Overlapping approved mappings ${conflict.mappingIds.join(", ")}.`
    });
  }

  return findings;
}

export function sheetMoneyTotals(state: State, sheet: BillingSheet): { transportThb: number; extrasThb: number; totalThb: number; incomplete: boolean } {
  let transportSatang = 0;
  let extrasSatang = 0;
  let incomplete = false;
  for (const jobId of sheet.jobIds) {
    const totals = sheetRowTotals(state, sheet, jobId);
    if (totals.transportSatang === null) incomplete = true;
    else transportSatang += totals.transportSatang;
    for (const value of Object.values(totals.extrasSatang)) {
      if (typeof value === "number") extrasSatang += value;
    }
  }
  return {
    transportThb: transportSatang / 100,
    extrasThb: extrasSatang / 100,
    totalThb: (transportSatang + extrasSatang) / 100,
    incomplete
  };
}
