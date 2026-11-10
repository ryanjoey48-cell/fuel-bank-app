"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { isEesLorryDepotForthId, isEesOfficeForthId, labelEesForthSite } from "@/lib/ees-depot-sites";

export type ForthImportSummary = {
  forthSourceRecords: number; uniqueForthLocationIds: number; validCoordinatePairs: number;
  exactDuplicateCoordinateGroups: number; populatedNames: number; populatedAddresses: number;
  distinctGroupLayers: number; eesDirectoryRecords: number; eesConfirmedDestinationPins: number;
  classifications: Record<string, number>; approvedImports: number;
  bulkEligible?: number; strongMatches?: number; possibleMatches?: number; uncertainMatches?: number;
};

export type ForthImportItem = {
  forthLocationId: string; name: string | null; groupLayer: string | null;
  latitude: number | null; longitude: number | null; address: string | null;
  diameterRaw?: string | null;
  classification: string; suggestedCategory: string; matchedEesLocationId: string | null;
  bestMatchConfidence?: string | null;
  bulkEligible?: boolean; alreadyImported?: boolean;
  directoryVerificationStatus?: string | null;
  awaitingDirectoryVerify?: boolean;
  matchCandidates: {
    eesLocationId: string; companyName: string; distanceMeters: number | null;
    confidence?: string; reasons: string[];
  }[];
  notes: string[]; canApproveAsNew: boolean;
};

type PilotReadiness = {
  environmentLabel: string;
  blockers: string[];
  eligiblePilotGeofences: number;
  pilotReady: boolean;
  items: { key: string; labelEn: string; labelTh: string; count: number | null; ready: boolean; blocker: string | null }[];
  activationChecklist: { step: number; en: string; th: string; done: boolean }[];
  reconciliation?: { classifications: Record<string, number>; approvedImports: number; bulkEligible: number };
};

type Props = {
  th: boolean;
  busy: boolean;
  forthSummary: ForthImportSummary | null;
  forthItems: ForthImportItem[];
  forthGroups: string[];
  forthFilter: string;
  forthGroup: string;
  forthCategory: string;
  forthConfidence: string;
  forthSearch: string;
  forthPage: number;
  forthTotalFiltered: number;
  forthDiameterNote: string;
  pilotReadiness: PilotReadiness | null;
  onFilterChange: (value: string) => void;
  onGroupChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onConfidenceChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onApproveOne: (item: ForthImportItem, forceDuplicate?: boolean) => Promise<void>;
  onLinkOne: (item: ForthImportItem, eesLocationId: string) => Promise<void>;
  onBulk: (action: "approve_drafts" | "skip" | "defer", ids: string[]) => Promise<void>;
};

