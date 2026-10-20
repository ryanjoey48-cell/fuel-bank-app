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

    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
        .then(registration => registration.update()).catch(() => undefined);
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    window.addEventListener("focus", register);
    return () => {window.removeEventListener("load", register);window.removeEventListener("focus", register);};
  }, []);

  return null;
}
