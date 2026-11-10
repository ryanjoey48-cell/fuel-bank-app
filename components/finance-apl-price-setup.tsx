"use client";

import { useMemo, useState } from "react";
import { sheetErrorText, type FlowRun, type FlowT } from "@/components/finance-billing-flow";
import {
  CUSTOMER_RATE_SCHEDULES,
  activeRateMappings,
  confirmedWorkOrder,
  jobMatchesMapping,
  type Booking,
  type CustomerRateRow,
  type CustomerRateSchedule,
  type RateMapping,
  type State
} from "@/lib/finance-demo-centre";
import { formatBangkokDateTime, formatThb } from "@/lib/finance-display";

const input = "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-950";
const btn = "rounded-lg border border-violet-400 bg-violet-50 px-3 py-1 text-sm font-semibold text-violet-950 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40";
const splitList = (text: string) => text.split(",").map((item) => item.trim()).filter(Boolean);
const rowRoute = (row: CustomerRateRow) => `${row.pickup} → ${row.delivery}`.replace(/\s+/g, " ").trim();
const CLASSES = ["4W", "6W", "40", "TRAILER"] as const;
const AUDIT_ACTIONS = new Set(["confirm_rate_mapping", "propose_rate_mapping", "approve_proposed_rate_mapping", "revoke_rate_mapping", "record_fuel_reference"]);

/**
 * Owner-only price set-up. It lists the imported price tables exactly as stored (route, vehicle, every fuel band and
 * its charge) and shows which rows the owner has approved for this customer. Approving a row once makes it apply to
 * every matching booking in its date range; nothing is matched by similarity alone, so aliases and plates are typed
 * by the owner. Every approval and withdrawal is kept in the history below.
 */
