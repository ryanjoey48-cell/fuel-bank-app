/**
 * Isolated fixture: the owner's example invoice (TRN invoice test.pdf, INTEGRA, TRN649/2026) as input data.
 * Used only by the fidelity tests and the fixture-mode preview page. It is never written to Finance records and its
 * values (INTEGRA, WO 6372, 64-0359, ฿3,800 + ฿1,000 overnight) never appear in real Finance drafts.
 */
import { findCustomerProfile } from "@/lib/finance-customer-profiles";
import { buildInvoiceDocument, type InvoiceDocument } from "@/lib/finance-invoice-model";

export function integraReferenceInvoice(): { doc: InvoiceDocument; profileFound: boolean } {
  const profile = findCustomerProfile("INTEGRA LOGISTICS CORPORATION CO., LTD.");
  if (!profile) throw new Error("INTEGRA profile missing");
  const doc = buildInvoiceDocument({
    invoiceNo: "TRN649/2026", invoiceNoKind: "issued", invoiceDate: "2026-11-02", draft: false,
    lines: [
      { kind: "trip", date: "2026-10-27", pickup: "สุวรรณภูมิ", delivery: "WG", vehicle: "64-0359", workOrder: "6372", fuelRate: 43.54, description: "", amountSatang: 380000 },
      { kind: "extra", date: null, pickup: "", delivery: "", vehicle: "", workOrder: "", fuelRate: null, description: "OVERNIGHT CHARGE", amountSatang: 100000 }
    ]
  }, profile);
  return { doc, profileFound: true };
}
