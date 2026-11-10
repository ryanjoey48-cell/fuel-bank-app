import "server-only";
import { loadBundledForthPinnedLocationsCsv } from "./forth-locations-import-server";
import { buildForthGpsMapPayloadFromCsv } from "./forth-gps-map-locations";
import { crossReferenceLocations, normaliseCompanyName, type CrossRefResult, type EesLocationLite, type ForthSiteLite } from "./fleet-location-crossref";

type SourceClient = { from: (table: string) => any };
export type CrossReference = { results: CrossRefResult[]; counts: Record<CrossRefResult["status"], number>; eesRecords: number; forthSites: number };

// The bundled Forth file never changes while the server runs, so it is parsed once.
let forthCache: Promise<ForthSiteLite[]> | null = null;
function forthSites(): Promise<ForthSiteLite[]> {
  forthCache ??= (async () => {
    const payload = buildForthGpsMapPayloadFromCsv(await loadBundledForthPinnedLocationsCsv());
    return payload.validation.status === "ready" ? payload.locations.map(l => ({ id: l.id, name: l.name, groupLayer: l.groupLayer, address: l.address, latitude: l.latitude, longitude: l.longitude })) : [];
  })().catch(() => { forthCache = null; return [] as ForthSiteLite[]; });
  return forthCache;
}

/**
 * Review-only name cross-reference. The EES directory is read as the caller (their own access rules apply, read only); nothing is
 * stored and no coordinates are produced for EES records.
 */
export async function loadCrossReference(client: SourceClient): Promise<CrossReference> {
  const result = await client.from("ees_locations").select("id,company_name,thai_name,alternative_names,address,province,destination_type").order("company_name").limit(1001);
  if (result.error || !result.data) throw Object.assign(new Error("ees_locations"), { status: 503 });
  const ees = result.data as EesLocationLite[];
  const results = crossReferenceLocations(ees, await forthSites());
  const counts = { strong: 0, possible: 0, multiple: 0, none: 0 } as CrossReference["counts"];
  for (const r of results) counts[r.status]++;
  return { results, counts, eesRecords: ees.length, forthSites: (await forthSites()).length };
}

/** The EES record (if any) that a Forth saved name was suggested for. A suggestion only; never a link. */
export function suggestionForForthName(results: readonly CrossRefResult[], forthName: string) {
  const key = normaliseCompanyName(forthName);
  const hit = results.find(r => r.status !== "none" && r.candidates.some(c => normaliseCompanyName(c.forthName) === key));
  return hit ? { eesName: hit.eesName, status: hit.status } : null;
}
