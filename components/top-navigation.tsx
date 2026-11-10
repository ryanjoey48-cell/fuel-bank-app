"use client";

import {
  ChevronDown,
  Menu,
  X
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { AccountMenu } from "@/components/account-menu";
import { EESLogo } from "@/components/ees-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  collectNavScrollRoots,
  decideNavHidden,
  readScrollTop,
  readViewportScrollY
} from "@/lib/ees-nav-scroll";
import { useLanguage } from "@/lib/language-provider";
import { routeIsActive, useOfficeNavEntries } from "@/lib/office-nav";



function focusIsInsideNav(root: HTMLElement | null) {
  if (!root) return false;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (!root.contains(active)) return false;
  // Pointer clicks leave focus on triggers; only keyboard focus should pin the bar.
  return active.matches(":focus-visible");
}

export function TopNavigation(_props: { compact?: boolean } = {}) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const lastScrollY = useRef(0);
  const navBusyRef = useRef(false);
  const navHiddenRef = useRef(false);
  const frameRef = useRef(0);
  const copy = t.home.topNavigation;
  // Fleet map gestures must not drive page scroll hide; keep chrome visible there.
  const skipAutoHide = pathname === "/fleet-tracking";

  const entries = useOfficeNavEntries();

  const navBusy = Boolean(openGroup || mobileOpen);
  navBusyRef.current = navBusy;
  navHiddenRef.current = navHidden;

  const closeMenus = useCallback(() => {
    setOpenGroup(null);
    setMobileOpen(false);
  }, []);

  useEffect(() => {
    closeMenus();
    // The shared shell survives client-side route changes. A hidden bar from the
    // previous page must not remain hidden at the top of the next page.
    navHiddenRef.current = false;
    setNavHidden(false);
    lastScrollY.current = readViewportScrollY();
  }, [pathname, closeMenus]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpenGroup(null);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const activeGroup = (
        document.activeElement as Element | null
      )?.closest<HTMLElement>("[data-nav-group-container]");
      activeGroup
        ?.querySelector<HTMLButtonElement>("button[data-nav-group-trigger]")
        ?.focus();
      closeMenus();
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeMenus]);

  useEffect(() => {
    if (skipAutoHide) {
      setNavHidden(false);
      navHiddenRef.current = false;
      return;
    }

    lastScrollY.current = readViewportScrollY();

    const applyScroll = (source: Window | Element) => {
      const currentY = readScrollTop(source);
      const nextHidden = decideNavHidden({
        currentY,
        lastY: lastScrollY.current,
        currentlyHidden: navHiddenRef.current,
        busy: navBusyRef.current,
        focusInsideNav: focusIsInsideNav(rootRef.current)
      });

      if (nextHidden && !navHiddenRef.current) {
        setOpenGroup(null);
      }

      if (nextHidden !== navHiddenRef.current) {
        navHiddenRef.current = nextHidden;
        setNavHidden(nextHidden);
      }

      lastScrollY.current = currentY;
    };

    const onScroll = (event: Event) => {
      const target = event.target;
      const source: Window | Element =
        target === document || target === document.documentElement || target === window
          ? window
          : target instanceof Element
            ? target
            : window;

      if (frameRef.current) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = 0;
        applyScroll(source);
      });
    };

    const roots = collectNavScrollRoots(rootRef.current);
    for (const root of roots) {
      root.addEventListener("scroll", onScroll, { passive: true });
    }

    return () => {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      for (const root of roots) {
        root.removeEventListener("scroll", onScroll);
      }
    };
  }, [skipAutoHide, pathname]);

  useEffect(() => {
    if (!navBusy) return;
    setNavHidden(false);
    navHiddenRef.current = false;
  }, [navBusy]);

  const handleGroupKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    groupKey: string
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpenGroup(null);
      event.currentTarget
        .querySelector<HTMLButtonElement>("button[data-nav-group-trigger]")
        ?.focus();
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    const container = event.currentTarget;
    const key = event.key;
    setOpenGroup(groupKey);

    requestAnimationFrame(() => {
      const items = Array.from(
        container.querySelectorAll<HTMLElement>('[role="menuitem"]')
      );
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next =
        key === "Home"
          ? 0
          : key === "End"
            ? items.length - 1
            : key === "ArrowUp"
              ? current <= 0
                ? items.length - 1
                : current - 1
              : (current + 1) % items.length;
      items[next]?.focus();
    });
  };

  const dropdownAlign = (key: string) => {
    if (key === "operations" || key === "fleet") return "is-start";
    if (key === "people" || key === "admin") return "is-end";
    return "is-center";
  };

  return (
    <header
      ref={rootRef}
      className={`top-navigation ees-floating-nav${navHidden ? " is-nav-hidden" : ""}${
        navBusy ? " is-nav-busy" : ""
      }`}
    >
      <div className="ees-floating-nav__shell">
        <div className="ees-floating-nav__bar">
          <Link
            href="/dashboard"
            className="ees-floating-nav__brand"
            onClick={() => setOpenGroup(null)}
          >
            <EESLogo
              alt={t.common.appName}
              size={64}
              className="ees-floating-nav__logo-img"
              priority
            />
            <span className="ees-floating-nav__brand-copy">
              <span className="ees-floating-nav__brand-title">EES Operations</span>
              <span className="ees-floating-nav__brand-subtitle">
                {t.common.appSubtitle}
              </span>
            </span>
          </Link>

          <nav className="ees-floating-nav__menu" aria-label={t.common.navigation}>
            {entries.map((entry) => {
              if (entry.type === "link") {
                const active = routeIsActive(pathname, entry.href);

                return (
                  <Link
                    key={entry.key}
                    href={entry.href}
                    className={`ees-nav-trigger${active ? " is-active" : ""}`}
                    onClick={() => setOpenGroup(null)}
                  >
                    {entry.label}
                  </Link>
                );
              }

              const active = entry.items.some(
                (item) =>
                  !item.suppressActive && routeIsActive(pathname, item.href)
              );
              const open = openGroup === entry.key;

              return (
                <div
                  key={entry.key}
                  className={`ees-nav-group${open ? " is-open" : ""}`}
                  data-nav-group-container={entry.key}
                  onKeyDown={(event) => handleGroupKeyDown(event, entry.key)}
                  onBlur={(event) => {
                    if (
                      !event.currentTarget.contains(
                        event.relatedTarget as Node | null
                      )
                    ) {
                      setOpenGroup(null);
                    }
                  }}
                >
                  <button
                    type="button"
                    data-nav-group-trigger={entry.key}
                    onClick={() => setOpenGroup(open ? null : entry.key)}
                    className={`ees-nav-trigger${active ? " is-active" : ""}${open ? " is-open" : ""}`}
                    aria-expanded={open}
                    aria-haspopup="menu"
                    aria-controls={`ees-menu-${entry.key}`}
                  >
                    <span>{entry.label}</span>
                    <ChevronDown className="ees-nav-trigger__chevron" aria-hidden />
                  </button>

                  {open ? (
                    <div
                      className={`ees-nav-dropdown ${dropdownAlign(entry.key)}`}
                    >
                      <div
                        className={`ees-nav-dropdown__panel${
                          entry.key === "operations" ? " is-wide" : ""
                        }`}
                        role="menu"
                        id={`ees-menu-${entry.key}`}
                        aria-label={entry.label}
                      >
                        <p className="ees-nav-dropdown__eyebrow">{entry.label}</p>

                        <div className="ees-nav-dropdown__list">
                          {entry.items.map((item, index) => {
                            const Icon = item.icon;
                            const itemActive =
                              !item.suppressActive &&
                              routeIsActive(pathname, item.href);

                            return (
                              <Link
                                key={`${entry.key}-${item.href}-${index}`}
                                href={item.href}
                                role="menuitem"
                                className={`ees-nav-dropdown__item${
                                  itemActive ? " is-active" : ""
                                }`}
                              >
                                <span className="ees-nav-dropdown__icon">
                                  <Icon aria-hidden />
                                </span>
                                <span className="ees-nav-dropdown__label">
                                  {item.label}
                                </span>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </nav>

          <div className="ees-floating-nav__actions">
            <div className="ees-floating-nav__lang">
              <LanguageSwitcher compact />
            </div>

            <AccountMenu compact />

            <button
              type="button"
              onClick={() => setMobileOpen((current) => !current)}
              className="ees-nav-mobile-toggle"
              aria-label={mobileOpen ? copy.closeMenu : copy.openMenu}
              aria-expanded={mobileOpen}
              aria-controls="top-navigation-mobile-menu"
            >
              {mobileOpen ? (
                <X className="h-5 w-5" aria-hidden />
              ) : (
                <Menu className="h-5 w-5" aria-hidden />
              )}
            </button>
          </div>
        </div>

        {mobileOpen ? (
          <>
            <button
              type="button"
              className="ees-nav-mobile-backdrop"
              onClick={() => setMobileOpen(false)}
              aria-label={copy.closeMenu}
            />

            <nav
              id="top-navigation-mobile-menu"
              className="ees-nav-mobile-panel"
              aria-label={t.common.navigation}
            >
              <div className="ees-nav-mobile-lang">
                <LanguageSwitcher />
              </div>

              <div className="ees-nav-mobile-grid">
                {entries.map((entry) => {
                  if (entry.type === "link") {
                    const active = routeIsActive(pathname, entry.href);

                    return (
                      <Link
                        key={`${entry.key}-mobile`}
                        href={entry.href}
                        className={`ees-nav-mobile-link${active ? " is-active" : ""}`}
                      >
                        {entry.label}
                      </Link>
                    );
                  }

                  return (
                    <section key={entry.key} className="ees-nav-mobile-section">
                      <h2>{entry.label}</h2>
                      <div className="ees-nav-mobile-section__list">
                        {entry.items.map((item, index) => {
                          const Icon = item.icon;
                          const active =
                            !item.suppressActive &&
                            routeIsActive(pathname, item.href);

                          return (
                            <Link
                              key={`${entry.key}-mobile-${item.href}-${index}`}
                              href={item.href}
                              className={`ees-nav-mobile-link${active ? " is-active" : ""}`}
                            >
                              <Icon className="h-4 w-4 shrink-0" aria-hidden />
                              {item.label}
                            </Link>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </nav>
          </>
        ) : null}
      </div>
    </header>
  );
}
