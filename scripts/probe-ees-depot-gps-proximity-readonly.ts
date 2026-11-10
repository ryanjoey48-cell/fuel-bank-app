/**
 * READ ONLY. GPS-verified Forth vehicles near EES OFFICE vs LORRY DEPOT.
 * Does not write DB / does not enable monitor.
 *
 * Location A OFFICE: Forth 1708908 @ 13.763182,100.753118
 * Location B LORRY DEPOT (owner Google Maps): 13.7688008,100.7657385
 * Forth parking candidate 1977073 @ 13.768732,100.766033 (~33 m from Maps depot)
 */
import fs from "node:fs";
import path from "node:path";
import { createForthTrackingService } from "../lib/forth-tracking-server";
import { isForthGpsPositionVerified } from "../lib/forth-tracking-view";
import { geofenceDistanceMeters } from "../lib/fleet-geofence-engine";

const root = path.resolve(__dirname, "..");

function loadEnv(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

async function main() {
  const local = loadEnv(path.join(root, ".env.local"));
  const env: Record<string, string | undefined> = { ...process.env, ...local };
  const forth = createForthTrackingService({ environment: env });
  const feed = await forth.getFleetData();
  const verified = feed.records.filter(isForthGpsPositionVerified);

  const targets = {
    ownerLorryDepot_maps: { latitude: 13.7688008, longitude: 100.7657385 },
    forth1977073_parkingYard: { latitude: 13.768732, longitude: 100.766033 },
    forth1708908_office: { latitude: 13.763182, longitude: 100.753118 }
  } as const;

  function nearest(target: { latitude: number; longitude: number }, limit = 5) {
    return verified
      .map((r) => ({
        registration: r.vehicleRegistration,
        vehicleKey: r.gpsDeviceId ? `forth:${r.gpsDeviceId}` : null,
        sourceAt: r.lastGpsTimestamp,
        meters: Math.round(
          geofenceDistanceMeters(
            { latitude: r.latitude as number, longitude: r.longitude as number },
            target
          )
        )
      }))
      .sort((a, b) => a.meters - b.meters)
      .slice(0, limit);
  }

  function bands(target: { latitude: number; longitude: number }) {
    const distances = verified.map((r) =>
      geofenceDistanceMeters(
        { latitude: r.latitude as number, longitude: r.longitude as number },
        target
      )
    );
    return {
      within100m: distances.filter((d) => d <= 100).length,
      within150m: distances.filter((d) => d <= 150).length,
      within250m: distances.filter((d) => d <= 250).length,
      within500m: distances.filter((d) => d <= 500).length,
      within2km: distances.filter((d) => d <= 2_000).length,
      within5km: distances.filter((d) => d <= 5_000).length
    };
  }

  const parkingToMapsMeters = Math.round(
    geofenceDistanceMeters(targets.forth1977073_parkingYard, targets.ownerLorryDepot_maps)
  );
  const officeToMapsMeters = Math.round(
    geofenceDistanceMeters(targets.forth1708908_office, targets.ownerLorryDepot_maps)
  );

  const report = {
    recordType: "EES_V20_3_OFFICE_VS_LORRY_DEPOT_GPS_READONLY",
    generatedAt: new Date().toISOString(),
    note: "Single snapshot — not visit frequency. OFFICE and LORRY DEPOT are separate.",
    forthConnected: feed.connectionStatus,
    fetchedAt: feed.fetchedAt,
    gpsVerified: verified.length,
    geometry: {
      parkingForth1977073_to_ownerMapsDepot_m: parkingToMapsMeters,
      officeForth1708908_to_ownerMapsDepot_m: officeToMapsMeters
    },
    targets: {
      ownerLorryDepot_maps: {
        role: "LORRY_DEPOT",
        ...targets.ownerLorryDepot_maps,
        source: "Owner-confirmed Google Maps Expert Express Sender co., ltd.",
        bands: bands(targets.ownerLorryDepot_maps),
        nearest: nearest(targets.ownerLorryDepot_maps)
      },
      forth1977073_parkingYard: {
        role: "FORTH_PARKING_YARD_CANDIDATE",
        forthId: "1977073",
        name: "ลานจอดรถ",
        ...targets.forth1977073_parkingYard,
        bands: bands(targets.forth1977073_parkingYard),
        nearest: nearest(targets.forth1977073_parkingYard)
      },
      forth1708908_office: {
        role: "EES_OFFICE_NOT_DEPOT",
        forthId: "1708908",
        name: "EES",
        ...targets.forth1708908_office,
        bands: bands(targets.forth1708908_office),
        nearest: nearest(targets.forth1708908_office)
      }
    }
  };

  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  const outPath = path.join(root, "output", "v20-3-lorry-depot-gps-proximity-readonly.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  // Keep legacy filename updated with corrected roles for continuity.
  fs.writeFileSync(
    path.join(root, "output", "v20-3-expert-express-depot-gps-proximity-readonly.json"),
    JSON.stringify(
      {
        ...report,
        supersededNote:
          "Corrected: 1708908 is OFFICE; Pilot 002 lorry depot uses owner Maps pin + Forth 1977073 candidate."
      },
      null,
      2
    )
  );
  console.log(
    JSON.stringify(
      {
        outPath: "output/v20-3-lorry-depot-gps-proximity-readonly.json",
        gpsVerified: report.gpsVerified,
        parkingToMapsM: parkingToMapsMeters,
        officeToMapsM: officeToMapsMeters,
        depotBands: report.targets.ownerLorryDepot_maps.bands,
        nearestDepot: report.targets.ownerLorryDepot_maps.nearest[0] ?? null
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