export default function FinanceAplPriceSetup({ state, jobs, clientId, client, run, t, canApprove }: {
  state: State; jobs: Booking[]; clientId: string; client: string; run: FlowRun; t: FlowT; canApprove: boolean;
}) {
  const [scheduleId, setScheduleId] = useState(CUSTOMER_RATE_SCHEDULES.find((s) => s.id === "apl")?.id ?? CUSTOMER_RATE_SCHEDULES[0].id);
  const schedule = CUSTOMER_RATE_SCHEDULES.find((item) => item.id === scheduleId) as CustomerRateSchedule;
  const [rowId, setRowId] = useState("");
  const row = schedule.rows.find((item) => item.id === rowId);
  const mappings = activeRateMappings(state).filter((item) => item.clientId === clientId);
  const [pickup, setPickup] = useState("");
  const [delivery, setDelivery] = useState("");
  const [plates, setPlates] = useState("");
  const [classes, setClasses] = useState<string[]>([]);
  const [reading, setReading] = useState<"as_printed" | "floor_level">("as_printed");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [contract, setContract] = useState("");
  const [review, setReview] = useState("");
  const [ack, setAck] = useState(false);
  const [message, setMessage] = useState("");
  const [showBands, setShowBands] = useState("");

  const spellings = useMemo(() => ({
    pickup: [...new Set(jobs.map((job) => job.pickup).filter(Boolean))],
    delivery: [...new Set(jobs.map((job) => job.delivery).filter(Boolean))],
    plates: [...new Set(jobs.map((job) => job.diarySource?.vehicle_registration || job.vehicle).filter(Boolean))]
  }), [jobs]);
  const hasLevelBands = !!row && row.bands.every((band) => /^(Up to|Fuel at) \d+$/.test(band.label));
  const audit = state.audit.filter((entry) => AUDIT_ACTIONS.has(entry.action)).slice(-10).reverse();
  const addTo = (current: string, value: string) => (splitList(current).includes(value) ? current : [...splitList(current), value].join(", "));
  const report = (result: ReturnType<FlowRun>, ok: string) => { setMessage(result.ok ? ok : sheetErrorText(result.code, result.detail, t)); return result.ok; };
  const mappingsFor = (r: CustomerRateRow) => mappings.filter((item) => item.scheduleId === scheduleId && item.rowId === r.id);

  const choose = (r: CustomerRateRow, prefill?: { pickup: string; delivery: string; plates: string }) => {
    setRowId(r.id); setReading("as_printed"); setAck(false); setReview(""); setMessage("");
    if (prefill) { setPickup(prefill.pickup); setDelivery(prefill.delivery); setPlates(prefill.plates); setClasses([]); }
  };
  // Owner-confirmation view: each distinct diary route in this batch next to the price-table rows that MIGHT be the same place.
  // Similar names are only proposals — nothing is approved until the owner clicks.
  const norm = (value: string) => (value || "").toLowerCase().replace(/[^a-z0-9\u0e00-\u0e7f]/g, "");
  const routeGroups = useMemo(() => {
    const groups = new Map<string, Booking[]>();
    for (const job of jobs) { const key = `${job.pickup}→${job.delivery}`; groups.set(key, [...(groups.get(key) || []), job]); }
    return [...groups.entries()].map(([key, list]) => {
      const p = norm(list[0].pickup);
      const candidates = CUSTOMER_RATE_SCHEDULES.flatMap((sc) => sc.rows.filter((r) => { const rp = norm(r.pickup.split(/\s+/)[0]); return p.length >= 4 && rp.length >= 4 && (rp.startsWith(p) || p.startsWith(rp)); }).map((r) => ({ sc, r })));
      const approvedFor = mappings.filter((m) => list.every((job) => jobMatchesMapping(job, m).ok));
      const ambiguousClass = candidates.length > 1 && new Set(candidates.map((c) => `${c.sc.id}|${c.r.pickup}|${c.r.delivery}`)).size < candidates.length;
      return { key, list, candidates, approvedFor, ambiguousClass };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, mappings.length]);
  const withdraw = (mapping: RateMapping) => {
    const reason = window.prompt(t("Why is this approval being withdrawn? (kept in the history; saved prices are not changed)", "เหตุผลที่ยกเลิกการอนุมัตินี้ (เก็บในประวัติ ราคาที่บันทึกแล้วไม่เปลี่ยน)"), "");
    if (reason === null) return;
    report(run({ type: "revoke_rate_mapping", mappingId: mapping.id, reason }), t("Approval withdrawn.", "ยกเลิกการอนุมัติแล้ว"));
  };

  return (
    <div id="apl-price-setup" className="space-y-2 rounded-lg bg-slate-50 p-3" data-testid="apl-price-setup">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-violet-950">{t("Price setup", "ตั้งค่าราคา")} — {client}</p>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-900">{t("Owner only", "เฉพาะเจ้าของ")}</span>
        {!canApprove ? <span className="text-xs text-amber-900">{t("View only — sign in as the owner (Admin) or select Approver to approve.", "ดูได้อย่างเดียว — เข้าสู่ระบบเป็นเจ้าของ (แอดมิน) หรือเลือกผู้อนุมัติเพื่ออนุมัติ")}</span> : null}
      </div>
      <p className="text-xs text-slate-600">{t("Approve a price-table row once. It then prices every matching booking inside its dates, using the verified Diesel B7 band. Nothing is matched by similar names.", "อนุมัติแถวในตารางราคาครั้งเดียว ระบบจะคิดราคางานที่ตรงกันในช่วงวันที่ โดยใช้ช่วงราคาดีเซล B7 ที่ยืนยันแล้ว ไม่จับคู่ด้วยชื่อที่คล้ายกัน")}</p>

      <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-violet-200" data-testid="route-confirmation">
        <p className="bg-violet-50 px-2 py-1 text-xs font-bold text-violet-950">{t("Routes in this batch — confirm what each one means", "เส้นทางในชุดนี้ — ยืนยันว่าแต่ละเส้นทางหมายถึงอะไร")}</p>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-2 py-1">{t("Booking Diary route", "เส้นทางในสมุดจอง")}</th><th className="px-2 py-1">{t("Vehicles", "รถ")}</th><th className="px-2 py-1">{t("Proposed price-table rows (not approved)", "แถวในตารางราคาที่เสนอ (ยังไม่อนุมัติ)")}</th><th className="px-2 py-1">{t("Status", "สถานะ")}</th></tr></thead>
          <tbody>
            {routeGroups.map((g) => (
              <tr key={g.key} className="border-t border-slate-100 align-top" data-testid="route-group" data-approved={g.approvedFor.length ? "yes" : "no"}>
                <td className="px-2 py-1 font-semibold">{g.list[0].pickup} → {g.list[0].delivery}<span className="block font-normal text-slate-500">{g.list.map((job) => `WO ${confirmedWorkOrder(job)} · ${job.date}`).join(" · ")}</span></td>
                <td className="px-2 py-1">{g.list.map((job) => `${job.diarySource?.vehicle_registration || job.vehicle}${job.diarySource?.vehicle ? ` (${job.diarySource.vehicle})` : ""}`).join(", ")}</td>
                <td className="px-2 py-1">
                  {g.candidates.length ? g.candidates.map(({ sc, r }) => (
                    <button key={sc.id + r.id} type="button" className="mb-0.5 mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-left hover:bg-violet-100" onClick={() => { setScheduleId(sc.id); choose(r, { pickup: [...new Set(g.list.map((job) => job.pickup))].join(", "), delivery: [...new Set(g.list.map((job) => job.delivery))].join(", "), plates: g.ambiguousClass ? [...new Set(g.list.map((job) => job.diarySource?.vehicle_registration || job.vehicle))].join(", ") : "" }); }}>
                      {sc.name.replace(/ Pricing$/, "")}: {`${r.pickup} → ${r.delivery}`.replace(/\s+/g, " ")} · <b>{r.vehicle}</b>
                    </button>
                  )) : <span className="text-amber-800">{t("No similar price-table row — owner review", "ไม่มีแถวที่คล้ายกัน — เจ้าของตรวจสอบ")}</span>}
                  {g.ambiguousClass ? <span className="block text-amber-800">{t("More than one vehicle class (4W/6W): choose the registrations that belong to the class — the plate alone is not enough evidence.", "มีหลายประเภทรถ (4W/6W): เลือกทะเบียนที่อยู่ในประเภทนั้น เพียงทะเบียนอย่างเดียวไม่พอเป็นหลักฐาน")}</span> : null}
                </td>
                <td className="whitespace-nowrap px-2 py-1">{g.approvedFor.length ? <span className="font-semibold text-emerald-800">✓ {t("Approved", "อนุมัติแล้ว")}</span> : <span className="text-amber-800">{t("Needs owner confirmation", "รอเจ้าของยืนยัน")}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist">
        {CUSTOMER_RATE_SCHEDULES.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={item.id === scheduleId} onClick={() => { setScheduleId(item.id); setRowId(""); }}
            className={`rounded-lg px-3 py-1 text-sm font-semibold ${item.id === scheduleId ? "bg-violet-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100"}`}>{item.name}</button>
        ))}
        <a className="ml-auto self-center text-xs font-semibold text-violet-900 underline" href={`/api/finance-pricing-source/${schedule.id}`} target="_blank" rel="noreferrer">{t("Open source PDF", "เปิด PDF ต้นทาง")} · v{schedule.version}</a>
      </div>
      {schedule.reviewNotes?.map((note) => <p key={note} className="text-xs text-amber-900">ℹ {note}</p>)}
      {schedule.rules.map((rule) => <p key={rule} className="text-xs text-slate-700">{t("Source condition (not charged automatically)", "เงื่อนไขต้นทาง (ไม่เรียกเก็บอัตโนมัติ)")}: {rule}</p>)}

      <div className="max-h-72 overflow-auto rounded-lg bg-white ring-1 ring-slate-200">
        <table className="w-full text-sm" data-testid="apl-rows">
          <thead className="sticky top-0 bg-slate-100 text-left text-xs text-slate-600"><tr><th className="px-2 py-1">{t("Route", "เส้นทาง")}</th><th className="px-2 py-1">{t("Vehicle", "รถ")}</th><th className="px-2 py-1">{t("Fuel bands", "ช่วงราคาน้ำมัน")}</th><th className="px-2 py-1">{t("Status", "สถานะ")}</th><th /></tr></thead>
          <tbody>
            {schedule.rows.map((r) => {
              const approved = mappingsFor(r);
              return (
                <tr key={r.id} className={`border-t border-slate-100 align-top ${r.id === rowId ? "bg-violet-50" : ""}`}>
                  <td className="px-2 py-1 font-medium">{rowRoute(r)}{r.reviewFlags.length ? <span className="ml-1 text-amber-700" title={r.reviewFlags.join(" ")}>⚠</span> : null}</td>
                  <td className="whitespace-nowrap px-2 py-1">{r.vehicle}</td>
                  <td className="px-2 py-1 text-xs">
                    <button type="button" className="font-semibold text-violet-900 underline" onClick={() => setShowBands(showBands === r.id ? "" : r.id)}>{r.bands[0].label} {formatThb(r.bands[0].amountThb)} … {r.bands.at(-1)!.label} {formatThb(r.bands.at(-1)!.amountThb)} ({r.bands.length})</button>
                    {showBands === r.id ? <ul className="mt-1 grid grid-cols-2 gap-x-3 lg:grid-cols-3" data-testid="apl-bands">{r.bands.map((band) => <li key={band.label} className="whitespace-nowrap">{band.label}: <b>{formatThb(band.amountThb)}</b></li>)}</ul> : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">{approved.length ? <span className="font-semibold text-emerald-800">✓ {t("Approved", "อนุมัติแล้ว")} ({approved.length})</span> : <span className="text-amber-800">{t("Pending owner approval", "รอเจ้าของอนุมัติ")}</span>}</td>
                  <td className="px-2 py-1"><button type="button" className={btn} onClick={() => choose(r)}>{approved.length ? t("Manage", "จัดการ") : t("Approve…", "อนุมัติ…")}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {row ? (
        <div className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-violet-200" data-testid="apl-approve-form">
          <p className="text-sm font-bold">{rowRoute(row)} · {row.vehicle}</p>
          {mappingsFor(row).map((m) => (
            <p key={m.id} className="flex flex-wrap items-center gap-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-950">
              ✓ {m.match ? `${m.match.pickup.join("/") || "*"} → ${m.match.delivery.join("/") || "*"}${m.match.plates?.length ? ` · ${m.match.plates.join("/")}` : ""}${m.match.vehicleClass.length ? ` · ${m.match.vehicleClass.join("/")}` : ""}` : t("any route", "ทุกเส้นทาง")} · {m.effectiveFrom} → {m.effectiveTo ?? t("open", "ไม่กำหนด")}{m.match?.bandReading === "floor_level" ? ` · ${t("fuel level = whole-baht floor", "ระดับน้ำมัน = ปัดลงเป็นบาทเต็ม")}` : ""} · {m.contractReference}
              {canApprove ? <button type="button" className="ml-auto font-semibold text-rose-800 underline" onClick={() => withdraw(m)}>{t("Withdraw", "ยกเลิก")}</button> : null}
            </p>
          ))}
          <div className="grid gap-2 md:grid-cols-2">
            <label className="text-xs font-semibold">{t("Pickup names that mean this route (comma separated)", "ชื่อต้นทางที่หมายถึงเส้นทางนี้ (คั่นด้วยจุลภาค)")}
              <input className={input} value={pickup} onChange={(e) => setPickup(e.target.value)} />
              <span className="mt-0.5 flex flex-wrap gap-1 font-normal">{spellings.pickup.map((s) => <button key={s} type="button" className="rounded bg-slate-100 px-1.5 text-xs hover:bg-violet-100" onClick={() => setPickup(addTo(pickup, s))}>+ {s}</button>)}</span></label>
            <label className="text-xs font-semibold">{t("Delivery names that mean this route", "ชื่อปลายทางที่หมายถึงเส้นทางนี้")}
              <input className={input} value={delivery} onChange={(e) => setDelivery(e.target.value)} />
              <span className="mt-0.5 flex flex-wrap gap-1 font-normal">{spellings.delivery.map((s) => <button key={s} type="button" className="rounded bg-slate-100 px-1.5 text-xs hover:bg-violet-100" onClick={() => setDelivery(addTo(delivery, s))}>+ {s}</button>)}</span></label>
            <label className="text-xs font-semibold">{t("Vehicles (registrations) this rate is for — optional", "ทะเบียนรถที่ใช้ราคานี้ — ไม่บังคับ")}
              <input className={input} value={plates} onChange={(e) => setPlates(e.target.value)} />
              <span className="mt-0.5 flex flex-wrap gap-1 font-normal">{spellings.plates.map((s) => <button key={s} type="button" className="rounded bg-slate-100 px-1.5 text-xs hover:bg-violet-100" onClick={() => setPlates(addTo(plates, s))}>+ {s}</button>)}</span></label>
            <fieldset className="text-xs font-semibold">{t("Vehicle class from the diary — optional", "ประเภทรถจากสมุดจอง — ไม่บังคับ")}
              <span className="mt-1 flex gap-3 font-normal">{CLASSES.map((c) => <label key={c} className="inline-flex items-center gap-1"><input type="checkbox" className="h-4 w-4" checked={classes.includes(c)} onChange={(e) => setClasses((prev) => e.target.checked ? [...prev, c] : prev.filter((x) => x !== c))} />{c === "40" ? "40'" : c}</label>)}</span></fieldset>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold">{t("Effective from", "เริ่มมีผล")}<input className={input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="text-xs font-semibold">{t("Effective to", "สิ้นสุด")}<input className={input} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
            <label className="text-xs font-semibold">{t("Source / contract reference", "อ้างอิงสัญญา/ต้นทาง")}<input className={input} value={contract} onChange={(e) => setContract(e.target.value)} placeholder={`${schedule.sourceFilename}`} /></label>
          </div>
          {hasLevelBands ? (
            <fieldset className="text-xs font-semibold">{t("How to read the fuel columns (\"Fuel at 43\")", "วิธีอ่านคอลัมน์ราคาน้ำมัน (\"Fuel at 43\")")}
              <label className="mt-1 flex items-start gap-2 font-normal"><input type="radio" className="mt-0.5" checked={reading === "as_printed"} onChange={() => setReading("as_printed")} />{t("As imported: fuel above 42.00 up to 43.00 pays the \"Fuel at 43\" column", "ตามที่นำเข้า: น้ำมันเกิน 42.00 ถึง 43.00 ใช้คอลัมน์ \"Fuel at 43\"")}</label>
              <label className="flex items-start gap-2 font-normal"><input type="radio" className="mt-0.5" checked={reading === "floor_level"} onChange={() => setReading("floor_level")} />{t("Whole-baht level: 43.00 to 43.99 pays the \"Fuel at 43\" column", "ระดับบาทเต็ม: 43.00 ถึง 43.99 ใช้คอลัมน์ \"Fuel at 43\"")}</label>
              <span className="font-normal text-amber-900">{t("The PDF does not say which. Only the owner can decide.", "PDF ไม่ได้ระบุ เจ้าของเท่านั้นที่ตัดสินได้")}</span>
            </fieldset>
          ) : null}
          {schedule.reviewNotes?.length && !hasLevelBands ? <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} />{t("I have read the notes above for this table.", "ฉันอ่านหมายเหตุของตารางนี้แล้ว")}</label> : null}
          {row.reviewFlags.map((flag) => <p key={flag} className="text-xs font-semibold text-amber-900">⚠ {flag}</p>)}
          {row.reviewFlags.length ? <label className="block text-xs font-semibold">{t("Review reason (required for flagged rows)", "เหตุผลการทบทวน (จำเป็นสำหรับแถวที่ติดธง)")}<input className={input} value={review} onChange={(e) => setReview(e.target.value)} /></label> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} data-testid="apl-propose" disabled={!from || contract.trim().length < 3 || (!pickup.trim() && !delivery.trim() && !plates.trim() && !classes.length) || (!!schedule.reviewNotes?.length && !hasLevelBands && !ack)}
              onClick={() => report(run({ type: "propose_rate_mapping", scheduleId, rowId: row.id, clientId, contractReference: contract, effectiveFrom: from, effectiveTo: to || null, reviewReason: review,
                match: { pickup: splitList(pickup), delivery: splitList(delivery), vehicleClass: classes, ...(plates.trim() ? { plates: splitList(plates) } : {}), ...(hasLevelBands ? { bandReading: reading } : {}) } }),
                t("Saved as PROPOSED. It does not price jobs until the owner approves it.", "บันทึกเป็นค่าที่เสนอ ยังไม่คิดราคาจนกว่าเจ้าของอนุมัติ"))}>
              {t("Save as proposed", "บันทึกเป็นค่าที่เสนอ")}
            </button>
            <button type="button" className="ees-fc-btn-primary !py-1.5" data-testid="apl-approve" disabled={!canApprove || !from || contract.trim().length < 3 || (!pickup.trim() && !delivery.trim() && !plates.trim() && !classes.length) || (!!schedule.reviewNotes?.length && !hasLevelBands && !ack)}
              onClick={() => report(run({ type: "confirm_rate_mapping", scheduleId, rowId: row.id, clientId, contractReference: contract, effectiveFrom: from, effectiveTo: to || null, reviewReason: review,
                match: { pickup: splitList(pickup), delivery: splitList(delivery), vehicleClass: classes, ...(plates.trim() ? { plates: splitList(plates) } : {}), ...(hasLevelBands ? { bandReading: reading } : {}) } }),
                t("Approved. It now prices every matching booking in its dates.", "อนุมัติแล้ว ระบบจะคิดราคางานที่ตรงกันในช่วงวันที่นี้"))}>
              {t("Approve this price row", "อนุมัติแถวราคานี้")}
            </button>
          </div>
        </div>
      ) : null}
      {message ? <p role="status" className="text-sm font-semibold text-violet-950" data-testid="apl-setup-message">{message}</p> : null}

      <details className="text-xs">
        <summary className="cursor-pointer font-semibold text-slate-800">{t("Configuration history", "ประวัติการตั้งค่า")} ({audit.length})</summary>
        <ul className="mt-1 space-y-0.5" data-testid="apl-audit">{audit.map((entry) => <li key={entry.step}><b>{formatBangkokDateTime(entry.at)}</b> · {entry.actor} · {entry.action === "confirm_rate_mapping" ? t("approved", "อนุมัติ") : entry.action === "revoke_rate_mapping" ? t("withdrawn", "ยกเลิก") : t("fuel reference", "ราคาน้ำมัน")} · {entry.detail.slice(0, 160)}</li>)}</ul>
      </details>
    </div>
  );
}
