import "server-only";
import { randomUUID } from "node:crypto";
import { createServerSupabaseAdmin } from "@/lib/admin-user-management-server";
import {
  assertFleetMonitorAllowedLocationIdsFromEnv,
  assertFleetMonitorSupabaseTargetFromEnv,
  filterGeofencesToLocationAllowlist
} from "@/lib/ees-database-environment";
import { getForthTrackingFleetData } from "@/lib/forth-tracking-server";
import { prepareForthGeofenceObservations } from "@/lib/fleet-geofence-source";
import {
  evaluateVehicleGeofences, initialVehicleGeofenceState, validGeofenceCoordinates,
  type ApprovedGeofence, type GeofenceObservation, type GeofenceVisitEvent, type VehicleGeofenceState
} from "@/lib/fleet-geofence-engine";
import { enqueueVisitNotificationIntents } from "@/lib/fleet-notification-outbox-server";

function restoredState(vehicleKey: string, row: Record<string, unknown> | null): VehicleGeofenceState {
  if (!row) return initialVehicleGeofenceState(vehicleKey);
  return {
    vehicleKey,
    phase: row.phase as VehicleGeofenceState["phase"],
    stable: row.stable as VehicleGeofenceState["stable"],
    locationId: row.location_id as string | null,
    candidateSince: row.candidate_since as string | null,
    arrivalAt: row.arrival_at as string | null,
    visitKey: row.visit_key as string | null,
    lastSourceAt: row.last_source_at as string | null,
    lastDetectedAt: row.last_detected_at as string | null,
    uncertainReason: row.uncertain_reason as string | null
  };
}

export async function runFleetOperationsMonitor() {
  // Fail closed before Forth fetch, lease acquisition, or any database writes.
  assertFleetMonitorSupabaseTargetFromEnv(process.env);
  assertFleetMonitorAllowedLocationIdsFromEnv(process.env);
  const admin = createServerSupabaseAdmin();
  const leaseToken = randomUUID();
  const { data: acquired, error } = await admin.rpc("acquire_ees_fleet_monitor_lease", {
    p_token: leaseToken, p_seconds: 180
  });
  if (error) throw new Error("Fleet monitor lease storage is unavailable.");
  if (!acquired) return { status: "skipped", returnedCount: 0, processedCount: 0, skippedCount: 0 };
  try {
    return await executeFleetOperationsMonitor(admin);
  } finally {
    await admin.rpc("release_ees_fleet_monitor_lease", { p_token: leaseToken });
  }
}

