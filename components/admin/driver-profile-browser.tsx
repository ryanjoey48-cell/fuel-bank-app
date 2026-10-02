"use client";

import Image from "next/image";
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Truck,
  UserRound,
  UserX,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  fetchDriverAccounts,
  getAccessToken,
  type ManagedDriverAccount
} from "@/lib/account-management";
import type { DriverProfile } from "@/lib/driver-operations";
import { useLanguage } from "@/lib/language-provider";
import { useModalScrollLock } from "@/lib/use-modal-scroll-lock";

type Filter = "all" | "active" | "none" | "inactive";

export function DriverProfileBrowser() {
  const { language } = useLanguage();
  const th = language === "th";

  const [drivers, setDrivers] = useState<ManagedDriverAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileBusy, setProfileBusy] = useState(false);
  const [error, setError] = useState(false);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const [selectedAccountId, setSelectedAccountId] =
    useState<string | null>(null);

  const [detail, setDetail] = useState<{
    profile: DriverProfile;
    active: boolean;
  } | null>(null);

  useModalScrollLock(selectedAccountId !== null);
  const requestId = useRef(0);
  const [avatars, setAvatars] = useState<Record<string, string>>({});

  const t = {
    title: th ? "รายชื่อคนขับ" : "Driver Directory",
    intro: th
      ? "ดูโปรไฟล์ บัญชี รถ และสถานะของคนขับ"
      : "Driver profiles, vehicles and portal access in one place.",
    search: th ? "ค้นหาคนขับ" : "Search drivers",
    placeholder: th
      ? "ชื่อ ทะเบียนรถ โทรศัพท์ หรืออีเมล"
      : "Name, vehicle, phone or email",
    refresh: th ? "รีเฟรช" : "Refresh",

    all: th ? "ทั้งหมด" : "All",
    active: th ? "บัญชีใช้งาน" : "Portal active",
    none: th ? "ไม่มีบัญชี" : "No account",
    inactive: th ? "ไม่ใช้งาน" : "Inactive",

    driver: th ? "คนขับ" : "Driver",
    vehicle: th ? "รถ" : "Vehicle",
    access: th ? "สิทธิ์พอร์ทัล" : "Portal access",
    email: th ? "อีเมล" : "Email",
    lastLogin: th ? "เข้าสู่ระบบล่าสุด" : "Last login",
    view: th ? "ดูโปรไฟล์" : "View profile",

    noAccount: th ? "ไม่มีบัญชี" : "No account",
    activeStatus: th ? "ใช้งาน" : "Active",
    inactiveStatus: th ? "ไม่ใช้งาน" : "Inactive",

    loading: th ? "กำลังโหลดคนขับ…" : "Loading drivers…",
    failed: th
      ? "ไม่สามารถโหลดข้อมูลคนขับได้"
      : "Unable to load driver directory.",
    empty: th ? "ไม่พบคนขับ" : "No drivers match your filters.",

    profile: th ? "โปรไฟล์คนขับ" : "Driver profile",
    officialName: th ? "ชื่อทางการ" : "Official name",
    displayName: th ? "ชื่อที่แสดง" : "Display name",
    driverId: th ? "รหัสคนขับ" : "Driver ID",
    phone: th ? "โทรศัพท์" : "Phone",
    account: th ? "บัญชี" : "Account",
    accountStatus: th ? "สถานะบัญชี" : "Account status",
    emailSecurity: th ? "การยืนยันอีเมล" : "Email confirmation",
    confirmed: th ? "ยืนยันแล้ว" : "Confirmed",
    notConfirmed: th ? "ยังไม่ยืนยัน" : "Not confirmed",
    close: th ? "ปิด" : "Close"
  };

  const load = useCallback(async () => {
    const id = ++requestId.current;

    setLoading(true);
    setError(false);

    try {
      const result = await fetchDriverAccounts();

      if (id === requestId.current) {
        setDrivers(result.drivers);
        const token = await getAccessToken();
        const next: Record<string, string> = {};
        const linked = result.drivers.filter((driver) => driver.accountId);
        for (let start = 0; start < linked.length && id === requestId.current; start += 10) {
          await Promise.all(linked.slice(start, start + 10).map(async (driver) => {
            const response = await fetch(`/api/admin/driver-operations/profiles/${driver.accountId}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
            if (!response.ok) throw new Error("Profiles unavailable");
            const payload = await response.json(); if (payload.profile.avatarUrl) next[driver.driverId] = payload.profile.avatarUrl;
          }));
        }
        if (id === requestId.current) setAvatars(next);
      }
    } catch {
      if (id === requestId.current) setError(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const counter = requestId;
    void load();

    return () => {
      counter.current++;
    };
  }, [load]);

  const format = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(th ? "th-TH" : "en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Bangkok"
        }).format(new Date(value))
      : "—";

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return drivers.filter((driver) => {
      const active =
        Boolean(driver.accountId) &&
        driver.accountActive &&
        driver.driverActive;

      if (filter === "active" && !active) return false;
      if (filter === "none" && driver.accountId) return false;

      if (
        filter === "inactive" &&
        !(driver.accountId && !driver.accountActive)
      ) {
        return false;
      }

      if (!query) return true;

      return [
        driver.name,
        driver.email,
        driver.vehicleRegistration
      ]
        .filter(Boolean)
        .some((value) =>
          String(value).toLowerCase().includes(query)
        );
    });
  }, [drivers, filter, search]);

  const openProfile = async (driver: ManagedDriverAccount) => {
    if (!driver.accountId) return;

    setSelectedAccountId(driver.accountId);
    setDetail(null);
    setProfileBusy(true);
    setError(false);

    try {
      const token = await getAccessToken();

      const response = await fetch(
        `/api/admin/driver-operations/profiles/${encodeURIComponent(
          driver.accountId
        )}`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (!response.ok) throw new Error();

      setDetail(await response.json());
    } catch {
      setError(true);
      setSelectedAccountId(null);
    } finally {
      setProfileBusy(false);
    }
  };

  return (
    <>
      <section className="driver-directory overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-brand-700">
                {t.title}
              </p>

              <h2 className="mt-1 text-xl font-black text-slate-950">
                {drivers.length} {th ? "คนขับ" : "drivers"}
              </h2>

              <p className="mt-1 text-sm text-slate-500">{t.intro}</p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative sm:w-[320px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                <input
                  className="form-input bg-white pl-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t.placeholder}
                  aria-label={t.search}
                />
              </div>

              <button
                type="button"
                className="btn-secondary"
                disabled={loading}
                onClick={() => void load()}
              >
                <RefreshCw
                  className={`h-4 w-4 ${
                    loading ? "animate-spin" : ""
                  }`}
                />
                {t.refresh}
              </button>
            </div>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 sm:mt-4 sm:flex-wrap">
            <DirectoryFilter
              label={t.all}
              count={drivers.length}
              active={filter === "all"}
              onClick={() => setFilter("all")}
            />

            <DirectoryFilter
              label={t.active}
              count={
                drivers.filter(
                  (d) =>
                    d.accountId &&
                    d.accountActive &&
                    d.driverActive
                ).length
              }
              active={filter === "active"}
              onClick={() => setFilter("active")}
            />

            <DirectoryFilter
              label={t.none}
              count={drivers.filter((d) => !d.accountId).length}
              active={filter === "none"}
              onClick={() => setFilter("none")}
            />

            <DirectoryFilter
              label={t.inactive}
              count={
                drivers.filter(
                  (d) => d.accountId && !d.accountActive
                ).length
              }
              active={filter === "inactive"}
              onClick={() => setFilter("inactive")}
            />
          </div>
        </div>

        {error ? (
          <div className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {t.failed}
          </div>
        ) : null}

        {loading ? (
          <div className="p-6 text-sm text-slate-500">
            {t.loading}
          </div>
        ) : (
          <>
            {/* DESKTOP */}
            <div className="hidden min-[1000px]:block">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-slate-50/80">
                  <tr>
                    <Head className="w-[23%]">{t.driver}</Head>
                    <Head className="w-[18%]">{t.vehicle}</Head>
                    <Head className="w-[16%]">{t.access}</Head>
                    <Head className="w-[23%]">{t.email}</Head>
                    <Head className="w-[20%]">{t.lastLogin}</Head>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((driver) => {
                    const active =
                      Boolean(driver.accountId) &&
                      driver.accountActive === true &&
                      driver.driverActive;

                    return (
                      <tr
                        key={driver.driverId}
                        className={`border-t border-slate-100 ${
                          driver.accountId
                            ? "cursor-pointer hover:bg-violet-50/30"
                            : ""
                        }`}
                        onClick={() => void openProfile(driver)}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            {avatars[driver.driverId] ? <Image unoptimized src={avatars[driver.driverId]} width={36} height={36} alt={driver.name} className="h-9 w-9 shrink-0 rounded-xl object-cover" /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xs font-black text-brand-700">
                              {driver.name
                                .slice(0, 1)
                                .toUpperCase()}
                            </span>}

                            <div>
                              <p className="font-bold text-slate-950">
                                {driver.name}
                              </p>

                              <p className="mt-0.5 text-[11px] text-slate-400">
                                {t.driverId} {driver.driverId}
                              </p>
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <Truck className="h-4 w-4 text-brand-600" />

                            <span className="font-semibold text-slate-700">
                              {driver.vehicleRegistration || "—"}
                            </span>
                          </div>
                        </td>

                        <td className="px-5 py-3">
                          <PortalBadge
                            account={Boolean(driver.accountId)}
                            active={active}
                            labels={t}
                          />
                        </td>

                        <td className="px-5 py-3 text-xs text-slate-600">
                          {driver.email || "—"}
                        </td>

                        <td className="px-5 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs text-slate-600">
                              {format(driver.lastSignInAt)}
                            </span>

                            {driver.accountId ? (
                              <ChevronRight className="h-4 w-4 text-brand-600" />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* MOBILE */}
            <div className="directory-mobile-rows grid gap-2 p-3 sm:gap-3 sm:p-4 min-[1000px]:hidden">
              {rows.map((driver) => {
                const active =
                  Boolean(driver.accountId) &&
                  driver.accountActive === true &&
                  driver.driverActive;

                return (
                  <button
                    key={driver.driverId}
                    type="button"
                    disabled={!driver.accountId}
                    onClick={() => void openProfile(driver)}
                    className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm disabled:cursor-default"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        {avatars[driver.driverId] ? <Image unoptimized src={avatars[driver.driverId]} width={44} height={44} alt={driver.name} className="h-11 w-11 shrink-0 rounded-xl object-cover" /> : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 font-black text-brand-700">
                          {driver.name.slice(0, 1).toUpperCase()}
                        </span>}

                        <div className="min-w-0">
                          <p className="truncate font-black text-slate-950">
                            {driver.name}
                          </p>

                          <p className="mt-0.5 text-xs text-slate-500">
                            {driver.vehicleRegistration || "—"}
                          </p>
                        </div>
                      </div>

                      <PortalBadge
                        account={Boolean(driver.accountId)}
                        active={active}
                        labels={t}
                      />
                    </div>

                    {driver.email ? (
                      <p className="mt-3 break-all text-xs text-slate-500">
                        {driver.email}
                      </p>
                    ) : null}

                    {driver.accountId ? <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-slate-400"><span>{t.lastLogin}: {format(driver.lastSignInAt)}</span><ChevronRight className="h-4 w-4 shrink-0 text-brand-600" /></div> : null}
                  </button>
                );
              })}
            </div>

            {!rows.length ? (
              <div className="p-10 text-center text-sm font-semibold text-slate-500">
                {t.empty}
              </div>
            ) : null}
          </>
        )}
      </section>

      {selectedAccountId ? (
        <div
          className="fixed inset-0 z-[110] flex items-end justify-end bg-slate-950/35 backdrop-blur-[2px] sm:items-stretch"
          onClick={() => {
            setSelectedAccountId(null);
            setDetail(null);
          }}
        >
          <aside
            role="dialog" aria-modal="true" aria-labelledby="directory-profile-title"
            className="directory-profile-drawer max-h-[calc(100dvh-1rem)] w-full overflow-y-auto overscroll-contain rounded-t-[2rem] bg-[#fffdf9] shadow-2xl sm:max-h-none sm:w-[500px] sm:rounded-none sm:rounded-l-[2rem]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-[#fffdf9]/95 px-5 py-4 backdrop-blur">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-brand-700">
                  {t.profile}
                </p>

                <h2 id="directory-profile-title" className="mt-1 break-words text-xl font-black text-slate-950">
                  {detail?.profile.officialName || "…"}
                </h2>
              </div>

              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white"
                onClick={() => {
                  setSelectedAccountId(null);
                  setDetail(null);
                }}
                aria-label={t.close}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {profileBusy ? (
              <div className="p-6 text-sm text-slate-500">
                {t.loading}
              </div>
            ) : detail ? (
              <div className="space-y-4 p-5">
                <section className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center gap-4">
                    {detail.profile.avatarUrl ? (
                      <Image
                        unoptimized
                        src={detail.profile.avatarUrl}
                        alt={detail.profile.officialName}
                        width={72}
                        height={72}
                        className="h-[72px] w-[72px] rounded-2xl object-cover"
                      />
                    ) : (
                      <span className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-brand-50 text-xl font-black text-brand-700">
                        {detail.profile.officialName
                          .slice(0, 1)
                          .toUpperCase()}
                      </span>
                    )}

                    <div>
                      <h3 className="text-lg font-black text-slate-950">
                        {detail.profile.officialName}
                      </h3>

                      <span
                        className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${
                          detail.active
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {detail.active
                          ? t.activeStatus
                          : t.inactiveStatus}
                      </span>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="grid gap-2">
                    <ProfileInfo
                      icon={<UserRound className="h-4 w-4" />}
                      label={t.displayName}
                      value={detail.profile.displayName || "—"}
                    />

                    <ProfileInfo
                      label={t.driverId}
                      value={detail.profile.driverId}
                    />

                    <ProfileInfo
                      icon={<Truck className="h-4 w-4" />}
                      label={t.vehicle}
                      value={detail.profile.vehicle || "—"}
                    />

                    <ProfileInfo
                      icon={<Mail className="h-4 w-4" />}
                      label={t.email}
                      value={detail.profile.email || "—"}
                    />

                    <ProfileInfo
                      icon={<Phone className="h-4 w-4" />}
                      label={t.phone}
                      value={detail.profile.phone || "—"}
                    />

                    <ProfileInfo
                      icon={<Clock3 className="h-4 w-4" />}
                      label={t.lastLogin}
                      value={
                        detail.profile.lastLogin
                          ? format(detail.profile.lastLogin)
                          : "—"
                      }
                    />
                  </div>
                </section>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </>
  );
}

function PortalBadge({
  account,
  active,
  labels
}: {
  account: boolean;
  active: boolean;
  labels: {
    noAccount: string;
    activeStatus: string;
    inactiveStatus: string;
  };
}) {
  if (!account) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold text-slate-600">
        <UserX className="h-3 w-3" />
        {labels.noAccount}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {active ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <UserX className="h-3 w-3" />
      )}

      {active ? labels.activeStatus : labels.inactiveStatus}
    </span>
  );
}

function DirectoryFilter({
  label,
  count,
  active,
  onClick
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${
        active
          ? "border-brand-300 bg-brand-50 text-brand-800"
          : "border-slate-200 bg-white text-slate-600"
      }`}
    >
      {label}
      <span className="ml-2 rounded-full bg-white/70 px-1.5 py-0.5">
        {count}
      </span>
    </button>
  );
}

function Head({
  children,
  className = ""
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-5 py-3 text-left text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 ${className}`}
    >
      {children}
    </th>
  );
}

function ProfileInfo({
  icon,
  label,
  value
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="operations-driver-info flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
      {icon ? <span className="text-brand-600">{icon}</span> : null}

      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
          {label}
        </p>

        <p className="mt-0.5 break-all text-sm font-semibold text-slate-800">
          {value}
        </p>
      </div>
    </div>
  );
}
