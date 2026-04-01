"use client";

import { useEffect } from "react";
import { getClientGoogleMapsApiKey } from "@/lib/google-maps";

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary?: (libraryName: string) => Promise<unknown>;
        __ib__?: () => void;
      };
    };
    __fuelBankGoogleMapsLoader?: Promise<void>;
  }
}

export function GoogleMapsLoader() {
  useEffect(() => {
    const apiKey = getClientGoogleMapsApiKey();

    if (!apiKey || typeof window === "undefined") {
      return;
    }

    if (window.google?.maps?.importLibrary) {
      void Promise.all([
        window.google.maps.importLibrary("maps"),
        window.google.maps.importLibrary("places")
      ]).catch(() => undefined);
      return;
    }

    if (!window.__fuelBankGoogleMapsLoader) {
      window.__fuelBankGoogleMapsLoader = new Promise<void>((resolve, reject) => {
        const googleNamespace = (window.google = window.google ?? {});
        const mapsNamespace = (googleNamespace.maps = googleNamespace.maps ?? {});

        mapsNamespace.__ib__ = () => resolve();

        const params = new URLSearchParams({
          key: apiKey,
          v: "weekly",
          loading: "async",
          callback: "google.maps.__ib__"
        });

        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
        script.async = true;
        script.defer = true;
        script.onerror = () => reject(new Error("Google Maps JavaScript API could not load."));
        document.head.appendChild(script);
      });
    }

    void window.__fuelBankGoogleMapsLoader
      .then(async () => {
        if (!window.google?.maps?.importLibrary) {
          return;
        }

        await Promise.all([
          window.google.maps.importLibrary("maps"),
          window.google.maps.importLibrary("places")
        ]);
      })
      .catch(() => undefined);
  }, []);

  return null;
}
