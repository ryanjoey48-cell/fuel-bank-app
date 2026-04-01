"use client";

import { PackageOpen } from "lucide-react";
import { useLanguage } from "@/lib/language-provider";

type EmptyStateProps = {
  title: string;
  description: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  const { t } = useLanguage();
  const lowerDescription = description.toLowerCase();
  const premiumDescription =
    lowerDescription.includes("loading") || lowerDescription.includes("กำลัง")
      ? description
      : description.endsWith(".")
        ? `${description.slice(0, -1)} to unlock clearer visibility.`
        : `${description} to unlock clearer visibility.`;

  return (
    <div className="surface-card-soft premium-empty-state">
      <div className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-[1.55rem] border border-brand-100/70 bg-[linear-gradient(180deg,#ffffff_0%,#faf7ff_100%)] shadow-[0_18px_36px_rgba(38,18,78,0.08)]">
        <PackageOpen className="h-6 w-6 text-brand-600" />
      </div>
      <h3 className="mt-6 text-[1.28rem] font-semibold tracking-[-0.04em] text-slate-950">
        {title}
      </h3>
      <p className="empty-state-description">{premiumDescription}</p>
      <p className="empty-state-note">{t.common.emptyStateHint}</p>
    </div>
  );
}
