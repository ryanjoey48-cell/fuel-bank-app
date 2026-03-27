import type { Translation } from "@/lib/translations";

export const TRANSFER_TYPE_KEYS = [
  "driver_advance",
  "fuel_reimbursement",
  "maintenance",
  "other"
] as const;

export const FUEL_TYPE_KEYS = [
  "diesel",
  "benzene",
  "gasohol_91",
  "gasohol_95",
  "premium_diesel",
  "other"
] as const;

export const PAYMENT_METHOD_KEYS = [
  "cash",
  "personal_card",
  "company_card",
  "bank_transfer",
  "other"
] as const;

export type TransferTypeKey = (typeof TRANSFER_TYPE_KEYS)[number];
export type FuelTypeKey = (typeof FUEL_TYPE_KEYS)[number];
export type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];

const TRANSFER_TYPE_ALIASES: Record<string, TransferTypeKey> = {
  driveradvance: "driver_advance",
  driver_advance: "driver_advance",
  "driver advance": "driver_advance",
  fuelreimbursement: "fuel_reimbursement",
  fuel_reimbursement: "fuel_reimbursement",
  "fuel reimbursement": "fuel_reimbursement",
  maintenance: "maintenance",
  other: "other",
  "อื่น ๆ": "other",
  "อื่นๆ": "other"
};

const FUEL_TYPE_ALIASES: Record<string, FuelTypeKey> = {
  diesel: "diesel",
  "ดีเซล": "diesel",
  benzene: "benzene",
  "เบนซิน": "benzene",
  gasohol91: "gasohol_91",
  gasohol_91: "gasohol_91",
  "gasohol 91": "gasohol_91",
  "แก๊สโซฮอล์ 91": "gasohol_91",
  gasohol95: "gasohol_95",
  gasohol_95: "gasohol_95",
  "gasohol 95": "gasohol_95",
  "แก๊สโซฮอล์ 95": "gasohol_95",
  premiumdiesel: "premium_diesel",
  premium_diesel: "premium_diesel",
  "premium diesel": "premium_diesel",
  "ดีเซลพรีเมียม": "premium_diesel",
  other: "other",
  "อื่น ๆ": "other",
  "อื่นๆ": "other"
};

const PAYMENT_METHOD_ALIASES: Record<string, PaymentMethodKey> = {
  cash: "cash",
  "เงินสด": "cash",
  personalcard: "personal_card",
  personal_card: "personal_card",
  "personal card": "personal_card",
  "บัตรส่วนตัว": "personal_card",
  companycard: "company_card",
  company_card: "company_card",
  "company card": "company_card",
  "บัตรบริษัท": "company_card",
  banktransfer: "bank_transfer",
  bank_transfer: "bank_transfer",
  "bank transfer": "bank_transfer",
  transfer: "bank_transfer",
  "โอนเงิน": "bank_transfer",
  card: "company_card",
  other: "other",
  "อื่น ๆ": "other",
  "อื่นๆ": "other"
};

function canonicalize(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function collapse(value: string | null | undefined) {
  return canonicalize(value).replace(/\s+/g, "");
}

function resolveAlias<T extends string>(
  value: string | null | undefined,
  aliases: Record<string, T>
) {
  const canonical = canonicalize(value);
  if (canonical && canonical in aliases) {
    return aliases[canonical];
  }

  const compact = collapse(value);
  if (compact && compact in aliases) {
    return aliases[compact];
  }

  return null;
}

export function normalizeTransferTypeKey(value: string | null | undefined) {
  return resolveAlias(value, TRANSFER_TYPE_ALIASES);
}

export function normalizeFuelTypeKey(value: string | null | undefined) {
  return resolveAlias(value, FUEL_TYPE_ALIASES);
}

export function normalizePaymentMethodKey(value: string | null | undefined) {
  return resolveAlias(value, PAYMENT_METHOD_ALIASES);
}

export function getTransferTypeLabel(t: Translation, value: string | null | undefined) {
  const key = normalizeTransferTypeKey(value);
  return key ? t.transfer.type[key] : value || "-";
}

export function getFuelTypeLabel(t: Translation, value: string | null | undefined) {
  const key = normalizeFuelTypeKey(value);
  return key ? t.fuel.type[key] : value || "-";
}

export function getPaymentMethodLabel(t: Translation, value: string | null | undefined) {
  const key = normalizePaymentMethodKey(value);
  return key ? t.payment.method[key] : value || "-";
}
