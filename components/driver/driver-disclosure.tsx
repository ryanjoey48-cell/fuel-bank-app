"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode, Ref } from "react";

export function DriverDisclosure({ title, id, children, detailsRef }: {
  title: string;
  id?: string;
  children: ReactNode;
  detailsRef?: Ref<HTMLDetailsElement>;
}) {
  return (
    <details ref={detailsRef} className="driver-disclosure group rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <summary id={id} className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-semibold text-[#152638] [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400 group-open:rotate-90" />
      </summary>
      {children}
    </details>
  );
}
