"use client";

import dynamic from "next/dynamic";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  List,
  MapPin,
  MapPinned,
  RefreshCw,
  Signal,
  SignalZero,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import layoutStyles from "./forth-tracking-centre.module.css";
import { FORTH_TRACKING_COPY } from "@/components/forth-tracking-copy";
import { ForthTrackingDiagnostics, type StatusDiagnosticResult, type StatusDiagnosticUiState } from "@/components/forth-tracking-diagnostics";
import { ForthTrackingInspector } from "@/components/forth-tracking-inspector";
import { JourneyHistoryPanel } from "@/components/forth-tracking-journey";
import { ForthTrackingVehicleRail } from "@/components/forth-tracking-vehicle-rail";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "@/lib/language-provider";
import { useAccountAccess } from "@/lib/use-account-access";
import {
  createForthStatusDiagnosticRunner,
  FORTH_STATUS_DIAGNOSTIC_SESSION_KEY,
  type ForthStatusDiagnosticFailure,
  type ForthStatusDiagnosticOutcome
} from "@/lib/forth-status-diagnostic-client";
import {
  canFocusForthMapRecord,
  filterForthFleetRecords,
  formatForthRelativeAge,
  formatForthTrackingTime,
  findForthFleetRecord,
  getForthFleetRecordKey,
  sortForthFleetRecords,
  summarizeForthFleet
} from "@/lib/forth-tracking-view";
import type { ForthFleetTrackingData, ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import type { ForthSourceFieldSnapshot } from "@/lib/forth-tracking";

const ForthTrackingMap = dynamic(
  () => import("@/components/forth-tracking-map").then((module) => module.ForthTrackingMap),
  { ssr: false, loading: () => <div className="min-h-0 flex-1 animate-pulse bg-slate-100" /> }
);

const POLL_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

type TrackingRequestFailure = "session" | "authorization" | "timeout" | "upstream" | "invalid_response" | "network";
type MapViewCommand = { type: "fit" | "focus"; sequence: number; key?: string | null };
type StatusDiagnosticRunner = {
  run(): Promise<ForthStatusDiagnosticOutcome<StatusDiagnosticResult>>;
  isAttemptUsed(): boolean;
};

const SOURCE_AUDIT_FIELDS = ["registration", "deviceId", "driver", "latitude", "longitude", "speed", "engine", "heading", "gpsSignal", "gprs", "positionSource", "positionTimestamp"] as const;

function isSourceFieldSnapshot(value: unknown): value is ForthSourceFieldSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return ["missing", "null", "empty", "string", "number", "boolean", "unsupported"].includes(String(snapshot.shape)) &&
    (snapshot.value === null || typeof snapshot.value === "string" || typeof snapshot.value === "boolean" || (typeof snapshot.value === "number" && Number.isFinite(snapshot.value))) &&
    typeof snapshot.truncated === "boolean";
}

function isFleetTrackingData(value: unknown): value is ForthFleetTrackingData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return ["not_configured", "connected", "failed"].includes(String(data.connectionStatus)) &&
    Array.isArray(data.records) &&
    data.records.every((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const sourceAudit = (entry as Record<string, unknown>).sourceAudit;
      if (!sourceAudit || typeof sourceAudit !== "object" || Array.isArray(sourceAudit)) return false;
      const source = sourceAudit as Record<string, unknown>;
      const record = entry as Record<string, unknown>;
      const validLocationText = (field: string) => record[field] === null ||
        (typeof record[field] === "string" && Array.from(record[field] as string).length <= 240);
      return SOURCE_AUDIT_FIELDS.every((field) => isSourceFieldSnapshot(source[field])) &&
        validLocationText("locationAddressEnglish") &&
        validLocationText("locationAddressThai") &&
        validLocationText("locationPointOfInterest");
    }) &&
    (data.fetchedAt === null || typeof data.fetchedAt === "string");
}

function isCountObject(value: unknown): value is Record<string, number> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((count) => Number.isInteger(count) && Number(count) >= 0);
}

