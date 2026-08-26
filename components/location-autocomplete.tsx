"use client";

import { MapPinned, RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { fetchJson } from "@/lib/http";

type LocationSuggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
  source?: "browser" | "server";
  browserPrediction?: BrowserPlacePrediction;
};

export type StructuredLocation = {
  label: string;
  formatted_address: string;
  place_id: string | null;
  lat: number;
  lng: number;
  country_code?: string | null;
  manual_text?: string;
  verified?: boolean;
};

type LocationAutocompleteProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  language?: "en" | "th";
  disabled?: boolean;
  configMissingMessage: string;
  helperText?: string;
  loadingText?: string;
  invalidText?: string;
  verifiedText?: string;
  manualUnverifiedText?: string;
  manualEntryText?: string;
  selectedLocation?: StructuredLocation | null;
  savedLocationApplied?: boolean;
  savedLocationAppliedText?: string;
  changeLocationText?: string;
  containerClassName?: string;
  onSelectLocation?: (location: StructuredLocation) => void;
  onManualInput?: (value: string) => void;
  onConfigurationChange?: (configured: boolean, message?: string) => void;
};

type AutocompleteConfigResponse = {
  configured?: boolean;
  browserConfigured?: boolean;
  serverConfigured?: boolean;
  missingVariables?: string[];
  message?: string | null;
  suggestions?: LocationSuggestion[];
};

type BrowserText = string | { toString: () => string } | null | undefined;
type BrowserPlace = {
  id?: string;
  displayName?: string;
  formattedAddress?: string;
  location?: { lat: () => number; lng: () => number };
  addressComponents?: Array<{ shortText?: string; types?: string[] }>;
  fetchFields: (input: { fields: string[] }) => Promise<void>;
};
type BrowserPlacePrediction = {
  placeId?: string;
  text?: BrowserText;
  mainText?: BrowserText;
  secondaryText?: BrowserText;
  toPlace: () => BrowserPlace;
};
type BrowserPlacesApi = {
  AutocompleteSessionToken?: new () => object;
  AutocompleteSuggestion?: {
    fetchAutocompleteSuggestions: (input: Record<string, unknown>) => Promise<{
      suggestions?: Array<{ placePrediction?: BrowserPlacePrediction }>;
    }>;
  };
};
type BrowserGoogleMapsLoader = { promise?: Promise<void> };

const GOOGLE_MAPS_STATUS_EVENT = "fuel-bank:google-maps-status";

function getBrowserPlaces() {
  return typeof window === "undefined"
    ? undefined
    : window.google?.maps?.places as BrowserPlacesApi | undefined;
}

function browserText(value: BrowserText) {
  if (typeof value === "string") return value;
  return value?.toString() ?? "";
}

async function fetchBrowserPredictions(
  input: string,
  language: "en" | "th",
  sessionToken: object
) {
  const places = getBrowserPlaces();
  if (!places?.AutocompleteSuggestion) return null;
  const result = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input,
    includedRegionCodes: ["th"],
    language,
    region: "TH",
    sessionToken
  });
  return (result.suggestions ?? []).flatMap((suggestion) => {
    const prediction = suggestion.placePrediction;
    if (!prediction) return [];
    const description = browserText(prediction.text);
    return [{
      placeId: prediction.placeId ?? description,
      description,
      mainText: browserText(prediction.mainText) || description,
      secondaryText: browserText(prediction.secondaryText),
      source: "browser" as const,
      browserPrediction: prediction
    }];
  }).slice(0, 5);
}

async function getBrowserPlaceDetails(prediction: BrowserPlacePrediction, invalidText: string) {
  const place = prediction.toPlace();
  await place.fetchFields({
    fields: ["id", "displayName", "formattedAddress", "location", "addressComponents"]
  });
  const latitude = place.location?.lat();
  const longitude = place.location?.lng();
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error(invalidText);
  const placeId = place.id || prediction.placeId || "";
  const label = place.displayName || place.formattedAddress || placeId;
  const address = place.formattedAddress || place.displayName || placeId;
  return {
    label,
    formatted_address: address,
    place_id: placeId,
    lat: Number(latitude),
    lng: Number(longitude),
    country_code: place.addressComponents?.find((component) => component.types?.includes("country"))?.shortText?.toUpperCase() ?? null,
    verified: true
  } satisfies StructuredLocation;
}

