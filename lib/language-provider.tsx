"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { safeLocalStorage } from "@/lib/safe-browser-storage";
import { translations, type Language } from "@/lib/translations";

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (typeof translations)[Language];
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

const STORAGE_KEY = "fuel-bank-language";

// useLayoutEffect on the client so the saved language (and the document's lang attribute) are applied BEFORE the first paint; the server
// render and first client render are still English, so hydration is unchanged.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");
  // V7.8.4: a returning Thai user used to load with <html lang="en"> and Thai content (the saved language was applied in a later effect), which
  // made the browser's translation feature treat the page as English, and the same mount wrote "en" over the saved "th" before it was applied.
  useIsomorphicLayoutEffect(() => {
    const saved = safeLocalStorage.getItem(STORAGE_KEY) as Language | null;
    if (saved === "en" || saved === "th") {
      document.documentElement.lang = saved;
      setLanguage(saved);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // The choice is saved when the user makes it, never as a side effect of the initial default.
  const chooseLanguage = useCallback((next: Language) => {
    setLanguage(next);
    safeLocalStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo(
    () => ({
      language,
      setLanguage: chooseLanguage,
      t: translations[language]
    }),
    [language, chooseLanguage]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }

  return context;
}
