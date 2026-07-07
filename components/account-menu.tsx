"use client";

import {
  AlertTriangle,
  Bell,
  ChevronDown,
  CircleHelp,
  Fuel,
  HelpCircle,
  KeyRound,
  LogOut,
  Ticket,
  UserCircle,
  Wrench,
  type LucideIcon
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import {
  fetchDrivers,
  fetchMissingMileageFuelLogCount,
  fetchSupportTicketNotificationCount,
  fetchUncheckedFuelLogCount,
  fetchVehicles,
  fetchWeeklyMileage
} from "@/lib/data";
import { buildOilChangeAlertRows } from "@/lib/operations";
import { supabase } from "@/lib/supabase";

const ADMIN_EMAIL = "joeryan09@outlook.com";

type AccountUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

type AccountMenuProps = {
  compact?: boolean;
};

type AccountRouteItem = {
  label: string;
  icon: LucideIcon;
  href: string;
};

type NotificationItem = {
  label: string;
  value: string;
  href: string;
  icon: LucideIcon;
  tone: "purple" | "amber" | "slate" | "rose";
};

type DropdownPosition = {
  left: number;
  top: number;
  width: number;
};

const ACCOUNT_PANEL_WIDTH = 336;
const NOTIFICATION_PANEL_WIDTH = 352;
const VIEWPORT_GAP = 12;

function getDropdownPosition(trigger: HTMLElement, preferredWidth: number): DropdownPosition {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(preferredWidth, window.innerWidth - VIEWPORT_GAP * 2);
  const left = Math.min(
    Math.max(VIEWPORT_GAP, rect.right - width),
    Math.max(VIEWPORT_GAP, window.innerWidth - width - VIEWPORT_GAP)
  );

  return {
    left,
    top: Math.min(rect.bottom + 10, window.innerHeight - VIEWPORT_GAP),
    width
  };
}

function getMetaString(user: AccountUser | null, key: string) {
  const value = user?.user_metadata?.[key] ?? user?.app_metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getUserRole(user: AccountUser | null) {
  if (!user) return "";
  if ((user.email ?? "").toLowerCase() === ADMIN_EMAIL) return "Admin";
  return getMetaString(user, "role") || "User";
}

function isAdminUser(user: AccountUser | null) {
  return (user?.email ?? "").toLowerCase() === ADMIN_EMAIL || getUserRole(user).toLowerCase() === "admin";
}

function getAdminDisplayName(email: string) {
  return email.toLowerCase() === ADMIN_EMAIL ? "Joey Ryan" : "";
}

function getInitials(displayName: string, email: string) {
  const trimmedName = displayName.trim();
  const trimmedEmail = email.trim();
  const source = trimmedName && trimmedName !== trimmedEmail ? trimmedName : "";

  if (!source) return trimmedEmail[0]?.toUpperCase() || "U";

  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || trimmedEmail[0]?.toUpperCase() || "U";
}

export function AccountMenu({ compact = false }: AccountMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition>({
    left: VIEWPORT_GAP,
    top: 72,
    width: ACCOUNT_PANEL_WIDTH
  });
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setUser((data.user ?? null) as AccountUser | null);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser((session?.user ?? null) as AccountUser | null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!menuOpen && !notificationsOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setNotificationsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen, notificationsOpen]);

  useEffect(() => {
    if (!menuOpen && !notificationsOpen) return;

    const trigger = notificationsOpen ? notificationButtonRef.current : accountButtonRef.current;
    if (!trigger) return;

    const updatePosition = () => {
      const preferredWidth = notificationsOpen ? NOTIFICATION_PANEL_WIDTH : ACCOUNT_PANEL_WIDTH;
      const nextPosition = getDropdownPosition(trigger, preferredWidth);
      setDropdownPosition((current) =>
        current.left === nextPosition.left &&
        current.top === nextPosition.top &&
        current.width === nextPosition.width
          ? current
          : nextPosition
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [menuOpen, notificationsOpen]);

  useEffect(() => {
    setMenuOpen(false);
    setNotificationsOpen(false);
  }, [pathname]);

  const role = getUserRole(user);
  const email = user?.email ?? "";
  const displayName =
    getMetaString(user, "name") ||
    getMetaString(user, "full_name") ||
    getAdminDisplayName(email) ||
    email ||
    "Account";
  const initials = useMemo(() => getInitials(displayName, email), [displayName, email]);
  const normalizedRole = role.toUpperCase() === "USER" ? "STAFF" : role.toUpperCase();
  const unreadNotificationCount = notifications.reduce((total, item) => total + (Number(item.value) || 0), 0);

  const routeItems: AccountRouteItem[] = [
    { label: "My Profile", icon: UserCircle, href: "/profile" },
    { label: "Change Password", icon: KeyRound, href: "/change-password" },
    { label: "Support & Feedback", icon: HelpCircle, href: "/support" }
  ];

  const loadNotifications = async () => {
    setNotificationsLoading(true);
    try {
      const [uncheckedFuel, missingMileage, supportTickets, oilAttention] = await Promise.all([
        fetchUncheckedFuelLogCount().catch(() => 0),
        fetchMissingMileageFuelLogCount().catch(() => 0),
        isAdminUser(user) ? fetchSupportTicketNotificationCount().catch(() => 0) : Promise.resolve(0),
        Promise.all([fetchVehicles(), fetchWeeklyMileage(), fetchDrivers()])
          .then(([vehicles, weeklyMileage, drivers]) =>
            buildOilChangeAlertRows({ vehicles, weeklyMileage, drivers }).filter((row) =>
              row.status === "overdue" || row.status === "urgent"
            ).length
          )
          .catch(() => 0)
      ]);

      setNotifications([
        ...(isAdminUser(user) && supportTickets > 0
          ? [{ label: "Support tickets", value: String(supportTickets), href: "/admin/support-tickets", icon: Ticket, tone: "purple" as const }]
          : []),
        ...(oilAttention > 0
          ? [{ label: "Oil changes overdue", value: String(oilAttention), href: "/weekly-mileage", icon: Wrench, tone: "amber" as const }]
          : []),
        ...(uncheckedFuel > 0
          ? [{ label: "Fuel logs not checked", value: String(uncheckedFuel), href: "/fuel-logs?review=not_checked", icon: Fuel, tone: "slate" as const }]
          : []),
        ...(missingMileage > 0
          ? [{ label: "Missing mileage/fuel details", value: String(missingMileage), href: "/fuel-logs?review=missing_mileage", icon: AlertTriangle, tone: "rose" as const }]
          : [])
      ]);
    } finally {
      setNotificationsLoading(false);
    }
  };

  const openNotifications = () => {
    const nextOpen = !notificationsOpen;
    if (nextOpen && notificationButtonRef.current) {
      setDropdownPosition(getDropdownPosition(notificationButtonRef.current, NOTIFICATION_PANEL_WIDTH));
    }
    setNotificationsOpen(nextOpen);
    setMenuOpen(false);
    if (nextOpen) void loadNotifications();
  };

  const openMenu = () => {
    const nextOpen = !menuOpen;
    if (nextOpen && accountButtonRef.current) {
      setDropdownPosition(getDropdownPosition(accountButtonRef.current, ACCOUNT_PANEL_WIDTH));
    }
    setMenuOpen(nextOpen);
    setNotificationsOpen(false);
  };

  const closeMenus = () => {
    setMenuOpen(false);
    setNotificationsOpen(false);
  };

  const navigateTo = (href: string) => {
    flushSync(closeMenus);
    window.requestAnimationFrame(() => {
      router.push(href);
    });
  };

  const handleSignOut = () => {
    flushSync(closeMenus);
    window.requestAnimationFrame(() => {
      void supabase.auth.signOut().then(() => {
        router.replace("/login");
      });
    });
  };

  const floatingLayer = portalReady && (menuOpen || notificationsOpen)
    ? createPortal(
        <>
          <button
            type="button"
            aria-label="Close account menu"
            className="fixed inset-0 cursor-default bg-transparent"
            style={{ zIndex: "var(--z-dropdown-backdrop)" }}
            onClick={closeMenus}
          />

          {notificationsOpen ? (
            <div
              className="account-dropdown-panel fixed max-w-[calc(100vw-24px)] overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white shadow-[0_26px_70px_rgba(15,23,42,0.22)]"
              style={{
                left: dropdownPosition.left,
                top: dropdownPosition.top,
                width: dropdownPosition.width,
                zIndex: "var(--z-dropdown)"
              }}
            >
              <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <p className="text-sm font-semibold text-slate-950">Notifications</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {unreadNotificationCount > 0 ? `${unreadNotificationCount} item${unreadNotificationCount === 1 ? "" : "s"} need attention` : "You're all caught up"}
                </p>
              </div>
              <div className="grid max-h-[min(28rem,calc(100vh-7rem))] gap-1 overflow-y-auto p-2.5">
                {notificationsLoading ? (
                  <p className="rounded-2xl bg-slate-50 px-3 py-4 text-sm font-medium text-slate-500">Loading notifications...</p>
                ) : notifications.length ? notifications.map((item) => {
                  const Icon = item.icon;
                  const toneClass =
                    item.tone === "purple"
                      ? "bg-brand-50 text-brand-700"
                      : item.tone === "amber"
                        ? "bg-amber-50 text-amber-700"
                        : item.tone === "rose"
                          ? "bg-rose-50 text-rose-700"
                          : "bg-slate-100 text-slate-700";

                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => navigateTo(item.href)}
                      className="group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-200"
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${toneClass}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-800">{item.label}</span>
                        <span className="block text-xs text-slate-500">Open details</span>
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                        {item.value}
                      </span>
                    </button>
                  );
                }) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center">
                    <Bell className="mx-auto h-5 w-5 text-slate-400" />
                    <p className="mt-2 text-sm font-semibold text-slate-700">No notifications yet.</p>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {menuOpen ? (
            <div
              className="account-dropdown-panel fixed max-w-[calc(100vw-24px)] overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white shadow-[0_26px_70px_rgba(15,23,42,0.22)]"
              style={{
                left: dropdownPosition.left,
                top: dropdownPosition.top,
                width: dropdownPosition.width,
                zIndex: "var(--z-dropdown)"
              }}
            >
              <div className="border-b border-slate-100 bg-brand-50/35 px-4 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-700 text-sm font-bold text-white">
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-950">{displayName}</p>
                    <p className="truncate text-xs text-slate-500">{email || "Signed in user"}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Signed in
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                        {normalizedRole || "STAFF"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-2">
                {routeItems.map(({ label, icon: Icon, href }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => navigateTo(href)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 outline-none transition hover:bg-slate-50 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-brand-200"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                      <Icon className="h-4 w-4" />
                    </span>
                    {label}
                  </button>
                ))}

                {isAdminUser(user) ? (
                  <button
                    type="button"
                    onClick={() => navigateTo("/admin/support-tickets")}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 outline-none transition hover:bg-slate-50 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-brand-200"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                      <CircleHelp className="h-4 w-4" />
                    </span>
                    Admin Support Tickets
                  </button>
                ) : null}

                <div className="my-2 border-t border-slate-100" />
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-rose-600 outline-none transition hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-rose-200"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                    <LogOut className="h-4 w-4" />
                  </span>
                  Sign Out
                </button>
              </div>
            </div>
          ) : null}
        </>,
        document.body
      )
    : null;

  return (
    <div ref={rootRef} className="relative z-[1000] flex items-center gap-2">
      <button
        ref={notificationButtonRef}
        type="button"
        onClick={openNotifications}
        className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm outline-none transition hover:border-brand-200 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-200"
        aria-label="Notifications"
        aria-expanded={notificationsOpen}
      >
        <Bell className="h-4.5 w-4.5" />
      </button>

      <button
        ref={accountButtonRef}
        type="button"
        onClick={openMenu}
        className="flex min-w-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2.5 py-2 text-left shadow-sm outline-none transition hover:border-brand-200 focus-visible:ring-2 focus-visible:ring-brand-200"
        aria-label="Account menu"
        aria-expanded={menuOpen}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xs font-bold text-brand-700">
          {initials}
        </span>
        {!compact ? (
          <span className="min-w-0">
            <span className="block max-w-[150px] truncate text-xs font-semibold text-slate-950">{displayName}</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{role}</span>
          </span>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>

      {floatingLayer}
    </div>
  );
}
