export type ShipmentQuotationInput = {
  estimatedDistanceKm: number | null;
  standardKmPerLitre: number | null;
  fuelPricePerLitre: number | null;
  fuelRiskBufferPercent: number | null;
  tollEstimate: number | null;
  parkingCost?: number | null;
  otherCosts: number | null;
  driverCost: number | null;
  marginPercent: number | null;
  markupPercent?: number | null;
  finalCustomerQuote?: number | null;
  actualDistanceKm: number | null;
  actualFuelLitres: number | null;
  actualFuelCost: number | null;
  actualTolls: number | null;
};

export type ShipmentQuotationValues = {
  distanceKm: number | null;
  fuelEfficiencyKmL: number | null;
  fuelPricePerLitre: number | null;
  estimatedFuelLitres: number | null;
  fuelCost: number | null;
  baseFuelCost: number | null;
  quotedFuelCost: number | null;
  tolls: number;
  parking: number;
  driverCost: number;
  subtotalCost: number;
  operatingCost: number;
  markupPercent: number;
  quotedPrice: number;
  recommendedQuote: number;
  finalCustomerQuote: number;
  finalPrice: number;
  expectedProfit: number | null;
  marginPercent: number | null;
  markupOnCostPercent: number | null;
  isManualQuoteOverride: boolean;
  actualTotalCost: number | null;
  varianceAmount: number | null;
  variancePercent: number | null;
};

function finiteOrNull(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : null;
}

function safeCost(value: number | null) {
  return finiteOrNull(value) ?? 0;
}

export function calculateShipmentQuotation(
  input: ShipmentQuotationInput
): ShipmentQuotationValues {
  return calculateShipmentCosts(input);
}

export function calculateShipmentCosts(
  input: ShipmentQuotationInput
): ShipmentQuotationValues {
  const estimatedDistanceKm = finiteOrNull(input.estimatedDistanceKm);
  const standardKmPerLitre = finiteOrNull(input.standardKmPerLitre);
  const fuelPricePerLitre = finiteOrNull(input.fuelPricePerLitre);
  const fuelRiskBufferPercent = safeCost(input.fuelRiskBufferPercent);
  const tollEstimate = safeCost(input.tollEstimate);
  const parking = safeCost(input.parkingCost ?? input.otherCosts);
  const driverCost = safeCost(input.driverCost);
  const markupPercent = safeCost(input.markupPercent ?? input.marginPercent);
  const manualFinalQuote = finiteOrNull(input.finalCustomerQuote);
  const actualFuelCost = finiteOrNull(input.actualFuelCost);
  const actualTolls = finiteOrNull(input.actualTolls);

  const estimatedFuelLitres =
    estimatedDistanceKm != null &&
    standardKmPerLitre != null &&
    standardKmPerLitre > 0
      ? estimatedDistanceKm / standardKmPerLitre
      : null;

  const baseFuelCost =
    estimatedFuelLitres != null && fuelPricePerLitre != null
      ? estimatedFuelLitres * fuelPricePerLitre
      : null;

  const quotedFuelCost =
    baseFuelCost != null
      ? baseFuelCost * (1 + fuelRiskBufferPercent / 100)
      : null;

  const subtotalCost = safeCost(quotedFuelCost) + tollEstimate + parking + driverCost;
  const quotedPrice = subtotalCost * (1 + markupPercent / 100);
  const finalCustomerQuote = manualFinalQuote ?? quotedPrice;
  const expectedProfit =
    finalCustomerQuote > 0 ? finalCustomerQuote - subtotalCost : null;
  const marginPercent =
    finalCustomerQuote > 0 && expectedProfit != null
      ? (expectedProfit / finalCustomerQuote) * 100
      : null;
  const markupOnCostPercent =
    subtotalCost > 0 && expectedProfit != null
      ? (expectedProfit / subtotalCost) * 100
      : null;
  const isManualQuoteOverride =
    manualFinalQuote != null && Math.abs(manualFinalQuote - quotedPrice) > 0.005;

  const hasActuals =
    finiteOrNull(input.actualDistanceKm) != null ||
    finiteOrNull(input.actualFuelLitres) != null ||
    actualFuelCost != null ||
    actualTolls != null;

  const actualTotalCost = hasActuals ? safeCost(actualFuelCost) + safeCost(actualTolls) : null;
  const varianceAmount =
    actualTotalCost != null ? actualTotalCost - quotedPrice : null;
  const variancePercent =
    varianceAmount != null && quotedPrice > 0
      ? (varianceAmount / quotedPrice) * 100
      : null;

  return {
    distanceKm: estimatedDistanceKm,
    fuelEfficiencyKmL: standardKmPerLitre,
    fuelPricePerLitre,
    estimatedFuelLitres,
    fuelCost: quotedFuelCost,
    baseFuelCost,
    quotedFuelCost,
    tolls: tollEstimate,
    parking,
    driverCost,
    subtotalCost,
    operatingCost: subtotalCost,
    markupPercent,
    quotedPrice,
    recommendedQuote: quotedPrice,
    finalCustomerQuote,
    finalPrice: finalCustomerQuote,
    expectedProfit,
    marginPercent,
    markupOnCostPercent,
    isManualQuoteOverride,
    actualTotalCost,
    varianceAmount,
    variancePercent
  };
}

export function parseOptionalNumber(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatInputNumber(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? String(value) : "";
}
