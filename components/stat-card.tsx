import { ReactNode } from "react";

type StatCardProps = {
  label: string;
  value: string;
  helper: string;
  icon: ReactNode;
};

export function StatCard({ label, value, helper, icon }: StatCardProps) {
  return (
    <div className="surface-card-soft flex h-full min-h-[164px] min-w-0 flex-col overflow-hidden p-4 sm:min-h-[176px] sm:p-4.5">
      <div className="absolute inset-x-0 top-0 h-16 bg-[linear-gradient(135deg,rgba(109,40,217,0.08),rgba(249,115,22,0.04)_70%,transparent)]" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-2 break-words text-[1.55rem] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[1.85rem]">
            {value}
          </p>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/80 bg-white text-brand-700 shadow-[0_12px_24px_rgba(109,40,217,0.08)]">
          {icon}
        </div>
      </div>
      <p className="relative mt-4 line-clamp-3 text-[13px] leading-6 text-slate-500">{helper}</p>
    </div>
  );
}
