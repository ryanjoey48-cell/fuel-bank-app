"use client";

import { ChevronDown, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountMenu } from "@/components/account-menu";
import { EESLogo } from "@/components/ees-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/lib/language-provider";
import { routeIsActive, useOfficeNavEntries } from "@/lib/office-nav";
import "@/components/floating-nav-v3.css";

/**
 * Navigation V3: small floating trigger + left drawer for every office page
 * except Home (which keeps the glass TopNavigation). Entries come from the
 * shared useOfficeNavEntries() hook, so access rules and labels never drift.
 */
export function FloatingNavV3() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const copy = t.home.topNavigation;
  const entries = useOfficeNavEntries();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);

  const close = useCallback(() => setOpen(false), []);

  // Route change: close, and auto-expand only the group holding the active page.
  useEffect(() => {
    setOpen(false);
    const next: Record<string, boolean> = {};
    for (const entry of entries) {
      if (entry.type === "group" && entry.items.some((i) => routeIsActive(pathname, i.href))) {
        next[entry.key] = true;
      }
    }
    setExpanded(next);
    // Re-seed on route change only; entries identity changes with language/access.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Focus management, scroll lock (small screens), Escape, focus trap.
  useEffect(() => {
    if (!open) {
      if (wasOpen.current) triggerRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    closeRef.current?.focus();

    const lock = window.matchMedia("(max-width: 1023px)").matches;
    const prevOverflow = document.body.style.overflow;
    if (lock) document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusables = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>("a[href]:not([tabindex='-1']), button:not([disabled])")
      ).filter((el) => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (lock) document.body.style.overflow = prevOverflow;
    };
  }, [open, close]);

  return (
    <div className="ees-v3">
      <button
        ref={triggerRef}
        type="button"
        className="ees-v3__trigger"
        aria-label={copy.openMenu}
        aria-expanded={open}
        aria-controls="ees-v3-drawer"
        onClick={() => setOpen(true)}
      >
        <Menu aria-hidden className="ees-v3__trigger-icon" />
      </button>

      <div className={`ees-v3__backdrop${open ? " is-open" : ""}`} onClick={close} aria-hidden />

      <aside
        ref={drawerRef}
        id="ees-v3-drawer"
        className={`ees-v3__drawer${open ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={t.common.navigation}
        inert={!open}
      >
        <header className="ees-v3__head">
          <Link href="/dashboard" className="ees-v3__brand">
            <EESLogo alt={t.common.appName} size={44} />
            <span className="ees-v3__brand-copy">
              <span className="ees-v3__brand-title">EES Operations</span>
              <span className="ees-v3__brand-sub">{t.common.appSubtitle}</span>
            </span>
          </Link>
          <button ref={closeRef} type="button" className="ees-v3__close" aria-label={copy.closeMenu} onClick={close}>
            <X aria-hidden className="h-5 w-5" />
          </button>
        </header>

        <div className="ees-v3__tools">
          <LanguageSwitcher compact />
          <AccountMenu compact />
        </div>

        <nav className="ees-v3__nav" aria-label={t.common.navigation}>
          {entries.map((entry) => {
            if (entry.type === "link") {
              const active = routeIsActive(pathname, entry.href);
              return (
                <Link
                  key={entry.key}
                  href={entry.href}
                  className={`ees-v3__link${active ? " is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={close}
                >
                  {entry.label}
                </Link>
              );
            }
            const isOpen = !!expanded[entry.key];
            const groupActive = entry.items.some((i) => !i.suppressActive && routeIsActive(pathname, i.href));
            return (
              <section key={entry.key} className="ees-v3__group">
                <button
                  type="button"
                  className={`ees-v3__group-btn${groupActive ? " is-active" : ""}`}
                  aria-expanded={isOpen}
                  aria-controls={`ees-v3-group-${entry.key}`}
                  onClick={() => setExpanded((cur) => ({ ...cur, [entry.key]: !cur[entry.key] }))}
                >
                  <span>{entry.label}</span>
                  <ChevronDown aria-hidden className="ees-v3__chev" />
                </button>
                <div id={`ees-v3-group-${entry.key}`} className={`ees-v3__items${isOpen ? " is-open" : ""}`}>
                  <div className="ees-v3__items-inner">
                    {entry.items.map((item, index) => {
                      const Icon = item.icon;
                      const active = !item.suppressActive && routeIsActive(pathname, item.href);
                      return (
                        <Link
                          key={`${item.href}-${index}`}
                          href={item.href}
                          className={`ees-v3__item${active ? " is-active" : ""}`}
                          aria-current={active ? "page" : undefined}
                          tabIndex={isOpen ? 0 : -1}
                          onClick={close}
                        >
                          <Icon aria-hidden className="h-4 w-4 shrink-0" />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </section>
            );
          })}
        </nav>
      </aside>
    </div>
  );
}
