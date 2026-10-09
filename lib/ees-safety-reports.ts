"use client";

import { supabase } from "@/lib/supabase";

export type SafetyReportIssue = {
  id: string;
  nameEn: string;
  nameTh: string;
  icon: string;
  type: string;
  notes: string;
  reportedAt: string;
};
export type SafetyReportVehicle = {
  registration: string;
  driver: string;
  model: string;
  status: string;
  inspectedAt: string | null;
  issues: SafetyReportIssue[];
};
export type SafetyReportInput = {
  vehicles: SafetyReportVehicle[];
  generatedAt?: Date;
};
export type SafetyReportFormat = "summary" | "detailed";

type Tracking = {
  issue_id: string;
  stage: string;
  assigned_to: string | null;
  note: string | null;
  updated_at: string | null;
};

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const date = (value: string | null | undefined) => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Bangkok"
      }).format(d);
};

const typeLabel = (v: string) =>
  ({
    missing: "สูญหาย / Missing",
    damaged: "ชำรุด / Damaged",
    expired: "หมดอายุ / Expired",
    incomplete: "ไม่ครบ / Incomplete",
    other: "อื่น ๆ / Other"
  } as Record<string, string>)[v] ?? v;

const stageLabel = (v: string | undefined) =>
  ({
    reported: "แจ้งแล้ว / Reported",
    arranging: "กำลังจัดหา / Arranging",
    supplied: "ส่งมอบแล้ว / Supplied",
    verified: "ตรวจยืนยันแล้ว / Verified"
  } as Record<string, string>)[v ?? ""] ?? "ยังไม่มีการติดตาม / Not tracked";

const unique = <T,>(items: T[]) => [...new Set(items)];

