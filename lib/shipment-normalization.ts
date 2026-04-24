import type { ShipmentWithDriver } from "@/types/database";

type ShipmentCargoDetails = {
  weight: string;
  pallets: string;
  width: string;
  length: string;
  height: string;
  cargoType: string;
};

type ParsedShipmentNotes = {
  freeTextNotes: string;
  customerName: string;
  jobDescription: string;
  pickupLocation: string;
  dropoffLocation: string;
  additionalDropoffs: string[];
  startRoute: string;
  parkingCost: number | null;
  returnToStart: boolean;
  fuelPricePerLitre: number | null;
  tolls: number | null;
  driverCost: number | null;
  systemRecommendedQuote: number | null;
  finalQuote: number | null;
  requestedStatus: string;
  vehicleType: string;
  durationMinutes: number | null;
  cargo: ShipmentCargoDetails;
};

export type NormalizedShipment = {
  id: string;
  jobReference: string;
  shipmentDate: string;
  customerName: string;
  jobDescription: string;
  startRoute: string;
  pickupLocation: string;
  dropoffLocation: string;
  additionalDropoffs: string[];
  returnToStart: boolean;
  distanceKm: number | null;
  durationMinutes: number | null;
  fuelCost: number | null;
  fuelPricePerLitre: number | null;
  estimatedFuelLitres: number | null;
  tolls: number | null;
  parkingCost: number | null;
  driverCost: number | null;
  operatingCost: number | null;
  systemRecommendedQuote: number | null;
  finalQuote: number | null;
  quotePrice: number | null;
  profit: number | null;
  marginPercent: number | null;
  markupPercent: number | null;
  driverId: string;
  driverName: string;
  vehicleReg: string;
  vehicleType: string;
  status: string;
  notes: string;
  cargo: ShipmentCargoDetails;
  costEstimationStatus: "ready" | "pending";
  costEstimationNote: string;
};

const EMPTY_CARGO: ShipmentCargoDetails = {
  weight: "",
  pallets: "",
  width: "",
  length: "",
  height: "",
  cargoType: ""
};

const KNOWN_NOTE_PREFIXES = [
  "Additional drop-offs:",
  "Cargo details:",
  "Start route:",
  "Parking:",
  "Return to start:",
  "Customer:",
  "Job description:",
  "Pickup:",
  "Main drop-off:",
  "Fuel price per litre:",
  "Tolls:",
  "Driver cost:",
  "System recommended quote:",
  "Final quote:",
  "Requested status:",
  "Vehicle type:",
  "Travel time minutes:",
  "Estimated travel time minutes:"
] as const;

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed != null) return parsed;
  }

  return null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const parsed = asText(value);
    if (parsed) return parsed;
  }

  return "";
}

function parseCargoDetails(value: string): ShipmentCargoDetails {
  if (!value.trim()) return { ...EMPTY_CARGO };

  const cargo = { ...EMPTY_CARGO };
  value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const [rawKey, ...rawValueParts] = item.split(":");
      const key = rawKey.trim().toLowerCase();
      const detailValue = rawValueParts.join(":").trim();

      if (key === "weight kg") cargo.weight = detailValue;
      if (key === "pallets") cargo.pallets = detailValue;
      if (key === "width cm") cargo.width = detailValue;
      if (key === "length cm") cargo.length = detailValue;
      if (key === "height cm") cargo.height = detailValue;
      if (key === "cargo type") cargo.cargoType = detailValue;
    });

  return cargo;
}

