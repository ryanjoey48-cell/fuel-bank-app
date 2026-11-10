import { NextResponse } from "next/server";
import {
  FleetMonitorDatabaseIsolationError,
  assertFleetMonitorAllowedLocationIdsFromEnv,
  assertFleetMonitorSupabaseTargetFromEnv
} from "@/lib/ees-database-environment";
import { runFleetOperationsMonitor } from "@/lib/fleet-operations-monitor-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Intentionally unscheduled. Deployment requires owner approval and a secret. */
export async function GET(request: Request) {
  if (process.env.EES_FLEET_MONITOR_ENABLED !== "true") {
    return NextResponse.json({ error: "Fleet monitor is disabled." }, { status: 503 });
  }
  const secret = process.env.EES_FLEET_MONITOR_SECRET;
  if (!secret || secret.length < 32 || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    // Isolation checks before monitor work (also re-checked inside runFleetOperationsMonitor).
    assertFleetMonitorSupabaseTargetFromEnv(process.env);
    assertFleetMonitorAllowedLocationIdsFromEnv(process.env);
    return NextResponse.json(await runFleetOperationsMonitor(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof FleetMonitorDatabaseIsolationError) {
      return NextResponse.json(
        { error: "Fleet monitor database target is not an approved staging project." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json({ error: "Fleet monitor unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
