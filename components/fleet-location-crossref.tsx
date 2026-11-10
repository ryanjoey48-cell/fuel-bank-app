"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { crossRefReason, crossRefStatusLabel, type CrossRefResult } from "@/lib/fleet-location-crossref";

type Lang = "en" | "th";
type Response = { results: CrossRefResult[]; counts: Record<CrossRefResult["status"], number>; eesRecords: number; forthSites: number };
const SHOWN = 10;

/**
 * Reports: review-only name suggestions between the EES Locations Directory and Forth saved locations. It reads the directory with the
 * caller's own access (no Forth call), links nothing, saves nothing, and shows no coordinates. EES records have no coordinates, so a
 * suggestion says "these names look like the same company", never "this is the same place".
 */
export function FleetLocationCrossRef({ language }: { language: Lang }) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const [data, setData] = useState<Response | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "failed">("loading");
  const [all, setAll] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token; if (!token) throw new Error("session");
        const response = await fetch("/api/admin/forth-tracking/evidence/location-crossref", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
        if (controller.signal.aborted) return;
        if (response.status === 403) { setState("forbidden"); return; }
        if (!response.ok) throw new Error("status");
        setData(await response.json() as Response); setState("ready");
      } catch { if (!controller.signal.aborted) setState("failed"); }
    })();
    return () => controller.abort();
  }, []);
  if (state === "forbidden") return null;
  const rows = (data?.results ?? []).filter(r => r.status !== "none").sort((a, b) => ({ strong: 0, multiple: 1, possible: 2, none: 3 }[a.status] - { strong: 0, multiple: 1, possible: 2, none: 3 }[b.status]) || (a.eesName < b.eesName ? -1 : 1));
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <section className="v74-crossref fleet-evidence" aria-label={t("Directory suggestions", "ข้อเสนอจับคู่สมุดสถานที่")} data-location-crossref>
      <div className="v72-section-head"><h3>{t("EES directory ↔ Forth saved locations", "สมุดสถานที่ EES ↔ สถานที่ที่บันทึกใน Forth")}</h3><span className="v72-tag">{t("suggestions only", "เป็นข้อเสนอเท่านั้น")}</span></div>
      {state === "loading" ? <p className="v72-hint">{t("Comparing names…", "กำลังเปรียบเทียบชื่อ…")}</p> : null}
      {state === "failed" ? <p className="v72-empty-line" role="alert">{t("Suggestions could not be loaded right now.", "โหลดข้อเสนอไม่ได้ในขณะนี้")}</p> : null}
      {data ? (
        <>
          <dl className="v72-strip" data-crossref-summary>
            <div><dt>{t("EES records", "รายการ EES")}</dt><dd><b>{data.eesRecords}</b><small>{t("no coordinates", "ไม่มีพิกัด")}</small></dd></div>
            <div><dt>{t("Forth saved sites", "สถานที่ใน Forth")}</dt><dd><b>{data.forthSites}</b><small>{t("with coordinates", "มีพิกัด")}</small></dd></div>
            <div><dt>{t("Strong suggestion", "ข้อเสนอที่แข็งแรง")}</dt><dd><b>{data.counts.strong}</b><small>{t("same name, one site", "ชื่อตรงกัน หนึ่งสถานที่")}</small></dd></div>
            <div><dt>{t("Possible", "อาจตรงกัน")}</dt><dd><b>{data.counts.possible}</b><small>{t("similar name", "ชื่อคล้าย")}</small></dd></div>
            <div className={data.counts.multiple > 0 ? "is-attention" : ""}><dt>{t("Several competing", "หลายรายการแข่งกัน")}</dt><dd><b>{data.counts.multiple}</b><small>{t("office must choose", "สำนักงานต้องเลือก")}</small></dd></div>
            <div><dt>{t("No reliable match", "ไม่พบที่เชื่อถือได้")}</dt><dd><b>{data.counts.none}</b><small>{t("not suggested", "ไม่เสนอ")}</small></dd></div>
          </dl>
          {rows.length ? (
            <div className="v72-table-wrap"><table className="v72-table">
              <thead><tr><th scope="col">{t("EES directory record", "รายการในสมุดสถานที่ EES")}</th><th scope="col">{t("Suggested Forth saved name", "ชื่อใน Forth ที่เสนอ")}</th><th scope="col">{t("Result", "ผล")}</th><th scope="col">{t("Why", "เหตุผล")}</th></tr></thead>
              <tbody>{shown.map(r => <tr key={r.eesId} data-crossref-status={r.status}>
                <th scope="row">{r.eesName}</th>
                <td>{r.candidates.slice(0, 2).map(c => `${c.forthName}${c.groupLayer ? ` (${c.groupLayer})` : ""}${c.sites > 1 ? ` · ${c.sites} ${t("sites", "สถานที่")}` : ""}`).join(" · ")}</td>
                <td>{crossRefStatusLabel(r.status, language)}</td>
                <td>{r.reasons.slice(0, 2).map(x => crossRefReason(x, language)).join(" ")}</td>
              </tr>)}</tbody>
            </table></div>
          ) : <p className="v72-empty-line">{t("No Forth saved name resembles an EES directory record.", "ไม่มีชื่อใน Forth ที่คล้ายกับรายการในสมุดสถานที่ EES")}</p>}
          {rows.length > SHOWN ? <button type="button" className="btn-secondary" onClick={() => setAll(v => !v)}>{all ? t("Show fewer", "แสดงน้อยลง") : t(`Show all ${rows.length}`, `แสดงทั้งหมด ${rows.length}`)}</button> : null}
          <p className="v72-hint">{t("Names only: nothing is linked, saved or changed, and no coordinates are created for EES records. Two sites with the same company name more than 1 km apart are never merged. Use the Locations Directory to pin and verify a place.", "เทียบชื่อเท่านั้น ไม่มีการเชื่อม บันทึก หรือแก้ไข และไม่สร้างพิกัดให้รายการ EES สองสถานที่ที่ชื่อบริษัทเดียวกันแต่ห่างกันเกิน 1 กม. จะไม่ถูกรวมกัน ใช้สมุดสถานที่เพื่อปักหมุดและยืนยันสถานที่")}</p>
        </>
      ) : null}
    </section>
  );
}
