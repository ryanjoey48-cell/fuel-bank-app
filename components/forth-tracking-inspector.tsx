"use client";

import { History, MapPin, X } from "lucide-react";
import type { ForthTrackingCopy } from "@/components/forth-tracking-copy";
import {
  activityText,
  gpsConfidenceLabel,
  shortPositionQualityLabel,
  timestampStatusLabel
} from "@/components/forth-tracking-ui";
import {
  getForthLocationDescription,
  getForthPositionTimeDisplay,
  getForthReportedActivity,
  getForthTrackingVehicleIdentity,
  isForthGpsPositionVerified
} from "@/lib/forth-tracking-view";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";

type Props = {
  record: ForthFleetTrackingRecord;
  copy: ForthTrackingCopy;
  language: "en" | "th";
  onClose: () => void;
  onOpenJourney: () => void;
};

export function ForthTrackingInspector({ record, copy, language, onClose, onOpenJourney }: Props) {
  const identity = getForthTrackingVehicleIdentity(record.vehicleRegistration);
  const locationDescription = getForthLocationDescription(record, language);
  const positionTime = getForthPositionTimeDisplay(record, Date.now(), language);
  const timeInterpretable = record.timestampStatus === "current" || record.timestampStatus === "stale";
  const displayedTime = timeInterpretable
    ? positionTime.relative ?? positionTime.exact
    : positionTime.sourceRaw ?? timestampStatusLabel(record, copy);

  return (
    <section className="border-b border-slate-200 px-2.5 py-2" aria-labelledby="forth-vehicle-details-title">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-violet-700">{copy.detailsTitle}</p>
          <h3 id="forth-vehicle-details-title" className="truncate text-[15px] font-extrabold tracking-tight text-slate-950">
            {record.vehicleRegistration || copy.unknownValue}
          </h3>
          {identity.make ? (
            <p className="truncate text-[10px] text-slate-500">
              {identity.make}{identity.model ? ` ${identity.model}` : ""}{identity.classLabel ? ` · ${identity.classLabel}` : ""}
            </p>
          ) : null}
        </div>
        <button type="button" aria-label={copy.mapCloseInspector} title={copy.mapCloseInspector} onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
          <X className="h-4 w-4" />
        </button>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <div>
          <dt className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{copy.speed}</dt>
          <dd className="font-bold text-slate-950">{record.speed === null ? copy.unknownValue : record.speed}</dd>
        </div>
        <div>
          <dt className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{copy.engine}</dt>
          <dd className="font-semibold text-slate-800">{record.engineOn === null ? copy.unknownValue : record.engineOn ? copy.engineOnLabel : copy.engineOffLabel}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{copy.latestPosition}</dt>
          <dd className="flex items-start gap-1 text-slate-800">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
            <span className="min-w-0 break-words">{locationDescription ?? copy.noPlaceDescription}</span>
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{copy.locationConfidence}</dt>
          <dd className={isForthGpsPositionVerified(record) ? "font-medium text-emerald-800" : "font-medium text-amber-900"}>
            {gpsConfidenceLabel(record, copy)}
            {record.positionSource ? ` · ${shortPositionQualityLabel(record, copy)}` : ""}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{copy.sourceTimestamp}</dt>
          <dd className="break-words font-medium text-slate-800" title={positionTime.exact ?? positionTime.sourceRaw ?? undefined}>
            {displayedTime}
            {record.sourceTimestampRaw && displayedTime !== record.sourceTimestampRaw ? (
              <span className="mt-0.5 block font-mono text-[10px] text-slate-500">{record.sourceTimestampRaw}</span>
            ) : null}
          </dd>
        </div>
      </dl>

      {!isForthGpsPositionVerified(record) ? (
        <p className="mt-1.5 text-[10px] leading-4 text-amber-900">{copy.reportedPositionWarning}</p>
      ) : null}

      <button type="button" onClick={onOpenJourney} className="btn-secondary mt-2 min-h-8 w-full justify-center gap-1 px-2 text-[10px]">
        <History className="h-3.5 w-3.5" />{copy.journeyHistoryView}
      </button>

      <details className="mt-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
        <summary className="cursor-pointer text-[10px] font-semibold text-slate-700">{copy.technicalDetails}</summary>
        <div className="mt-1.5 grid gap-1 border-t border-slate-100 pt-1.5 text-[10px]">
          <p><span className="font-semibold text-slate-500">{copy.device}: </span><span className="break-all font-mono text-slate-700">{record.gpsDeviceId || copy.unknownValue}</span></p>
          <p><span className="font-semibold text-slate-500">{copy.reportedCoordinates}: </span><span className="break-all font-mono text-slate-700">{record.coordinateStatus === "valid" && record.latitude !== null && record.longitude !== null ? `${record.latitude}, ${record.longitude}` : copy.noPosition}</span></p>
          <p><span className="font-semibold text-slate-500">{copy.gps}: </span><span className="text-slate-700">{record.gpsConnectivity === "connected" ? copy.available : record.gpsConnectivity === "disconnected" ? copy.gpsNoFix : copy.unknownValue}</span></p>
          <p><span className="font-semibold text-slate-500">{copy.gprs}: </span><span className="text-slate-700">{record.gprsConnectivity === "connected" ? copy.online : record.gprsConnectivity === "disconnected" ? copy.offlineStatus : copy.unknownValue}</span></p>
          <p><span className="font-semibold text-slate-500">{copy.activityBasis}: </span><span className="text-slate-700">{activityText(getForthReportedActivity(record), copy)}</span></p>
          {record.sourceTimestampRaw ? <p><span className="font-semibold text-slate-500">{copy.sourceTimestamp}: </span><span className="break-all font-mono text-slate-700">{record.sourceTimestampRaw}</span></p> : null}
        </div>
      </details>
    </section>
  );
}
