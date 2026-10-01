"use client";

import clsx from "clsx";
import { Fuel } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

type StationBrand = "bangchak" | "shell" | "other" | "blank";

type FuelStationBadgeProps = {
  station?: string | null;
  className?: string;
  compact?: boolean;
  count?: number;
};

function getStationBrand(station?: string | null): StationBrand {
  const normalized = station?.trim().toLocaleLowerCase() ?? "";
  if (!normalized) return "blank";
  if (normalized.includes("bangchak") || normalized.includes("บางจาก")) return "bangchak";
  if (normalized.includes("shell")) return "shell";
  return "other";
}

const stationLogoByBrand = {
  bangchak: "/fuel-logos/bangchak.png",
  shell: "/fuel-logos/shell.png"
} as const;

export function FuelStationBadge({ station, className, compact = false, count }: FuelStationBadgeProps) {
  const label = station?.trim() ?? "";
  const brand = getStationBrand(station);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    setLogoFailed(false);
  }, [brand]);

  if (brand === "blank") {
    return <span className={clsx("text-slate-400", className)}>—</span>;
  }

  const logoSize = compact ? 20 : 24;
  const hasBrandLogo = brand === "bangchak" || brand === "shell";

  return (
    <span
      className={clsx(
        "inline-flex max-w-full items-center rounded-full border border-slate-200 bg-white font-semibold text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        compact ? "gap-1.5 px-2 py-1 text-[11px]" : "gap-2 px-2.5 py-1.5 text-xs",
        className
      )}
      title={label}
    >
      {hasBrandLogo && !logoFailed ? (
        <Image
          src={stationLogoByBrand[brand]}
          alt=""
          width={logoSize}
          height={logoSize}
          className="shrink-0 object-contain"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500" style={{ width: logoSize, height: logoSize }}>
          <Fuel className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden="true" />
        </span>
      )}
      <span className="truncate">{label}</span>
      {count != null ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 tabular-nums text-slate-600">{count}</span> : null}
    </span>
  );
}
