import { PackageOpen } from "lucide-react";

type EmptyStateProps = {
  title: string;
  description: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="surface-card-soft border-dashed px-5 py-8 text-center sm:px-6 sm:py-10">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200/80 bg-white shadow-[0_16px_34px_rgba(15,23,42,0.06)]">
        <PackageOpen className="h-6 w-6 text-slate-400" />
      </div>
      <h3 className="mt-4 text-lg font-semibold tracking-[-0.03em] text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}
