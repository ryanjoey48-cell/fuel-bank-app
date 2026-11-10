/**
 * Map engine choice for the Fleet Tracking V2 visual prototype.
 *
 * Leaflet is already used by EES Locations, ships BSD-licensed, and renders
 * small HTML vehicle markers with registration labels without a tile API key.
 *
 * The shared EES basemap uses OpenFreeMap vector styles (via MapLibre GL Leaflet)
 * because the OSMF public raster CDN rate-limits production apps (HTTP 429) and
 * unauthenticated CARTO URLs watermark tiles. Operators may still override with
 * NEXT_PUBLIC_EES_MAP_TILE_URL for a licensed raster provider.
 *
 * MapLibre GL JS alone is the stronger visual engine for large vector datasets,
 * but keeping Leaflet markers preserves click, label, and depot-overlap behaviour
 * for the small EES truck fleet without rewriting marker code.
 *
 * Values stay inlined (rather than re-exported via path aliases) so the Node test
 * loader can require this module without Next.js path mapping.
 */
export const FLEET_TRACKING_V2_STYLE_URL =
  process.env.NEXT_PUBLIC_EES_MAP_STYLE_URL?.trim() ||
  "https://tiles.openfreemap.org/styles/liberty";

export const FLEET_TRACKING_V2_TILE_ATTRIBUTION =
  '<a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> · ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">&copy; OpenMapTiles</a> · ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">&copy; OpenStreetMap contributors</a>';

export const FLEET_TRACKING_V2_TILE_URL = process.env.NEXT_PUBLIC_EES_MAP_TILE_URL?.trim() || null;

export const FLEET_TRACKING_V2_MAP_ENGINE = "leaflet+openfreemap" as const;
