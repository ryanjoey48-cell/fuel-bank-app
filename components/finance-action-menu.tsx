"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Escape the scrolling paper list while keeping keyboard focus with its row. */
export default function FinanceActionMenu({ open, onClose, onToggle, label, children }: {
  open: boolean; onClose: () => void; onToggle: () => void; label: string; children: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 320 });
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = trigger.current!;
    const rect = anchor.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const height = Math.min(menu.current?.scrollHeight || 320, Math.max(below, above));
    setPosition({ left: Math.max(8, Math.min(rect.right - 272, window.innerWidth - 280)), top: below >= height ? rect.bottom + 6 : Math.max(8, rect.top - height - 6), maxHeight: Math.max(80, Math.max(below, above)) });
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose();
    };
    const close = () => onClose();
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", close); };
  }, [open, onClose]);
  return <>
    <button ref={trigger} type="button" className="ees-fc-icon-btn !h-8 !w-8" aria-haspopup="menu" aria-controls={open ? menuId : undefined} aria-expanded={open} aria-label={label} onClick={onToggle}>⋯</button>
    {open ? createPortal(<div ref={menu} id={menuId} role="menu" aria-label={label} className="fc6-action-menu" style={position}
      onKeyDown={event => {
        if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); onClose(); trigger.current?.focus(); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
      }} onClick={event => { if ((event.target as Element).closest("button:not(:disabled)")) trigger.current?.focus(); }}>
      {children}
    </div>, document.body) : null}
  </>;
}