export async function openSafetyReport(
  format: SafetyReportFormat,
  input: SafetyReportInput
): Promise<void> {
  const win = window.open("", "_blank");
  if (!win) {
    window.alert("Please allow pop-ups for this site to open the printable safety report.");
    return;
  }

  win.document.write(
    '<!doctype html><html><head><meta charset="utf-8"><title>Preparing EES Safety Report</title></head><body style="font-family:Arial,sans-serif;padding:32px">Preparing live safety report…</body></html>'
  );
  win.document.close();

  const affected = input.vehicles.filter((v) => v.issues.length > 0);
  const unchecked = input.vehicles.filter((v) => v.status === "not_checked");
  const readyVehicles = input.vehicles.filter((v) => v.status === "ready");
  const allIssues = affected.flatMap((v) => v.issues);
  const uniqueIds = unique(allIssues.map((i) => i.id));

  const tracking = new Map<string, Tracking>();
  let trackingError: string | null = null;
  if (uniqueIds.length) {
    const result = await supabase
      .from("vehicle_safety_replacement_tracking")
      .select("issue_id,stage,assigned_to,note,updated_at")
      .in("issue_id", uniqueIds);

    if (result.error) trackingError = result.error.message;
    else {
      for (const t of (result.data ?? []) as Tracking[]) {
        tracking.set(t.issue_id, t);
      }
    }
  }

  const candidates = [...document.querySelectorAll<HTMLImageElement>("header img, nav img, img")];
  const logoElement =
    candidates.find((el) => /ees|logo|brand/i.test(`${el.alt} ${el.src}`)) ??
    candidates.find((el) => {
      const box = el.getBoundingClientRect();
      return box.top < 100 && box.left < 230 && box.width > 20 && box.width < 220;
    });
  const logoUrl = logoElement?.currentSrc || logoElement?.src || "";
  const logo = logoUrl ? `<img class="brand-logo" alt="EES" src="${esc(logoUrl)}" />` : "";

  const grouped = new Map<
    string,
    { nameEn: string; nameTh: string; icon: string; count: number; people: string[] }
  >();

  for (const v of affected) {
    for (const i of v.issues) {
      const key = `${i.nameEn}|${i.nameTh}|${i.type}`;
      const entry = grouped.get(key) ?? {
        nameEn: i.nameEn,
        nameTh: i.nameTh,
        icon: i.icon,
        count: 0,
        people: []
      };
      entry.count += 1;
      const person = `${v.driver} (${v.registration})`;
      if (!entry.people.includes(person)) entry.people.push(person);
      grouped.set(key, entry);
    }
  }

  const groups = [...grouped.values()].sort(
    (a, b) => b.count - a.count || a.nameEn.localeCompare(b.nameEn)
  );
  const sortedAffected = [...affected].sort((a, b) => a.driver.localeCompare(b.driver));
  const sortedUnchecked = [...unchecked].sort((a, b) => a.driver.localeCompare(b.driver));
  const sortedReady = [...readyVehicles].sort((a, b) => a.driver.localeCompare(b.driver));

  const total = input.vehicles.length;
  const readyCount = readyVehicles.length;
  const affectedCount = affected.length;
  const notCheckedCount = unchecked.length;
  const now = input.generatedAt ?? new Date();
  const asAt = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(now);

  const empty = '<span class="muted">ไม่มีรายการ / No records</span>';

  const stats = `
    <div class="stats">
      <div><b>${total}</b><span>รถทั้งหมด / Total fleet</span></div>
      <div><b>${readyCount}</b><span>พร้อมใช้งาน / Ready</span></div>
      <div><b>${affectedCount}</b><span>ต้องดำเนินการ / Need action</span></div>
      <div><b>${notCheckedCount}</b><span>ยังไม่ตรวจ / Not checked</span></div>
    </div>`;

  const bubble = (label: string, tone: "ready" | "unchecked" | "issue") =>
    `<span class="bubble ${tone}">${label}</span>`;

  const vehicleBubble = (
    vehicle: SafetyReportVehicle,
    tone: "ready" | "unchecked"
  ) =>
    bubble(
      `${tone === "ready" ? "✅" : "🕒"} ${esc(vehicle.driver)} · ${esc(vehicle.registration)}`,
      tone
    );

  const issueBubble = (issue: SafetyReportIssue) =>
    bubble(`${esc(issue.icon || "⚠️")} ${esc(issue.nameEn)}`, "issue");

  const listPeople = (people: string[]) =>
    `<div class="people">${people
      .map((person) => `<span class="person-pill">${esc(person)}</span>`)
      .join("")}</div>`;

  const readyOverview = `
    <section class="report-section compact-section">
      <h2>รถพร้อมใช้งาน <span>Ready vehicles · ${readyCount}</span></h2>
      <p class="section-caption">รายชื่อคนขับและทะเบียนรถที่ตรวจแล้วและพร้อมใช้งาน / Drivers and registrations that have passed the latest check.</p>
      <div class="bubble-list">${sortedReady.map((v) => vehicleBubble(v, "ready")).join("") || empty}</div>
    </section>`;

  const summaryTable = `
    <table class="equipment-table">
      <thead>
        <tr>
          <th>อุปกรณ์ / Equipment</th>
          <th class="num">จำนวน / Qty</th>
          <th>ผู้ขับขี่ (ทะเบียนรถ) / Drivers (Registration)</th>
        </tr>
      </thead>
      <tbody>
        ${
          groups
            .map(
              (g) => `
            <tr>
              <td>
                <div class="equipment-name"><span class="emoji">${esc(g.icon || "⚠️")}</span><div><b>${esc(
                  g.nameTh
                )}</b><span class="en">${esc(g.nameEn)}</span></div></div>
              </td>
              <td class="num qty">${g.count}</td>
              <td>${listPeople(g.people)}</td>
            </tr>`
            )
            .join("") || `<tr><td colspan="3">${empty}</td></tr>`
        }
      </tbody>
    </table>`;

  const conciseDrivers = `
    <section class="report-section">
      <h2>รถที่ต้องดำเนินการ <span>Vehicles requiring action · ${affectedCount}</span></h2>
      <table class="compact action-table">
        <thead>
          <tr>
            <th>คนขับ / Driver</th>
            <th>ทะเบียนรถ / Registration</th>
            <th>อุปกรณ์ที่ขาดหรือชำรุด / Missing or damaged equipment</th>
          </tr>
        </thead>
        <tbody>
          ${
            sortedAffected
              .map(
                (v) => `
              <tr>
                <td><b>${esc(v.driver)}</b></td>
                <td class="reg">${esc(v.registration)}</td>
                <td><div class="bubble-list compact-bubbles">${v.issues
                  .map(
                    (i) => `<span class="bubble issue">${esc(i.icon || "⚠️")} ${esc(i.nameTh)} <span class="inline-en">/ ${esc(
                      i.nameEn
                    )}</span></span>`
                  )
                  .join("")}</div></td>
              </tr>`
              )
              .join("") || `<tr><td colspan="3">${empty}</td></tr>`
          }
        </tbody>
      </table>
    </section>`;

  const uncheckedSection = `
    <section class="report-section">
      <h2>รถที่ยังไม่ส่งผลตรวจ <span>Vehicles awaiting inspection · ${notCheckedCount}</span></h2>
      <p class="section-caption">ยังไม่ยืนยันความพร้อมของอุปกรณ์ / Equipment readiness has not been confirmed.</p>
      <div class="bubble-list">${sortedUnchecked.map((v) => vehicleBubble(v, "unchecked")).join("") || empty}</div>
      <table class="compact top-gap">
        <thead>
          <tr>
            <th>คนขับ / Driver</th>
            <th>ทะเบียนรถ / Registration</th>
            <th>รุ่นรถ / Vehicle model</th>
            <th>สถานะ / Status</th>
          </tr>
        </thead>
        <tbody>
          ${
            sortedUnchecked
              .map(
                (v) => `
              <tr>
                <td><b>${esc(v.driver)}</b></td>
                <td class="reg">${esc(v.registration)}</td>
                <td>${esc(v.model || "—")}</td>
                <td><span class="pending">🕒 ยังไม่ตรวจ<span class="en">Not checked</span></span></td>
              </tr>`
              )
              .join("") || `<tr><td colspan="4">${empty}</td></tr>`
          }
        </tbody>
      </table>
    </section>`;

  // Management version: no duplicate table; the named registration chips are complete.
  // Detailed version retains the model/status table for office follow-up.
  const uncheckedSummary = `
    <section class="report-section">
      <h2>รถที่ยังไม่ส่งผลตรวจ <span>Vehicles awaiting inspection · ${notCheckedCount}</span></h2>
      <p class="section-caption">ยังไม่ยืนยันความพร้อมของอุปกรณ์ / Equipment readiness has not been confirmed.</p>
      <div class="bubble-list">${sortedUnchecked.map((v) => vehicleBubble(v, "unchecked")).join("") || empty}</div>
    </section>`;

  const detailRow = (v: SafetyReportVehicle) => `
    <section class="vehicle-block">
      <div class="vehicle-title">
        <strong>${esc(v.driver)}</strong>
        <b>${esc(v.registration)}</b>
        <span>${esc(v.model)}</span>
      </div>
      <table class="compact">
        <thead>
          <tr>
            <th>อุปกรณ์ / Equipment</th>
            <th>ปัญหา / Issue</th>
            <th>ผู้รับผิดชอบ / Responsible</th>
            <th>การดำเนินการ / Progress</th>
          </tr>
        </thead>
        <tbody>
          ${v.issues
            .map((i) => {
              const t = tracking.get(i.id);
              return `
                <tr>
                  <td>
                    <div class="equipment-name"><span class="emoji">${esc(i.icon || "⚠️")}</span><div><strong>${esc(
                      i.nameTh
                    )}</strong><span class="en">${esc(i.nameEn)}</span></div></div>
                  </td>
                  <td>${esc(typeLabel(i.type))}</td>
                  <td>${esc(t?.assigned_to || "—")}</td>
                  <td>${esc(stageLabel(t?.stage))}</td>
                </tr>
                <tr class="note-row">
                  <td colspan="4">
                    <b>บันทึกจากคนขับ / Driver note:</b> ${esc(i.notes || "—")}<br>
                    <b>ติดตามงาน / Office follow-up:</b> ${esc(t?.note || "—")}
                    <span class="muted">· ${esc(date(i.reportedAt))}${
                      t?.updated_at ? ` · Updated ${esc(date(t.updated_at))}` : ""
                    }</span>
                  </td>
                </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </section>`;

  const warnings = trackingError
    ? `<div class="warning">ไม่สามารถโหลดข้อมูลการติดตาม / Follow-up data unavailable: ${esc(
        trackingError
      )}.</div>`
    : "";

  const caution = `<footer><div class="footer-top"><strong>จัดทำโดย EES Operations / Prepared by EES Operations</strong><span>${esc(asAt)} · Bangkok</span></div><div class="footer-note">ข้อมูล ณ วันที่จัดทำรายงาน / Snapshot at time of report generation. Outstanding counts are reported issues, not confirmed purchase quantities. Equipment remains outstanding until the safety inspection is updated and verified. Vehicles awaiting inspection have not confirmed equipment readiness.</div></footer>`;

  const html = `<!doctype html>
  <html lang="th">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>EES Vehicle Safety — ${
        format === "summary" ? "Management Summary" : "Detailed Report"
      }</title>
      <style>
        @page{size:A4;margin:12mm 12mm}
        *{box-sizing:border-box}
        body{margin:0;background:#eeece8;color:#2d2736;font-family:Tahoma,"Noto Sans Thai",Arial,sans-serif;font-size:10px;line-height:1.42}
        .sheet{width:210mm;min-height:297mm;margin:18px auto;padding:14mm 14mm 12mm;background:#fff;box-shadow:0 10px 25px rgba(0,0,0,.08)}
        .actions{display:flex;gap:10px;justify-content:center;position:sticky;top:0;background:#f5f1eb;padding:10px;z-index:4}
        .actions button{background:#64238d;color:#fff;border:0;border-radius:10px;padding:9px 17px;font-weight:700;cursor:pointer}
        .actions button.secondary{background:#e7e0ed;color:#3c2d50}
        .header{display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:2px solid #64238d;padding-bottom:11px}
        .identity{display:flex;gap:13px;align-items:center;min-width:0}
        .brand-logo{width:92px;height:92px;object-fit:contain;flex:none;border-radius:13px}
        .brand{font-size:10px;letter-spacing:.9px;color:#64238d;font-weight:700}
        .header h1{font-size:20px;line-height:1.17;margin:3px 0}
        .header h1 span{display:block;font-size:15px;font-weight:700;color:#2f2745}
        .subtitle{font-size:10px;color:#6f6878}
        .report-type{text-align:right;white-space:nowrap;text-transform:uppercase;font-size:11px;font-weight:700;color:#64238d;padding-top:10px}
        .report-type .en{display:block;font-size:10px;margin-top:2px}
        .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:12px 0 13px}
        .stats>div{border:1px solid #e8e1d9;background:#fdfbf7;padding:8px 11px;border-radius:9px}
        .stats b{display:block;font-size:24px;line-height:1;color:#241c38}
        .stats span{display:block;margin-top:5px;font-size:10px;color:#6f6878}
        .report-section{margin-top:12px} .report-section>h2{break-after:avoid;page-break-after:avoid}
        .compact-section{margin-top:8px}
        h2{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px;font-size:13px;line-height:1.35;border-bottom:1px solid #ddd5e2;margin:0 0 7px;padding-bottom:5px;color:#221b32}
        h2 span{font-weight:500;color:#756d80;font-size:11px}
        .section-caption{font-size:9.5px;color:#766e7e;margin:2px 0 8px}
        table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px}
        th{background:#f4eef9;color:#47344d;text-align:left;font-size:9.5px;padding:6px 8px;border-bottom:1px solid #dcd4e1}
        td{padding:5px 8px;vertical-align:top;border-bottom:1px solid #eee8e3;overflow-wrap:anywhere}
        tr{break-inside:avoid;page-break-inside:avoid}
        thead{display:table-header-group}
        .equipment-table th:first-child{width:30%}
        .equipment-table th.num{width:64px}
        .equipment-table .qty{font-size:16px;color:#8a2459;font-weight:800}
        .num{text-align:center}
        .en{display:block;font-size:9px;color:#78717e}
        .inline-en{font-size:9px;color:#7d7681}
        .top-gap{margin-top:10px}
        .people,.bubble-list{display:flex;flex-wrap:wrap;gap:6px}
        .person-pill{display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border-radius:999px;background:#f7f3ee;border:1px solid #ece4dc;white-space:nowrap;font-size:9px}
        .bubble{display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:999px;font-size:9px;font-weight:700;border:1px solid transparent;white-space:nowrap}
        .bubble.ready{background:#ecfbf4;border-color:#b8e8cc;color:#0f6b3e}
        .bubble.unchecked{background:#fff7e7;border-color:#efd59b;color:#9a6200}
        .bubble.issue{background:#fff1f4;border-color:#f2ced8;color:#a12a54;font-weight:600}
        .compact-bubbles{gap:5px}
        .equipment-name{display:flex;align-items:flex-start;gap:8px}
        .emoji{font-size:16px;line-height:1.1}
        .compact th:nth-child(1){width:22%}
        .compact th:nth-child(2){width:23%}
        .action-table th:nth-child(3){width:55%}
        .reg{font-weight:700;white-space:nowrap}
        .pending{display:inline-flex;align-items:center;gap:5px;color:#a56011;font-weight:700}
        .vehicle-block{margin:14px 0;break-inside:avoid;page-break-inside:avoid}
        .vehicle-title{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:9px 10px;background:#faf7f2;border:1px solid #eee5dc;border-radius:10px 10px 0 0}
        .vehicle-title strong,.vehicle-title b{font-size:12px}
        .vehicle-title span{color:#7c7480}
        .note-row td{padding:6px 8px;background:#fdfcfb;font-size:9.5px}
        .muted{color:#746e79}
        .warning{padding:8px 10px;background:#fff4dc;color:#854d00;margin:10px 0;border-radius:8px;border:1px solid #f0dbab}
        footer{margin-top:16px;padding-top:9px;border-top:1px solid #e4dfe2;color:#79727a;font-size:8.8px}.footer-top{display:flex;justify-content:space-between;gap:12px;color:#4a4055;font-size:9px}.footer-top strong{color:#612786}.footer-note{margin-top:5px;color:#7e7883;font-size:8px}

        /* Compact management layout: keep labels and equipment icons readable. */
        .summary-report .equipment-table td{padding:4px 7px}
        .summary-report .equipment-table th{padding:5px 7px}
        .summary-report .equipment-name{gap:6px}
        .summary-report .equipment-name .emoji{font-size:15px}
        .summary-report .action-table td{padding:4px 7px}
        .summary-report .action-table th{padding:5px 7px}
        .summary-report .bubble.issue{padding:3px 7px;font-size:8.6px}
        .summary-report .compact-bubbles{gap:3px}
        .summary-report .person-pill{padding:2px 6px;font-size:8.8px}
        .summary-report .report-section{margin-top:10px}
        .summary-report .bubble-list{gap:4px}

        @media print{body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.actions{display:none}.sheet{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}.report-section{break-inside:auto}.vehicle-block{break-inside:avoid;page-break-inside:avoid}tr{break-inside:avoid}}
        @media screen and (max-width:850px){.sheet{width:auto;min-height:0;margin:10px;padding:18px}.stats{grid-template-columns:repeat(2,1fr)}}
      </style>
    </head>
    <body>
      <div class="actions">
        <button onclick="window.print()">บันทึกเป็น PDF / Print or save PDF</button>
        <button class="secondary" onclick="window.close()">Close / ปิด</button>
      </div>
      <main class="sheet ${format === "summary" ? "summary-report" : "detailed-report"}">
        <header class="header">
          <div class="identity">
            ${logo}
            <div>
              <div class="brand">EXPERT EXPRESS SENDER CO., LTD.</div>
              <h1>รายงานความปลอดภัยรถ<span>Vehicle Safety Report</span></h1>
              <div class="subtitle">จัดทำเมื่อ / Generated: ${esc(asAt)} (Bangkok)</div>
            </div>
          </div>
          <div class="report-type">${
            format === "summary"
              ? "สรุปผู้บริหาร<span class='en'>MANAGEMENT SUMMARY</span>"
              : "รายงานฉบับละเอียด<span class='en'>DETAILED REPORT</span>"
          }</div>
        </header>

        ${stats}
        ${warnings}
        ${readyOverview}

        <section class="report-section">
          <h2>สรุปอุปกรณ์ที่ต้องจัดหา <span>Equipment requiring action · ${allIssues.length} items</span></h2>
          ${summaryTable}
        </section>

        ${format === "summary" ? conciseDrivers : `<section class="report-section"><h2>รายละเอียดของรถที่มีปัญหา <span>Detailed issue and replacement progress</span></h2>${
          sortedAffected.map(detailRow).join("") || empty
        }</section>`}

        ${format === "summary" ? uncheckedSummary : uncheckedSection}
        ${caution}
      </main>
    </body>
  </html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
}
