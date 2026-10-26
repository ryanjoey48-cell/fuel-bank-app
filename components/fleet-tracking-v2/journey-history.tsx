"use client";

import { useState, type FormEvent } from "react";
import { Clock3, LoaderCircle, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { FORTH_HISTORY_LIVE_REQUESTS_ENABLED } from "@/lib/forth-history-live-gate";
import { parseForthTripsResponse, type ForthTripRecord } from "@/lib/forth-history-contract";
import type { FleetTrackingV2LiveVehicle } from "@/lib/fleet-tracking-v2/live-adapter";
import styles from "./live-workspace.module.css";

type Copy = {
  journeyHistory: string;
  chooseReportDay: string;
  historyTimezoneNote: string;
  historyAwaitingApproval: string;
  loadJourneyHistory: string;
  journeyNoRecords: string;
  journeyOrigin: string;
  journeyDestination: string;
  journeyTravelTimeRaw: string;
  historyLoading: string;
  historyFailed: string;
};

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; records: ForthTripRecord[] };

function shown(value: string | null) {
  return value === null || value === "" ? "—" : value;
}

export function JourneyHistoryPanel({ vehicle, language, copy }: {
  vehicle: FleetTrackingV2LiveVehicle;
  language: "en" | "th";
  copy: Copy;
}) {
  const [date, setDate] = useState("");
  const [state, setState] = useState<LoadState>({ status: "idle" });

  async function loadHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!FORTH_HISTORY_LIVE_REQUESTS_ENABLED || !vehicle.deviceId || !date) return;
    setState({ status: "loading" });
    try {
      const sessionResult = await supabase.auth.getSession();
      if (sessionResult.error) throw new Error(copy.historyFailed);
      const token = sessionResult.data.session?.access_token;
      if (!token) throw new Error(copy.historyFailed);
      const response = await fetch("/api/admin/forth-tracking/history/journeys", {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: vehicle.deviceId, date, language })
      });
      const payload: unknown = await response.json().catch(() => null);
      const envelope = payload !== null && typeof payload === "object" && !Array.isArray(payload)
        ? payload as { records?: unknown; error?: unknown }
        : {};
      if (!response.ok) {
        throw new Error(typeof envelope.error === "string" ? envelope.error : copy.historyFailed);
      }
      const result = parseForthTripsResponse(envelope.records);
      if (!result.ok) throw new Error(copy.historyFailed);
      setState({ status: "ready", records: result.records });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error && error.message ? error.message : copy.historyFailed });
    }
  }

  return (
    <section className={styles.journeyPanel} aria-label={copy.journeyHistory}>
      <h3><Clock3 size={14} />{copy.journeyHistory}</h3>
      <form className={styles.journeyForm} onSubmit={loadHistory}>
        <label>
          <span>{copy.chooseReportDay}</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <button type="submit" disabled={!FORTH_HISTORY_LIVE_REQUESTS_ENABLED || !vehicle.deviceId || !date || state.status === "loading"}>
          {state.status === "loading" ? <LoaderCircle size={14} className={styles.journeySpinner} /> : <Search size={14} />}
          {state.status === "loading" ? copy.historyLoading : copy.loadJourneyHistory}
        </button>
      </form>
      <p className={styles.journeyNote}>{copy.historyTimezoneNote}</p>
      {!FORTH_HISTORY_LIVE_REQUESTS_ENABLED ? <p className={styles.journeyGate}>{copy.historyAwaitingApproval}</p> : null}
      {state.status === "error" ? <p className={styles.journeyError} role="alert">{state.message}</p> : null}
      {state.status === "ready" && state.records.length === 0 ? <p className={styles.journeyEmpty}>{copy.journeyNoRecords}</p> : null}
      {state.status === "ready" && state.records.length > 0 ? (
        <ol className={styles.journeyRows}>
          {state.records.map((record, index) => (
            <li key={`${record.boxId ?? vehicle.deviceId}-${record.rDate ?? date}-${index}`}>
              <div className={styles.journeyRowHead}><strong>{shown(record.rDate)}</strong><span>{shown(record.driver)}</span></div>
              <div><span>{copy.journeyOrigin}</span><strong>{shown(record.source)}</strong></div>
              <div><span>{shown(record.arriveTime)} · {shown(record.departTime)}</span><strong>{copy.journeyDestination}: {shown(record.destination)}</strong></div>
              <div><span>{shown(record.arriveDestinationTime)} · {shown(record.departDestinationTime)}</span><strong>{copy.journeyTravelTimeRaw}: {shown(record.routingTime)}</strong></div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
