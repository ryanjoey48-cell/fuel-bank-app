"use client";

import { useEffect } from "react";
import {
  createGoogleMapsStatus,
  extractGoogleMapsErrorCode,
  getClientGoogleMapsConfig,
  getGoogleMapsErrorMessage,
  type GoogleMapsHealthStatus
} from "@/lib/google-maps";

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary?: (libraryName: string) => Promise<unknown>;
        places?: unknown;
        DirectionsService?: unknown;
        __ib__?: () => void;
      };
    };
    gm_authFailure?: () => void;
    __fuelBankGoogleMapsLoader?: {
      promise: Promise<void>;
      status: GoogleMapsHealthStatus;
      retry: () => void;
    };
  }
}

type GoogleMapsLoaderProps = {
  depotConfigured?: boolean;
  onStatusChange?: (status: GoogleMapsHealthStatus) => void;
};

const GOOGLE_MAPS_STATUS_EVENT = "fuel-bank:google-maps-status";

function publishStatus(status: GoogleMapsHealthStatus, onStatusChange?: (status: GoogleMapsHealthStatus) => void) {
  onStatusChange?.(status);
  if (typeof window !== "undefined") {
    window.__fuelBankGoogleMapsLoader = window.__fuelBankGoogleMapsLoader
      ? { ...window.__fuelBankGoogleMapsLoader, status }
      : undefined;
    window.dispatchEvent(new CustomEvent(GOOGLE_MAPS_STATUS_EVENT, { detail: status }));
  }
}

export function GoogleMapsLoader({ depotConfigured = false, onStatusChange }: GoogleMapsLoaderProps) {
  useEffect(() => {
    const { hasKey, key: apiKey, source, legacySource, missingVariable } = getClientGoogleMapsConfig();
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      const message = args.map((arg) => String(arg)).join(" ");
      const googleMapsErrorCode = extractGoogleMapsErrorCode(message);
      if (googleMapsErrorCode) {
        publishStatus(
          createGoogleMapsStatus({
            hasPublicKey: hasKey,
            publicSource: source,
            legacyPublicSource: legacySource,
            missingPublicVariables: hasKey ? [] : ["NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"],
            depotConfigured,
            scriptLoaded: Boolean(window.google?.maps),
            placesAvailable: Boolean(window.google?.maps?.places),
            directionsAvailable: Boolean(window.google?.maps?.DirectionsService),
            errorCode: googleMapsErrorCode,
            errorMessage: getGoogleMapsErrorMessage(googleMapsErrorCode, message)
          }),
          onStatusChange
        );
      }
      originalConsoleError(...args);
    };

    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[Fuel Bank] Google Maps browser key ${hasKey ? "loaded" : "missing"}${source ? ` from ${source}` : ""}${legacySource && !source ? `; legacy key ${legacySource} is present but not used` : ""}.`
      );
    }

    if (!apiKey || typeof window === "undefined") {
      publishStatus(
        createGoogleMapsStatus({
          hasPublicKey: hasKey,
          publicSource: source,
          legacyPublicSource: legacySource,
          missingPublicVariables: hasKey ? [] : ["NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"],
          depotConfigured,
          errorCode: "MissingPublicKey",
          errorMessage: `Missing ${missingVariable ?? "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"}`
        }),
        onStatusChange
      );
      return () => {
        if (console.error === originalConsoleError) return;
        console.error = originalConsoleError;
      };
    }

    const emitLoadedStatus = () => {
      publishStatus(
        createGoogleMapsStatus({
          hasPublicKey: true,
          publicSource: source,
          legacyPublicSource: legacySource,
          missingPublicVariables: [],
          depotConfigured,
          scriptLoaded: Boolean(window.google?.maps),
          placesAvailable: Boolean(window.google?.maps?.places),
          directionsAvailable: Boolean(window.google?.maps?.DirectionsService),
          errorCode: window.google?.maps?.places ? null : "PlacesLibraryMissing",
          errorMessage: window.google?.maps?.places ? null : "Google Maps Places library missing."
        }),
        onStatusChange
      );
    };

    const createLoader = () => {
      const promise = new Promise<void>((resolve, reject) => {
        const googleNamespace = (window.google = window.google ?? {});
        const mapsNamespace = (googleNamespace.maps = googleNamespace.maps ?? {});
        const timeoutId = window.setTimeout(() => {
          reject(new Error("Google Maps script load timed out."));
        }, 12000);

        mapsNamespace.__ib__ = () => {
          window.clearTimeout(timeoutId);
          resolve();
        };

        window.gm_authFailure = () => {
          window.clearTimeout(timeoutId);
          reject(new Error("Google Maps authentication failed. Check key, referrer restrictions, enabled APIs, and billing."));
        };

        const params = new URLSearchParams({
          key: apiKey,
          v: "weekly",
          libraries: "places",
          loading: "async",
          callback: "google.maps.__ib__"
        });

        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
        script.async = true;
        script.defer = true;
        script.dataset.fuelBankGoogleMaps = "true";
        script.onerror = () => {
          window.clearTimeout(timeoutId);
          reject(new Error("Google Maps JavaScript API could not load."));
        };
        document.head.appendChild(script);
      });
      const retry = () => {
        document.querySelectorAll("script[data-fuel-bank-google-maps='true']").forEach((script) => script.remove());
        window.__fuelBankGoogleMapsLoader = undefined;
        window.google = undefined;
      };

      window.__fuelBankGoogleMapsLoader = {
        promise,
        retry,
        status: createGoogleMapsStatus({
          hasPublicKey: true,
          publicSource: source,
          legacyPublicSource: legacySource,
          missingPublicVariables: [],
          depotConfigured
        })
      };
      return window.__fuelBankGoogleMapsLoader;
    };

    const loader = window.__fuelBankGoogleMapsLoader ?? createLoader();

    if (window.google?.maps?.importLibrary && !window.google.maps.places) {
      loader.promise = Promise.resolve();
    }

    void loader.promise
      .then(async () => {
        if (!window.google?.maps?.importLibrary) {
          publishStatus(
            createGoogleMapsStatus({
              hasPublicKey: true,
              publicSource: source,
              legacyPublicSource: legacySource,
              missingPublicVariables: [],
              depotConfigured,
              scriptLoaded: Boolean(window.google?.maps),
              errorCode: "ScriptLoadedImportMissing",
              errorMessage: "Google Maps loaded without importLibrary."
            }),
            onStatusChange
          );
          return;
        }

        await Promise.all([
          window.google.maps.importLibrary("maps"),
          window.google.maps.importLibrary("places")
        ]);
        emitLoadedStatus();
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Google Maps JavaScript API could not load.";
        const errorCode = extractGoogleMapsErrorCode(message) ?? "ScriptLoadFailed";
        publishStatus(
          createGoogleMapsStatus({
            hasPublicKey: true,
            publicSource: source,
            legacyPublicSource: legacySource,
            missingPublicVariables: [],
            depotConfigured,
            errorCode,
            errorMessage: getGoogleMapsErrorMessage(errorCode, message)
          }),
          onStatusChange
        );
      });
    return () => {
      if (console.error !== originalConsoleError) {
        console.error = originalConsoleError;
      }
    };
  }, [depotConfigured, onStatusChange]);

  return null;
}
