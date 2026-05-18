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
        "inline-flex shrink-0 items-center rounded-[0.7rem] border border-slate-200 bg-white/96 p-0.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]",
        compact ? "gap-0" : "gap-0.5"
      )}
      aria-label={t.common.language}
      role="group"
    >
      <button
        type="button"
        onClick={() => setLanguage("en")}
        className={clsx(
          "rounded-[0.55rem] font-bold transition duration-150 active:scale-[0.98]",
          compact ? "min-h-[28px] min-w-[34px] px-2 text-[11px]" : "min-h-[30px] min-w-[38px] px-2.5 text-[11px]",
          language === "en"
            ? "bg-brand-700 text-white shadow-[0_6px_14px_rgba(95,51,183,0.18)]"
            : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
        )}
        aria-pressed={language === "en"}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLanguage("th")}
        className={clsx(
          "rounded-[0.55rem] font-bold transition duration-150 active:scale-[0.98]",
          compact ? "min-h-[28px] min-w-[34px] px-2 text-[11px]" : "min-h-[30px] min-w-[38px] px-2.5 text-[11px]",
          language === "th"
            ? "bg-brand-700 text-white shadow-[0_6px_14px_rgba(95,51,183,0.18)]"
            : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
        )}
        aria-pressed={language === "th"}
      >
        TH
      </button>
    </div>
  );
}
