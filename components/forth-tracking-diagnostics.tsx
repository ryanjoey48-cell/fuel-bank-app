"use client";

import { Activity, Search, X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import type { ForthTrackingCopy } from "@/components/forth-tracking-copy";
import { ActivityPill, activityText, gpsConfidenceLabel, timestampStatusLabel } from "@/components/forth-tracking-ui";
import {
  formatForthTrackingTime,
  getForthAccuracyComparisons,
  getForthFleetRecordKey,
  getForthNormalizationWarnings,
  getForthReportedActivity,
  type ForthAccuracyField,
  type ForthNormalizationWarning
} from "@/lib/forth-tracking-view";
import type { ForthFleetTrackingData, ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import type { ForthSourceFieldSnapshot } from "@/lib/forth-tracking";

export type StatusDiagnosticUiState =
  | "checking"
  | "ready"
  | "awaiting_confirmation"
  | "running"
  | "completed"
  | "failed"
  | "previously_attempted";

export type StatusDiagnosticResult = {
  connectionStatus: "connected" | "failed" | "not_configured";
  recordCount: number;
  communications: Record<"online" | "offline" | "unknown", number>;
  positionFreshness: Record<"current" | "stale" | "unknown", number>;
  gpsSignal: Record<"available" | "unavailable" | "unknown", number>;
  positionQuality: Record<"gps" | "no_gps" | "wifi" | "lbs" | "other" | "unknown", number>;
  speedAvailability: Record<"available" | "unavailable", number>;
  engineState: Record<"on" | "off" | "unknown", number>;
  classificationReason: Record<string, number>;
  positionSourceShape: {
    canonicalField: Record<string, number>;
    alternateCandidateRecords: number;
    alternateCandidateValues: Record<string, number>;
  };
  unknownPositionSourceStrings: {
    unknownStringCount: number;
    returnedUniqueCount: number;
    notListedOccurrences: number;
    rejectedOccurrences: number;
    labels: Array<{ label: string; occurrences: number }>;
  };
  error: string | null;
};

function accuracyFieldLabel(field: ForthAccuracyField, copy: ForthTrackingCopy) {
  const labels: Record<ForthAccuracyField, string> = {
    registration: copy.registration,
    device_id: copy.device,
    driver: copy.driver,
    speed: copy.speed,
    engine: copy.engine,
    latitude: copy.accuracyLatitude,
    longitude: copy.accuracyLongitude,
    heading: copy.heading,
    gps_signal: copy.gps,
    gprs: copy.gprs,
    position_source: copy.positionSource,
    position_time: copy.timestamp,
    retrieval_time: copy.lastSync,
    activity_status: copy.accuracyActivityStatus
  };
  return labels[field];
}

function accuracyWarningLabel(warning: ForthNormalizationWarning, copy: ForthTrackingCopy) {
  const labels: Record<ForthNormalizationWarning, string> = {
    registration_missing: copy.warningRegistrationMissing,
    device_id_missing: copy.warningDeviceMissing,
    driver_not_displayable: copy.warningDriverFiltered,
    speed_missing: copy.warningSpeedMissing,
    speed_invalid: copy.warningSpeedInvalid,
    engine_unavailable: copy.warningEngineUnknown,
    coordinates_missing: copy.warningCoordinatesMissing,
    coordinates_invalid: copy.warningCoordinatesInvalid,
    heading_invalid: copy.warningHeadingInvalid,
    gps_signal_unknown: copy.warningGpsUnknown,
    gprs_unknown: copy.warningGprsUnknown,
    position_time_stale: copy.warningTimestampStale,
    position_time_unavailable: copy.warningTimestampUnknown,
    position_source_unknown: copy.warningSourceUnknown,
    source_value_truncated: copy.warningTruncated
  };
  return labels[warning];
}

function sourceAuditValue(snapshot: ForthSourceFieldSnapshot, copy: ForthTrackingCopy) {
  if (snapshot.shape === "missing") return copy.accuracyMissing;
  if (snapshot.shape === "null") return copy.accuracyNull;
  if (snapshot.shape === "empty") return copy.accuracyEmpty;
  if (snapshot.shape === "unsupported") return copy.accuracyUnsupported;
  return (
    <span className="inline-flex max-w-full flex-wrap items-baseline gap-1">
      <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-800">
        {typeof snapshot.value === "string" ? JSON.stringify(snapshot.value) : String(snapshot.value)}
      </code>
      {snapshot.truncated ? <span className="text-[10px] text-amber-800">{copy.accuracyTruncated}</span> : null}
    </span>
  );
}

function normalizedAccuracyValue(
  field: ForthAccuracyField,
  normalized: string | null,
  record: ForthFleetTrackingRecord,
  fetchedAt: string | null,
  copy: ForthTrackingCopy,
  language: "en" | "th"
): ReactNode {
  if (field === "engine") return record.engineOn === null ? copy.unknownValue : record.engineOn ? copy.engineOn : copy.engineOff;
  if (field === "gps_signal") return record.gpsConnectivity === "connected" ? copy.available : record.gpsConnectivity === "disconnected" ? copy.gpsNoFix : copy.unknownValue;
  if (field === "gprs") return record.gprsConnectivity === "connected" ? copy.online : record.gprsConnectivity === "disconnected" ? copy.offlineStatus : copy.unknownValue;
  if (field === "position_source") return <span>{gpsConfidenceLabel(record, copy)}{record.positionSource ? <span className="mt-1 block text-[11px] text-slate-500">{record.positionSource}</span> : null}</span>;
  if (field === "position_time") return <span>{formatForthTrackingTime(record.lastGpsTimestamp, language) ?? timestampStatusLabel(record, copy)}{record.lastGpsTimestamp ? <span className="mt-1 block text-[10px] font-normal text-slate-500">{record.lastGpsTimestamp} · {timestampStatusLabel(record, copy)}</span> : null}</span>;
  if (field === "retrieval_time") return <span>{formatForthTrackingTime(fetchedAt, language) ?? copy.unknownValue}{fetchedAt ? <span className="mt-1 block text-[10px] font-normal text-slate-500">{fetchedAt}</span> : null}</span>;
  if (field === "activity_status") return <span>{activityText(getForthReportedActivity(record), copy)}<span className="mt-1 block text-[10px] font-normal text-slate-500">{copy.accuracyActivityDerived}</span></span>;
  return normalized ?? copy.unknownValue;
}

type Props = {
  copy: ForthTrackingCopy;
  language: "en" | "th";
  data: ForthFleetTrackingData;
  accuracySearch: string;
  onAccuracySearchChange: (value: string) => void;
  accuracyRecords: ForthFleetTrackingRecord[];
  recordKeysByReference: Map<ForthFleetTrackingRecord, string>;
  summaryTotal: number;
  dialogRef: RefObject<HTMLElement | null>;
  closeRef: RefObject<HTMLButtonElement | null>;
  statusDiagnosticTriggerRef: RefObject<HTMLButtonElement | null>;
  statusDiagnosticMessageRef: RefObject<HTMLParagraphElement | null>;
  statusDiagnosticCancelRef: RefObject<HTMLButtonElement | null>;
  statusDiagnosticDialogRef: RefObject<HTMLDivElement | null>;
  statusDiagnostic: StatusDiagnosticResult | null;
  statusDiagnosticState: StatusDiagnosticUiState;
  diagnosticStateLabels: Record<StatusDiagnosticUiState, string>;
  diagnosticStatusBody: string;
  diagnosticStateClass: string;
  diagnosticCanStart: boolean;
  diagnosticButtonLabel: string;
  statusDiagnosticConfirmationOpen: boolean;
  onClose: () => void;
  onStartDiagnostic: () => void;
  onCancelDiagnostic: () => void;
  onConfirmDiagnostic: () => void;
};

export function ForthTrackingDiagnostics({
  copy,
  language,
  data,
  accuracySearch,
  onAccuracySearchChange,
  accuracyRecords,
  recordKeysByReference,
  summaryTotal,
  dialogRef,
  closeRef,
  statusDiagnosticTriggerRef,
  statusDiagnosticMessageRef,
  statusDiagnosticCancelRef,
  statusDiagnosticDialogRef,
  statusDiagnostic,
  statusDiagnosticState,
  diagnosticStateLabels,
  diagnosticStatusBody,
  diagnosticStateClass,
  diagnosticCanStart,
  diagnosticButtonLabel,
  statusDiagnosticConfirmationOpen,
  onClose,
  onStartDiagnostic,
  onCancelDiagnostic,
  onConfirmDiagnostic
}: Props) {
  return (
    <div className="fixed inset-0 z-[900] flex justify-end bg-slate-950/45">
      <button type="button" className="absolute inset-0" aria-label={language === "th" ? "ปิดการวินิจฉัย" : "Close diagnostics"} onClick={onClose} />
      <aside ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="forth-diagnostics-title" className="relative z-[901] flex h-full w-full max-w-3xl flex-col border-l border-slate-200 bg-slate-50 shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700">{language === "th" ? "สิทธิ์สำนักงาน" : "Office access"}</p>
            <h2 id="forth-diagnostics-title" className="text-base font-bold text-slate-950">{language === "th" ? "การวินิจฉัยการติดตาม" : "Tracking diagnostics"}</h2>
          </div>
          <button ref={closeRef} type="button" className="btn-secondary min-h-9 justify-center gap-1.5 px-3 text-xs" onClick={onClose}><X className="h-4 w-4" />{language === "th" ? "ปิด" : "Close"}</button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-5">
          <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:px-5">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">{copy.accuracyTitle}</summary>
            <section className="mt-4 space-y-4" aria-label={copy.accuracyTitle}>
              <div className="space-y-2 text-xs leading-5 text-slate-600">
                <p>{copy.accuracyIntro}</p>
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950"><strong>{copy.accuracyActivityStatus}:</strong> {copy.accuracyActivityNotMapped} {copy.accuracyActivityDerived}</p>
                <p>{copy.accuracySignalExplanation}</p>
                <p>{copy.accuracySpeedUnitNote}</p>
              </div>
              <label className="block max-w-lg">
                <span className="sr-only">{copy.accuracySearch}</span>
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={accuracySearch}
                    onChange={(event) => onAccuracySearchChange(event.target.value)}
                    placeholder={copy.accuracySearchPlaceholder}
                    aria-label={copy.accuracySearch}
                    className="min-h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  />
                </span>
              </label>
              <p className="text-[11px] text-slate-500">{copy.showingVehicles} {accuracyRecords.length} {copy.ofVehicles} {summaryTotal} · {copy.lastSync}: {formatForthTrackingTime(data.fetchedAt, language) ?? copy.unknownValue}</p>
              {accuracyRecords.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">{copy.accuracyNoMatches}</p>
              ) : (
                <div className="space-y-2">
                  {accuracyRecords.map((record) => {
                    const comparisons = getForthAccuracyComparisons(record, data.fetchedAt);
                    const warnings = getForthNormalizationWarnings(record);
                    const key = recordKeysByReference.get(record) ?? getForthFleetRecordKey(record, 0);
                    return (
                      <details key={key} className="rounded-xl border border-slate-200 bg-slate-50/60">
                        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm font-semibold text-slate-800">
                          <span>{record.vehicleRegistration || copy.unknownValue} <span className="font-normal text-slate-500">· {record.gpsDeviceId || copy.unknownValue}</span></span>
                          <ActivityPill activity={getForthReportedActivity(record)} copy={copy} />
                        </summary>
                        <div className="grid gap-2 border-t border-slate-200 p-3 sm:grid-cols-2 xl:grid-cols-3">
                          {comparisons.map((comparison) => (
                            <div key={comparison.field} className="min-w-0 rounded-lg border border-slate-200 bg-white p-2.5">
                              <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-600">{accuracyFieldLabel(comparison.field, copy)}</h3>
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-semibold text-slate-500">{copy.accuracySourceColumn}</p>
                                  <p className="mb-1 break-all font-mono text-[10px] text-slate-400">
                                    {comparison.field === "activity_status" ? copy.accuracyActivityNotMapped : comparison.sourceField}
                                  </p>
                                  <div className="break-words text-xs text-slate-700">
                                    {comparison.source
                                      ? sourceAuditValue(comparison.source, copy)
                                      : comparison.field === "activity_status" ? copy.accuracyActivityNotMapped : copy.accuracyNotApplicable}
                                  </div>
                                </div>
                                <div className="min-w-0 border-l border-slate-100 pl-2">
                                  <p className="text-[10px] font-semibold text-slate-500">{copy.accuracyNormalizedColumn}</p>
                                  <p className="mt-2 break-words text-xs font-medium text-slate-800">
                                    {normalizedAccuracyValue(comparison.field, comparison.normalized, record, data.fetchedAt, copy, language)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="border-t border-slate-200 px-3 py-2.5 text-xs leading-5">
                          <strong className="text-slate-700">{copy.accuracyWarnings}: </strong>
                          {warnings.length
                            ? <span className="text-amber-900">{warnings.map((warning) => accuracyWarningLabel(warning, copy)).join(" · ")}</span>
                            : <span className="text-emerald-800">{copy.accuracyNoWarnings}</span>}
                        </div>
                      </details>
                    );
                  })}
                </div>
              )}
            </section>
          </details>
          <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:px-5">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">{copy.diagnosticAdvancedTitle}</summary>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-label={copy.diagnosticTitle}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">{copy.diagnosticTitle}</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{copy.diagnosticIntro}</p>
                </div>
                <button
                  ref={statusDiagnosticTriggerRef}
                  type="button"
                  className="btn-secondary shrink-0 justify-center gap-2"
                  onClick={onStartDiagnostic}
                  disabled={!diagnosticCanStart || statusDiagnosticConfirmationOpen}
                >
                  <Activity className={"h-4 w-4 " + (statusDiagnosticState === "running" ? "animate-pulse" : "")} />
                  {diagnosticButtonLabel}
                </button>
              </div>
              <p
                ref={statusDiagnosticMessageRef}
                tabIndex={-1}
                role={statusDiagnosticState === "failed" ? "alert" : "status"}
                aria-live={statusDiagnosticState === "failed" ? "assertive" : "polite"}
                className={"mt-3 rounded-xl border px-3 py-2 text-xs leading-5 " + diagnosticStateClass}
              >
                <strong>{diagnosticStateLabels[statusDiagnosticState]}:</strong> {diagnosticStatusBody}
              </p>
              {statusDiagnosticState === "completed" && statusDiagnostic?.error ? (
                <p className="mt-2 text-xs leading-5 text-amber-800" role="status">
                  {copy.diagnosticEndpointError} {statusDiagnostic.error}
                </p>
              ) : null}
              {statusDiagnostic ? (
                <div className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-600 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
                  <p><strong>{copy.diagnosticConnection}:</strong> {statusDiagnostic.connectionStatus}</p>
                  <p><strong>{copy.diagnosticRecords}:</strong> {statusDiagnostic.recordCount}</p>
                  <p><strong>{copy.communications}:</strong> {Object.entries(statusDiagnostic.communications).map(([key, count]) => `${key} ${count}`).join(" · ")}</p>
                  <p><strong>{copy.positionFreshness}:</strong> {Object.entries(statusDiagnostic.positionFreshness).map(([key, count]) => `${key} ${count}`).join(" · ")}</p>
                  <p><strong>{copy.gpsSignal}:</strong> {Object.entries(statusDiagnostic.gpsSignal).map(([key, count]) => `${key} ${count}`).join(" · ")}</p>
                  <p><strong>{copy.positionQuality}:</strong> {Object.entries(statusDiagnostic.positionQuality).map(([key, count]) => `${key} ${count}`).join(" · ")}</p>
                  <p><strong>{copy.speedAvailability}:</strong> {Object.entries(statusDiagnostic.speedAvailability).map(([key, count]) => `${key} ${count}`).join(" · ")}</p>
                  <p><strong>{copy.engine}:</strong> {Object.entries(statusDiagnostic.engineState).map(([key, count]) => `${key} ${count}`).join(" · ")}</p>
                  <p><strong>{copy.diagnosticSourceShape}:</strong> {Object.entries(statusDiagnostic.positionSourceShape.canonicalField).map(([key, count]) => `${key.replaceAll("_", " ")} ${count}`).join(" · ")}</p>
                  <p><strong>{copy.diagnosticAlternateSources}:</strong> {statusDiagnostic.positionSourceShape.alternateCandidateRecords} records; {Object.entries(statusDiagnostic.positionSourceShape.alternateCandidateValues).map(([key, count]) => `${key.replaceAll("_", " ")} ${count}`).join(" · ")}</p>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <p><strong>{copy.diagnosticUnknownSourceLabels}:</strong> {statusDiagnostic.unknownPositionSourceStrings.unknownStringCount} unknown string occurrences; {statusDiagnostic.unknownPositionSourceStrings.returnedUniqueCount} unique labels returned; {statusDiagnostic.unknownPositionSourceStrings.notListedOccurrences} occurrences omitted by the list limit; {statusDiagnostic.unknownPositionSourceStrings.rejectedOccurrences} values filtered by safety limits.</p>
                    <p className="text-[11px] text-slate-500">{copy.diagnosticUnknownSourceNote}</p>
                    {statusDiagnostic.unknownPositionSourceStrings.labels.length ? (
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {statusDiagnostic.unknownPositionSourceStrings.labels.map((entry, index) => (
                          <li key={index}><code className="break-all font-mono text-[11px]">{entry.label}</code> · {entry.occurrences}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <p className="sm:col-span-2 lg:col-span-3"><strong>{copy.diagnosticClassification}:</strong> {Object.entries(statusDiagnostic.classificationReason).filter(([, count]) => count > 0).map(([key, count]) => `${key.replaceAll("_", " ")} ${count}`).join(" · ") || "—"}</p>
                </div>
              ) : null}
              {statusDiagnosticConfirmationOpen ? (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 p-4">
                  <div
                    ref={statusDiagnosticDialogRef}
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="forth-status-diagnostic-dialog-title"
                    aria-describedby="forth-status-diagnostic-dialog-description"
                    className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
                  >
                    <h3 id="forth-status-diagnostic-dialog-title" className="text-base font-bold text-slate-950">
                      {copy.diagnosticDialogTitle}
                    </h3>
                    <p id="forth-status-diagnostic-dialog-description" className="mt-2 text-sm leading-6 text-slate-600">
                      {copy.diagnosticDialogBody}
                    </p>
                    <div className="mt-5 flex flex-wrap justify-end gap-2">
                      <button ref={statusDiagnosticCancelRef} type="button" className="btn-secondary justify-center" onClick={onCancelDiagnostic}>
                        {copy.diagnosticDialogCancel}
                      </button>
                      <button type="button" className="btn-primary justify-center" onClick={onConfirmDiagnostic}>
                        {copy.diagnosticDialogRun}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          </details>
        </div>
      </aside>
    </div>
  );
}
