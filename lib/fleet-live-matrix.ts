/**
 * V7.8.4 Live Fleet status matrix. Pure and read-only; it adds NO classification rule. Every vehicle is placed in exactly one cell using the
 * existing helpers (describeLiveVehicle -> getForthReportedActivity, isForthGpsPositionVerified, record freshness), so the cells always add up
 * to the vehicles counted and can be checked against the headline filters. "Moving" and "stationary" are the device-reported activity, and
 * "verified" is the position verification: two different questions that the headline strip showed side by side but never crossed.
 */
import type { ForthFleetTrackingRecord } from "./forth-tracking-server";
import { describeLiveVehicle } from "./forth-live-status";
import { recordNeedsForthAttentionReview } from "./forth-tracking-view";

export type LiveCell = "moving_verified" | "moving_unverified" | "stationary_verified" | "stationary_unverified" | "stale_or_missing" | "uncertain";
export const LIVE_CELLS: readonly LiveCell[] = ["moving_verified", "moving_unverified", "stationary_verified", "stationary_unverified", "stale_or_missing", "uncertain"];
export type LiveMatrix = {
  total: number; cells: Record<LiveCell, number>;
  /** Counted across the cells above; vehicles that also need attention are an overlay, not a cell. */
  needsAttention: number;
  verified: number; unverified: number;
  /** Not shown on the verified-only map: every unverified vehicle (of the vehicles in scope), and how many of them have usable coordinates. */
  hiddenByVerifiedOnly: { total: number; withCoordinates: number; moving: number };
  partitions: boolean;
};

/** Precedence is fixed: a position that is not current or has no coordinates is "stale or missing" whatever its other flags say. */
export function liveCellOf(record: ForthFleetTrackingRecord): LiveCell {
  const v = describeLiveVehicle(record);
  if (v.freshness !== "current" || !v.hasCoordinates) return "stale_or_missing";
  if (v.motion === "uncertain" || v.motion === "unavailable") return "uncertain";
  return `${v.motion}_${v.verified ? "verified" : "unverified"}` as LiveCell;
}

export function liveStatusMatrix(records: readonly ForthFleetTrackingRecord[]): LiveMatrix {
  const cells = Object.fromEntries(LIVE_CELLS.map(c => [c, 0])) as Record<LiveCell, number>;
  let needsAttention = 0, verified = 0, unverified = 0, hiddenCoords = 0, hiddenMoving = 0;
  for (const r of records) {
    cells[liveCellOf(r)]++;
    if (recordNeedsForthAttentionReview(r)) needsAttention++;
    const v = describeLiveVehicle(r);
    if (v.verified) verified++;
    else { unverified++; if (v.hasCoordinates) hiddenCoords++; if (v.motion === "moving") hiddenMoving++; }
  }
  const sum = LIVE_CELLS.reduce((n, c) => n + cells[c], 0);
  return { total: records.length, cells, needsAttention, verified, unverified, hiddenByVerifiedOnly: { total: unverified, withCoordinates: hiddenCoords, moving: hiddenMoving }, partitions: sum === records.length && verified + unverified === records.length };
}

type Pair = readonly [string, string];
export const LIVE_CELL_COPY: Record<LiveCell, { label: Pair; help: Pair }> = {
  moving_verified: { label: ["Moving · verified", "เคลื่อนที่ · ยืนยัน"], help: ["Reported moving, with a current GPS-verified position.", "รายงานว่าเคลื่อนที่ และมีตำแหน่ง GPS ที่ยืนยันและเป็นปัจจุบัน"] },
  moving_unverified: { label: ["Moving · unverified", "เคลื่อนที่ · ไม่ยืนยัน"], help: ["Reported moving, but the position is not GPS-verified. The pin is the last reported coordinate.", "รายงานว่าเคลื่อนที่ แต่ตำแหน่งไม่ได้รับการยืนยันด้วย GPS หมุดคือพิกัดล่าสุดที่รายงาน"] },
  stationary_verified: { label: ["Stationary · verified", "หยุดนิ่ง · ยืนยัน"], help: ["Reported stopped, with a current GPS-verified position.", "รายงานว่าหยุด และมีตำแหน่ง GPS ที่ยืนยันและเป็นปัจจุบัน"] },
  stationary_unverified: { label: ["Stationary · unverified", "หยุดนิ่ง · ไม่ยืนยัน"], help: ["Reported stopped, but the position is not GPS-verified.", "รายงานว่าหยุด แต่ตำแหน่งไม่ได้รับการยืนยันด้วย GPS"] },
  stale_or_missing: { label: ["Stale or missing position", "ตำแหน่งเก่าหรือไม่มี"], help: ["The position is not current, its time is unknown, or there are no usable coordinates. Not live.", "ตำแหน่งไม่เป็นปัจจุบัน ไม่ทราบเวลา หรือไม่มีพิกัดที่ใช้ได้ ไม่ใช่ข้อมูลสด"] },
  uncertain: { label: ["Activity uncertain", "สถานะไม่แน่ชัด"], help: ["Speed and engine signals conflict or are unavailable, so moving or stopped cannot be stated.", "สัญญาณความเร็วและเครื่องยนต์ขัดแย้งหรือไม่มี จึงระบุว่าเคลื่อนที่หรือหยุดไม่ได้"] }
};
