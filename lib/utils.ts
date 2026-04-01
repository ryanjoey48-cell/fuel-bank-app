import type { Language } from "@/lib/translations";

export const formatCurrency = (value: number, language: Language = "en") =>
  new Intl.NumberFormat(language === "th" ? "th-TH" : "en-US", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0);

export const formatDate = (value: string, language: Language = "en") => {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(parsed);
};

export const formatNumber = (value: number, language: Language = "en", digits = 0) =>
  new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value || 0);

export const today = () => new Date().toISOString().slice(0, 10);

export function normalizeComparableText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeLocationKey(value: string | null | undefined) {
  return normalizeComparableText(value).replace(/\s*,\s*/g, ", ");
}
