"use client";

import { useEffect } from "react";

/** Keep the underlying page stationary while a responsive sheet is open. */
export function useModalScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
}
