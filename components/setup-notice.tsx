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
    <div className="rounded-[1.75rem] border border-accent-200/80 bg-[linear-gradient(135deg,rgba(255,249,240,0.98),rgba(255,255,255,0.98))] px-5 py-4 text-sm text-amber-900 shadow-[0_18px_32px_rgba(242,138,47,0.08)] backdrop-blur">
      {t.common.setupNotice}
    </div>
  );
}