export function ForthLocationsBulkPanel({
  th, busy, forthSummary, forthItems, forthGroups, forthFilter, forthGroup, forthCategory, forthConfidence, forthSearch,
  forthPage, forthTotalFiltered, forthDiameterNote, pilotReadiness,
  onFilterChange, onGroupChange, onCategoryChange, onConfidenceChange, onSearchChange, onPageChange,
  onApproveOne, onLinkOne, onBulk
}: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirmText, setConfirmText] = useState("");
  const pageEligibleIds = useMemo(
    () => forthItems.filter((item) => item.bulkEligible).map((item) => item.forthLocationId),
    [forthItems]
  );
  const selectedIds = Object.entries(selected).filter(([, value]) => value).map(([id]) => id);
  const selectedEligible = selectedIds.filter((id) => pageEligibleIds.includes(id));
  const pageCount = Math.max(1, Math.ceil(forthTotalFiltered / 50));

  function toggleAllEligible() {
    const next = { ...selected };
    const allSelected = pageEligibleIds.every((id) => next[id]);
    for (const id of pageEligibleIds) next[id] = !allSelected;
    setSelected(next);
  }

  async function runBulk(action: "approve_drafts" | "skip" | "defer") {
    const ids = action === "approve_drafts" ? selectedEligible : selectedIds;
    if (!ids.length) return;
    if (confirmText.trim().toLowerCase() !== "confirm") return;
    await onBulk(action, ids);
    setSelected({});
    setConfirmText("");
  }

  return (
    <>
      <details className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4" open>
        <summary className="cursor-pointer font-bold text-emerald-950">
          {th ? "นำเข้าสถานที่ Forth แบบกลุ่ม" : "Forth locations bulk review"} · {forthSummary?.forthSourceRecords ?? "—"}
        </summary>
        <p className="mt-2 text-xs text-slate-600">
          {th
            ? "แยก 3 ขั้นตอน: 1) นำเข้าร่าง 2) ยืนยันหมุดปลายทางในไดเรกทอรี 3) เปิดโซนติดตาม การอนุมัติกลุ่มไม่ยืนยันหมุดและไม่เปิด geofence"
            : "Three separate actions: 1) import draft 2) confirm destination pin in Locations 3) enable geofence. Bulk approve never confirms pins or activates monitoring."}
        </p>
        {forthDiameterNote ? <p className="mt-2 text-xs text-amber-800">{forthDiameterNote}</p> : null}
        {forthSummary ? (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white px-3 py-1.5 font-semibold">Forth · {forthSummary.forthSourceRecords}</span>
            <span className="rounded-full bg-white px-3 py-1.5 font-semibold">EES · {forthSummary.eesDirectoryRecords}</span>
            <span className="rounded-full bg-emerald-100 px-3 py-1.5 font-semibold text-emerald-900">Matched · {forthSummary.classifications.MATCHED ?? 0}</span>
            <span className="rounded-full bg-sky-100 px-3 py-1.5 font-semibold text-sky-900">New · {forthSummary.classifications.NEW_LOCATION ?? 0}</span>
            <span className="rounded-full bg-amber-100 px-3 py-1.5 font-semibold text-amber-900">Possible dup · {forthSummary.classifications.POSSIBLE_DUPLICATE ?? 0}</span>
            <span className="rounded-full bg-rose-100 px-3 py-1.5 font-semibold text-rose-900">Review · {forthSummary.classifications.REQUIRES_REVIEW ?? 0}</span>
            <span className="rounded-full bg-violet-100 px-3 py-1.5 font-semibold text-violet-900">Approved · {forthSummary.approvedImports}</span>
            <span className="rounded-full bg-white px-3 py-1.5">Bulk-eligible · {forthSummary.bulkEligible ?? 0}</span>
            <span className="rounded-full bg-white px-3 py-1.5">Strong/possible/uncertain · {forthSummary.strongMatches ?? 0}/{forthSummary.possibleMatches ?? 0}/{forthSummary.uncertainMatches ?? 0}</span>
            <span className="rounded-full bg-white px-3 py-1.5">Pins · {forthSummary.eesConfirmedDestinationPins}</span>
          </div>
        ) : <p className="mt-3 text-sm text-slate-500">{th ? "กำลังโหลดการเปรียบเทียบ" : "Loading reconciliation"}</p>}

        <div className="mt-3 flex flex-wrap gap-2">
          <select className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" value={forthFilter} onChange={(event) => onFilterChange(event.target.value)} aria-label={th ? "ตัวกรองสถานะ" : "Classification filter"}>
            {[
              ["NEW_LOCATION", th ? "สถานที่ใหม่" : "New locations"],
              ["POSSIBLE_DUPLICATE", th ? "อาจซ้ำ" : "Possible duplicates"],
              ["REQUIRES_REVIEW", th ? "ต้องทบทวน" : "Requires review"],
              ["AWAITING_DIRECTORY_VERIFY", th ? "รอตรวจในไดเรกทอรี" : "Awaiting Directory verify"],
              ["MATCHED", th ? "จับคู่แล้ว" : "Matched"],
              ["APPROVED", th ? "นำเข้าแล้ว" : "Already imported"],
              ["MISSING_COORDINATES", th ? "ไม่มีพิกัด" : "Missing coordinates"],
              ["INVALID_COORDINATES", th ? "พิกัดไม่ถูกต้อง" : "Invalid coordinates"],
              ["ALL", th ? "ทั้งหมด" : "All"]
            ].map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" value={forthCategory} onChange={(event) => onCategoryChange(event.target.value)} aria-label={th ? "ประเภทที่แนะนำ" : "Suggested category"}>
            <option value="">{th ? "ทุกประเภท" : "All categories"}</option>
            {["Customer", "Depot", "Warehouse", "Factory", "Port", "Airport", "Other"].map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          <select className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" value={forthConfidence} onChange={(event) => onConfidenceChange(event.target.value)} aria-label={th ? "ความมั่นใจในการจับคู่" : "Match confidence"}>
            <option value="">{th ? "ทุกระดับความมั่นใจ" : "All confidence"}</option>
            {["strong", "possible", "uncertain"].map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          <select className="min-h-10 max-w-xs rounded-lg border border-slate-300 px-3 text-sm" value={forthGroup} onChange={(event) => onGroupChange(event.target.value)} aria-label={th ? "กลุ่ม Forth" : "Forth group"}>
            <option value="">{th ? "ทุกกลุ่ม/ชั้น" : "All groups/layers"}</option>
            {forthGroups.map((group) => <option key={group} value={group}>{group}</option>)}
          </select>
          <input className="min-h-10 min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 text-sm" value={forthSearch} onChange={(event) => onSearchChange(event.target.value)} placeholder={th ? "ค้นหาชื่อ รหัส Forth หรือกลุ่ม" : "Search name, Forth ID or group"} />
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <button type="button" className="rounded-full bg-amber-100 px-3 py-1.5 font-semibold text-amber-950" disabled={busy} onClick={() => onFilterChange("POSSIBLE_DUPLICATE")}>
            {th ? "ตรวจรายการอาจซ้ำ" : "Review possible duplicates"}
          </button>
          <button type="button" className="rounded-full bg-violet-100 px-3 py-1.5 font-semibold text-violet-950" disabled={busy} onClick={() => onFilterChange("AWAITING_DIRECTORY_VERIFY")}>
            {th ? "รอตรวจในไดเรกทอรี" : "Awaiting Directory verify"}
          </button>
          <button type="button" className="rounded-full bg-emerald-100 px-3 py-1.5 font-semibold text-emerald-950" disabled={busy} onClick={() => onCategoryChange("Depot")}>
            {th ? "เฉพาะ Depot" : "Depot only"}
          </button>
          <button type="button" className="rounded-full bg-sky-100 px-3 py-1.5 font-semibold text-sky-950" disabled={busy} onClick={() => onCategoryChange("Customer")}>
            {th ? "เฉพาะลูกค้า" : "Customer only"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className="btn-secondary" disabled={busy || !pageEligibleIds.length} onClick={toggleAllEligible}>
            {th ? "เลือกทั้งหมดที่อนุมัติกลุ่มได้ในหน้านี้" : "Select all bulk-eligible on this page"}
          </button>
          <span className="text-xs text-slate-600">{th ? "เลือกแล้ว" : "Selected"} · {selectedIds.length} ({th ? "อนุมัติกลุ่มได้" : "bulk-eligible"} {selectedEligible.length})</span>
          <label className="text-xs">{th ? "พิมพ์ confirm เพื่อยืนยัน" : "Type confirm to proceed"}
            <input className="ml-2 min-h-9 rounded-lg border border-slate-300 px-2" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="confirm" />
          </label>
          <button type="button" className="btn-primary" disabled={busy || confirmText.trim().toLowerCase() !== "confirm" || !selectedEligible.length} onClick={() => void runBulk("approve_drafts")}>
            {th ? "อนุมัติร่างแบบกลุ่ม" : "Bulk approve drafts"}
          </button>
          <button type="button" className="btn-secondary" disabled={busy || confirmText.trim().toLowerCase() !== "confirm" || !selectedIds.length} onClick={() => void runBulk("defer")}>
            {th ? "เลื่อนตรวจ" : "Bulk defer"}
          </button>
          <button type="button" className="btn-secondary" disabled={busy || confirmText.trim().toLowerCase() !== "confirm" || !selectedIds.length} onClick={() => void runBulk("skip")}>
            {th ? "ข้าม" : "Bulk skip"}
          </button>
        </div>
        <p className="mt-2 text-xs text-amber-900">
          {th
            ? "รายการที่อาจซ้ำหรือต้องทบทวนจะถูกตัดออกจากการอนุมัติกลุ่มโดยอัตโนมัติ"
            : "Possible duplicates and review-required rows are automatically excluded from bulk approve."}
        </p>

        <div className="mt-3 max-h-96 overflow-y-auto divide-y divide-emerald-100 rounded-lg border border-emerald-100 bg-white">
          {forthItems.map((item) => (
            <article key={item.forthLocationId} className="grid gap-2 p-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto]">
              <label className="pt-1">
                <input type="checkbox" className="h-4 w-4 accent-emerald-700" checked={Boolean(selected[item.forthLocationId])} onChange={(event) => setSelected((current) => ({ ...current, [item.forthLocationId]: event.target.checked }))} aria-label={item.name || item.forthLocationId} />
              </label>
              <div>
                <p className="font-bold">{item.name || (th ? "ไม่มีชื่อ" : "Unnamed")}
                  <span className="ml-2 text-xs font-semibold text-emerald-800">{item.classification}</span>
                  {item.bestMatchConfidence ? <span className="ml-2 text-xs font-semibold text-slate-600">{item.bestMatchConfidence}</span> : null}
                  {item.alreadyImported ? <span className="ml-2 text-xs font-semibold text-violet-700">{th ? "นำเข้าแล้ว" : "imported"}</span> : null}
                  {item.awaitingDirectoryVerify ? <span className="ml-2 text-xs font-semibold text-amber-800">{th ? "รอตรวจไดเรกทอรี" : "awaiting Directory verify"}</span> : null}
                  {item.bulkEligible ? <span className="ml-2 text-xs font-semibold text-sky-700">{th ? "อนุมัติกลุ่มได้" : "bulk-eligible"}</span> : null}
                  {isEesLorryDepotForthId(item.forthLocationId) || isEesOfficeForthId(item.forthLocationId) ? (
                    <span className="ml-2 text-xs font-semibold text-rose-800">{labelEesForthSite(item.forthLocationId, th ? "th" : "en")}</span>
                  ) : null}
                </p>
                <p className="text-xs text-slate-500">Forth #{item.forthLocationId} · {item.groupLayer || "—"} · {item.suggestedCategory}</p>
                <p className="text-xs text-slate-600">{item.address || (th ? "ไม่มีที่อยู่ในไฟล์ Forth" : "No address in Forth export")}</p>
                <p className="text-xs text-slate-500">{item.latitude != null && item.longitude != null ? `${item.latitude}, ${item.longitude}` : "—"} · diameter raw {item.diameterRaw ?? "—"}</p>
                {item.matchCandidates.slice(0, 2).map((candidate) => (
                  <p key={candidate.eesLocationId} className="mt-1 text-xs text-amber-900">
                    {candidate.companyName}
                    {candidate.distanceMeters != null ? ` · ${Math.round(candidate.distanceMeters)} m` : ""}
                    {candidate.confidence ? ` · ${candidate.confidence}` : ""}
                    {" · "}{candidate.reasons.join("; ")}
                  </p>
                ))}
                {item.notes.map((note) => <p key={note} className="text-xs text-amber-800">{note}</p>)}
              </div>
              <div className="flex flex-col items-stretch gap-2 sm:items-end">
                {item.canApproveAsNew && item.classification === "NEW_LOCATION" ? (
                  <button type="button" className="btn-primary" disabled={busy} onClick={() => void onApproveOne(item)}>{th ? "อนุมัติเป็นร่าง" : "Approve draft"}</button>
                ) : null}
                {item.canApproveAsNew && item.classification !== "NEW_LOCATION" ? (
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => void onApproveOne(item, true)}>{th ? "บังคับสร้างร่าง" : "Force draft"}</button>
                ) : null}
                {(item.matchedEesLocationId || item.matchCandidates[0]) ? (
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => void onLinkOne(item, item.matchedEesLocationId || item.matchCandidates[0].eesLocationId)}>
                    {th ? "เชื่อมกับ EES" : "Link to EES"}
                  </button>
                ) : null}
                <Link href="/locations" className="text-xs font-semibold text-violet-700">{th ? "เปิดไดเรกทอรี" : "Open Directory"}</Link>
              </div>
            </article>
          ))}
          {!forthItems.length && forthSummary ? <p className="p-4 text-sm text-slate-500">{th ? "ไม่มีรายการในตัวกรองนี้" : "No rows in this filter."}</p> : null}
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <button type="button" className="btn-secondary" disabled={busy || forthPage <= 1} onClick={() => onPageChange(forthPage - 1)}>{th ? "ก่อนหน้า" : "Previous"}</button>
          <span className="text-xs text-slate-600">{th ? "หน้า" : "Page"} {forthPage} / {pageCount} · {forthTotalFiltered}</span>
          <button type="button" className="btn-secondary" disabled={busy || forthPage >= pageCount} onClick={() => onPageChange(forthPage + 1)}>{th ? "ถัดไป" : "Next"}</button>
        </div>
      </details>

      <details className="mt-3 rounded-xl border border-slate-200 bg-white p-4" open>
        <summary className="cursor-pointer font-bold text-slate-900">
          {th ? "ความพร้อมนำร่อง geofence" : "Geofence pilot readiness"} · {pilotReadiness?.environmentLabel ?? "—"}
        </summary>
        {!pilotReadiness ? <p className="mt-2 text-sm text-slate-500">{th ? "กำลังโหลด" : "Loading"}</p> : (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {pilotReadiness.items.map((item) => (
                <div key={item.key} className={`rounded-lg border px-3 py-2 text-sm ${item.ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                  <p className="font-semibold">{th ? item.labelTh : item.labelEn}</p>
                  <p className="text-xs text-slate-600">{item.count == null ? (item.ready ? (th ? "พร้อม" : "ready") : (th ? "ยังไม่พร้อม" : "not ready")) : item.count}</p>
                  {item.blocker ? <p className="mt-1 text-xs text-amber-900">{item.blocker}</p> : null}
                </div>
              ))}
            </div>
            <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-slate-700">
              {pilotReadiness.activationChecklist.map((step) => (
                <li key={step.step} className={step.done ? "text-emerald-800" : ""}>
                  {th ? step.th : step.en}{step.done ? (th ? " ✓" : " ✓") : ""}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-slate-600">
              {th ? "โซนนำร่องที่เข้าเกณฑ์โดยประมาณ" : "Approximate eligible pilot geofences"}: {pilotReadiness.eligiblePilotGeofences}
              {" · "}
              {pilotReadiness.pilotReady ? (th ? "โครงสร้างพร้อมเริ่มนำร่องหลังอนุมัติเจ้าของ" : "Structure ready for owner-approved pilot start") : (th ? "ยังไม่พร้อมเปิดมอนิเตอร์จริง" : "Not ready for live monitoring")}
            </p>
            {pilotReadiness.blockers.length ? (
              <div className="mt-2 text-xs text-amber-900">
                <strong>{th ? "สิ่งที่ยังติดค้าง" : "Current blockers"}</strong>
                <ul className="mt-1 list-disc pl-5">{pilotReadiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
              </div>
            ) : null}
          </>
        )}
      </details>
    </>
  );
}
