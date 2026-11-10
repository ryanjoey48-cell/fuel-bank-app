import { confirmedWorkOrder, normalizeWorkOrderInput, sheetTrnLabel, type State } from "./finance-demo-centre";

export class FinanceWriteGuardError extends Error {}

/** Checked inside the store's serialised read/check/write boundary, independently of browser controls. */
export function assertFinanceBillingWrite(previous: State | undefined, next: State) {
  const assignments = (state: State) => {
    const seen = new Map<string, string>();
    const duplicates = new Set<string>();
    const jobs = new Map(state.bookings.map(job => [job.id, job]));
    for (const sheet of state.billingSheets || []) {
      for (const id of sheet.jobIds) {
        const job = jobs.get(id);
        const identity = job ? normalizeWorkOrderInput(confirmedWorkOrder(job)) : "";
        const keys = [`booking:${id}`, ...(identity ? [`wo:${identity}`] : [])];
        for (const key of keys) {
          const old = seen.get(key);
          if (old) duplicates.add(`${key}|${old}|${sheet.id}`);
          else seen.set(key, sheet.id);
        }
      }
    }
    return duplicates;
  };
  const existingDuplicates = previous ? assignments(previous) : new Set<string>();
  for (const duplicate of assignments(next)) {
    if (!existingDuplicates.has(duplicate)) throw new FinanceWriteGuardError("FINANCE_DUPLICATE_BILLING");
  }
  for (const sheet of previous?.billingSheets || []) {
    if (!sheet.approvedAt && !sheet.readyForApprovalAt && !sheet.officialTrn) continue;
    const updated = next.billingSheets?.find(item => item.id === sheet.id);
    if (!updated || JSON.stringify([sheet.clientId, sheet.jobIds, sheet.lines, sheet.officialTrn]) !== JSON.stringify([updated.clientId, updated.jobIds, updated.lines, updated.officialTrn])) {
      throw new FinanceWriteGuardError("FINANCE_APPROVED_FIGURES_LOCKED");
    }
    if (sheet.approvedAt && updated.approvedAt && JSON.stringify([sheet.approvedAt, sheet.approvedBy, sheet.approvalNote]) !== JSON.stringify([updated.approvedAt, updated.approvedBy, updated.approvalNote])) throw new FinanceWriteGuardError("FINANCE_APPROVED_FIGURES_LOCKED");
    for (const id of sheet.jobIds) {
      const oldJob = previous!.bookings.find(job => job.id === id);
      const newJob = next.bookings.find(job => job.id === id);
      const facts = (job: typeof oldJob) => job && [job.clientId, job.client, job.date, job.returned, job.adminReceipts, job.workOrderConfirmed, job.price];
      if (JSON.stringify(facts(oldJob)) !== JSON.stringify(facts(newJob))) throw new FinanceWriteGuardError("FINANCE_APPROVED_FIGURES_LOCKED");
    }
    if ((sheet.readyForApprovalAt && !updated.readyForApprovalAt) || (sheet.approvedAt && !updated.approvedAt)) {
      if (sheet.officialTrn) throw new FinanceWriteGuardError("FINANCE_APPROVED_FIGURES_LOCKED");
      const additions = next.audit.slice(previous!.audit.length);
      if (!additions.some(event => ["sheet_reopen", "sheet_reject_approval"].includes(event.action) && event.subject === sheetTrnLabel(sheet) && event.detail.trim().length >= 10)) {
        throw new FinanceWriteGuardError("FINANCE_REOPEN_AUDIT_REQUIRED");
      }
    }
  }
  for (const sheet of next.billingSheets || []) {
    const prior = previous?.billingSheets?.find(item => item.id === sheet.id);
    if (sheet.officialTrn && sheet.officialTrn !== prior?.officialTrn) throw new FinanceWriteGuardError("FINANCE_ISSUANCE_DISABLED");
  }
}
