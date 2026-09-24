export type InsuranceRenewalQuoteDraft = {
  currentPremium: number | null;
  renewalQuote: number | null;
  renewalInsurer: string | null;
  renewalDate: string | null;
};

export type InsuranceRenewalQuoteComparison = InsuranceRenewalQuoteDraft & {
  differenceThb: number | null;
  differencePercent: number | null;
};

/**
 * Presentation-layer comparison for a future, separately persisted renewal quote.
 * It never substitutes zero for a missing current premium or quote.
 */
export function compareInsuranceRenewalQuote(
  draft: InsuranceRenewalQuoteDraft
): InsuranceRenewalQuoteComparison {
  const { currentPremium, renewalQuote } = draft;
  const canCompare = currentPremium != null && renewalQuote != null;
  const differenceThb = canCompare ? renewalQuote - currentPremium : null;
  const differencePercent = differenceThb != null && currentPremium != null && currentPremium !== 0
    ? (differenceThb / currentPremium) * 100
    : null;
  return { ...draft, differenceThb, differencePercent };
}
