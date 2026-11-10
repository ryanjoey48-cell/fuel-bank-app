"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFinanceFixture } from "@/components/finance-fixture-provider";
import { bookingReference, confirmedWorkOrder } from "@/lib/finance-demo-centre";
import { demoCopy } from "@/lib/finance-demo-copy";
import { MANUAL_MASS_BOOKING_ID, mapFixtureBookingsToDiary } from "@/lib/finance-fixture-booking-diary";
import { useLanguage } from "@/lib/language-provider";

export function FinanceFixtureBookingDiary() {
  const { language } = useLanguage();
  const th = language === "th";
  const c = demoCopy[language];
  const { state, role, dispatch, error, clearError } = useFinanceFixture();
  const entries = useMemo(() => mapFixtureBookingsToDiary(state.bookings), [state.bookings]);
  const [selectedId, setSelectedId] = useState(MANUAL_MASS_BOOKING_ID);
  const selected = entries.find((row) => row.id === selectedId) ?? entries[0];
  const fixtureJob = state.bookings.find((job) => job.id === selected?.id);
  const [jobOrderNumber, setJobOrderNumber] = useState("");

  const woDraft = jobOrderNumber || fixtureJob?.returned.workOrder || "";

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <p className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-black text-amber-950">
        {th
          ? "สมุดจอง FIXTURE · ไม่บันทึก Supabase · งานทดสอบ Mass แยกจากข้อมูลจริง"
          : "FIXTURE BOOKING DIARY · No Supabase writes · Mass manual test isolated from production"}
      </p>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{c.diary}</h1>
          <p className="text-sm text-slate-600">{th ? "รายการจองจาก fixture ในเครื่อง" : "In-memory fixture bookings for manual walkthrough"}</p>
        </div>
        <Link href="/finance-centre" className="btn-secondary">{c.title}</Link>
      </header>
      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
          <button type="button" className="ml-2 font-bold underline" onClick={clearError}>{th ? "ปิด" : "Dismiss"}</button>
        </p>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <section className="surface-card p-4">
          <h2 className="font-bold">{c.bookingReference}</h2>
          <ul className="mt-3 max-h-[520px] space-y-2 overflow-auto">
            {entries.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => { setSelectedId(row.id); setJobOrderNumber(""); }}
                  className={`w-full rounded-lg border p-3 text-left text-sm ${selected?.id === row.id ? "border-violet-500 bg-violet-50" : "border-slate-200"}`}
                >
                  <strong>{row.booking_id}</strong>
                  <span className="block text-xs text-slate-600">
                    {row.job_order_number || c.awaitingGreenSheet} · {row.client?.name} · {row.booking_date}
                  </span>
                  {row.id === MANUAL_MASS_BOOKING_ID ? (
                    <span className="mt-1 block text-[10px] font-bold uppercase text-amber-800">SIMULATED LOCAL TEST</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
        {selected && fixtureJob ? (
          <section className="surface-card space-y-4 p-4">
            <h2 className="text-lg font-bold">{selected.booking_id}</h2>
            <p className="text-sm">{selected.pickup} → {selected.dropoff}</p>
            <p className="text-sm">{c.driver}: {selected.driver} · {c.vehicle}: {selected.vehicle_registration}</p>
            <p className="text-xs text-slate-500">{selected.notes}</p>
            <label className="block text-sm font-semibold">
              {c.workOrder}
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={woDraft}
                onChange={(event) => setJobOrderNumber(event.target.value)}
                placeholder={c.awaitingGreenSheet}
              />
            </label>
            <p className="text-xs text-slate-600">
              {confirmedWorkOrder(fixtureJob) ? c.workOrderConfirmed : c.awaitingGreenSheet}
            </p>
            <button
              type="button"
              className="btn-primary"
              disabled={role !== "office" || woDraft.trim().length < 3}
              onClick={() => dispatch({ type: "set_returned_work_order", jobId: fixtureJob.id, workOrder: woDraft.trim() })}
            >
              {c.save}
            </button>
            {role !== "office" ? <p className="text-xs text-amber-800">{c.requiresRole}: {c.roles.office}</p> : null}
            <Link className="inline-block text-sm font-semibold text-violet-800 underline" href={`/job-verification?booking=${encodeURIComponent(fixtureJob.id)}`}>
              {c.views.verification} · {bookingReference(fixtureJob)}
            </Link>
          </section>
        ) : null}
      </div>
    </main>
  );
}
