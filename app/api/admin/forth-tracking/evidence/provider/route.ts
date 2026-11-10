import { NextResponse } from "next/server";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { requireFleetOfficeAccess } from "@/lib/fleet-operations-auth";
import { hasPermission } from "@/lib/authorization";
import { applyJourneyAccess, canViewJourneyDetail } from "@/lib/forth-playback-access";
import { createFleetSourceClient } from "@/lib/fleet-evidence-server";
import { getForthParkingReport, getForthLogReport, getForthTrackingFleetData } from "@/lib/forth-tracking-server";
import { matchForthVehicle } from "@/lib/forth-tracking";
import { isForthHistoryLiveRequestsEnabled } from "@/lib/forth-history-live-gate";
import { beginForthHistoryRateLimit, releaseForthHistoryRateLimit } from "@/lib/forth-history-rate-limit";
import { bangkokDay } from "@/lib/fleet-intelligence";
import { buildProviderDay, publicProviderDay } from "@/lib/fleet-intelligence-day";
import { recalledProviderDayEntry, rememberProviderDay } from "@/lib/fleet-intelligence-session";
import { providerMetricsSnapshot, recordProviderRead, type ProviderReadOutcome } from "@/lib/fleet-provider-metrics";
import { ORIGIN_HEADER, REQUEST_ID_HEADER, UNVERIFIED_ACTOR, actorRef, failureOutcome, inFlightKey, logProviderRequest, parseOrigin, parseRequestId, recentProviderRequests, registerInFlight, summariseByOrigin, waitForInFlight, type RequestOutcome } from "@/lib/fleet-provider-request-log";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const rateKey = "fleet-intelligence-interactive-provider";
export async function POST(request: Request) {
  let acquired = false;
  // V7.8.3: which application action asked for this read (allow-listed header), for operators. No tokens, positions or registrations are logged.
  // Parsed before sign-in so that a request refused early (sign-in, permission, gate, validation) is still logged with its origin: earlier,
  // those were counted by the V6.2 metrics but not by the origin log, which is why the two could disagree.
  let release: (() => void) | null = null; let waited = false;
  // V6.2 bounded, privacy-safe diagnostics: outcome, status, duration and the number of Forth report reads only.
  const started = Date.now(); let forthRequests = 0;
  const requestId = parseRequestId(request.headers.get(REQUEST_ID_HEADER)), origin = parseOrigin(request.headers.get(ORIGIN_HEADER));
  const logged = { actor: UNVERIFIED_ACTOR, vehicleRef: "", day: "", refresh: false, done: false };
  const note = (outcome: RequestOutcome, status: number) => {
    if (logged.done) return; logged.done = true;
    logProviderRequest({ id: requestId, route: "provider_day", actor: logged.actor, origin, vehicleRef: logged.vehicleRef, day: logged.day, refresh: logged.refresh, outcome, status, forthRequests, durationMs: Date.now() - started, waitedForInFlight: waited });
  };
  try {
    const { user, access } = await requireFleetOfficeAccess(request);
    logged.actor = actorRef(user.id);
    const journeyAllowed = canViewJourneyDetail({ access, userId: user.id, checkPermission: hasPermission });
    // New operator-requested local report read. Never unlocks the existing playback gate.
    const localDevelopment = process.env.NODE_ENV === "development" && !process.env.VERCEL;
    if (!localDevelopment && !isForthHistoryLiveRequestsEnabled()) throw new AdminApiError(503, "Provider history approval is required outside local development.");
    const params = new URL(request.url).searchParams;
    const vehicleId = params.get("vehicleId") ?? "", day = params.get("day") ?? "";
    logged.vehicleRef = vehicleId; logged.day = day; logged.refresh = params.get("refresh") === "1";
    try { if (!vehicleId || vehicleId.length > 80 || bangkokDay(day).start > Date.now()) throw new Error(); }
    catch { throw new AdminApiError(400, "Choose one vehicle and a valid Bangkok day."); }
    const client = createFleetSourceClient(request);
    const vehicle = await client.from("vehicles").select("id,vehicle_reg").eq("id", vehicleId).single();
    if (vehicle.error || !vehicle.data?.vehicle_reg) throw new AdminApiError(404, "Vehicle identity is unavailable.");
    // Idempotent reads: inside the cache window the same vehicle/day is served from memory (no Forth request) unless the operator
    // explicitly asks to refresh. A failed refresh below never writes the cache, so earlier evidence is kept until it expires.
    const refresh = logged.refresh;
    // The same user asking again for the same vehicle-day while a read is running waits for it and then uses the cache: never a second Forth call.
    const guardKey = inFlightKey(user.id, vehicleId, day);
    if (!refresh) waited = await waitForInFlight(guardKey);
    const cached = refresh ? null : recalledProviderDayEntry(user.id, vehicleId, vehicle.data.vehicle_reg, day);
    if (cached) { recordProviderRead({ outcome: "cache_hit", status: 200, durationMs: Date.now() - started }); note(waited ? "deduplicated_cache_hit" : "cache_hit", 200); return NextResponse.json({ ...applyJourneyAccess(publicProviderDay(cached.evidence), journeyAllowed), cache: { hit: true, storedAt: cached.storedAt, expiresAt: cached.expiresAt } }, { headers }); }
    const rate = beginForthHistoryRateLimit(rateKey);
    release = registerInFlight(guardKey);
    if (!rate.allowed) { recordProviderRead({ outcome: "rate_limited", status: 429, durationMs: Date.now() - started }); note("rate_limited", 429); return NextResponse.json({ error: "Provider reads are rate limited." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } }); }
    acquired = true;
    const fleet = await getForthTrackingFleetData();
    if (fleet.connectionStatus !== "connected") throw new AdminApiError(503, "Forth fleet identity is unavailable.");
    const matches = fleet.records.filter(record => matchForthVehicle(record, [vehicle.data]).status === "matched");
    const deviceId = matches.length === 1 ? matches[0].gpsDeviceId : null;
    if (!deviceId || fleet.records.filter(r => r.gpsDeviceId === deviceId).length !== 1) throw new AdminApiError(409, "A unique Forth device association is required.");
    const stamp = day.replaceAll("-", "");
    // Two bounded report reads at most. No retries, multi-vehicle downloads or provider commands.
    forthRequests++;
    const parking = await getForthParkingReport({ deviceId, forthDate: stamp, language: "en" });
    if (!parking.ok) throw new AdminApiError(parking.status, "Forth provider distance report is unavailable.");
    if (!Array.isArray(parking.payload) || parking.payload.length > 20000) throw new AdminApiError(502, "Invalid provider distance response.");
    forthRequests++;
    const log = await getForthLogReport({ deviceId, startTime: `${stamp}000000`, endTime: `${stamp}235959` });
    const evidence = buildProviderDay({ vehicleId, registration: vehicle.data.vehicle_reg, deviceId, day, capturedAt: new Date().toISOString(), reportRows: parking.payload,
      logRows: log.ok && Array.isArray(log.payload) && log.payload.length <= 20000 ? log.payload : null });
    rememberProviderDay(user.id, evidence);
    recordProviderRead({ outcome: "provider_read", status: 200, durationMs: Date.now() - started, forthRequests });
    note("provider_read", 200);
    const stored = recalledProviderDayEntry(user.id, vehicleId, vehicle.data.vehicle_reg, day);
    return NextResponse.json({ ...applyJourneyAccess(publicProviderDay(evidence), journeyAllowed), cache: { hit: false, storedAt: stored?.storedAt ?? evidence.capturedAt, expiresAt: stored?.expiresAt ?? null } }, { headers });
  } catch (error) {
    // A browser that cancelled (the Stop button, a changed date) is not a provider or lookup failure.
    const cancelled = request.signal?.aborted === true;
    const failStatus = cancelled ? 499 : error instanceof AdminApiError ? error.status : 502;
    const failOutcome: ProviderReadOutcome = cancelled ? "client_cancelled" : failStatus === 400 ? "invalid_request" : failStatus === 401 || failStatus === 403 ? "unauthorised" : failStatus === 409 ? "device_refused" : forthRequests > 0 ? "provider_error" : "other_error";
    recordProviderRead({ outcome: failOutcome, status: failStatus, durationMs: Date.now() - started, forthRequests });
    note(failureOutcome({ cancelled, forthRequests, status: failStatus }), failStatus);
    console.warn("fleet_provider_read_failed", { code: error instanceof AdminApiError ? error.status : "invalid_source_evidence" });
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Provider evidence could not be verified." }, { status: error instanceof AdminApiError ? error.status : 502, headers });
  } finally { if (acquired) releaseForthHistoryRateLimit(rateKey); release?.(); }
}

/**
 * Diagnostics for authorised operators only (the same server-side decision as historical journey detail). Counts and statuses,
 * never coordinates, device ids, registrations or users. Process memory: nothing is stored.
 */
export async function GET(request: Request) {
  try {
    const { user, access } = await requireFleetOfficeAccess(request);
    if (!canViewJourneyDetail({ access, userId: user.id, checkPermission: hasPermission })) throw new AdminApiError(403, "Provider diagnostics need administrator authorisation.");
    return NextResponse.json({ metrics: providerMetricsSnapshot(), requests: { byOrigin: summariseByOrigin(), recent: recentProviderRequests().slice(-50) } }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AdminApiError ? error.message : "Diagnostics are unavailable." }, { status: error instanceof AdminApiError ? error.status : 503, headers });
  }
}
