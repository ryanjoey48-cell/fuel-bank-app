/**
 * Map-safe vehicle silhouettes for Fleet Tracking markers.
 * Original SVG paths — not proprietary emoji artwork.
 * Categories come from confirmed fleet display data only.
 */

import type { ForthTrackingMapVehicleClass } from "@/lib/forth-tracking-view";

export type ForthVehicleIconCategory =
  | "four_wheeler"
  | "six_wheeler"
  | "six_plus_six_wheeler"
  | "eighteen_wheeler"
  | "unclassified";

/** 24×24 viewBox path groups (fill none; stroke inherits). */
const ICON_PATHS: Record<ForthVehicleIconCategory, string> = {
  // Pickup / Hilux-style cab + short bed
  four_wheeler:
    '<path d="M3.2 11.2h7.8l1.8-2.6h4.4l2.2 2.6H21v5.2H3.2z"/>' +
    '<path d="M5.2 11.2l1-2.4h4.6l1.1 2.4"/>' +
    '<rect x="12.6" y="11.4" width="5.6" height="2.2" rx="0.4"/>' +
    '<circle cx="7" cy="17.2" r="1.55"/><circle cx="17.4" cy="17.2" r="1.55"/>',
  // Rigid 6-wheeler box
  six_wheeler:
    '<path d="M2.2 8.2h11.4v8.4H2.2z"/>' +
    '<path d="M13.6 10.4h4l3.2 2.6v3.6h-7.2z"/>' +
    '<path d="M15.2 10.4l1.1-1.8h2.4l1.2 1.8"/>' +
    '<circle cx="5.4" cy="17.6" r="1.45"/><circle cx="10.2" cy="17.6" r="1.45"/><circle cx="17.8" cy="17.6" r="1.45"/>',
  // Longer rigid / 6+6 twin-axle look
  six_plus_six_wheeler:
    '<path d="M1.6 8h12.2v8.6H1.6z"/>' +
    '<path d="M13.8 10.2h4.2l3.4 2.8v3.6h-7.6z"/>' +
    '<path d="M15.4 10.2l1.1-1.7h2.6l1.2 1.7"/>' +
    '<circle cx="4" cy="17.8" r="1.3"/><circle cx="7.4" cy="17.8" r="1.3"/>' +
    '<circle cx="11.2" cy="17.8" r="1.3"/><circle cx="17.2" cy="17.8" r="1.3"/><circle cx="20.4" cy="17.8" r="1.3"/>',
  // Articulated tractor + trailer
  eighteen_wheeler:
    '<path d="M1.2 8.4h11.6v8H1.2z"/>' +
    '<path d="M12.8 10.6h4.8l3.8 2.6v3.2h-8.6z"/>' +
    '<path d="M14.6 10.6l1-1.6h2.8l1.1 1.6"/>' +
    '<circle cx="3.2" cy="17.6" r="1.25"/><circle cx="6.8" cy="17.6" r="1.25"/><circle cx="10.4" cy="17.6" r="1.25"/>' +
    '<circle cx="16.2" cy="17.6" r="1.25"/><circle cx="19.6" cy="17.6" r="1.25"/><circle cx="21.6" cy="17.6" r="1.05"/>',
  unclassified:
    '<path d="M4 10h12l2.5 3H21v4.5H4z"/>' +
    '<path d="M6 10l1.2-2.2h6.2L14.6 10"/>' +
    '<circle cx="7.5" cy="17.2" r="1.5"/><circle cx="16.5" cy="17.2" r="1.5"/>'
};

export function forthVehicleIconCategory(
  vehicleClass: ForthTrackingMapVehicleClass | ForthVehicleIconCategory | null | undefined
): ForthVehicleIconCategory {
  if (vehicleClass === "four_wheeler") return "four_wheeler";
  if (vehicleClass === "six_wheeler") return "six_wheeler";
  if (vehicleClass === "six_plus_six_wheeler") return "six_plus_six_wheeler";
  if (vehicleClass === "eighteen_wheeler") return "eighteen_wheeler";
  return "unclassified";
}

export function forthVehicleIconSvgPaths(category: ForthVehicleIconCategory): string {
  return ICON_PATHS[category] ?? ICON_PATHS.unclassified;
}

export function forthVehicleIconLabel(
  category: ForthVehicleIconCategory,
  language: "en" | "th" = "en"
): string {
  if (language === "th") {
    if (category === "four_wheeler") return "รถกระบะ 4 ล้อ";
    if (category === "six_wheeler") return "รถ 6 ล้อ";
    if (category === "six_plus_six_wheeler") return "รถ 6+6 ล้อ";
    if (category === "eighteen_wheeler") return "รถพ่วง 18 ล้อ";
    return "ประเภทรถไม่ระบุ";
  }
  if (category === "four_wheeler") return "4-wheel pickup";
  if (category === "six_wheeler") return "6-wheel lorry";
  if (category === "six_plus_six_wheeler") return "6+6-wheel lorry";
  if (category === "eighteen_wheeler") return "18-wheeler";
  return "Unclassified vehicle";
}

/** Compact HTML fragment for Leaflet DivIcon (stroke-based silhouette). */
export function buildForthVehicleMarkerGlyphHtml(
  vehicleClass: ForthTrackingMapVehicleClass | ForthVehicleIconCategory,
  className: string
): string {
  const category = forthVehicleIconCategory(vehicleClass);
  return (
    `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" data-vehicle-class="${category}">` +
    forthVehicleIconSvgPaths(category) +
    `</svg>`
  );
}
