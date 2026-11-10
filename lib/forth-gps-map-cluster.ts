/**
 * Forth GPS destination clustering — distinct from live vehicle markers.
 * Cameras and cluster geometry never rewrite coordinates.
 */

/** Cluster radius in pixels from cluster centre (Leaflet.markercluster). */
export function forthGpsClusterMaxRadius(zoom: number) {
  if (!Number.isFinite(zoom)) return 48;
  // V21.2: merge aggressively at regional zoom so customer pins stay subordinate to trucks.
  if (zoom <= 8) return 72;
  if (zoom <= 10) return 58;
  if (zoom <= 12) return 44;
  return 32;
}

/** Individual teardrop pins appear from this zoom upward. */
export function forthGpsDisableClusteringAtZoom() {
  return 15;
}

export type ForthGpsClusterIconClasses = {
  shell: string;
  body: string;
  count: string;
  tag: string;
};

export function buildForthGpsClusterIconHtml(count: number, classes: ForthGpsClusterIconClasses) {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const display = safeCount > 999 ? "999+" : String(safeCount);
  return (
    `<span class="${classes.shell}" aria-hidden="true">` +
    `<span class="${classes.body}"><span class="${classes.count}">${display}</span></span>` +
    `<span class="${classes.tag}">GPS</span>` +
    `</span>`
  );
}

export function forthGpsClusterIconSize(count: number): [number, number] {
  if (count >= 100) return [30, 34];
  if (count >= 25) return [28, 32];
  return [26, 30];
}

export function forthGpsClusterIconAnchor(size: [number, number]): [number, number] {
  return [Math.round(size[0] / 2), size[1] - 2];
}
