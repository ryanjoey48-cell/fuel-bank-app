"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  RefreshCw,
  Search,
  Truck,
  UserCheck,
  UserRound,
  UserX,
  XCircle
} from "lucide-react";
import {
  fetchDriverAccounts,
  type ManagedDriverAccount,
  type ManagedDriverAccountResult
} from "@/lib/account-management";
import { useLanguage } from "@/lib/language-provider";

function friendlyVehicleType(value: string | null) {
  if (!value) return "";

  const labels: Record<string, string> = {
    FOUR_WHEEL_TRUCK: "4-Wheel Truck",
    SIX_WHEEL_TRUCK: "6-Wheel Truck",
    SIX_PLUS_SIX_WHEELER: "6+6 Wheeler",
    EIGHTEEN_WHEELER: "18-Wheeler",
    TEN_WHEEL_TRUCK: "10-Wheel Truck",
    TRAILER: "Trailer"
  };

  return (
    labels[value] ??
    value
      .toLowerCase()
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

export function DriverAccounts() {
  const { language } = useLanguage();
  const th = language === "th";
  const copy = (en: string, thai: string) => (th ? thai : en);

  const [result, setResult] =
    useState<ManagedDriverAccountResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;

    setLoading(true);
    setError(null);

    try {
      const data = await fetchDriverAccounts();

      if (id === requestId.current) {
        setResult(data);
      }
    } catch (caught) {
      if (id === requestId.current) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load driver accounts."
        );
      }
    } finally {
      if (id === requestId.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();

    return () => {
      requestId.current++;
    };
  }, [load]);

  const query = search.trim().toLocaleLowerCase();

  const rows = (result?.drivers ?? []).filter((row) => {
    const active = row.accountActive === true && row.driverActive;

    return (
      (filter === "all" ||
        (filter === "active" ? active : row.accountId === null)) &&
      [row.name, row.email, row.vehicleRegistration].some((value) =>
        value?.toLocaleLowerCase().includes(query)
      )
    );
  });

  const status = (row: ManagedDriverAccount) =>
    row.accountId === null
      ? copy("No account", "ไม่มีบัญชี")
      : row.accountActive && row.driverActive
        ? copy("Active", "ใช้งาน")
        : copy("Inactive", "ไม่ใช้งาน");

  const badge = (row: ManagedDriverAccount) => (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${
        row.accountId === null
          ? "border-slate-200 bg-slate-50 text-slate-600"
          : row.accountActive && row.driverActive
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-rose-200 bg-rose-50 text-rose-700"
      }`}
    >
      {row.accountId !== null && row.accountActive && row.driverActive ? (
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      ) : null}

      {status(row)}
    </span>
  );

  const date = (value: string | null) =>
    value && !Number.isNaN(new Date(value).getTime())
      ? new Intl.DateTimeFormat(th ? "th-TH" : "en-GB", {
          dateStyle: "medium",
          timeStyle: "short"
        }).format(new Date(value))
      : "-";

  const security = (row: ManagedDriverAccount) =>
    row.accountId === null ? (
      "-"
    ) : (
      <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
        {row.emailConfirmedAt ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        ) : (
          <XCircle className="h-4 w-4 shrink-0 text-rose-500" />
        )}

        {row.emailConfirmedAt
          ? copy("Confirmed", "ยืนยันแล้ว")
          : copy("Not confirmed", "ยังไม่ยืนยัน")}
      </span>
    );

  const headings = [
    copy("Driver", "คนขับ"),
    copy("Vehicle", "รถ"),
    copy("Portal access", "สิทธิ์พอร์ทัล"),
    copy("Login email", "อีเมลเข้าสู่ระบบ"),
    copy("Last sign-in", "เข้าสู่ระบบล่าสุด"),
    copy("Security", "ความปลอดภัย")
  ];

  const summaries = [
    {
      label: copy("All drivers", "คนขับทั้งหมด"),
      value: result?.summary.total,
      icon: UserRound
    },
    {
      label: copy("Portal accounts", "บัญชีพอร์ทัล"),
      value: result?.summary.withAccount,
      icon: UserCheck
    },
    {
      label: copy("Active access", "สิทธิ์ที่ใช้งาน"),
      value: result?.summary.activeAccounts,
      icon: CheckCircle2
    },
    {
      label: copy("No account", "ไม่มีบัญชี"),
      value: result?.summary.withoutAccount,
      icon: UserX
    }
  ] as const;

  return (
    <section
      aria-labelledby="driver-accounts-title"
      className="overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm"
    >
      <div className="border-b border-slate-100 bg-gradient-to-r from-white to-violet-50/50 p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-violet-100 p-2.5 text-violet-700">
              <Truck className="h-5 w-5" />
            </span>

            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700">
                {copy("DRIVER ACCESS", "สิทธิ์คนขับ")}
              </p>

              <h2
                id="driver-accounts-title"
                className="mt-1 text-xl font-semibold text-slate-950"
              >
                {copy("Driver accounts", "บัญชีคนขับ")}
              </h2>

              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                {copy(
                  "See every driver and whether they currently have access to the EES Driver Portal.",
                  "ดูคนขับทุกคนและสถานะสิทธิ์เข้าใช้งาน EES Driver Portal"
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {summaries.map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-xl border border-violet-100 bg-white px-3.5 py-2.5 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                  {label}
                </p>

                <Icon className="h-4 w-4 text-brand-600" />
              </div>

              <p className="mt-1 text-2xl font-bold leading-none text-brand-700">
                {loading || error ? "—" : value ?? "—"}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_11rem_auto]">
          <label>
            <span className="form-label">
              {copy("Search drivers", "ค้นหาคนขับ")}
            </span>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

              <input
                className="form-input bg-white pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy(
                  "Name, email or vehicle registration",
                  "ชื่อ อีเมล หรือทะเบียนรถ"
                )}
              />
            </div>
          </label>

          <label>
            <span className="form-label">
              {copy("Portal access", "สิทธิ์พอร์ทัล")}
            </span>

            <select
              className="form-input bg-white"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">
                {copy("All drivers", "คนขับทั้งหมด")}
              </option>

              <option value="active">
                {copy("Active login", "บัญชีที่ใช้งาน")}
              </option>

              <option value="none">
                {copy("No account", "ไม่มีบัญชี")}
              </option>
            </select>
          </label>

          <button
            type="button"
            className="btn-secondary self-end"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />

            {copy("Refresh", "รีเฟรช")}
          </button>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="m-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <p className="font-semibold">
            {copy(
              "Unable to load driver accounts. Refresh to try again.",
              "ไม่สามารถโหลดบัญชีคนขับได้ กรุณารีเฟรชเพื่อลองอีกครั้ง"
            )}
          </p>

          <p className="mt-1">{error}</p>
        </div>
      ) : loading ? (
        <p role="status" className="p-5 text-sm text-slate-500">
          {copy(
            "Loading driver accounts…",
            "กำลังโหลดบัญชีคนขับ…"
          )}
        </p>
      ) : (
        <>
          <div className="hidden min-[980px]:block">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-violet-50/60">
                <tr>
                  <th className="w-[15%] px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                    {headings[0]}
                  </th>

                  <th className="w-[20%] px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                    {headings[1]}
                  </th>

                  <th className="w-[16%] px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                    {headings[2]}
                  </th>

                  <th className="w-[21%] px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                    {headings[3]}
                  </th>

                  <th className="w-[16%] px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                    {headings[4]}
                  </th>

                  <th className="w-[12%] px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                    {headings[5]}
                  </th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => {
                  const hasActivePortal =
                    row.accountId !== null &&
                    row.accountActive &&
                    row.driverActive;

                  return (
                    <tr
                      key={row.driverId}
                      className={`border-t border-slate-100 transition ${
                        hasActivePortal
                          ? "bg-emerald-50/20 hover:bg-emerald-50/40"
                          : "hover:bg-violet-50/30"
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                              hasActivePortal
                                ? "bg-brand-50 text-brand-700"
                                : "bg-slate-50 text-slate-400"
                            }`}
                          >
                            <UserRound className="h-4 w-4" />
                          </div>

                          <div className="min-w-0">
                            <p className="truncate font-bold text-slate-950">
                              {row.name}
                            </p>

                            <p className="mt-0.5 text-[11px] text-slate-400">
                              {copy("ID", "รหัส")} {row.driverId}
                            </p>

                            {!row.driverActive ? (
                              <p className="mt-0.5 text-[11px] font-semibold text-rose-600">
                                {copy(
                                  "Inactive driver",
                                  "คนขับไม่ใช้งาน"
                                )}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-slate-800">
                          {row.vehicleRegistration ?? "-"}
                        </p>

                        {row.vehicleType ? (
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {friendlyVehicleType(row.vehicleType)}
                          </p>
                        ) : null}
                      </td>

                      <td className="px-4 py-2.5">
                        {badge(row)}
                      </td>

                      <td className="break-all px-4 py-2.5 text-xs text-slate-600">
                        {row.email ?? "-"}
                      </td>

                      <td className="px-4 py-2.5 text-xs text-slate-600">
                        {date(row.lastSignInAt)}
                      </td>

                      <td className="px-4 py-2.5">
                        {security(row)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 p-4 min-[980px]:hidden">
            {rows.map((row) => (
              <article
                key={row.driverId}
                className="min-w-0 rounded-2xl border border-slate-200 p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="break-words font-bold text-slate-950">
                      {row.name}
                    </h3>

                    <p className="mt-1 text-xs text-slate-500">
                      {copy("Driver ID", "รหัสคนขับ")} {row.driverId}
                      {!row.driverActive
                        ? ` · ${copy(
                            "Inactive driver",
                            "คนขับไม่ใช้งาน"
                          )}`
                        : ""}
                    </p>
                  </div>

                  {badge(row)}
                </div>

                <dl className="mt-3 space-y-2 text-sm">
                  {[
                    [
                      headings[1],
                      [
                        row.vehicleRegistration,
                        friendlyVehicleType(row.vehicleType)
                      ]
                        .filter(Boolean)
                        .join(" · ") || "-"
                    ],
                    [headings[3], row.email ?? "-"],
                    [headings[4], date(row.lastSignInAt)],
                    [
                      copy(
                        "Email confirmation",
                        "การยืนยันอีเมล"
                      ),
                      security(row)
                    ]
                  ].map(([label, value], index) => (
                    <div
                      key={index}
                      className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3"
                    >
                      <dt className="text-slate-500">{label}</dt>

                      <dd className="break-words text-slate-800">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="p-5 text-center text-sm text-slate-500">
              {copy(
                "No drivers match your search or filter.",
                "ไม่พบคนขับที่ตรงกับการค้นหาหรือตัวกรอง"
              )}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
            <p className="text-xs text-slate-500">
              {copy(
                `Showing ${rows.length} of ${
                  result?.summary.total ?? 0
                } drivers`,
                `แสดง ${rows.length} จาก ${
                  result?.summary.total ?? 0
                } คน`
              )}
            </p>

            <p className="text-xs font-semibold text-slate-500">
              {copy(
                `${result?.summary.activeAccounts ?? 0} active portal ${
                  result?.summary.activeAccounts === 1
                    ? "account"
                    : "accounts"
                } · ${result?.summary.withoutAccount ?? 0} without accounts`,
                `${result?.summary.activeAccounts ?? 0} บัญชีที่ใช้งาน · ${
                  result?.summary.withoutAccount ?? 0
                } ไม่มีบัญชี`
              )}
            </p>
          </div>
        </>
      )}
    </section>
  );
}