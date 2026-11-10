/**
 * Fleet Tracking marker geometry.
 *
 * The geographic anchor is the centre of the vehicle symbol only. Registration
 * labels may overflow outside the icon box; they must never change iconSize or
 * iconAnchor, otherwise a fixed pixel offset becomes kilometres at low zoom
 * (vehicles appear over water when zooming out).
 */

export const FORTH_MARKER_DISC_PX = 42;
export const FORTH_MARKER_ICON_SIZE: [number, number] = [FORTH_MARKER_DISC_PX, FORTH_MARKER_DISC_PX];
export const FORTH_MARKER_ICON_ANCHOR: [number, number] = [
  FORTH_MARKER_DISC_PX / 2,
  FORTH_MARKER_DISC_PX / 2
];

/**
 * Preserve a recognisable truck silhouette at regional zoom. The geographic
 * coordinate remains at the centre of the symbol at every size.
 */
export function forthMarkerDiscPxForZoom(zoom: number) {
  if (!Number.isFinite(zoom)) return FORTH_MARKER_DISC_PX;
  // Keep a recognisable vehicle silhouette at regional / Core Ops zoom.
  if (zoom <= 7) return 28;
  if (zoom <= 9) return 32;
  if (zoom <= 11) return 36;
  if (zoom <= 13) return 40;
  return 42;
}

export type ForthLabelCandidate = {
  key: string;
  x: number;
  y: number;
  iconSize: number;
  labelWidth: number;
  labelHeight: number;
  selected: boolean;
  reveal: boolean;
  priority: number;
};

export type ForthPlannedLabel = { key: string; left: number; top: number; visible: boolean };

/** Find marker symbols that overlap on screen without altering their geographic anchors. */
export function getForthScreenOverlapGroups(points: Array<{ key: string; x: number; y: number }>, thresholdPx: number) {
  const valid = points.filter((point) => point.key && [point.x, point.y].every(Number.isFinite));
  const parent = valid.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const footprint = Number.isFinite(thresholdPx) ? Math.max(0, thresholdPx) : 0;
  for (let left = 0; left < valid.length; left += 1) {
    for (let right = left + 1; right < valid.length; right += 1) {
      if (Math.abs(valid[left].x - valid[right].x) < footprint && Math.abs(valid[left].y - valid[right].y) < footprint) {
        parent[find(right)] = find(left);
      }
    }
  }
  const members = new Map<number, Set<string>>();
  valid.forEach((point, index) => {
    const group = members.get(find(index)) ?? new Set<string>();
    group.add(point.key);
    members.set(find(index), group);
  });
  return [...members.values()].filter((group) => group.size > 1).map((group) => [...group].sort()).sort((a, b) => a[0].localeCompare(b[0]));
}

/** Vertical fan steps so stacked / nearby vehicles keep readable registrations. */
function forthLabelFanOffsets(labelHeight: number, zoom: number) {
  const step = Math.max(14, Math.round(labelHeight + (zoom >= 11 ? 2 : 4)));
  const reach = zoom >= 13 ? 4 : zoom >= 10 ? 5 : 6;
  const offsets = [0];
  for (let rung = 1; rung <= reach; rung += 1) {
    offsets.push(-step * rung, step * rung);
  }
  return offsets;
}

function forthLabelRectOverlaps(
  rect: { left: number; top: number; right: number; bottom: number },
  other: { left: number; top: number; right: number; bottom: number },
  pad = 2
) {
  return rect.left < other.right + pad && rect.right + pad > other.left && rect.top < other.bottom + pad && rect.bottom + pad > other.top;
}

