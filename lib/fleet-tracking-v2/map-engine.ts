/**
 * Map engine choice for the Fleet Tracking V2 visual prototype.
 *
 * Leaflet is already used by EES Locations, ships BSD-licensed, and renders
 * small HTML vehicle markers with registration labels without a tile API key.
 *
 * MapLibre GL JS (also BSD) is the stronger visual engine for large vector
 * datasets, but it needs a hosted style, adds a second WebGL stack, and does
 * not improve click, label, or depot-overlap behaviour for 21 trucks.
 *
 * Usability for this prototype depends on marker size, clustering, and a
 * compact roster — not on 3D pitch or novelty.
 */
export const FLEET_TRACKING_V2_MAP_ENGINE = "leaflet" as const;

export const FLEET_TRACKING_V2_TILE_URL =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export const FLEET_TRACKING_V2_TILE_ATTRIBUTION =
  "&copy; OpenStreetMap contributors";
