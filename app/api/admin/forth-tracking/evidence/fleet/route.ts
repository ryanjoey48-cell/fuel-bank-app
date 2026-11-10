import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { createFleetSourceClient } from "@/lib/fleet-evidence-server";
import { recalledProviderDay } from "@/lib/fleet-intelligence-session";
import { hasPermission } from "@/lib/authorization";
import { applyJourneyAccess, canViewJourneyDetail } from "@/lib/forth-playback-access";
import { buildDayInsights } from "@/lib/fleet-day-insights";
import type { JourneyLedger } from "@/lib/fleet-journey-ledger";
import type { VehicleDayReview } from "@/lib/fleet-day-review";
import { summarizeProviderFleet } from "@/lib/fleet-intelligence-day";
import { bangkokDay } from "@/lib/fleet-intelligence";
import { purchaseTotal, purchasesByFuelType, singleFuelTypeLitres } from "@/lib/fleet-evidence-view";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const { user, access } = await requireFleetOfficeAccess(request);
    // Journey-level insight is derived from Forth history, so it is released only to callers allowed to see historical journeys (decided here, on the server).
    const journeyAllowed = canViewJourneyDetail({ access, userId: user.id, checkPermission: hasPermission });
    const day = new URL(request.url).searchParams.get("day") ?? "";
    try { if (bangkokDay(day).start > Date.now()) throw new Error(); } catch { throw new AdminApiError(400, "Choose a valid Bangkok date."); }
    const client = createFleetSourceClient(request);
    const [vehicles, fuel] = await Promise.all([
      client.from("vehicles").select("id,vehicle_reg,active").order("vehicle_reg").limit(101),
      client.from("fuel_logs").select("id,vehicle_reg,litres,total_cost,fuel_type,date").eq("date",day).order("id").limit(501)
    ]);
    if (vehicles.error || !vehicles.data || vehicles.data.length > 100) throw new AdminApiError(503,"Vehicle registry is unavailable or exceeds the bounded report scope.");
    const fuelAvailable = !fuel.error && (fuel.data?.length ?? 0) <= 500;
    const normalize = (s: string) => s.normalize("NFKC").replace(/[\s\-‐‑‒–—]/g, "").toUpperCase();
    const num = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(?:\.\d+)?$/.test(v.trim()) ? Number(v) : NaN; return Number.isFinite(n) && n >= 0 ? n : null; };
    const toPurchase = (f: { litres: unknown; total_cost: unknown; fuel_type: unknown }) => ({ purchasedLitres: num(f.litres), costThb: num(f.total_cost), fuelType: typeof f.fuel_type === "string" ? f.fuel_type : null });
    const matchedFuelIds = new Set<unknown>();
    const rows = vehicles.data.map(vehicle => {
      const evidence = recalledProviderDay(user.id, vehicle.id, vehicle.vehicle_reg, day);
      const uniqueRegistration = vehicles.data.filter(v => normalize(v.vehicle_reg) === normalize(vehicle.vehicle_reg)).length === 1;
      const vehicleFuel = fuelAvailable && uniqueRegistration ? (fuel.data ?? []).filter(f => typeof f.vehicle_reg === "string" && normalize(f.vehicle_reg) === normalize(vehicle.vehicle_reg)) : null;
      vehicleFuel?.forEach(f => matchedFuelIds.add(f.id));
      const purchases = vehicleFuel?.map(toPurchase) ?? null;
      const fuelByType = purchasesByFuelType(purchases);
      const arithmeticPassed = evidence?.provider.arithmetic.status === "pass";
      // V6.1: the same V6 insight definitions as the vehicle drawer, computed from this user's own cached read only. No Forth request here.
      let review: VehicleDayReview | null = null;
      if (evidence) {
        const gated = applyJourneyAccess({ journeyLedger: (evidence as { journeyLedger?: unknown }).journeyLedger ?? null }, journeyAllowed);
        const model = buildDayInsights({ day, providerRead: true, providerKm: evidence.sources.providerReported.value, providerReconciled: arithmeticPassed, ledger: gated.journeyLedger as JourneyLedger | null, journeysRestricted: gated.journeyAccess === "requires_authorisation",
          observations: evidence.logAvailable ? evidence.gps.observations : null, verifiedObservations: evidence.logAvailable ? evidence.gps.verifiedObservations : null, receivedObservations: evidence.logAvailable ? evidence.gps.observations : null });
        review = { coverage: model.coverage, coverageReasons: model.coverageReasons, activity: model.activity, insights: model.insights.map(i => ({ id: i.id, reliability: i.reliability, evidence: i.evidence })), positionCount: model.positionCount, journeyAccess: gated.journeyAccess };
      }
      return { vehicleId: vehicle.id, registration: vehicle.vehicle_reg, metric: evidence?.sources.providerReported ?? null, arithmeticPassed,
        gpsKm: evidence?.sources.gpsDerived.value ?? null, gpsComplete: evidence?.gps.complete ?? false, capturedAt: evidence?.capturedAt ?? null,
        segments: evidence ? evidence.provider.segments.length : null, review,
        registry: !uniqueRegistration ? "duplicate_registration" as const : (vehicle as { active?: boolean | null }).active === false ? "inactive" as const : "active" as const,
        purchaseRecords: purchases?.length ?? null,
        // Litres are only combined for one recorded fuel type; mixed types are listed separately.
        purchasedLitres: singleFuelTypeLitres(fuelByType), purchaseCostThb: purchaseTotal(purchases,"costThb"), fuelByType,
        fuelExplanation: !fuelAvailable ? "fuel_source_unavailable" : !uniqueRegistration ? "registration_not_unique" : purchases!.length === 0 ? "no_purchases_recorded" : fuelByType!.length > 1 ? "mixed_fuel_types" : "recorded",
        explanation: !evidence ? "not_read_in_this_session" : !arithmeticPassed ? "provider_totals_not_reconciled" : evidence.sources.providerReported.completeness !== "complete" ? "provider_coverage_unverified" : "complete" };
    });
    const matchedFuel = fuelAvailable ? (fuel.data ?? []).filter(f => matchedFuelIds.has(f.id)) : null;
    const fleetFuel = fuelAvailable ? { byType: purchasesByFuelType(matchedFuel!.map(toPurchase)), matchedRecords: matchedFuel!.length, unmatchedRecords: (fuel.data ?? []).length - matchedFuel!.length, vehiclesWithPurchases: rows.filter(r => (r.purchaseRecords ?? 0) > 0).length } : null;
    const summary = summarizeProviderFleet(day,rows);
    const usableRecords = rows.filter(r => (r.metric?.value != null && r.arithmeticPassed) || (r.purchaseRecords ?? 0) > 0).length;
    return NextResponse.json({ day, capturedAt: new Date().toISOString(), scope: "visible_ees_vehicle_registry", rows, summary: { ...summary, vehiclesWithUsableRecords: usableRecords, vehiclesWithoutRecords: rows.length - usableRecords }, fuel: fleetFuel, fuelAvailable }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Fleet report is unavailable." }, { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
