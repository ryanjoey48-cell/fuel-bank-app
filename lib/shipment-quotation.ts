export type ShipmentQuotationInput = {
  estimatedDistanceKm: number | null;
  standardKmPerLitre: number | null;
  fuelPricePerLitre: number | null;
  fuelRiskBufferPercent: number | null;
  tollEstimate: number | null;
  otherCosts: number | null;
  driverCost: number | null;
  marginPercent: number | null;
  actualDistanceKm: number | null;
  actualFuelLitres: number | null;
  actualFuelCost: number | null;
  actualTolls: number | null;
};

export type ShipmentQuotationValues = {
  estimatedFuelLitres: number | null;
  baseFuelCost: number | null;
  quotedFuelCost: number | null;
  subtotalCost: number;
  quotedPrice: number;
  finalPrice: number;
  actualTotalCost: number | null;
  varianceAmount: number | null;
  variancePercent: number | null;
};

function finiteOrNull(value: number | null) {
  return value != null && Number.isFinite(value) ? value : null;
}

function safeCost(value: number | null) {
  return finiteOrNull(value) ?? 0;
}

export function calculateShipmentQuotation(
  input: ShipmentQuotationInput
): ShipmentQuotationValues {
  const estimatedDistanceKm = finiteOrNull(input.estimatedDistanceKm);
  const standardKmPerLitre = finiteOrNull(input.standardKmPerLitre);
  const fuelPricePerLitre = finiteOrNull(input.fuelPricePerLitre);
  const fuelRiskBufferPercent = safeCost(input.fuelRiskBufferPercent);
  const tollEstimate = safeCost(input.tollEstimate);
  const otherCosts = safeCost(input.otherCosts);
  const driverCost = safeCost(input.driverCost);
  const marginPercent = safeCost(input.marginPercent);
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

  const subtotalCost = safeCost(quotedFuelCost) + tollEstimate + otherCosts + driverCost;
  const quotedPrice = subtotalCost * (1 + marginPercent / 100);

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
    estimatedFuelLitres,
    baseFuelCost,
    quotedFuelCost,
    subtotalCost,
    quotedPrice,
    finalPrice: quotedPrice,
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