export function parseShipmentNotes(notes: string | null | undefined): ParsedShipmentNotes {
  const lines = String(notes ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const values = new Map<string, string>();
  const freeTextLines: string[] = [];

  lines.forEach((line) => {
    const matchedPrefix = KNOWN_NOTE_PREFIXES.find((prefix) => line.startsWith(prefix));
    if (!matchedPrefix) {
      freeTextLines.push(line);
      return;
    }

    values.set(matchedPrefix, line.slice(matchedPrefix.length).trim());
  });

  const additionalDropoffs = (values.get("Additional drop-offs:") ?? "")
    .split("|")
    .map((stop) => stop.trim())
    .filter(Boolean);

  return {
    freeTextNotes: freeTextLines.join("\n"),
    customerName: values.get("Customer:") ?? "",
    jobDescription: values.get("Job description:") ?? "",
    pickupLocation: values.get("Pickup:") ?? "",
    dropoffLocation: values.get("Main drop-off:") ?? "",
    additionalDropoffs,
    startRoute: values.get("Start route:") ?? "",
    parkingCost: asNumber(values.get("Parking:")),
    returnToStart: (values.get("Return to start:") ?? "").toLowerCase() === "yes",
    fuelPricePerLitre: asNumber(values.get("Fuel price per litre:")),
    tolls: asNumber(values.get("Tolls:")),
    driverCost: asNumber(values.get("Driver cost:")),
    systemRecommendedQuote: asNumber(values.get("System recommended quote:")),
    finalQuote: asNumber(values.get("Final quote:")),
    requestedStatus: values.get("Requested status:") ?? "",
    vehicleType: values.get("Vehicle type:") ?? "",
    durationMinutes:
      asNumber(values.get("Travel time minutes:")) ??
      asNumber(values.get("Estimated travel time minutes:")),
    cargo: parseCargoDetails(values.get("Cargo details:") ?? "")
  };
}

export function normalizeShipment(shipment: ShipmentWithDriver): NormalizedShipment {
  const parsedNotes = parseShipmentNotes(shipment.notes);
  const distanceKm = firstNumber(
    shipment.estimated_distance_km,
    shipment.total_operational_distance_km,
    shipment.total_distance_km,
    shipment.quoted_distance_km
  );
  const fuelCost = firstNumber(
    shipment.estimated_fuel_cost,
    shipment.fuel_cost,
    shipment.estimated_fuel_cost_thb
  );
  const fuelPricePerLitre = firstNumber(
    shipment.fuel_price_per_litre,
    shipment.diesel_price,
    parsedNotes.fuelPricePerLitre
  );
  const estimatedFuelLitres =
    firstNumber(shipment.estimated_fuel_litres) ??
    (fuelCost != null && fuelPricePerLitre != null && fuelPricePerLitre > 0
      ? fuelCost / fuelPricePerLitre
      : null);
  const tolls = firstNumber(shipment.toll_estimate, shipment.toll_cost, parsedNotes.tolls);
  const parkingCost = parsedNotes.parkingCost;
  const driverCost = firstNumber(shipment.driver_cost, parsedNotes.driverCost);
  const costParts = [fuelCost, tolls, parkingCost, driverCost].filter(
    (value): value is number => value != null
  );
  const operatingCost =
    firstNumber(shipment.subtotal_cost) ??
    (costParts.length ? costParts.reduce((sum, value) => sum + value, 0) : null);
  const systemRecommendedQuote = firstNumber(
    shipment.quoted_price,
    parsedNotes.systemRecommendedQuote
  );
  const finalQuote = firstNumber(shipment.final_price, parsedNotes.finalQuote);
  const quotePrice = finalQuote ?? systemRecommendedQuote;
  const profit = quotePrice != null && operatingCost != null ? quotePrice - operatingCost : null;
  const marginPercent =
    quotePrice != null && quotePrice > 0 && profit != null ? (profit / quotePrice) * 100 : null;
  const markupPercent =
    firstNumber(shipment.margin_percent) ??
    (systemRecommendedQuote != null && operatingCost != null && operatingCost > 0
      ? ((systemRecommendedQuote - operatingCost) / operatingCost) * 100
      : null);

  return {
    id: shipment.id,
    jobReference: shipment.job_reference,
    shipmentDate: shipment.shipment_date,
    customerName: firstText(shipment.customer_name, parsedNotes.customerName),
    jobDescription: firstText(shipment.goods_description, parsedNotes.jobDescription),
    startRoute: firstText(parsedNotes.startRoute, shipment.start_location),
    pickupLocation: firstText(parsedNotes.pickupLocation, shipment.pickup_location, shipment.start_location),
    dropoffLocation: firstText(parsedNotes.dropoffLocation, shipment.dropoff_location, shipment.end_location),
    additionalDropoffs: parsedNotes.additionalDropoffs,
    returnToStart: parsedNotes.returnToStart,
    distanceKm,
    durationMinutes: parsedNotes.durationMinutes,
    fuelCost,
    fuelPricePerLitre,
    estimatedFuelLitres,
    tolls,
    parkingCost,
    driverCost,
    operatingCost,
    systemRecommendedQuote,
    finalQuote,
    quotePrice,
    profit,
    marginPercent,
    markupPercent,
    driverId: shipment.driver_id ?? "",
    driverName: firstText(shipment.driver),
    vehicleReg: firstText(shipment.vehicle_reg),
    vehicleType: firstText(shipment.vehicle_type, parsedNotes.vehicleType),
    status: firstText(parsedNotes.requestedStatus, shipment.status, "Draft"),
    notes: parsedNotes.freeTextNotes,
    cargo: {
      weight: parsedNotes.cargo.weight,
      pallets: parsedNotes.cargo.pallets,
      width: parsedNotes.cargo.width,
      length: parsedNotes.cargo.length,
      height: parsedNotes.cargo.height,
      cargoType: firstText(parsedNotes.cargo.cargoType, shipment.goods_description)
    },
    costEstimationStatus: shipment.cost_estimation_status ?? "pending",
    costEstimationNote: shipment.cost_estimation_note ?? ""
  };
}

export function buildNormalizedShipmentRouteLabel(shipment: NormalizedShipment) {
  const start = shipment.pickupLocation || shipment.startRoute;
  const lastAdditionalDropoff =
    shipment.additionalDropoffs.length > 0
      ? shipment.additionalDropoffs[shipment.additionalDropoffs.length - 1]
      : "";
  const end = lastAdditionalDropoff || shipment.dropoffLocation || shipment.startRoute;
  return { start, end };
}
