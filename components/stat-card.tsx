import { ReactNode } from "react";

type StatCardProps = {
  label: string;
  value: string;
  helper: string;
  icon: ReactNode;
};

export function StatCard({ label, value, helper, icon }: StatCardProps) {
  return (
    <div className="surface-card-soft flex h-full min-h-[152px] flex-col p-3.5 sm:min-h-[164px] sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium leading-5 text-slate-400">{label}</p>
          <p className="mt-1.5 break-words text-[1.45rem] font-semibold tracking-[-0.03em] text-slate-900 sm:text-[1.75rem]">
            {value}
          </p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brand-100 bg-brand-50 text-brand-700 shadow-[0_8px_20px_rgba(109,40,217,0.08)] sm:h-10 sm:w-10">
          {icon}
        </div>
      </div>
      <p className="mt-2 line-clamp-3 text-[12px] leading-5 text-slate-500">{helper}</p>
    </div>
  );
}