function isStatusDiagnosticResult(value: unknown): value is StatusDiagnosticResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  const unknownSourceStrings = result.unknownPositionSourceStrings;
  const unknownSourceShape = unknownSourceStrings && typeof unknownSourceStrings === "object"
    ? unknownSourceStrings as Record<string, unknown>
    : null;
  return ["connected", "failed", "not_configured"].includes(String(result.connectionStatus)) &&
    Number.isInteger(result.recordCount) && Number(result.recordCount) >= 0 &&
    isCountObject(result.communications) &&
    isCountObject(result.positionFreshness) &&
    isCountObject(result.gpsSignal) &&
    isCountObject(result.positionQuality) &&
    isCountObject(result.speedAvailability) &&
    isCountObject(result.engineState) &&
    isCountObject(result.classificationReason) &&
    Boolean(result.positionSourceShape) &&
    typeof result.positionSourceShape === "object" &&
    isCountObject((result.positionSourceShape as Record<string, unknown>).canonicalField) &&
    Number.isInteger((result.positionSourceShape as Record<string, unknown>).alternateCandidateRecords) &&
    Number((result.positionSourceShape as Record<string, unknown>).alternateCandidateRecords) >= 0 &&
    isCountObject((result.positionSourceShape as Record<string, unknown>).alternateCandidateValues) &&
    Boolean(unknownSourceShape) &&
    Number.isInteger(unknownSourceShape!.unknownStringCount) &&
    Number(unknownSourceShape!.unknownStringCount) >= 0 &&
    Number.isInteger(unknownSourceShape!.returnedUniqueCount) &&
    Number(unknownSourceShape!.returnedUniqueCount) >= 0 &&
    Number(unknownSourceShape!.returnedUniqueCount) <= 20 &&
    Number.isInteger(unknownSourceShape!.notListedOccurrences) &&
    Number(unknownSourceShape!.notListedOccurrences) >= 0 &&
    Number.isInteger(unknownSourceShape!.rejectedOccurrences) &&
    Number(unknownSourceShape!.rejectedOccurrences) >= 0 &&
    Array.isArray(unknownSourceShape!.labels) &&
    unknownSourceShape!.labels.length <= 20 &&
    unknownSourceShape!.labels.every((entry) =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).label === "string" &&
      Array.from((entry as Record<string, unknown>).label as string).length <= 80 &&
      Number.isInteger((entry as Record<string, unknown>).occurrences) &&
      Number((entry as Record<string, unknown>).occurrences) > 0
    ) &&
    (result.error === null || typeof result.error === "string");
}