async function executeFleetOperationsMonitor(admin: ReturnType<typeof createServerSupabaseAdmin>) {
  const startedAt = new Date().toISOString();
  const allowedLocationIds = assertFleetMonitorAllowedLocationIdsFromEnv(process.env);
  const { data: run, error: runError } = await admin.from("ees_fleet_monitor_runs")
    .insert({ started_at: startedAt, status: "running" }).select("id").single();
  if (runError || !run) throw new Error("Fleet monitor storage is unavailable.");
  let returnedCount = 0;
  let processedCount = 0;
  let skippedCount = 0;
  try {
    const [zonesResult, locationsResult, pinsResult] = await Promise.all([
      admin.from("ees_fleet_geofence_zones").select("location_id,radius_meters,entry_dwell_seconds,exit_dwell_seconds,hysteresis_meters,active", { count: "exact" }).eq("active", true).limit(1000),
      admin.from("ees_locations").select("id,verification_status,is_active", { count: "exact" }).eq("verification_status", "verified").eq("is_active", true).limit(1000),
      admin.from("ees_location_map_pins").select("location_id,latitude,longitude,pin_status,pin_type", { count: "exact" }).eq("pin_status", "manual_confirmed").eq("pin_type", "destination").limit(1000)
    ]);
    if (zonesResult.error || locationsResult.error || pinsResult.error) throw new Error("Approved location evidence is unavailable.");
    if ([zonesResult, locationsResult, pinsResult].some((result) => result.count === null || result.count > (result.data?.length ?? 0))) {
      throw new Error("Approved location set exceeds the safe single-run bound.");
    }
    const verified = new Set((locationsResult.data ?? []).map((row) => row.id));
    const pins = new Map((pinsResult.data ?? []).map((row) => [row.location_id, row]));
    const loadedZones: ApprovedGeofence[] = (zonesResult.data ?? []).flatMap((row) => {
      const pin = pins.get(row.location_id);
      if (!verified.has(row.location_id) || !pin || !validGeofenceCoordinates(pin.latitude, pin.longitude)) return [];
      return [{ locationId: row.location_id, latitude: pin.latitude, longitude: pin.longitude,
        radiusMeters: row.radius_meters, entryDwellMs: row.entry_dwell_seconds * 1000,
        exitDwellMs: row.exit_dwell_seconds * 1000, hysteresisMeters: row.hysteresis_meters, active: row.active }];
    });
    // Fail-closed: only explicitly allowlisted locations (Pilot 002 depot for supervised pulse).
    const zones = filterGeofencesToLocationAllowlist(loadedZones, allowedLocationIds);
    if (!zones.length) {
      await admin.from("ees_fleet_monitor_runs").update({ status: "skipped", finished_at: new Date().toISOString(),
        returned_count: 0, processed_count: 0, skipped_count: 0, error_code: "no_allowlisted_zones" }).eq("id", run.id);
      return { status: "skipped", returnedCount, processedCount, skippedCount };
    }
    const feed = await getForthTrackingFleetData();
    if (feed.connectionStatus !== "connected" || !feed.fetchedAt) throw new Error("Forth snapshot unavailable.");
    returnedCount = feed.records.length;
    const prepared = prepareForthGeofenceObservations(feed.records, feed.fetchedAt);
    skippedCount = prepared.skipped.length;
    const committedEvents: GeofenceVisitEvent[] = [];
    for (const observation of prepared.observations) {
      const committed = await commitObservation(admin, observation, zones);
      if (committed?.processed) {
        processedCount += 1;
        if (committed.event) committedEvents.push(committed.event);
      } else skippedCount += 1;
    }
    if (committedEvents.length) {
      const locationIds = [...new Set(committedEvents.map((event) => event.locationId))];
      const { data: named } = await admin.from("ees_locations")
        .select("id,company_name,thai_name").in("id", locationIds);
      const names = new Map((named ?? []).map((row) => [row.id, {
        en: row.company_name,
        th: row.thai_name || row.company_name
      }]));
      // Durable outbox only. deliveryEnabled stays false until V20.3 owner approval.
      await enqueueVisitNotificationIntents(admin, committedEvents, names);
    }
    await admin.from("ees_fleet_monitor_runs").update({ status: "succeeded", finished_at: new Date().toISOString(),
      returned_count: returnedCount, processed_count: processedCount, skipped_count: skippedCount }).eq("id", run.id);
    return { status: "succeeded", returnedCount, processedCount, skippedCount };
  } catch {
    await admin.from("ees_fleet_monitor_runs").update({ status: "failed", finished_at: new Date().toISOString(),
      returned_count: returnedCount, processed_count: processedCount, skipped_count: skippedCount,
      error_code: "monitor_failed" }).eq("id", run.id);
    throw new Error("Fleet monitor failed. See server diagnostics.");
  }
}

type AdminClient = ReturnType<typeof createServerSupabaseAdmin>;

async function commitObservation(
  admin: AdminClient,
  observation: GeofenceObservation,
  zones: ApprovedGeofence[]
): Promise<{ processed: boolean; event: GeofenceVisitEvent | null } | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: row, error } = await admin.from("ees_fleet_vehicle_geofence_state")
      .select("vehicle_key,version,phase,stable,location_id,candidate_since,arrival_at,visit_key,last_source_at,last_detected_at,uncertain_reason")
      .eq("vehicle_key", observation.vehicleKey).maybeSingle();
    if (error) throw new Error("Fleet vehicle state cannot be read.");
    const transition = evaluateVehicleGeofences(restoredState(observation.vehicleKey, row), observation, zones);
    if (transition.ignored) return { processed: false, event: null };
    const { data: accepted, error: commitError } = await admin.rpc("commit_ees_fleet_geofence_transition", {
      p_vehicle_key: observation.vehicleKey, p_expected_version: row?.version ?? 0,
      p_state: transition.state, p_event: transition.events[0] ?? null
    });
    if (commitError) throw new Error("Fleet transition could not be committed.");
    if (accepted === true) return { processed: true, event: transition.events[0] ?? null };
  }
  throw new Error("Fleet transition had repeated concurrent version conflicts.");
}
