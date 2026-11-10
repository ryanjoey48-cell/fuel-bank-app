/**
 * Shared EES basemap configuration.
 *
 * Why this exists:
 * - `tile.openstreetmap.org` is a community best-effort CDN. OSMF tile policy
 *   forbids relying on it for production apps, and this network currently
 *   receives HTTP 429 "Too many requests" from that host.
 * - Unauthenticated CARTO basemap URLs return watermark tiles ("API KEY REQUIRED").
 *
 * Default: OpenFreeMap Liberty vector style (commercial use allowed, no API key) rendered
 * through MapLibre GL as a Leaflet layer so existing Leaflet vehicle markers stay intact.
 * Liberty is preferred over Positron for fleet operations (stronger road/water contrast).
 *
 * Operators may override with a licensed raster URL via NEXT_PUBLIC_EES_MAP_TILE_URL
 * (for example a CARTO or Geoapify URL that already includes a valid key).
 *
 * Caching: the Leaflet map is created once and kept across Forth polling refreshes.
 * Vector/raster HTTP responses honour Cache-Control; Leaflet raster options below
 * avoid refetching while the viewport is idle or zooming.
 */

export const EES_MAP_VECTOR_STYLE_URL =
  process.env.NEXT_PUBLIC_EES_MAP_STYLE_URL?.trim() ||
  "https://tiles.openfreemap.org/styles/liberty";

/** Optional licensed raster override. When set, Leaflet uses this instead of OpenFreeMap. */
export const EES_MAP_RASTER_TILE_URL = process.env.NEXT_PUBLIC_EES_MAP_TILE_URL?.trim() || null;

export const EES_MAP_ATTRIBUTION =
  '<a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> · ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">&copy; OpenMapTiles</a> · ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">&copy; OpenStreetMap contributors</a>';

export const EES_MAP_RASTER_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>';

export const EES_LEAFLET_RASTER_TILE_OPTIONS = {
  maxZoom: 19,
  minZoom: 4,
  keepBuffer: 4,
  updateWhenIdle: true,
  updateWhenZooming: false,
  crossOrigin: true as const
};

export function eesMapUsesRasterOverride() {
  return Boolean(EES_MAP_RASTER_TILE_URL);
}
