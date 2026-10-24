import { memo } from "react";
import type { ForthTrackingCopy } from "@/components/forth-tracking-copy";
import {
  getForthReportedActivity,
  isForthGpsConfidenceUnavailable,
  isForthGpsPositionVerified,
  type ForthReportedActivity
} from "@/lib/forth-tracking-view";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";

export function activityText(activity: ForthReportedActivity, copy: ForthTrackingCopy) {
  if (activity === "driving") return copy.activityDriving;
  if (activity === "uncertain") return copy.activityUncertain;
  if (activity === "stopped_engine_on") return copy.activityStoppedEngineOn;
  if (activity === "stopped_engine_off") return copy.activityStoppedEngineOff;
  if (activity === "stopped_engine_unknown") return copy.activityStoppedEngineUnknown;
  return copy.activityUnavailable;
}

export function activityStyle(activity: ForthReportedActivity) {
  if (activity === "driving") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (activity === "uncertain") return "border-orange-200 bg-orange-50 text-orange-900";
  if (activity === "stopped_engine_on") return "border-amber-200 bg-amber-50 text-amber-900";
  if (activity === "stopped_engine_off") return "border-indigo-200 bg-indigo-50 text-indigo-800";
  if (activity === "stopped_engine_unknown") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

export function timestampStatusLabel(record: ForthFleetTrackingRecord, copy: ForthTrackingCopy) {
  if (record.timestampStatus === "current") return copy.current;
  if (record.timestampStatus === "stale") return copy.stale;
  if (record.timestampStatus === "timezone_unconfigured") return copy.timezoneUnconfigured;
  if (record.timestampStatus === "timezone_invalid") return copy.timezoneInvalid;
  if (record.timestampStatus === "timezone_ambiguous") return copy.ambiguousTime;
  if (record.timestampStatus === "invalid") return copy.invalidTime;
  return copy.noTimestamp;
}

export function gpsConfidenceLabel(record: ForthFleetTrackingRecord, copy: ForthTrackingCopy) {
  if (isForthGpsPositionVerified(record)) return copy.gpsPositionVerified;
  if (record.timestampStatus === "stale") return `${copy.gpsPositionUnverified} · ${copy.stale}`;
  if (record.timestampStatus !== "current") {
    return `${copy.gpsConfidenceUnavailable} · ${timestampStatusLabel(record, copy)}`;
  }
  if (isForthGpsConfidenceUnavailable(record)) return copy.gpsConfidenceUnavailable;
  return copy.gpsPositionUnverified;
}

export function shortPositionQualityLabel(record: ForthFleetTrackingRecord, copy: ForthTrackingCopy) {
  if (isForthGpsPositionVerified(record)) return copy.gpsPositionVerified;
  if (record.timestampStatus === "timezone_unconfigured") return copy.timezoneUnconfigured;
  if (record.timestampStatus === "stale") return copy.stale;
  if (record.timestampStatus !== "current" || isForthGpsConfidenceUnavailable(record)) return copy.gpsConfidenceUnavailable;
  if (record.positionQuality === "no_gps") return "No GPS";
  if (record.positionQuality === "wifi") return "Wi-Fi";
  if (record.positionQuality === "lbs") return "LBS";
  if (record.positionQuality === "other") return copy.otherQuality;
  if (record.positionQuality === "gps") return copy.gpsPositionUnverified;
  return copy.unknownQuality;
}

export const ActivityPill = memo(function ActivityPill({
  activity,
  copy
}: {
  activity: ForthReportedActivity;
  copy: ForthTrackingCopy;
}) {
  return (
    <span className={"inline-flex min-h-5 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none " + activityStyle(activity)}>
      {activityText(activity, copy)}
    </span>
  );
});

export const FleetVehicleRow = memo(function FleetVehicleRow({
  record,
  recordKey,
  active,
  copy,
  onSelect
}: {
  record: ForthFleetTrackingRecord;
  recordKey: string;
  active: boolean;
  copy: ForthTrackingCopy;
  onSelect: (key: string) => void;
}) {
  const activity = getForthReportedActivity(record);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(recordKey)}
      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${active ? "bg-violet-50 text-slate-950" : "hover:bg-slate-50"}`}
    >
      <span className="min-w-0 truncate text-[13px] font-bold tracking-tight">{record.vehicleRegistration || copy.unknownValue}</span>
      <span className="text-right text-[13px] font-semibold tabular-nums text-slate-900">{record.speed === null ? "—" : record.speed}</span>
      <span className="col-span-2"><ActivityPill activity={activity} copy={copy} /></span>
    </button>
  );
});