export function LocationAutocomplete({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  language = "en",
  disabled = false,
  configMissingMessage,
  helperText,
  loadingText = "Loading location suggestions...",
  invalidText = "Please select a valid location from the Google suggestions.",
  verifiedText = "Verified by Google",
  manualUnverifiedText = "manual/unverified",
  manualEntryText = "You can still type the full location manually.",
  selectedLocation,
  savedLocationApplied = false,
  savedLocationAppliedText = "Saved location applied",
  changeLocationText = "Change Google Maps location",
  containerClassName = "form-field md:col-span-2",
  onSelectLocation,
  onManualInput,
  onConfigurationChange
}: LocationAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [mapsConfigured, setMapsConfigured] = useState<boolean | null>(null);
  const [browserConfigured, setBrowserConfigured] = useState<boolean | null>(null);
  const [browserPlacesReady, setBrowserPlacesReady] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [sessionToken, setSessionToken] = useState(() => crypto.randomUUID());
  const browserSessionTokenRef = useRef<object | null>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const userEditedRef = useRef(false);
  const listboxId = useId();

  useEffect(() => {
    let cancelled = false;

    const loadConfiguration = async () => {
      try {
        const result = await fetchJson<{
          configured?: boolean;
          browserConfigured?: boolean;
          serverConfigured?: boolean;
          suggestions?: LocationSuggestion[];
          message?: string | null;
          missingVariables?: string[];
        }>(`/api/location-autocomplete?language=${language}`);

        if (!cancelled) {
          const configured = Boolean(
            result.data?.browserConfigured ??
              result.data?.serverConfigured ??
              result.data?.configured
          );
          setBrowserConfigured(Boolean(result.data?.browserConfigured));
          const configMessage =
            result.data?.message ||
            (result.data?.missingVariables?.length
              ? `Missing ${result.data.missingVariables.join(" and ")}`
              : configMissingMessage);
          if (process.env.NODE_ENV !== "production") {
            console.info(`[Fuel Bank] Google location search ${configured ? "configured" : "not configured"}.`);
          }
          setMapsConfigured(configured);
          onConfigurationChange?.(configured, configured ? undefined : configMessage);
          if (!configured) {
            setStatusMessage(configMessage);
            setCanRetry(true);
          }
        }
      } catch (error) {
        if (!cancelled) {
          if (process.env.NODE_ENV !== "production") {
            console.info("[Fuel Bank] Google location search configuration check failed.");
          }
          setMapsConfigured(null);
          setStatusMessage(error instanceof Error ? error.message : "Google location search is unavailable.");
          setCanRetry(true);
        }
      }
    };

    void loadConfiguration();

    return () => {
      cancelled = true;
    };
  }, [configMissingMessage, language, onConfigurationChange]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateBrowserStatus = () => {
      const places = getBrowserPlaces();
      const ready = Boolean(places?.AutocompleteSuggestion && places.AutocompleteSessionToken);
      setBrowserPlacesReady(ready);
      if (ready) {
        setMapsConfigured(true);
        setStatusMessage(helperText ?? null);
        setCanRetry(false);
        onConfigurationChange?.(true);
      }
    };
    updateBrowserStatus();
    const loaderPromise = (window.__fuelBankGoogleMapsLoader as BrowserGoogleMapsLoader | undefined)?.promise;
    if (loaderPromise) void loaderPromise.then(updateBrowserStatus).catch((error) => {
      setStatusMessage(error instanceof Error ? error.message : "Google Places failed to load.");
      setCanRetry(true);
      onConfigurationChange?.(false, error instanceof Error ? error.message : "Google Places failed to load.");
    });
    window.addEventListener(GOOGLE_MAPS_STATUS_EVENT, updateBrowserStatus);
    return () => window.removeEventListener(GOOGLE_MAPS_STATUS_EVENT, updateBrowserStatus);
  }, [helperText, onConfigurationChange]);

  useEffect(() => {
    if (disabled || mapsConfigured === false || !userEditedRef.current) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const query = value.trim();
    if (query.length < 2) {
      setSuggestions([]);
      setLoading(false);
      setActiveIndex(-1);
      return;
    }

    const nextRequestId = requestIdRef.current + 1;
    requestIdRef.current = nextRequestId;

    const timeoutId = setTimeout(async () => {
      try {
        setLoading(true);
        if (browserConfigured && !browserPlacesReady) {
          setStatusMessage("Google Places is still loading. Retry if it does not become ready.");
          return;
        }
        if (browserPlacesReady) {
          const places = getBrowserPlaces();
          const SessionToken = places?.AutocompleteSessionToken;
          if (!SessionToken) throw new Error("Google Places session token is unavailable.");
          browserSessionTokenRef.current ??= new SessionToken();
          const browserSuggestions = await fetchBrowserPredictions(
            query,
            language,
            browserSessionTokenRef.current
          );
          if (requestIdRef.current !== nextRequestId) return;
          setSuggestions(browserSuggestions ?? []);
          setIsOpen(true);
          setActiveIndex(-1);
          setStatusMessage(helperText ?? null);
          setCanRetry(false);
          return;
        }

        const result = await fetchJson<AutocompleteConfigResponse>(
          `/api/location-autocomplete?input=${encodeURIComponent(query)}&language=${language}&sessionToken=${encodeURIComponent(sessionToken)}`
        );

        if (requestIdRef.current !== nextRequestId) {
          return;
        }

        if (result.data?.configured === false || result.data?.serverConfigured === false) {
          const configMessage =
            result.data?.message ||
            (result.data?.missingVariables?.length
              ? `Missing ${result.data.missingVariables.join(" and ")}`
              : configMissingMessage);
          setMapsConfigured(false);
          onConfigurationChange?.(false, configMessage);
          setSuggestions([]);
          setStatusMessage(configMessage);
          setCanRetry(true);
          setIsOpen(false);
          return;
        }

        setMapsConfigured(true);
        onConfigurationChange?.(true);
        setStatusMessage(helperText ?? null);
        setCanRetry(false);
        setSuggestions((result.data?.suggestions ?? []).map((suggestion) => ({ ...suggestion, source: "server" })));
        setIsOpen(true);
        setActiveIndex(-1);
      } catch (error) {
        if (requestIdRef.current === nextRequestId) {
          setSuggestions([]);
          setStatusMessage(error instanceof Error ? error.message : "Places Autocomplete failed.");
          setCanRetry(true);
        }
      } finally {
        if (requestIdRef.current === nextRequestId) {
          setLoading(false);
        }
      }
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [
    configMissingMessage,
    disabled,
    helperText,
    language,
    mapsConfigured,
    browserConfigured,
    browserPlacesReady,
    onConfigurationChange,
    sessionToken,
    value
  ]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const selectSuggestion = async (suggestion: LocationSuggestion) => {
    userEditedRef.current = false;
    setLoading(true);
    try {
      if (suggestion.source === "browser" && suggestion.browserPrediction) {
        const location = await getBrowserPlaceDetails(suggestion.browserPrediction, invalidText);
        onChange(location.formatted_address || location.label);
        onSelectLocation?.(location);
        setSuggestions([]);
        setIsOpen(false);
        setActiveIndex(-1);
        setStatusMessage(helperText ?? null);
        setCanRetry(false);
        browserSessionTokenRef.current = null;
        setSessionToken(crypto.randomUUID());
        return;
      }

      const result = await fetchJson<StructuredLocation>(
        `/api/location-details?placeId=${encodeURIComponent(suggestion.placeId)}&language=${language}&sessionToken=${encodeURIComponent(sessionToken)}`
      );
      const location = {
        label: result.data?.label || suggestion.mainText || suggestion.description,
        formatted_address: result.data?.formatted_address || suggestion.description,
        place_id: result.data?.place_id || suggestion.placeId,
        lat: Number(result.data?.lat),
        lng: Number(result.data?.lng),
        verified: true
      };
      if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
        throw new Error(invalidText);
      }
      onChange(location.formatted_address || location.label);
      onSelectLocation?.(location);
      setSuggestions([]);
      setIsOpen(false);
      setActiveIndex(-1);
      setStatusMessage(helperText ?? null);
      setCanRetry(false);
      setSessionToken(crypto.randomUUID());
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : invalidText);
      setCanRetry(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={containerClassName}>
      <label className={required ? "form-label form-label-required" : "form-label"}>{label}</label>
      <div className="relative">
        <MapPinned className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          role="combobox"
          required={required}
          value={value}
          disabled={disabled}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={isOpen && suggestions.length > 0}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          onChange={(event) => {
            userEditedRef.current = true;
            onChange(event.target.value);
            onManualInput?.(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (suggestions.length > 0) {
              setIsOpen(true);
            }
          }}
          onBlur={() => {
            blurTimeoutRef.current = setTimeout(() => setIsOpen(false), 120);
          }}
          onKeyDown={(event) => {
            if (!suggestions.length) {
              return;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) => Math.min(current + 1, suggestions.length - 1));
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
              return;
            }

            if (event.key === "Enter" && activeIndex >= 0) {
              event.preventDefault();
              void selectSuggestion(suggestions[activeIndex]);
              return;
            }

            if (event.key === "Escape") {
              setIsOpen(false);
            }
          }}
          className="form-input bg-white pl-11"
          placeholder={placeholder ?? "Type location"}
        />

        {isOpen && suggestions.length > 0 ? (
          <div
            id={listboxId}
            role="listbox"
            className="absolute z-20 mt-2 w-full overflow-hidden rounded-[1rem] border border-slate-200 bg-white shadow-[0_20px_60px_-32px_rgba(15,23,42,0.35)]"
          >
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.placeId}
                type="button"
                className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${
                  index === activeIndex ? "bg-slate-100" : "bg-white hover:bg-slate-50"
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  void selectSuggestion(suggestion);
                }}
                onClick={() => void selectSuggestion(suggestion)}
              >
                <MapPinned className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">
                    {suggestion.mainText}
                  </span>
                  {suggestion.secondaryText ? (
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {suggestion.secondaryText}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <p className="mt-2 text-sm text-slate-500">
        {mapsConfigured === false
          ? statusMessage ?? configMissingMessage
          : loading
            ? loadingText
            : selectedLocation
              ? selectedLocation.place_id
                ? `${verifiedText}: ${selectedLocation.formatted_address}`
                : selectedLocation.manual_text
                  ? `${selectedLocation.manual_text} - ${manualUnverifiedText}`
                  : selectedLocation.formatted_address
              : statusMessage ?? helperText ?? "Type at least 2 characters and select a verified Google result."}
      </p>
      {canRetry ? <button type="button" className="btn-secondary mt-2 min-h-9 text-xs" onClick={() => {
        setCanRetry(false);
        setStatusMessage("Retrying Google Places...");
        window.__fuelBankGoogleMapsLoader?.retry();
        window.location.reload();
      }}><RefreshCw className="h-4 w-4" />Retry Google Places</button> : null}
      {savedLocationApplied ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-brand-700">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-1">
            <MapPinned className="h-3.5 w-3.5" />
            {savedLocationAppliedText}
          </span>
          <span className="text-slate-500">{changeLocationText}</span>
        </p>
      ) : null}
    </div>
  );
}