/** Place registration text around fixed geographic anchors, without moving symbols. */
export function planForthMarkerLabels(
  candidates: ForthLabelCandidate[],
  viewport: { width: number; height: number },
  zoom: number
): ForthPlannedLabel[] {
  const ordered = [...candidates].sort((a, b) =>
    Number(b.selected) - Number(a.selected) ||
    Number(b.reveal) - Number(a.reveal) ||
    b.priority - a.priority ||
    a.key.localeCompare(b.key)
  );
  const occupied: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  const symbolFootprints = candidates.map((item) => ({
    key: item.key,
    left: item.x - item.iconSize / 2 - 2,
    top: item.y - item.iconSize / 2 - 2,
    right: item.x + item.iconSize / 2 + 2,
    bottom: item.y + item.iconSize / 2 + 2
  }));
  // Stable fan index for vehicles sharing nearly the same screen point.
  const clusterOrder = new Map<string, number>();
  const clusterBuckets = new Map<string, string[]>();
  for (const item of ordered) {
    const bucket = `${Math.round(item.x / 8)}_${Math.round(item.y / 8)}`;
    const members = clusterBuckets.get(bucket) ?? [];
    members.push(item.key);
    clusterBuckets.set(bucket, members);
  }
  for (const members of clusterBuckets.values()) {
    members.forEach((key, index) => clusterOrder.set(key, index));
  }
  const result: ForthPlannedLabel[] = [];
  for (const item of ordered) {
    const radius = item.iconSize / 2;
    // Keep registration physically attached to the icon (tiny connector gap only).
    const gap = 1;
    const fanIndex = clusterOrder.get(item.key) ?? 0;
    const step = Math.max(14, Math.round(item.labelHeight + (zoom >= 11 ? 2 : 4)));
    const dedicated = fanIndex === 0 ? 0 : (fanIndex % 2 === 0 ? 1 : -1) * Math.ceil(fanIndex / 2) * step;
    const preferred = forthLabelFanOffsets(item.labelHeight, zoom);
    // Prefer the cluster's dedicated rung first so depot stacks read as a list.
    const offsets = dedicated === 0 ? preferred : [dedicated, ...preferred.filter((offset) => offset !== dedicated)];
    const sides = item.x + radius + gap + item.labelWidth > viewport.width - 6 ? [-1, 1] : [1, -1];
    let choice: { left: number; top: number; right: number; bottom: number } | null = null;
    const tryPlace = (allowSymbolOverlap: boolean) => {
      for (const offset of offsets) {
        for (const side of sides) {
          const left = side === 1 ? item.x + radius + gap : item.x - radius - gap - item.labelWidth;
          const top = item.y - item.labelHeight / 2 + offset;
          const rect = { left, top, right: left + item.labelWidth, bottom: top + item.labelHeight };
          if (left < 2 || top < 2 || rect.right > viewport.width - 2 || rect.bottom > viewport.height - 2) continue;
          if (occupied.some((other) => forthLabelRectOverlaps(rect, other))) continue;
          if (
            !allowSymbolOverlap &&
            symbolFootprints.some((symbol) => symbol.key !== item.key && forthLabelRectOverlaps(rect, symbol, 0))
          ) {
            continue;
          }
          return rect;
        }
      }
      return null;
    };
    choice = tryPlace(false) ?? tryPlace(true);
    // Force a readable fan slot when collision avoidance cannot find free space —
    // operators need every registration on Fit-ops / regional views.
    if (!choice) {
      const step = Math.max(14, Math.round(item.labelHeight + 2));
      const side = sides[0];
      const left = side === 1 ? item.x + radius + gap : item.x - radius - gap - item.labelWidth;
      const top = item.y - item.labelHeight / 2 + (fanIndex % 2 === 0 ? -1 : 1) * step * Math.ceil((fanIndex + 1) / 2);
      choice = {
        left: Math.max(2, Math.min(viewport.width - item.labelWidth - 2, left)),
        top: Math.max(2, Math.min(viewport.height - item.labelHeight - 2, top)),
        right: 0,
        bottom: 0
      };
      choice.right = choice.left + item.labelWidth;
      choice.bottom = choice.top + item.labelHeight;
    }
    // Never pin a registration to the screen edge after its real anchor leaves the map.
    const anchorInView = item.x >= -radius && item.y >= -radius && item.x <= viewport.width + radius && item.y <= viewport.height + radius;
    const visible = anchorInView;
    result.push({ key: item.key, left: choice.left, top: choice.top, visible });
    if (visible) occupied.push(choice);
  }
  return result;
}

export function forthMarkerIconSizeForZoom(zoom: number): [number, number] {
  const disc = forthMarkerDiscPxForZoom(zoom);
  return [disc, disc];
}

export function forthMarkerIconAnchorForZoom(zoom: number): [number, number] {
  const disc = forthMarkerDiscPxForZoom(zoom);
  return [disc / 2, disc / 2];
}

/** Approximate metres-per-pixel at the equator for a Leaflet/MapLibre zoom level. */
export function forthMetersPerPixelAtEquator(zoom: number) {
  if (!Number.isFinite(zoom)) return Number.POSITIVE_INFINITY;
  return (156543.03392 * Math.cos(0)) / 2 ** zoom;
}

/**
 * Screen-space distance between a projected lat/lng and the rendered disc centre,
 * converted to metres using the supplied metres-per-pixel value.
 */
export function forthMarkerAnchorErrorMeters(
  projectedPoint: { x: number; y: number },
  discCenterPoint: { x: number; y: number },
  metersPerPixel: number
) {
  if (![projectedPoint.x, projectedPoint.y, discCenterPoint.x, discCenterPoint.y, metersPerPixel].every(Number.isFinite)) {
    return Number.POSITIVE_INFINITY;
  }
  const pixelError = Math.hypot(discCenterPoint.x - projectedPoint.x, discCenterPoint.y - projectedPoint.y);
  return pixelError * Math.max(0, metersPerPixel);
}

/**
 * A correctly configured marker keeps its disc centre within a small pixel
 * tolerance of the projected source coordinate at every zoom level.
 */
export function forthMarkerAnchorIsStable(
  errorsByZoom: Array<{ zoom: number; errorMeters: number }>,
  maxErrorMetersAtZoom14 = 8
) {
  if (errorsByZoom.length === 0) return false;
  return errorsByZoom.every(({ zoom, errorMeters }) => {
    if (!Number.isFinite(zoom) || !Number.isFinite(errorMeters)) return false;
    // Allow roughly one CSS pixel of rounding, scaled by zoom.
    const limit = maxErrorMetersAtZoom14 * 2 ** (14 - zoom);
    return errorMeters <= Math.max(2, limit);
  });
}
