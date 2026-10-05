"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode, Ref } from "react";

export function DriverDisclosure({ title, id, children, detailsRef, compact = false }: {
  title: string;
  id?: string;
  children: ReactNode;
  detailsRef?: Ref<HTMLDetailsElement>;
  compact?: boolean;
}) {
  return (
    <details ref={detailsRef} className={`driver-disclosure group ${compact ? "driver-disclosure-compact" : "driver-surface"}`}>
      <summary id={id} className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 font-semibold text-[#152638] [&::-webkit-details-marker]:hidden ${compact ? "text-xs text-slate-600" : "px-4 text-sm"}`}>
        <span>{title}</span>
        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400 group-open:rotate-90" />
      </summary>
      <div className="driver-disclosure-content">{children}</div>
    </details>
  );
}