export function ForthTrackingCentre() {
  const { language } = useLanguage();
  const { can } = useAccountAccess();
  const copy = FORTH_TRACKING_COPY[language];
  const [data, setData] = useState<ForthFleetTrackingData | null>(null);
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState<string | null>(null);
  const [requestError, setRequestError] = useState(false);
  const [requestFailureReason, setRequestFailureReason] = useState<TrackingRequestFailure>("network");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [accuracySearch, setAccuracySearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"live" | "journey">("live");
  const [journeyVehicleKey, setJourneyVehicleKey] = useState<string | null>(null);
  const [journeyDate, setJourneyDate] = useState("");
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [showAllReportedPositions, setShowAllReportedPositions] = useState(false);
  const [clusterKeys, setClusterKeys] = useState<string[] | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [mapCommand, setMapCommand] = useState<MapViewCommand>({ type: "fit", sequence: 0 });
  const [statusDiagnostic, setStatusDiagnostic] = useState<StatusDiagnosticResult | null>(null);
  const [statusDiagnosticState, setStatusDiagnosticState] = useState<StatusDiagnosticUiState>("checking");
  const [statusDiagnosticFailure, setStatusDiagnosticFailure] = useState<{
    reason: ForthStatusDiagnosticFailure;
    attemptUsed: boolean;
    httpStatus?: number;
  } | null>(null);
  const [statusDiagnosticConfirmationOpen, setStatusDiagnosticConfirmationOpen] = useState(false);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const recordsRef = useRef<ForthFleetTrackingRecord[]>([]);
  const statusDiagnosticRunnerRef = useRef<StatusDiagnosticRunner | null>(null);
  const statusDiagnosticTriggerRef = useRef<HTMLButtonElement | null>(null);
  const diagnosticsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const diagnosticsCloseRef = useRef<HTMLButtonElement | null>(null);
  const diagnosticsDialogRef = useRef<HTMLElement | null>(null);
  const mobileListTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileListSearchRef = useRef<HTMLInputElement | null>(null);
  const mobileListDialogRef = useRef<HTMLElement | null>(null);
  const diagnosticsWasOpenRef = useRef(false);
  const mobileListWasOpenRef = useRef(false);
  const statusDiagnosticCancelRef = useRef<HTMLButtonElement | null>(null);
  const statusDiagnosticDialogRef = useRef<HTMLDivElement | null>(null);
  const statusDiagnosticMessageRef = useRef<HTMLParagraphElement | null>(null);
  const statusDiagnosticReturnFocusRef = useRef<HTMLElement | null>(null);
  const restoreStatusDiagnosticFocusRef = useRef(false);
  const statusDiagnosticConfirmationReturnStateRef = useRef<"ready" | "failed">("ready");
  const statusDiagnosticConfirmStartedRef = useRef(false);
  const statusDiagnosticInteractedRef = useRef(false);
  const lastGoodFleetDataRef = useRef<ForthFleetTrackingData | null>(null);

  useEffect(() => {
    if (diagnosticsOpen) {
      diagnosticsWasOpenRef.current = true;
      diagnosticsCloseRef.current?.focus();
    } else if (diagnosticsWasOpenRef.current) {
      diagnosticsWasOpenRef.current = false;
      diagnosticsTriggerRef.current?.focus();
    }
  }, [diagnosticsOpen]);

  useEffect(() => {
    if (mobileListOpen) {
      mobileListWasOpenRef.current = true;
      mobileListSearchRef.current?.focus();
    } else if (mobileListWasOpenRef.current) {
      mobileListWasOpenRef.current = false;
      mobileListTriggerRef.current?.focus();
    }
  }, [mobileListOpen]);

  useEffect(() => {
    if (!diagnosticsOpen && !mobileListOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (statusDiagnosticConfirmationOpen) return;
        if (diagnosticsOpen) setDiagnosticsOpen(false);
        else setMobileListOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [diagnosticsOpen, mobileListOpen, statusDiagnosticConfirmationOpen]);

  const focusVehicle = useCallback((key: string) => {
    setSelectedKey(key);
    setJourneyVehicleKey(key);
    setClusterKeys(null);
    setMobileListOpen(false);
    const record = findForthFleetRecord(recordsRef.current, key);
    if (record && canFocusForthMapRecord(record)) {
      setMapCommand((current) => ({ type: "focus", sequence: current.sequence + 1, key }));
    }
  }, []);

  const fitAllVehicles = () => {
    setSelectedKey(null);
    setClusterKeys(null);
    setMapCommand((current) => ({ type: "fit", sequence: current.sequence + 1 }));
  };

  const showOverlapGroup = (keys: string[]) => {
    setClusterKeys(keys);
  };

  if (!statusDiagnosticRunnerRef.current) {
    statusDiagnosticRunnerRef.current = createForthStatusDiagnosticRunner<StatusDiagnosticResult>({
      storage: {
        read: () => window.sessionStorage.getItem(FORTH_STATUS_DIAGNOSTIC_SESSION_KEY),
        write: (value) => window.sessionStorage.setItem(FORTH_STATUS_DIAGNOSTIC_SESSION_KEY, value)
      },
      getAccessToken: async () => {
        try {
          const { data: authData, error: authError } = await supabase.auth.getSession();
          return authError ? null : authData.session?.access_token ?? null;
        } catch {
          return null;
        }
      },
      isValidResult: isStatusDiagnosticResult
    });
  }
  const statusDiagnosticRunner = statusDiagnosticRunnerRef.current;

  useEffect(() => {
    setStatusDiagnosticState(statusDiagnosticRunner.isAttemptUsed() ? "previously_attempted" : "ready");
  }, [statusDiagnosticRunner]);

  useEffect(() => {
    if (statusDiagnosticConfirmationOpen) {
      statusDiagnosticCancelRef.current?.focus();
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setStatusDiagnosticConfirmationOpen(false);
          setStatusDiagnosticState(statusDiagnosticConfirmationReturnStateRef.current);
        }
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }
    if (restoreStatusDiagnosticFocusRef.current) {
      restoreStatusDiagnosticFocusRef.current = false;
      statusDiagnosticReturnFocusRef.current?.focus();
    }
  }, [statusDiagnosticConfirmationOpen]);

  useEffect(() => {
    if (statusDiagnosticInteractedRef.current &&
      ["completed", "failed", "previously_attempted"].includes(statusDiagnosticState)) {
      statusDiagnosticMessageRef.current?.focus();
    }
  }, [statusDiagnosticState]);

  const runStatusDiagnostic = async () => {
    if (!statusDiagnosticConfirmationOpen || statusDiagnosticConfirmStartedRef.current) return;
    statusDiagnosticConfirmStartedRef.current = true;
    restoreStatusDiagnosticFocusRef.current = false;
    setStatusDiagnosticConfirmationOpen(false);
    setStatusDiagnosticFailure(null);
    setStatusDiagnostic(null);
    setStatusDiagnosticState("running");

    try {
      const outcome = await statusDiagnosticRunner.run();
      if (outcome.kind === "completed") {
        setStatusDiagnostic(outcome.result);
        setStatusDiagnosticState("completed");
      } else if (outcome.reason === "already_attempted") {
        setStatusDiagnosticFailure({ reason: outcome.reason, attemptUsed: true });
        setStatusDiagnosticState("previously_attempted");
      } else {
        setStatusDiagnosticFailure({
          reason: outcome.reason,
          attemptUsed: outcome.attemptUsed,
          httpStatus: outcome.httpStatus
        });
        setStatusDiagnosticState("failed");
      }
    } catch {
      setStatusDiagnosticFailure({
        reason: "network_error",
        attemptUsed: statusDiagnosticRunner.isAttemptUsed()
      });
      setStatusDiagnosticState("failed");
    } finally {
      statusDiagnosticConfirmStartedRef.current = false;
    }
  };

  const openStatusDiagnosticConfirmation = () => {
    const mayStart = statusDiagnosticState === "ready" ||
      (statusDiagnosticState === "failed" && statusDiagnosticFailure?.attemptUsed === false);
    if (!mayStart) return;
    if (statusDiagnosticRunner.isAttemptUsed()) {
      setStatusDiagnosticState("previously_attempted");
      return;
    }
    statusDiagnosticInteractedRef.current = true;
    statusDiagnosticConfirmationReturnStateRef.current =
      statusDiagnosticState === "failed" ? "failed" : "ready";
    statusDiagnosticReturnFocusRef.current = statusDiagnosticTriggerRef.current;
    restoreStatusDiagnosticFocusRef.current = true;
    setStatusDiagnosticConfirmationOpen(true);
    setStatusDiagnosticState("awaiting_confirmation");
  };

  const cancelStatusDiagnosticConfirmation = () => {
    setStatusDiagnosticConfirmationOpen(false);
    setStatusDiagnosticState(statusDiagnosticConfirmationReturnStateRef.current);
  };

  const closeDiagnostics = () => {
    if (statusDiagnosticConfirmationOpen) cancelStatusDiagnosticConfirmation();
    setDiagnosticsOpen(false);
  };

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let requestController: AbortController | null = null;

    const load = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      requestController = new AbortController();
      let timedOut = false;
      let failureReason: TrackingRequestFailure = "network";
      const timeout = window.setTimeout(() => {
        timedOut = true;
        requestController?.abort();
      }, REQUEST_TIMEOUT_MS);
      setRefreshing(true);

      try {
        let authData: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"];
        let authError: Awaited<ReturnType<typeof supabase.auth.getSession>>["error"];
        try {
          ({ data: authData, error: authError } = await supabase.auth.getSession());
        } catch {
          failureReason = "session";
          throw new Error("session_unavailable");
        }
        if (authError || !authData.session?.access_token) {
          failureReason = "session";
          throw new Error("session_unavailable");
        }
        if (!active) return;

        const response = await fetch("/api/admin/forth-tracking/vehicles", {
          method: "GET",
          cache: "no-store",
          signal: requestController.signal,
          headers: { Authorization: `Bearer ${authData.session.access_token}` }
        });
        if (!response.ok) {
          failureReason = response.status === 401 || response.status === 403
            ? "authorization"
            : response.status >= 500 ? "upstream" : "network";
          throw new Error("request_unavailable");
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          failureReason = "invalid_response";
          throw new Error("invalid_response");
        }
        if (!isFleetTrackingData(payload)) {
          failureReason = "invalid_response";
          throw new Error("invalid_response");
        }
        if (active) {
          if (payload.connectionStatus === "connected") {
            lastGoodFleetDataRef.current = payload;
            if (payload.fetchedAt) setLastSuccessfulRefreshAt(payload.fetchedAt);
            setData(payload);
            setRequestError(false);
            setRequestFailureReason("network");
            setSelectedKey((current) => current && payload.records.some((record, index) => getForthFleetRecordKey(record, index) === current) ? current : null);
          } else if (lastGoodFleetDataRef.current) {
            setData(lastGoodFleetDataRef.current);
            setRequestError(true);
            setRequestFailureReason("upstream");
          } else {
            setData(payload);
            setRequestError(false);
            setRequestFailureReason("network");
          }
        }
      } catch {
        if (active) {
          setData(lastGoodFleetDataRef.current);
          setRequestError(true);
          setRequestFailureReason(timedOut ? "timeout" : failureReason);
          if (!lastGoodFleetDataRef.current) setSelectedKey(null);
        }
      } finally {
        window.clearTimeout(timeout);
        inFlight = false;
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    refreshRef.current = load;
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      requestController?.abort();
    };
  }, []);

  const connected = data?.connectionStatus === "connected";
  const summary = useMemo(() => summarizeForthFleet(data?.records ?? []), [data?.records]);
  recordsRef.current = data?.records ?? [];
  const recordKeysByReference = useMemo(() => {
    const keys = new Map<ForthFleetTrackingRecord, string>();
    for (const [index, record] of (data?.records ?? []).entries()) {
      keys.set(record, getForthFleetRecordKey(record, index));
    }
    return keys;
  }, [data?.records]);
  const visibleRecords = useMemo(
    () => sortForthFleetRecords(filterForthFleetRecords(data?.records ?? [], search, "all"), "registration"),
    [data?.records, search]
  );
  const accuracyRecords = useMemo(() => {
    const query = accuracySearch.trim().toLocaleLowerCase();
    const records = data?.records ?? [];
    return sortForthFleetRecords(records.filter((record) => {
      if (!query) return true;
      return [
        record.vehicleRegistration,
        record.gpsDeviceId,
        record.reportedDriver,
        typeof record.sourceAudit.registration.value === "string" ? record.sourceAudit.registration.value : null,
        typeof record.sourceAudit.deviceId.value === "string" ? record.sourceAudit.deviceId.value : null
      ].some((value) => value?.toLocaleLowerCase().includes(query));
    }), "registration");
  }, [accuracySearch, data?.records]);
  const selectedRecord = useMemo(() => {
    if (!data || !selectedKey) return null;
    return findForthFleetRecord(data.records, selectedKey);
  }, [data, selectedKey]);
  const lastChecked = formatForthTrackingTime(
    lastSuccessfulRefreshAt ?? (data?.connectionStatus === "connected" ? data.fetchedAt : null),
    language
  );
  const lastRefreshAge = formatForthRelativeAge(
    lastSuccessfulRefreshAt ?? (data?.connectionStatus === "connected" ? data.fetchedAt : null),
    Date.now(),
    language
  );
  const timezoneUnconfigured = (data?.records ?? []).some((record) => record.timestampStatus === "timezone_unconfigured");
  const timestampInterpretationUnavailable = (data?.records ?? []).some((record) =>
    record.timestampStatus === "timezone_invalid" || record.timestampStatus === "timezone_ambiguous" || record.timestampStatus === "invalid"
  );
  const timeQualityMessage = connected && (timezoneUnconfigured || timestampInterpretationUnavailable)
    ? timezoneUnconfigured ? copy.timezoneUnavailableBanner : copy.timestampUnavailableBanner
    : null;
  const mapCopy = useMemo(() => ({
    gpsVerified: copy.gpsPositionVerified,
    notGpsVerified: copy.gpsPositionUnverified,
    gpsConfidenceUnavailable: copy.gpsConfidenceUnavailable,
    groupVehicles: copy.overlapVehicles,
    expandGroup: copy.selectOverlapGroup,
    unknownValue: copy.unknownValue,
    noPositions: copy.noPositions,
    loading: copy.mapLoading,
    mapUnavailable: copy.mapUnavailable,
    mapRegionLabel: copy.mapRegionLabel
  }), [copy]);

  const trackingMessage = requestError
    ? requestFailureReason === "session"
      ? copy.requestSessionFailure
      : requestFailureReason === "authorization"
        ? copy.requestAuthorizationFailure
        : requestFailureReason === "timeout"
          ? copy.requestTimeoutFailure
          : requestFailureReason === "upstream"
            ? copy.requestUpstreamFailure
            : requestFailureReason === "invalid_response"
              ? copy.requestInvalidResponseFailure
              : copy.requestFailure
    : data?.error?.message ?? copy.failureBody;
  const diagnosticStateLabels: Record<StatusDiagnosticUiState, string> = {
    checking: copy.diagnosticStateChecking,
    ready: copy.diagnosticStateReady,
    awaiting_confirmation: copy.diagnosticStateAwaiting,
    running: copy.diagnosticStateRunning,
    completed: copy.diagnosticStateCompleted,
    failed: copy.diagnosticStateFailed,
    previously_attempted: copy.diagnosticStatePreviouslyAttempted
  };
  const diagnosticStatusBody = statusDiagnosticState === "checking"
    ? copy.diagnosticStateChecking
    : statusDiagnosticState === "ready"
      ? copy.diagnosticReadyBody
      : statusDiagnosticState === "awaiting_confirmation"
        ? copy.diagnosticAwaitingBody
        : statusDiagnosticState === "running"
          ? copy.diagnosticRunningBody
          : statusDiagnosticState === "completed"
            ? copy.diagnosticCompletedBody
            : statusDiagnosticState === "previously_attempted"
              ? copy.diagnosticPreviouslyAttemptedBody
              : statusDiagnosticFailure?.reason === "session_unavailable"
                ? copy.diagnosticSessionError
                : statusDiagnosticFailure?.reason === "unauthorized"
                  ? copy.diagnosticUnauthorizedError
                  : statusDiagnosticFailure?.reason === "forbidden"
                    ? copy.diagnosticForbiddenError
                    : statusDiagnosticFailure?.reason === "http_error"
                      ? copy.diagnosticHttpError + (statusDiagnosticFailure.httpStatus ? " (HTTP " + statusDiagnosticFailure.httpStatus + ")" : "")
                      : statusDiagnosticFailure?.reason === "network_error"
                        ? copy.diagnosticNetworkError
                        : statusDiagnosticFailure?.reason === "invalid_response"
                          ? copy.diagnosticInvalidResponseError
                          : copy.diagnosticDuplicateError;
  const diagnosticCanStart = statusDiagnosticState === "ready" ||
    (statusDiagnosticState === "failed" && statusDiagnosticFailure?.attemptUsed === false);
  const diagnosticButtonLabel = statusDiagnosticState === "checking"
    ? copy.diagnosticStateChecking + "…"
    : statusDiagnosticState === "awaiting_confirmation"
      ? copy.diagnosticStateAwaiting
      : statusDiagnosticState === "running"
        ? copy.diagnosticStateRunning + "…"
        : statusDiagnosticState === "completed"
          ? copy.diagnosticStateCompleted
          : statusDiagnosticState === "previously_attempted" ||
              (statusDiagnosticState === "failed" && statusDiagnosticFailure?.attemptUsed)
            ? copy.diagnosticStatePreviouslyAttempted
            : statusDiagnosticState === "failed"
              ? copy.diagnosticRetryButton
              : copy.diagnosticButton;
  const diagnosticStateClass = statusDiagnosticState === "completed"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : statusDiagnosticState === "failed" || statusDiagnosticState === "previously_attempted"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : statusDiagnosticState === "running" || statusDiagnosticState === "awaiting_confirmation"
        ? "border-violet-200 bg-violet-50 text-violet-800"
        : "border-slate-200 bg-slate-50 text-slate-700";

  const clusterRecords = clusterKeys
    ? clusterKeys.flatMap((key) => {
      const record = findForthFleetRecord(data?.records ?? [], key);
      return record ? [{ key, record }] : [];
    })
    : [];

  const selectFirstSearchMatch = () => {
    const first = visibleRecords[0];
    const key = first ? recordKeysByReference.get(first) : null;
    if (key) focusVehicle(key);
  };

  return (
    <main className="forth-tracking-workspace mx-auto flex w-full max-w-none flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-200 bg-white px-3 py-1.5">
        <div className="min-w-0">
          <h1 className="text-base font-bold tracking-tight text-slate-950 sm:text-lg">{copy.title}</h1>
          <p className="hidden text-[10px] text-slate-500 sm:block">
            {copy.trackedVehiclesCount}: {summary.total}
            {connected ? ` · ${copy.gpsPositionCount}: ${summary.positionConfidence.gpsVerified} · ${copy.reportedMovingCount}: ${summary.reportedActivity.driving}` : ""}
            {lastRefreshAge ? ` · ${copy.lastSync} ${lastRefreshAge}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <nav aria-label={language === "th" ? "มุมมองการติดตาม" : "Tracking views"} className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button type="button" aria-pressed={activeView === "live"} onClick={() => setActiveView("live")} className={`min-h-8 rounded-md px-2.5 text-[11px] font-semibold ${activeView === "live" ? "bg-white text-violet-800 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{copy.liveFleetView}</button>
            <button type="button" aria-pressed={activeView === "journey"} onClick={() => { if (selectedKey) setJourneyVehicleKey(selectedKey); setActiveView("journey"); }} className={`min-h-8 rounded-md px-2.5 text-[11px] font-semibold ${activeView === "journey" ? "bg-white text-violet-800 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{copy.journeyHistoryView}</button>
          </nav>
          <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${requestError ? "border-amber-200 bg-amber-50 text-amber-900" : connected ? "border-emerald-200 bg-emerald-50 text-emerald-800" : data?.connectionStatus === "not_configured" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600"}`}>
            {requestError ? <AlertTriangle className="h-4 w-4" /> : connected ? <CheckCircle2 className="h-4 w-4" /> : data?.connectionStatus === "not_configured" ? <AlertTriangle className="h-4 w-4" /> : <Signal className="h-4 w-4" />}
            {requestError ? copy.unavailable : connected ? copy.connected : data?.connectionStatus === "not_configured" ? copy.disconnected : data?.connectionStatus === "failed" ? copy.unavailable : copy.mapLoading}
          </span>
          <button type="button" className="btn-secondary min-h-9 justify-center gap-1.5 px-2.5 py-1 text-[11px]" onClick={() => void refreshRef.current()} disabled={refreshing || loading}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? copy.refreshing : copy.refresh}
          </button>
          {connected && !requestError && can("business:read") ? <button ref={diagnosticsTriggerRef} type="button" className="btn-secondary min-h-9 justify-center gap-1.5 px-2.5 py-1 text-[11px]" onClick={() => setDiagnosticsOpen(true)}>
            <Activity className="h-3.5 w-3.5" />{language === "th" ? "การวินิจฉัย" : "Diagnostics"}
          </button> : null}
        </div>
      </header>

      {activeView === "journey" ? (
        <JourneyHistoryPanel
          records={data?.records ?? []}
          selectedKey={journeyVehicleKey ?? selectedKey}
          selectedDate={journeyDate}
          onSelectVehicle={(key) => { setJourneyVehicleKey(key); focusVehicle(key); }}
          onDateChange={setJourneyDate}
          onReturnToFleet={() => setActiveView("live")}
          language={language}
        />
      ) : (
        <>
          {data?.connectionStatus === "not_configured" || data?.connectionStatus === "failed" || requestError ? (
            <section className={`forth-tracking-alert flex shrink-0 items-center gap-2 border-b px-3 py-1.5 ${requestError && connected ? "border-amber-200 bg-amber-50/80" : data?.connectionStatus === "not_configured" ? "border-amber-200 bg-amber-50/80" : "border-rose-200 bg-rose-50/80"}`} role="status">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${data?.connectionStatus === "not_configured" || requestError && connected ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
                {data?.connectionStatus === "not_configured" ? <SignalZero className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              </span>
              <div className="min-w-0 text-[11px] leading-4 text-slate-700">
                <strong className="mr-1 text-slate-900">{data?.connectionStatus === "not_configured" ? copy.configurationTitle : copy.failureTitle}</strong>
                <span>{data?.connectionStatus === "not_configured" ? copy.configurationBody : trackingMessage}</span>
                {requestError && lastChecked ? <span className="ml-1 text-slate-600">{copy.refreshFailedSnapshot} {lastChecked}</span> : null}
              </div>
            </section>
          ) : null}

          {timeQualityMessage ? <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] leading-4 text-amber-950" role="status">{timeQualityMessage}</div> : null}

          <div className={`${layoutStyles.stage} forth-tracking-grid`}>
            {connected ? (
              <ForthTrackingMap records={data?.records ?? []} selectedKey={selectedKey} onSelect={focusVehicle} onOverlapGroup={showOverlapGroup} command={mapCommand} showAllReportedPositions={showAllReportedPositions} language={language} copy={mapCopy} />
            ) : (
              <div className="forth-map-viewport flex h-full flex-col items-center justify-center bg-slate-50 px-5 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-violet-700 shadow-sm"><MapPin className="h-7 w-7" /></span>
                <p className="mt-4 max-w-sm text-sm font-medium leading-6 text-slate-600">{data?.connectionStatus === "not_configured" ? copy.configurationBody : copy.noPositions}</p>
              </div>
            )}

            <div className="pointer-events-none absolute right-3 top-3 z-[510] flex flex-wrap justify-end gap-1.5">
              <label className="pointer-events-auto inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm">
                <input type="checkbox" checked={showAllReportedPositions} onChange={(event) => setShowAllReportedPositions(event.target.checked)} className="h-4 w-4 accent-violet-700" />
                {copy.showAllReportedPositions}
              </label>
              <button type="button" className="pointer-events-auto btn-secondary min-h-9 justify-center gap-1 bg-white/95 px-2.5 py-1 text-[11px] shadow-sm" onClick={fitAllVehicles}>
                <MapPinned className="h-4 w-4" />{copy.resetOperatingArea}
              </button>
            </div>

            {clusterRecords.length > 0 ? (
              <div className={layoutStyles.clusterPicker} role="dialog" aria-label={copy.clusterPickerTitle}>
                <div className="flex items-start justify-between gap-2 px-2.5 pt-2">
                  <div>
                    <p className="text-xs font-bold text-slate-950">{copy.clusterPickerTitle}</p>
                    <p className="mt-0.5 text-[10px] leading-4 text-slate-600">{copy.clusterPickerHint}</p>
                  </div>
                  <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label={copy.clearOverlap} onClick={() => setClusterKeys(null)}><X className="h-4 w-4" /></button>
                </div>
                <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto p-1.5">
                  {clusterRecords.map(({ key, record }) => (
                    <li key={key}>
                      <button type="button" onClick={() => focusVehicle(key)} className="w-full rounded-md px-2 py-1.5 text-left text-[12px] font-semibold hover:bg-slate-50">
                        {record.vehicleRegistration || copy.unknownValue}
                        <span className="ml-2 font-normal text-slate-500">{record.speed === null ? "—" : record.speed}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {selectedRecord && !mobileListOpen ? (
              <div className={layoutStyles.mobileInspector}>
                <ForthTrackingInspector
                  record={selectedRecord}
                  copy={copy}
                  language={language}
                  onClose={() => setSelectedKey(null)}
                  onOpenJourney={() => { setJourneyVehicleKey(selectedKey); setActiveView("journey"); }}
                />
              </div>
            ) : null}

            {mobileListOpen ? <button type="button" className="fixed inset-0 z-[515] bg-slate-950/30 lg:hidden" aria-label={copy.closeVehiclesSheet} onClick={() => setMobileListOpen(false)} /> : null}

            <ForthTrackingVehicleRail
              className={`${layoutStyles.rail} ${mobileListOpen ? layoutStyles.railOpen : ""}`}
              copy={copy}
              language={language}
              connected={connected}
              loading={loading}
              requestError={requestError}
              connectionStatus={data?.connectionStatus}
              open={mobileListOpen}
              total={summary.total}
              visibleRecords={visibleRecords}
              recordKeysByReference={recordKeysByReference}
              selectedKey={selectedKey}
              selectedRecord={selectedRecord}
              showInspector
              search={search}
              searchRef={mobileListSearchRef}
              dialogRef={mobileListDialogRef}
              onSearchChange={setSearch}
              onSearchSubmit={selectFirstSearchMatch}
              onSelect={focusVehicle}
              onCloseSheet={() => setMobileListOpen(false)}
              onClearSelection={() => setSelectedKey(null)}
              onOpenJourney={() => { setJourneyVehicleKey(selectedKey); setActiveView("journey"); setMobileListOpen(false); }}
            />

            <button ref={mobileListTriggerRef} type="button" className={`${layoutStyles.sheetToggle} btn-secondary min-h-10 justify-center gap-1 bg-white px-3 text-xs shadow-md`} onClick={() => setMobileListOpen(true)} aria-expanded={mobileListOpen} aria-controls="forth-vehicle-list">
              <List className="h-4 w-4" />{copy.openVehiclesSheet}
            </button>
          </div>
        </>
      )}

      {connected && !requestError && can("business:read") && diagnosticsOpen && data ? (
        <ForthTrackingDiagnostics
          copy={copy}
          language={language}
          data={data}
          accuracySearch={accuracySearch}
          onAccuracySearchChange={setAccuracySearch}
          accuracyRecords={accuracyRecords}
          recordKeysByReference={recordKeysByReference}
          summaryTotal={summary.total}
          dialogRef={diagnosticsDialogRef}
          closeRef={diagnosticsCloseRef}
          statusDiagnosticTriggerRef={statusDiagnosticTriggerRef}
          statusDiagnosticMessageRef={statusDiagnosticMessageRef}
          statusDiagnosticCancelRef={statusDiagnosticCancelRef}
          statusDiagnosticDialogRef={statusDiagnosticDialogRef}
          statusDiagnostic={statusDiagnostic}
          statusDiagnosticState={statusDiagnosticState}
          diagnosticStateLabels={diagnosticStateLabels}
          diagnosticStatusBody={diagnosticStatusBody}
          diagnosticStateClass={diagnosticStateClass}
          diagnosticCanStart={diagnosticCanStart}
          diagnosticButtonLabel={diagnosticButtonLabel}
          statusDiagnosticConfirmationOpen={statusDiagnosticConfirmationOpen}
          onClose={closeDiagnostics}
          onStartDiagnostic={openStatusDiagnosticConfirmation}
          onCancelDiagnostic={cancelStatusDiagnosticConfirmation}
          onConfirmDiagnostic={() => void runStatusDiagnostic()}
        />
      ) : null}
    </main>
  );
}
