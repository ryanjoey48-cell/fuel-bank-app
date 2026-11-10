/**
 * Adapter: a saved Finance billing sheet → invoice lines. Uses the same figures the billing table, TRN statement and
 * Finance Records show (sheetRowTotals), so nothing is retyped or read from a spreadsheet.
 */
import { buildInvoiceDocument, type InvoiceDocument, type InvoiceLine } from "@/lib/finance-invoice-model";
import { findCustomerProfile, pendingCustomerProfile, profilesForLookup, type CustomerBillingProfile } from "@/lib/finance-customer-profiles";
import { displayVehicle } from "@/lib/finance-display";
import { bangkokDate, confirmedWorkOrder, sheetRowTotals, type BillingSheet, type State } from "@/lib/finance-demo-centre";

const EXTRA_DESCRIPTION: Record<string, string> = {
  parking: "PARKING CHARGE", toll: "TOLL CHARGE", overtime: "OVERTIME CHARGE", container_pickup: "CONTAINER PICKUP CHARGE", overnight: "OVERNIGHT CHARGE", other: "OTHER CHARGE"
};
// Parking and Overtime print in their own columns (owner-confirmed); everything else is a separate row.
const EXTRA_ORDER = ["toll", "container_pickup", "overnight", "other"] as const;

export function invoiceLinesFromSheet(state: State, sheet: BillingSheet): { lines: InvoiceLine[]; warnings: string[] } {
  const lines: InvoiceLine[] = [];
  const warnings: string[] = [];
  for (const jobId of sheet.jobIds) {
    const job = state.bookings.find((item) => item.id === jobId);
    if (!job) { warnings.push("A paper in this batch has no booking record."); continue; }
    const totals = sheetRowTotals(state, sheet, jobId);
    const transport = sheet.lines[jobId]?.transport ?? null;
    if (totals.transportSatang === null) warnings.push(`Work order ${confirmedWorkOrder(job)} has no transport charge.`);
    lines.push({
      kind: "trip", date: job.date, pickup: job.pickup, delivery: job.delivery, vehicle: displayVehicle(job.vehicle), workOrder: confirmedWorkOrder(job),
      fuelRate: typeof transport?.fuelPriceThb === "number" ? transport.fuelPriceThb : null, description: "", amountSatang: totals.transportSatang ?? 0, ...(totals.transportSatang === null ? { unpriced: true } : {}),
      parkingSatang: totals.extrasSatang.parking && totals.extrasSatang.parking > 0 ? totals.extrasSatang.parking : null,
      overtimeSatang: totals.extrasSatang.overtime && totals.extrasSatang.overtime > 0 ? totals.extrasSatang.overtime : null
    });
    // Each approved extra stays on its own row — never merged into the transport charge.
    for (const kind of EXTRA_ORDER) {
      const satang = totals.extrasSatang[kind];
      if (satang === null || satang === 0) continue;
      lines.push({ kind: "extra", date: null, pickup: "", delivery: "", vehicle: "", workOrder: "", fuelRate: null, description: EXTRA_DESCRIPTION[kind], amountSatang: satang });
    }
  }
  return { lines, warnings };
}

export function invoiceFromSheet(state: State, sheet: BillingSheet, profile: CustomerBillingProfile, today = bangkokDate()): InvoiceDocument {
  const { lines, warnings } = invoiceLinesFromSheet(state, sheet);
  const invoiceNo = sheet.simulatedTrn ?? sheet.draftReference;
  return buildInvoiceDocument({ invoiceNo, invoiceNoKind: sheet.simulatedTrn ? "simulated_trn" : "draft_reference", invoiceDate: today, lines, draft: true, warnings }, profile);
}

/** Template choice for a sheet: the approved customer profile's template, otherwise null (generic draft invoice). */
export function invoiceProfileForSheet(sheet: BillingSheet, state?: State): { profile: CustomerBillingProfile | null; approved: boolean } {
  const catalog = state ? profilesForLookup(state.customerProfiles) : undefined;
  const profile = findCustomerProfile(sheet.client, catalog);
  return { profile, approved: !!profile && profile.reviewStatus === "approved" };
}

/** The profile the invoice preview uses: the customer's own (approved or pending), else a clearly pending placeholder — never another customer's. */
export function previewProfileForSheet(sheet: BillingSheet, state?: State): { profile: CustomerBillingProfile; kind: "approved" | "pending_profile" | "no_profile" } {
  const { profile, approved } = invoiceProfileForSheet(sheet, state);
  if (profile) return { profile, kind: approved ? "approved" : "pending_profile" };
  return { profile: pendingCustomerProfile(sheet.client), kind: "no_profile" };
}
