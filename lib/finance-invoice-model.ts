/**
 * Invoice calculation + document model. One authoritative path: Finance's saved sheet figures (satang integers) →
 * invoice lines → gross → deduction → advance → net. Nothing is re-read from a spreadsheet.
 *
 * Money is integer satang throughout (decimal-safe). The deduction is rounded half-up to the nearest satang.
 */
import { EES_COMPANY } from "@/lib/ees-company";
import { thaiBahtText } from "@/lib/thai-baht-text";
import { type CustomerBillingProfile, type DeductionRule } from "@/lib/finance-customer-profiles";

export type InvoiceLine = {
  kind: "trip" | "extra";
  /** ISO yyyy-mm-dd of the job (trip rows). */
  date: string | null;
  pickup: string;
  delivery: string;
  vehicle: string;
  workOrder: string;
  /** Diesel/fuel rate shown per line (THB per litre) when the saved price came from the rate schedule. */
  fuelRate: number | null;
  /** The work order has no customer charge yet: the amount cell stays blank instead of showing a zero charge. */
  unpriced?: boolean;
  /** Extra rows: printed description, e.g. "OVERNIGHT CHARGE". */
  description: string;
  /** AMOUNT column: transport charge (trip rows) or the special charge (extra rows). */
  amountSatang: number;
  /** Trip rows: customer-billable Parking and Overtime in their own columns (null = blank, not zero). Added to the gross total. */
  parkingSatang?: number | null;
  overtimeSatang?: number | null;
};

export type InvoiceTotals = {
  /** Gross: AMOUNT column + Parking column + OT column. */
  subtotalSatang: number;
  amountColumnSatang: number;
  parkingSatang: number;
  overtimeSatang: number;
  deductionSatang: number;
  deductionBasisPoints: number | null;
  advanceSatang: number;
  netSatang: number;
};

export type InvoiceDocument = {
  invoiceNo: string;
  invoiceNoKind: "simulated_trn" | "draft_reference" | "issued";
  /** ISO yyyy-mm-dd. */
  invoiceDate: string;
  seller: { nameTh: string; nameEn: string; addressTh: string; addressEn: string; taxId: string };
  customer: { nameTh: string; addressTh: string; taxId: string };
  lines: InvoiceLine[];
  totals: InvoiceTotals;
  deductionLabel: string | null;
  amountInWordsTh: string;
  signatureName: string | null;
  profile: { id: string; version: number; reviewStatus: string; template: string };
  /** Draft/test safeguards: printed in the top margin. Never absent for anything not officially issued. */
  draft: boolean;
  warnings: string[];
};

/** Round-half-up basis-point share of an integer, exact in integers. */
export function percentOfSatang(satang: number, basisPoints: number): number {
  return Math.floor((satang * basisPoints + 5000) / 10000);
}

export function computeInvoiceTotals(lines: Pick<InvoiceLine, "amountSatang" | "parkingSatang" | "overtimeSatang">[], deduction: Pick<DeductionRule, "basisPoints"> | null, advanceSatang = 0): InvoiceTotals {
  const amountColumnSatang = lines.reduce((sum, line) => sum + line.amountSatang, 0);
  const parkingSatang = lines.reduce((sum, line) => sum + (line.parkingSatang ?? 0), 0);
  const overtimeSatang = lines.reduce((sum, line) => sum + (line.overtimeSatang ?? 0), 0);
  const subtotalSatang = amountColumnSatang + parkingSatang + overtimeSatang;
  const deductionSatang = deduction ? percentOfSatang(subtotalSatang, deduction.basisPoints) : 0;
  return { subtotalSatang, amountColumnSatang, parkingSatang, overtimeSatang, deductionSatang, deductionBasisPoints: deduction ? deduction.basisPoints : null, advanceSatang, netSatang: subtotalSatang - deductionSatang - advanceSatang };
}

export type InvoiceSource = {
  invoiceNo: string;
  invoiceNoKind: InvoiceDocument["invoiceNoKind"];
  invoiceDate: string;
  lines: InvoiceLine[];
  advanceSatang?: number;
  draft: boolean;
  warnings?: string[];
};

export function buildInvoiceDocument(source: InvoiceSource, profile: CustomerBillingProfile, options: { sellerNameThOverride?: string } = {}): InvoiceDocument {
  const deduction = profile.deduction;
  const totals = computeInvoiceTotals(source.lines, deduction, profile.advancePaymentAllowed ? source.advanceSatang ?? 0 : 0);
  const warnings = [...(source.warnings ?? [])];
  if (profile.reviewStatus !== "approved") warnings.push("Customer billing profile is not approved by the owner yet — billing details and deduction are unconfirmed.");
  if (deduction && deduction.reviewStatus !== "approved") warnings.push("Deduction rule is not approved by the owner yet.");
  if (totals.netSatang < 0) warnings.push("Net payable is negative.");
  return {
    invoiceNo: source.invoiceNo,
    invoiceNoKind: source.invoiceNoKind,
    invoiceDate: source.invoiceDate,
    seller: { nameTh: options.sellerNameThOverride ?? EES_COMPANY.nameTh, nameEn: EES_COMPANY.nameEn, addressTh: EES_COMPANY.addressTh, addressEn: EES_COMPANY.addressEn, taxId: EES_COMPANY.taxId },
    customer: { nameTh: profile.legalNameTh, addressTh: profile.billingAddressTh, taxId: profile.taxId },
    lines: source.lines,
    totals,
    deductionLabel: deduction ? deduction.label : null,
    amountInWordsTh: totals.netSatang >= 0 ? thaiBahtText(totals.netSatang) : "",
    signatureName: profile.signatureName,
    profile: { id: profile.id, version: profile.version, reviewStatus: profile.reviewStatus, template: profile.invoiceTemplate },
    draft: source.draft,
    warnings
  };
}

/** Immutable evidence stored with an issued invoice (no issuing happens locally; this is the shape that must be kept). */
export function invoiceSnapshot(document: InvoiceDocument, profile: CustomerBillingProfile) {
  return JSON.stringify({ document, profile }, null, 0);
}
