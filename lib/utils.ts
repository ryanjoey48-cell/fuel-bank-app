import type { Language } from "@/lib/translations";

export const formatCurrency = (value: number, language: Language = "en") =>
  new Intl.NumberFormat(language === "th" ? "th-TH" : "en-US", {
    style: "currency",
    currency: "THB"
  }).format(value || 0);

export const formatDate = (value: string, language: Language = "en") =>
  new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(value));

export const formatNumber = (value: number, language: Language = "en", digits = 0) =>
  new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value || 0);

export const today = () => new Date().toISOString().slice(0, 10);
