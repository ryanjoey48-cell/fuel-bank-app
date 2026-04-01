import { ReactNode } from "react";

type StatCardProps = {
  label: string;
  value: string;
  helper: string;
  icon: ReactNode;
  valueVariant?: "default" | "date";
};

export function StatCard({ label, value, helper, icon, valueVariant = "default" }: StatCardProps) {
  return (
    <div className="surface-card-soft card-metric-shell">
      <div className="card-metric-header">
        <div className="min-w-0 flex-1">
          <p className="metric-label">{label}</p>
          <p className={valueVariant === "date" ? "metric-value-date" : "metric-value"}>
            {value}
          </p>
        </div>
        <div className="card-metric-icon">
          {icon}
        </div>
      </div>
      <p className="metric-helper">{helper}</p>
    </div>
  );
}
