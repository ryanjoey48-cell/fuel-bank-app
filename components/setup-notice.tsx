"use client";

import { useLanguage } from "@/lib/language-provider";

export function SetupNotice() {
  const { t } = useLanguage();
  const missingEnv =
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!missingEnv) {
    return null;
  }

  return (
    <div className="rounded-3xl border border-accent-200/90 bg-accent-50/92 px-5 py-4 text-sm text-amber-900 shadow-[0_12px_28px_rgba(249,115,22,0.1)] backdrop-blur">
      {t.common.setupNotice}
    </div>
  );
}
