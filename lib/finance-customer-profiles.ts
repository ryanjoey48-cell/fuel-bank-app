/**
 * Versioned customer billing profiles for Finance documents.
 *
 * A profile holds REGISTERED billing details and per-customer document rules. Nothing here is invented: the INTEGRA
 * entry was copied from the owner's example invoice "TRN invoice test.pdf" (2026-TRN649-INTEGRA.xls) and is therefore
 * `pending_owner_approval` until the owner confirms it. Only an `approved` profile selects its custom template for real
 * Finance drafts; everything else falls back to the generic draft documents.
 *
 * Issued documents must keep the profile version they were built from (see `profileSnapshot` in finance-invoice-model).
 */
export type ProfileReviewStatus = "draft" | "pending_owner_approval" | "approved" | "retired";
export type InvoiceTemplateId = "ees-xls-invoice-v1";
export type TrnStatementTemplateId = "ees-trn-statement-v1";

export type DeductionRule = {
  /** What the percentage is applied to. Only the invoice subtotal is modelled; anything else needs owner sign-off. */
  base: "invoice_subtotal";
  /** Basis points (100 = 1%). */
  basisPoints: number;
  /** Printed wording after "หัก". */
  label: string;
  reviewStatus: ProfileReviewStatus;
};

export type CustomerBillingProfile = {
  id: string;
  version: number;
  /** ISO date the version takes effect. */
  effectiveFrom: string;
  reviewStatus: ProfileReviewStatus;
  /** Where the details came from — shown to reviewers, never silently trusted. */
  source: string;
  /** Normalised substrings of the Finance customer name that select this profile. */
  match: string[];
  legalNameTh: string;
  legalNameEn: string | null;
  billingAddressTh: string;
  billingAddressEn: string | null;
  taxId: string;
  contact: string | null;
  invoiceTemplate: InvoiceTemplateId;
  trnStatementTemplate: TrnStatementTemplateId;
  /** Printed beside the signature line; customer/template specific and unverified. */
  signatureName: string | null;
  deduction: DeductionRule | null;
  advancePaymentAllowed: boolean;
  /** Parking / overtime: how they print. The source invoice does not show an example, so rows are the safe default. */
  /** Parking and Overtime print in their own columns (owner-confirmed). */
  parkingOvertime: "own_columns";
  fuelRateDisplay: "per_line" | "hidden";
  paymentTerms: string | null;
  supportingDocuments: string[];
  /** Observed in the source that the owner should look at (never silently corrected). */
  notes: string[];
  /** Local admin editor audit — optional on seed catalogue rows. */
  updatedBy?: string | null;
  updatedAt?: string | null;
  /** Withholding tax configuration summary for admin review (never auto-applied without owner approval). */
  withholdingNote?: string | null;
};

export type CustomerProfileEvent = {
  id: string;
  profileId: string;
  at: string;
  by: string;
  action: "upsert_draft" | "submit" | "approve" | "retire" | "reject";
  fromStatus: ProfileReviewStatus | null;
  toStatus: ProfileReviewStatus;
  note: string;
};

/** Fields that must be real (not placeholder) before an authorized actor may approve a profile. */
export function profileRequiredGaps(profile: CustomerBillingProfile): string[] {
  const gaps: string[] = [];
  const pendingish = (value: string | null | undefined) => !value || /pending|รอยืนยัน/i.test(value);
  if (!profile.legalNameTh.trim() || pendingish(profile.legalNameTh)) gaps.push("legalNameTh");
  if (!profile.billingAddressTh.trim() || pendingish(profile.billingAddressTh)) gaps.push("billingAddressTh");
  if (!profile.taxId.trim() || pendingish(profile.taxId) || profile.taxId.replace(/\D/g, "").length < 10) gaps.push("taxId");
  if (!profile.match.length) gaps.push("match");
  if (!profile.source.trim() || profile.source.length < 10) gaps.push("source");
  return gaps;
}

/** Seed catalogue plus local workspace overrides (local wins by id). Never invents customer details. */
export function profilesForLookup(localProfiles: CustomerBillingProfile[] | undefined | null = null): CustomerBillingProfile[] {
  const byId = new Map(CUSTOMER_BILLING_PROFILES.map((p) => [p.id, p]));
  for (const profile of localProfiles || []) byId.set(profile.id, profile);
  return [...byId.values()];
}

