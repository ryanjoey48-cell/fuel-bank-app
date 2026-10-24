"use client";

import { Search, X } from "lucide-react";
import type { RefObject } from "react";
import type { ForthTrackingCopy } from "@/components/forth-tracking-copy";
import { ForthTrackingInspector } from "@/components/forth-tracking-inspector";
import { FleetVehicleRow } from "@/components/forth-tracking-ui";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";

type Props = {
  className?: string;
  copy: ForthTrackingCopy;
  language: "en" | "th";
  connected: boolean;
  loading: boolean;
  requestError: boolean;
  connectionStatus?: "connected" | "failed" | "not_configured";
  open: boolean;
  total: number;
  visibleRecords: ForthFleetTrackingRecord[];
  recordKeysByReference: Map<ForthFleetTrackingRecord, string>;
  selectedKey: string | null;
  selectedRecord: ForthFleetTrackingRecord | null;
  showInspector: boolean;
  search: string;
  searchRef: RefObject<HTMLInputElement | null>;
  dialogRef: RefObject<HTMLElement | null>;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onSelect: (key: string) => void;
  onCloseSheet: () => void;
  onClearSelection: () => void;
  onOpenJourney: () => void;
};

export function ForthTrackingVehicleRail({
  className,
  copy,
  language,
  connected,
  loading,
  requestError,
  connectionStatus,
  open,
  total,
  visibleRecords,
  recordKeysByReference,
  selectedKey,
  selectedRecord,
  showInspector,
  search,
  searchRef,
  dialogRef,
  onSearchChange,
  onSearchSubmit,
  onSelect,
  onCloseSheet,
  onClearSelection,
  onOpenJourney
}: Props) {
  return (
    <aside
      ref={dialogRef}
      id="forth-vehicle-list"
      className={`forth-vehicle-sidebar ${className ?? ""}`}
      aria-labelledby="forth-vehicle-list-title"
      role={open ? "dialog" : undefined}
      aria-modal={open ? true : undefined}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-2.5 pt-2.5">
        <div className="min-w-0">
          <h2 id="forth-vehicle-list-title" className="text-sm font-bold text-slate-950">{copy.listTitle}</h2>
          <p className="text-[10px] text-slate-500">{copy.showingVehicles} {visibleRecords.length} {copy.ofVehicles} {total}</p>
        </div>
        <button type="button" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label={copy.closeVehiclesSheet} onClick={onCloseSheet}>
          <X className="h-4 w-4" />
        </button>
      </div>

      {showInspector && selectedRecord ? (
        <ForthTrackingInspector
          record={selectedRecord}
          copy={copy}
          language={language}
          onClose={onClearSelection}
          onOpenJourney={onOpenJourney}
        />
      ) : null}

      <label className="forth-vehicle-controls relative mx-2.5 mt-2 block shrink-0">
        <span className="sr-only">{copy.search}</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={searchRef}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSearchSubmit();
            }
          }}
          placeholder={copy.search}
          type="search"
          className="min-h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
      </label>
      <p className="forth-vehicle-count mx-2.5 mt-1 shrink-0 text-[10px] text-slate-500">{copy.listDescription}</p>

      <div className="forth-vehicle-results mt-1 space-y-0.5 px-1.5 pb-2">
        {connected && visibleRecords.length === 0 && total === 0 ? <div className="px-3 py-6 text-center text-sm text-slate-500">{copy.noVehicles}</div> : null}
        {connected && total > 0 && visibleRecords.length === 0 ? <div className="px-3 py-6 text-center text-sm text-slate-500">{copy.noMatches}</div> : null}
        {connected ? visibleRecords.map((record) => {
          const key = recordKeysByReference.get(record);
          return key ? <FleetVehicleRow key={key} record={record} recordKey={key} active={key === selectedKey} copy={copy} onSelect={onSelect} /> : null;
        }) : null}
        {!connected && !loading && !requestError && connectionStatus !== "not_configured" ? <div className="px-3 py-6 text-center text-sm text-slate-500">{copy.failureBody}</div> : null}
        {loading && total === 0 ? <div className="px-3 py-6 text-center text-sm text-slate-500">{copy.mapLoading}</div> : null}
      </div>
    </aside>
  );
}
