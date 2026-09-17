"use client";
import { useLanguage } from "@/lib/language-provider";
import { maintenanceDateRange } from "@/lib/maintenance-ux";

export function MaintenancePeriodPresets({ start, end, onChange }: { start: string; end: string; onChange: (range: {start: string; end: string}) => void }) {
  const { t } = useLanguage();
  return <div className="flex flex-wrap gap-2" aria-label={t.maintenance.period}>{(["thisYear", "last12Months", "allTime"] as const).map(key => {
    const range = maintenanceDateRange(key);
    const active = range.start === start && range.end === end;
    return <button type="button" key={key} className={`min-h-9 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active?"border-violet-300 bg-violet-100 text-violet-800 shadow-sm":"border-violet-100 bg-white/70 text-slate-600 hover:border-violet-200 hover:bg-violet-50"}`} aria-pressed={active} onClick={() => onChange(range)}>{t.maintenance[key]}</button>;
  })}</div>;
}