export const CUSTOMER_BILLING_PROFILES: CustomerBillingProfile[] = [
  {
    id: "integra-logistics",
    version: 1,
    effectiveFrom: "2026-11-02",
    reviewStatus: "pending_owner_approval",
    source: "Copied from owner example invoice TRN649/2026 (TRN invoice test.pdf, 2026-TRN649-INTEGRA.xls). Not yet confirmed against the customer master.",
    match: ["INTEGRA", "อินทีกรา"],
    legalNameTh: "บริษัท อินทีกรา โลจิสติกส์ คอร์ปอเรชั่น จำกัด",
    legalNameEn: "INTEGRA LOGISTICS CORPORATION CO., LTD.",
    billingAddressTh: "819/16 ซอยปรีชา 1 ถนนสาธุประดิษฐ์ แขวงบางโพงพาง เขตยานนาวา กรุงเทพฯ 10120",
    billingAddressEn: null,
    taxId: "0105551036315",
    contact: null,
    invoiceTemplate: "ees-xls-invoice-v1",
    trnStatementTemplate: "ees-trn-statement-v1",
    signatureName: "NATVARAT",
    deduction: { base: "invoice_subtotal", basisPoints: 100, label: "1%", reviewStatus: "pending_owner_approval" },
    advancePaymentAllowed: true,
    parkingOvertime: "own_columns",
    fuelRateDisplay: "per_line",
    paymentTerms: null,
    supportingDocuments: [],
    notes: [
      "Example shows a 1% deduction on the subtotal; the calculation base and whether it applies to every INTEGRA invoice need owner confirmation.",
      "Printed form wording kept as in the source: \"RECEIVEC\" and \"SINGNATURE\"."
    ]
  }
];

const normalise = (value: string) => value.normalize("NFC").toUpperCase().replace(/\s+/g, " ").trim();

/** Latest profile whose `match` text appears in the customer name, regardless of review status. */
export function findCustomerProfile(customerName: string, profiles: CustomerBillingProfile[] = CUSTOMER_BILLING_PROFILES, onOrAfter?: string): CustomerBillingProfile | null {
  const name = normalise(customerName);
  const hits = profiles.filter((profile) => profile.reviewStatus !== "retired" && profile.match.some((needle) => name.includes(normalise(needle))) && (!onOrAfter || profile.effectiveFrom <= onOrAfter));
  return hits.sort((a, b) => b.version - a.version)[0] ?? null;
}

/** Placeholder for a customer with no verified profile: only the Finance customer name; every registered detail shows as pending. No deduction. */
export function pendingCustomerProfile(customerName: string): CustomerBillingProfile {
  return {
    id: "pending-" + normalise(customerName).toLowerCase().replace(/[^a-z0-9ก-๙]+/g, "-"), version: 0, effectiveFrom: "1970-01-01", reviewStatus: "draft",
    source: "No verified customer billing profile — placeholder built from the Finance customer name only.",
    match: [], legalNameTh: customerName, legalNameEn: null,
    billingAddressTh: "ที่อยู่ลูกค้า — รอยืนยัน / CUSTOMER ADDRESS — PENDING", billingAddressEn: null, taxId: "รอยืนยัน / PENDING", contact: null,
    invoiceTemplate: "ees-xls-invoice-v1", trnStatementTemplate: "ees-trn-statement-v1", signatureName: null,
    deduction: null, advancePaymentAllowed: false, parkingOvertime: "own_columns", fuelRateDisplay: "per_line", paymentTerms: null, supportingDocuments: [],
    notes: ["Customer legal name, address, tax ID, withholding and payment terms are not verified."]
  };
}

/** The profile a real draft may use: only an approved one. */
export function approvedProfileFor(customerName: string, date?: string, profiles: CustomerBillingProfile[] = CUSTOMER_BILLING_PROFILES) {
  const profile = findCustomerProfile(customerName, profiles, date);
  return profile && profile.reviewStatus === "approved" ? profile : null;
}
