/**
 * Journey playback helpers — timeline, gaps, continuity.
 * Does not invent positions across outages.
 */

import type { HistoricalLogPoint, HistoricalLogReplay } from "@/lib/forth-history-log";

export const FORTH_PLAYBACK_SPEEDS = [1, 2, 5] as const;
export type ForthPlaybackSpeed = (typeof FORTH_PLAYBACK_SPEEDS)[number];

export type ForthPlaybackObservation = {
  index: number;
  point: HistoricalLogPoint;
  gapBeforeMs: number | null;
  isGapEdge: boolean;
};

export type ForthPlaybackSeekResult = {
  index: number;
  point: HistoricalLogPoint | null;
  progress: number;
};

/** Bangkok calendar day → Forth path stamps YYYYMMDDHHmmss (same local wall clock). */
export function forthPlaybackDayRange(
  dateYmd: string,
  startHm = "00:00",
  endHm = "23:59"
): { startTime: string; endTime: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  const startMatch = /^(\d{2}):(\d{2})$/.exec(startHm);
  const endMatch = /^(\d{2}):(\d{2})$/.exec(endHm);
  if (!startMatch || !endMatch) return null;
  // A real Asia/Bangkok calendar day that is not in the future, and real clock times. Forth accepts one day per request.
  const noon = Date.parse(`${dateYmd}T12:00:00+07:00`);
  if (!Number.isFinite(noon) || new Date(noon + 7 * 3_600_000).toISOString().slice(0, 10) !== dateYmd) return null;
  if (Date.parse(`${dateYmd}T00:00:00+07:00`) > Date.now()) return null;
  for (const match of [startMatch, endMatch]) if (Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  const ymd = dateYmd.replaceAll("-", "");
  const startTime = `${ymd}${startMatch[1]}${startMatch[2]}00`;
  const endMinute = Number(endMatch[2]);
  const endHour = Number(endMatch[1]);
  // Inclusive end-of-minute → next second clamp within same day for API window.
  let eh = endHour;
  let em = endMinute;
  let es = 59;
  if (em === 59 && eh === 23) {
    es = 59;
  }
  const endTime = `${ymd}${String(eh).padStart(2, "0")}${String(em).padStart(2, "0")}${String(es).padStart(2, "0")}`;
  if (endTime <= startTime) return null;
  return { startTime, endTime };
}

export function orderHistoricalPointsByTime(points: readonly HistoricalLogPoint[]): HistoricalLogPoint[] {
  return [...points].sort((left, right) => {
    const leftMs = left.timestampIso ? Date.parse(left.timestampIso) : Number.POSITIVE_INFINITY;
    const rightMs = right.timestampIso ? Date.parse(right.timestampIso) : Number.POSITIVE_INFINITY;
    if (leftMs !== rightMs) return leftMs - rightMs;
    return (left.sourceTimestamp ?? "").localeCompare(right.sourceTimestamp ?? "");
  });
}

export function dedupeHistoricalObservations(points: readonly HistoricalLogPoint[]): HistoricalLogPoint[] {
  const seen = new Set<string>();
  const result: HistoricalLogPoint[] = [];
  for (const point of points) {
    const key = [
      point.timestampIso ?? "",
      point.sourceTimestamp ?? "",
      point.latitude ?? "",
      point.longitude ?? "",
      point.speedKph ?? "",
      point.verifiedGps ? "1" : "0"
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(point);
  }
  return result;
}

export function buildPlaybackObservations(replay: HistoricalLogReplay): ForthPlaybackObservation[] {
  const ordered = orderHistoricalPointsByTime(dedupeHistoricalObservations(replay.points));
  return ordered.map((point, index) => {
    const previous = index > 0 ? ordered[index - 1] : null;
    let gapBeforeMs: number | null = null;
    if (previous?.timestampIso && point.timestampIso) {
      const gap = Date.parse(point.timestampIso) - Date.parse(previous.timestampIso);
      gapBeforeMs = Number.isFinite(gap) && gap > 0 ? gap : null;
    }
    const isGapEdge = gapBeforeMs !== null && gapBeforeMs > 5 * 60_000;
    return { index, point, gapBeforeMs, isGapEdge };
  });
}

/** Seek by 0–1 progress across observation indices (not wall-clock inventing). */
export function seekPlaybackByProgress(
  observations: readonly ForthPlaybackObservation[],
  progress: number
): ForthPlaybackSeekResult {
  if (!observations.length) return { index: -1, point: null, progress: 0 };
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const index = Math.min(observations.length - 1, Math.round(clamped * (observations.length - 1)));
  return { index, point: observations[index]?.point ?? null, progress: clamped };
}

export function seekPlaybackByTimestamp(
  observations: readonly ForthPlaybackObservation[],
  timestampIso: string
): ForthPlaybackSeekResult {
  if (!observations.length) return { index: -1, point: null, progress: 0 };
  const target = Date.parse(timestampIso);
  if (!Number.isFinite(target)) return seekPlaybackByProgress(observations, 0);
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  observations.forEach((row, index) => {
    const ms = row.point.timestampIso ? Date.parse(row.point.timestampIso) : Number.NaN;
    if (!Number.isFinite(ms)) return;
    const delta = Math.abs(ms - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = index;
    }
  });
  const progress = observations.length <= 1 ? 0 : best / (observations.length - 1);
  return { index: best, point: observations[best].point, progress };
}

export function advancePlaybackIndex(
  observations: readonly ForthPlaybackObservation[],
  currentIndex: number,
  direction: 1 | -1 = 1
): number {
  if (!observations.length) return -1;
  return Math.max(0, Math.min(observations.length - 1, currentIndex + direction));
}

export type ForthPlaybackAvailability =
  | {
      status: "unavailable";
      code: "history_live_disabled" | "missing_device" | "invalid_range" | "upstream_error" | "empty";
      message: string;
    }
  | {
      status: "ready";
      deviceId: string;
      dateYmd: string;
      observationCount: number;
      verifiedCount: number;
      segmentCount: number;
      gapCount: number;
    };

/** Shown when the server-side approval gate is closed. It says why, instead of implying Forth cannot supply history. */
export function describeHistoryGateOff(language: "en" | "th" = "en"): string {
  return language === "th"
    ? "การเล่นย้อนเส้นทางยังไม่พร้อมใช้งาน: เซิร์ฟเวอร์ปิดไว้จนกว่าเจ้าของกิจการจะอนุมัติ ระบบจึงไม่ขอและไม่แสดงเส้นทางใดๆ"
    : "Journey playback is not available: it is switched off on this server until the owner approves it. No history is requested and no route is shown.";
}

/**
 * Thai wording for playback HTTP errors. The server's English messages are fixed and contain no coordinates, so English
 * users see the server text (null here); Thai users get the same meaning in Thai.
 */
export function describePlaybackHttpError(status: number, language: "en" | "th" = "en"): string | null {
  if (language !== "th") return null;
  if (status === 403) return "การดูเส้นทางย้อนหลังต้องได้รับอนุญาตเป็นการเฉพาะ โปรดติดต่อผู้ดูแลระบบ";
  if (status === 400 || status === 413 || status === 415) return "คำขอไม่ถูกต้อง: เลือกรถหนึ่งคัน วันที่ในอดีตหรือวันนี้ (เวลากรุงเทพ) และช่วงเวลาที่ถูกต้อง";
  if (status === 404) return "ไม่พบรถคันนี้ในกองรถ Forth ที่ได้รับอนุญาต";
  if (status === 409) return "รหัสอุปกรณ์ Forth นี้ซ้ำกันในกองรถ ไม่สามารถเลือกได้";
  if (status === 429) return "มีการขอข้อมูลบ่อยเกินไป โปรดรอสักครู่แล้วลองใหม่";
  if (status >= 500) return "ระบบ Forth ไม่พร้อมใช้งานในขณะนี้ ไม่มีการแสดงเส้นทางสมมติ";
  return null;
}

export function describeHistoryUnavailable(language: "en" | "th" = "en"): string {
  return language === "th"
    ? "ยังไม่มีข้อมูล GPS ย้อนหลังจากสิทธิ์ Forth ปัจจุบัน — ไม่แสดงเส้นทางสมมติ"
    : "Historical GPS data is not available from current Forth access — no invented route is shown.";
}
