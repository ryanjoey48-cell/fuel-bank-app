"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "@/lib/language-provider";

type Stage = "reported" | "arranging" | "supplied" | "verified";
type Tracking = { issue_id: string; stage: Stage; assigned_to: string | null; note: string | null; updated_at: string };
type Event = { id: string; stage: Stage; note: string | null; created_at: string };
export type TrackedIssue = { id: string; equipment: string; emoji: string; registration: string; driver: string; problem: string; originalNote: string | null };
type Props = { issue: TrackedIssue; onClose: () => void; onChange: () => void };
const stageOptions: Stage[] = ["reported", "arranging", "supplied", "verified"];
const stageNames = {
  en: { reported: "Reported", arranging: "Being arranged", supplied: "Supplied", verified: "Verified" },
  th: { reported: "แจ้งปัญหาแล้ว", arranging: "กำลังจัดหา", supplied: "ส่งมอบอุปกรณ์แล้ว", verified: "ตรวจสอบเรียบร้อย" }
};
export function SafetyReplacementPanel({ issue, onClose, onChange }: Props) {
  const { language } = useLanguage();
  const en = language === "en";
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [history, setHistory] = useState<Event[]>([]);
  const [stage, setStage] = useState<Stage>("reported");
  const [assignedTo, setAssignedTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    const [record, events] = await Promise.all([
      supabase.from("vehicle_safety_replacement_tracking").select("issue_id,stage,assigned_to,note,updated_at").eq("issue_id", issue.id).maybeSingle(),
      supabase.from("vehicle_safety_replacement_events").select("id,stage,note,created_at").eq("issue_id", issue.id).order("created_at", { ascending: false })
    ]);
    if (record.error || events.error) setError(record.error?.message || events.error?.message || "Load failed");
    else {
      const value = record.data as Tracking | null;
      setTracking(value); setStage(value?.stage ?? "reported"); setAssignedTo(value?.assigned_to ?? "");
      setNote(value?.note ?? ""); setHistory((events.data ?? []) as Event[]); setError("");
    }
    setLoading(false);
  }, [issue.id]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    if (busy) return;
    setBusy(true); setError("");
    const result = await supabase.rpc("save_vehicle_safety_replacement", {
      p_issue_id: issue.id, p_stage: stage, p_assigned_to: assignedTo.trim() || null, p_note: note.trim() || null
    });
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    onChange(); await load();
  };
  const labels = stageNames[en ? "en" : "th"];
  return <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={en ? "Manage equipment replacement" : "จัดการเปลี่ยนอุปกรณ์"} className="flex max-h-[94dvh] w-full max-w-[620px] flex-col overflow-hidden rounded-t-3xl border border-[#eee7de] bg-[#fffdf8] shadow-2xl sm:rounded-3xl">
      <header className="flex items-start justify-between gap-4 border-b border-[#eee7de] p-5">
        <div><p className="text-[11px] font-semibold uppercase tracking-widest text-violet-600">{en ? "EQUIPMENT FOLLOW-UP" : "ติดตามอุปกรณ์"}</p><h2 className="mt-1 text-xl font-semibold text-slate-950">{issue.emoji} {issue.equipment}</h2><p className="mt-1 text-sm text-slate-500">{issue.driver} · {issue.registration} · {issue.problem}</p></div>
        <button type="button" onClick={onClose} className="rounded-xl border px-3 py-2 text-sm text-slate-600">✕</button>
      </header>
      <div className="space-y-4 overflow-y-auto p-5">
        {issue.originalNote && <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3 text-sm text-slate-700"><p className="text-xs font-semibold text-rose-800">{en ? "Original driver report" : "รายละเอียดที่คนขับแจ้ง"}</p><p className="mt-1">{issue.originalNote}</p></div>}
        {loading ? <p className="text-sm text-slate-500">{en ? "Loading..." : "กำลังโหลด..."}</p> : <>
          <label className="block text-sm font-medium text-slate-800">{en ? "Replacement progress" : "สถานะการเปลี่ยนอุปกรณ์"}<select className="form-input mt-1 bg-white" value={stage} onChange={e => setStage(e.target.value as Stage)}>{stageOptions.map(s => <option value={s} key={s}>{labels[s]}</option>)}</select></label>
          <label className="block text-sm font-medium text-slate-800">{en ? "Responsible person" : "ผู้รับผิดชอบ"}<input className="form-input mt-1 bg-white" value={assignedTo} onChange={e => setAssignedTo(e.target.value)} placeholder={en ? "Who is arranging this?" : "ใครเป็นผู้ดำเนินการ"} maxLength={120}/></label>
          <label className="block text-sm font-medium text-slate-800">{en ? "Office notes" : "หมายเหตุจากสำนักงาน"}<textarea className="form-input mt-1 min-h-24 bg-white" value={note} onChange={e => setNote(e.target.value)} placeholder={en ? "Order, delivery or verification details..." : "รายละเอียดการสั่งซื้อ ส่งมอบ หรือตรวจสอบ..."}/></label>
          {stage === "verified" && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{en ? "Verification is logged here, but the vehicle stays flagged until its safety issue is cleared through a safety check. Do not edit the original inspection just to mark an item ordered." : "บันทึกการตรวจสอบแล้ว แต่รถยังมีสถานะต้องดำเนินการจนกว่าจะตรวจความปลอดภัยและแก้ไขปัญหาให้เรียบร้อย"}</p>}
          {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          <div><h3 className="mb-2 text-sm font-semibold text-slate-800">{en ? "Activity history" : "ประวัติการดำเนินการ"}</h3>{history.length ? <div className="divide-y rounded-xl border bg-white">{history.map(item => <div key={item.id} className="p-3 text-xs"><span className="font-semibold">{labels[item.stage]}</span><span className="ml-2 text-slate-400">{new Date(item.created_at).toLocaleString(en ? "en-GB" : "th-TH")}</span>{item.note && <p className="mt-1 text-slate-600">{item.note}</p>}</div>)}</div> : <p className="text-xs text-slate-500">{en ? "No updates recorded yet." : "ยังไม่มีประวัติการอัปเดต"}</p>}</div>
        </>}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-[#eee7de] p-4"><button type="button" onClick={onClose} className="rounded-xl border px-4 py-2 text-sm">{en ? "Close" : "ปิด"}</button><button type="button" onClick={() => void save()} disabled={busy || loading} className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? (en ? "Saving..." : "กำลังบันทึก") : (en ? "Save progress" : "บันทึกความคืบหน้า")}</button></footer>
    </section>
  </div>;
}
