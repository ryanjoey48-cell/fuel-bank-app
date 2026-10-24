"use client";

import { History, MapPinned } from "lucide-react";
import { FORTH_TRACKING_COPY } from "@/components/forth-tracking-copy";
import { getForthFleetRecordKey } from "@/lib/forth-tracking-view";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";

export function JourneyHistoryPanel({
  records,
  selectedKey,
  selectedDate,
  onSelectVehicle,
  onDateChange,
  onReturnToFleet,
  language
}: {
  records: ForthFleetTrackingRecord[];
  selectedKey: string | null;
  selectedDate: string;
  onSelectVehicle: (key: string) => void;
  onDateChange: (date: string) => void;
  onReturnToFleet: () => void;
  language: "en" | "th";
}) {
  const copy = FORTH_TRACKING_COPY[language];
  const vehicles = records.map((record, index) => ({
    key: getForthFleetRecordKey(record, index),
    label: record.vehicleRegistration || record.gpsDeviceId || copy.unknownValue
  }));
  const selectedVehicle = vehicles.find(({ key }) => key === selectedKey) ?? vehicles[0];

  return (
    <section className="surface-card min-h-0 flex-1 overflow-y-auto p-4 sm:p-6" aria-labelledby="forth-journey-history-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-violet-700">{copy.journeyHistoryView}</p>
          <h2 id="forth-journey-history-title" className="mt-1 text-xl font-bold tracking-tight text-slate-950">{copy.journeyHistoryTitle}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-slate-600">{copy.journeyHistoryDescription}</p>
        </div>
        <button type="button" onClick={onReturnToFleet} className="btn-secondary min-h-10 justify-center gap-2 px-3 text-xs">
          <MapPinned className="h-4 w-4" />{copy.liveFleetView}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-slate-700">
          {copy.journeyVehicle}
          <select
            value={selectedVehicle?.key ?? ""}
            onChange={(event) => onSelectVehicle(event.target.value)}
            disabled={vehicles.length === 0}
            className="min-h-11 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-50"
          >
            {vehicles.length === 0 ? <option value="">{copy.noVehicles}</option> : null}
            {vehicles.map((vehicle) => <option key={vehicle.key} value={vehicle.key}>{vehicle.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-700">
          {copy.journeyDate}
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => onDateChange(event.target.value)}
            className="min-h-11 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
        </label>
      </div>

      <div role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
        <h3 className="font-bold">{copy.journeyVerificationTitle}</h3>
        <p className="mt-1">{copy.journeyVerificationBody}</p>
        <p className="mt-1 font-semibold">{copy.journeyNoRequests}</p>
        <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
          <li><code>POST /api/vehicle/trips</code></li>
          <li><code>POST /api/vehicle/tripDetails</code></li>
          <li><code>POST /api/vehicle/parkingTrip</code></li>
          <li><code>POST /api/vehicle/parkingEngineOverTheLimits</code></li>
        </ul>
      </div>

      <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
        <History className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
        <h3 className="mt-2 text-sm font-bold text-slate-800">{copy.journeyEmptyTitle}</h3>
        <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-slate-600">{copy.journeyEmptyBody}</p>
      </div>
    </section>
  );
}
