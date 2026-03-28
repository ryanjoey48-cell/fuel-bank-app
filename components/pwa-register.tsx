"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

    document.documentElement.classList.toggle("standalone-app", isStandalone);

    if (!("serviceWorker" in navigator)) {
      return;
    }

    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js");
    });
  }, []);

  return null;
}
