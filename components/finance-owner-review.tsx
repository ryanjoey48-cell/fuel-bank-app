"use client";

import type { FlowT } from "@/components/finance-billing-flow";
import { CUSTOMER_RATE_SCHEDULES, activeRateMappings, confirmedWorkOrder, jobMatchesMapping, type BillingSheet, type Booking, type State } from "@/lib/finance-demo-centre";
import { fuelCalculation } from "@/lib/finance-pricing-evidence";

type Item = { key: string; topic: string; evidence: string; source: string; status: "approved" | "pending"; detail: string };

/**
 * Compact owner-review checklist for one billing batch, computed from the saved bookings and the approved mappings. An item is
 * Approved only when an owner-approved mapping covers it; nothing is inferred from a similar name or a plate number.
 */
export default function FinanceOwnerReview({ state, sheet, jobs, t }: { state: State; sheet: BillingSheet; jobs: Booking[]; t: FlowT }) {
  const mappings = activeRateMappings(state).filter((m) => m.clientId === sheet.clientId);
  const groups = new Map<string, Booking[]>();
  for (const job of jobs) groups.set(`${job.pickup}→${job.delivery}`, [...(groups.get(`${job.pickup}→${job.delivery}`) || []), job]);
  const items: Item[] = [];
  const rowText = (scheduleId: string, rowId: string) => {
    const sc = CUSTOMER_RATE_SCHEDULES.find((x) => x.id === scheduleId); const r = sc?.rows.find((x) => x.id === rowId);
    return r ? `${sc!.name.replace(/ Pricing$/, "")}: ${`${r.pickup} → ${r.delivery}`.replace(/\s+/g, " ")} · ${r.vehicle}` : rowId;
  };
  for (const [key, list] of groups) {
    const regs = [...new Set(list.map((job) => job.diarySource?.vehicle_registration || job.vehicle))];
    const wos = list.map((job) => confirmedWorkOrder(job)).join(", ");
    const covering = mappings.filter((m) => list.every((job) => jobMatchesMapping(job, m).ok));
    const m = covering[0];
    const label = `${list[0].pickup} → ${list[0].delivery}`;
    items.push({ key: key + "route", topic: t("Route → price-table row", "เส้นทาง → แถวตารางราคา"), evidence: `${label} · WO ${wos}`, source: m ? rowText(m.scheduleId, m.rowId) : t("not mapped", "ยังไม่ผูก"), status: m ? "approved" : "pending", detail: m ? m.contractReference : t("Choose the row in Price setup", "เลือกแถวใน ตั้งค่าราคา") });
    const dg = list.map((job) => job.diarySource?.vehicle).filter(Boolean).join(", ") || t("not recorded in the diary", "สมุดจองไม่ได้ระบุ");
    const classKnown = !!m && !!(m.match?.plates?.length || m.match?.vehicleClass?.length);
    const row = m ? CUSTOMER_RATE_SCHEDULES.find((x) => x.id === m.scheduleId)?.rows.find((x) => x.id === m.rowId) : undefined;
    const needsClass = (() => { const sc = CUSTOMER_RATE_SCHEDULES.flatMap((x) => x.rows); return !!row && sc.filter((r) => r.pickup === row.pickup && r.delivery === row.delivery).length > 1; })();
    items.push({ key: key + "veh", topic: t("Vehicle class", "ประเภทรถ"), evidence: `${regs.join(", ")} · ${t("diary vehicle", "รถในสมุดจอง")}: ${dg}`, source: row ? row.vehicle : "—",
      status: m && (!needsClass || classKnown) ? "approved" : "pending", detail: m ? (m.match?.plates?.length ? `${t("approved registrations", "ทะเบียนที่อนุมัติ")}: ${m.match.plates.join(", ")}` : needsClass ? t("class not approved for these vehicles", "ยังไม่อนุมัติประเภทรถของคันเหล่านี้") : t("single vehicle row — no class choice needed", "แถวเดียว ไม่ต้องเลือกประเภทรถ")) : t("needs a route approval first", "ต้องอนุมัติเส้นทางก่อน") });
    const seen = [...new Set(list.map((job) => job.pickup))];
    const aliases = m?.match?.pickup ?? [];
    const norm = (x: string) => x.toLowerCase().replace(/[\s.\-_'"()+]/g, "");
    const uncovered = seen.filter((p) => !aliases.some((a) => norm(a) && norm(p).includes(norm(a))));
    items.push({ key: key + "alias", topic: t("Name spellings", "การสะกดชื่อ"), evidence: `${t("seen in diary", "ที่พบในสมุดจอง")}: ${seen.join(" / ")}`, source: aliases.length ? aliases.join(" / ") : "—", status: m && !uncovered.length ? "approved" : "pending", detail: m ? (uncovered.length ? `${t("not covered", "ยังไม่ครอบคลุม")}: ${uncovered.join(", ")}` : t("all observed spellings are covered", "ครอบคลุมทุกการสะกดที่พบ")) : "—" });
    items.push({ key: key + "dates", topic: t("Contract effective dates", "วันที่สัญญามีผล"), evidence: `${[...new Set(list.map((job) => job.date))].join(", ")}`, source: m ? `${m.effectiveFrom} → ${m.effectiveTo ?? t("open", "ไม่กำหนด")}` : "—", status: m ? "approved" : "pending", detail: m ? t("entered by the approver", "กรอกโดยผู้อนุมัติ") : t("no approval yet", "ยังไม่อนุมัติ") });
  }
  // General Goodyear fuel-column reading: only an owner decision settles it; a one-off override does not.
  const goodyear = mappings.filter((m) => m.scheduleId === "goodyear");
  const overrides = jobs.map((job) => fuelCalculation(state, sheet, job)).filter((c) => c.schedule.startsWith("Goodyear") && c.overrideReason);
  if (goodyear.length || overrides.length || jobs.some((job) => /goodyear/i.test(job.pickup)))
    items.push({ key: "gyread", topic: t("Goodyear fuel-column reading", "วิธีอ่านคอลัมน์น้ำมันของ Goodyear"), evidence: overrides.length ? overrides.map((c) => `WO ${c.workOrder}: ${t("table", "ตาราง")} ฿${c.tableCharge?.toFixed(2)} → ${t("applied", "ใช้จริง")} ฿${c.applied?.toFixed(2)}`).join(" · ") : t("no override recorded", "ไม่มีการแก้ราคา"),
      source: goodyear.map((m) => (m.match?.bandReading === "floor_level" ? t("whole-baht level", "ระดับบาทเต็ม") : t("as printed", "ตามที่พิมพ์"))).join(" / ") || "—",
      status: "pending", detail: t("A per-job override does not settle the general reading — owner decision pending.", "การแก้ราคารายงานไม่ได้กำหนดวิธีอ่านทั่วไป — รอเจ้าของตัดสินใจ") });
  const pending = items.filter((i) => i.status === "pending").length;
  return (
    <section className="rounded-lg bg-white ring-1 ring-violet-200" data-testid="owner-review">
      <div className="flex flex-wrap items-center gap-3 bg-violet-50 px-3 py-1.5">
        <h3 className="text-sm font-bold text-violet-950">{t("Owner review", "ให้เจ้าของตรวจสอบ")}</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${pending ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`} data-testid="owner-review-pending">{pending ? t(`${pending} pending`, `รอตรวจ ${pending} รายการ`) : t("All approved", "อนุมัติครบ")}</span>
        <a className="ml-auto text-xs font-semibold text-violet-900 underline" href="#apl-price-setup">{t("Approve in Price setup ↓", "อนุมัติใน ตั้งค่าราคา ↓")}</a>
      </div>
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-600"><tr><th className="px-2 py-1">{t("Topic", "หัวข้อ")}</th><th className="px-2 py-1">{t("Booking Diary evidence", "หลักฐานจากสมุดจอง")}</th><th className="px-2 py-1">{t("Price-sheet row / approved value", "แถวตารางราคา / ค่าที่อนุมัติ")}</th><th className="px-2 py-1">{t("Status", "สถานะ")}</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.key} className="border-t border-slate-100 align-top" data-status={item.status}>
                <td className="whitespace-nowrap px-2 py-1 font-semibold">{item.topic}</td>
                <td className="px-2 py-1">{item.evidence}</td>
                <td className="px-2 py-1">{item.source}<span className="block text-slate-500">{item.detail}</span></td>
                <td className="whitespace-nowrap px-2 py-1">{item.status === "approved" ? <span className="font-bold text-emerald-800">✓ {t("Approved", "อนุมัติแล้ว")}</span> : <span className="font-bold text-amber-800">{t("Pending", "รอตรวจ")}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
