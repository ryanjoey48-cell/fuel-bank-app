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
    <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 shadow-soft">
      {t.common.setupNotice}
    </div>
  );
}
