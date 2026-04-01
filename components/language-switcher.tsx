"use client";

import clsx from "clsx";
import { useLanguage } from "@/lib/language-provider";

type LanguageSwitcherProps = {
  compact?: boolean;
};

export function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div
      className={clsx(
        "inline-flex shrink-0 items-center rounded-full border border-brand-100/70 bg-white/96 p-1 shadow-[0_10px_22px_rgba(38,18,78,0.06)]",
        compact ? "gap-0" : "gap-0.5"
      )}
      aria-label={t.common.language}
      role="group"
    >
      <button
        type="button"
        onClick={() => setLanguage("en")}
        className={clsx(
          "rounded-full font-semibold transition duration-200",
          compact ? "min-h-[38px] min-w-[44px] px-3 text-xs" : "min-h-[42px] min-w-[50px] px-4 text-sm",
          language === "en"
            ? "bg-brand-600 text-white shadow-[0_10px_20px_rgba(95,51,183,0.18)]"
            : "text-slate-600 hover:bg-brand-50 hover:text-slate-900"
        )}
        aria-pressed={language === "en"}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLanguage("th")}
        className={clsx(
          "rounded-full font-semibold transition duration-200",
          compact ? "min-h-[38px] min-w-[44px] px-3 text-xs" : "min-h-[42px] min-w-[50px] px-4 text-sm",
          language === "th"
            ? "bg-brand-600 text-white shadow-[0_10px_20px_rgba(95,51,183,0.18)]"
            : "text-slate-600 hover:bg-brand-50 hover:text-slate-900"
        )}
        aria-pressed={language === "th"}
      >
        TH
      </button>
    </div>
  );
}
