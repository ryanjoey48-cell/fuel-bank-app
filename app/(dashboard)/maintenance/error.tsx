"use client";

import { useEffect } from "react";
import { useLanguage } from "@/lib/language-provider";

export default function MaintenanceError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useLanguage();
  useEffect(() => { console.error("Maintenance rendering failed", error); }, [error]);
  return (
    <section className="surface-card space-y-3 p-5" role="alert">
      <h2 className="section-title">{t.maintenance.title}</h2>
      <p>{t.maintenance.loadError}</p>
      <button className="btn-primary" onClick={reset}>{t.maintenance.refresh}</button>
    </section>
  );
}
