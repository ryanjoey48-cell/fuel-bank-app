import Link from "next/link";
import { notFound } from "next/navigation";
import { financePreviewRoutes, isFinanceLocalPreview } from "@/lib/finance-local-preview";

export default function FinancePreviewHubPage() {
  if (process.env.NODE_ENV === "production") notFound();
  if (!isFinanceLocalPreview()) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <h1 className="text-2xl font-bold">Finance preview is not enabled</h1>
        <p className="text-sm text-slate-600">Start with <code>npm run dev:finance-preview</code>. That command clears Supabase credentials for the local process only.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8 text-slate-900">
      <header className="rounded-2xl bg-violet-950 p-6 text-white">
        <p className="text-xs font-bold tracking-[.2em] text-amber-300">EES · LOCAL FIXTURE PREVIEW</p>
        <h1 className="mt-2 text-3xl font-bold">Finance Centre screens</h1>
        <p className="mt-2 text-sm text-violet-100">
          These are the real application page components. Development Supabase is unavailable, so interactive persistence uses fixtures only. Nothing here is live booking, invoice, or customer data.
        </p>
      </header>
      <p className="rounded-lg border-4 border-amber-500 bg-amber-100 p-3 text-sm font-black text-amber-950">
        LOCAL PREVIEW ONLY · NO DATABASE · NO PRODUCTION ACCESS · NO TRN ISSUANCE
      </p>
      <section className="space-y-3">
        {financePreviewRoutes.map((route) => (
          <Link key={route.href} href={route.href} className="block rounded-xl border border-violet-200 bg-white p-4 shadow-sm hover:border-violet-500">
            <strong className="text-violet-900">{route.labelEn}</strong>
            <span className="ml-2 text-sm text-slate-500">{route.labelTh}</span>
            <p className="mt-1 text-xs text-slate-600">{route.mode}</p>
            <p className="mt-1 font-mono text-xs text-violet-700">{route.href}</p>
          </Link>
        ))}
      </section>
      <p className="text-xs text-slate-500">
        Booking Diary remains the operational source in production. This preview never creates bookings and never connects to Supabase.
      </p>
    </main>
  );
}
