"use client";

import { MapPinned } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { fetchJson } from "@/lib/http";

type LocationSuggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
  source?: "browser" | "server";
};

export type StructuredLocation = {
  label: string;
  formatted_address: string;
  place_id: string | null;
  lat: number;
  lng: number;
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
  selectedLocation?: StructuredLocation | null;
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

type BrowserPrediction = {
  place_id?: string;
  description?: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
};

type BrowserPlacesApi = {
  AutocompleteService?: new () => {
    getPlacePredictions: (
      request: Record<string, unknown>,
      callback: (predictions: BrowserPrediction[] | null, status: string) => void
    ) => void;
  };
  PlacesService?: new (node: HTMLDivElement) => {
    getDetails: (
      request: Record<string, unknown>,
      callback: (place: Record<string, unknown> | null, status: string) => void
    ) => void;
  };
  PlacesServiceStatus?: {
    OK?: string;
    ZERO_RESULTS?: string;
  };
};

type BrowserGoogleMapsLoader = {
  promise?: Promise<void>;
};

const GOOGLE_MAPS_STATUS_EVENT = "fuel-bank:google-maps-status";

function getBrowserPlaces() {
  return typeof window !== "undefined"
    ? (window.google?.maps?.places as BrowserPlacesApi | undefined)
    : undefined;
}

function mapBrowserPredictions(predictions: BrowserPrediction[] | null): LocationSuggestion[] {
  return (predictions ?? []).slice(0, 5).map((prediction) => ({
    placeId: prediction.place_id ?? prediction.description ?? "",
    description: prediction.description ?? "",
    mainText: prediction.structured_formatting?.main_text ?? prediction.description ?? "",
    secondaryText: prediction.structured_formatting?.secondary_text ?? "",
    source: "browser"
  }));
}

function fetchBrowserPredictions(input: string, language: "en" | "th") {
  const places = getBrowserPlaces();
  if (!places?.AutocompleteService) {
    return null;
  }
  const AutocompleteService = places.AutocompleteService;

  return new Promise<LocationSuggestion[]>((resolve, reject) => {
    const service = new AutocompleteService();
    service.getPlacePredictions(
      {
        input,
        componentRestrictions: { country: "th" },
        language
      },
      (predictions, status) => {
        const okStatus = places.PlacesServiceStatus?.OK ?? "OK";
        const zeroResultsStatus = places.PlacesServiceStatus?.ZERO_RESULTS ?? "ZERO_RESULTS";
        if (status === okStatus || status === zeroResultsStatus) {
          resolve(mapBrowserPredictions(predictions));
          return;
        }
        reject(new Error(`Places Autocomplete failed: ${status}`));
      }
    );
  });
}

function getTextField(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) {
    const text = (value as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }
  return "";
}

function getBrowserPlaceDetails(placeId: string, invalidText: string) {
  const places = getBrowserPlaces();
  if (!places?.PlacesService) {
    return null;
  }
  const PlacesService = places.PlacesService;

  return new Promise<StructuredLocation>((resolve, reject) => {
    const node = document.createElement("div");
    const service = new PlacesService(node);
    service.getDetails(
      {
        placeId: placeId.replace(/^places\//, ""),
        fields: ["place_id", "name", "formatted_address", "geometry"]
      },
      (place, status) => {
        const okStatus = places.PlacesServiceStatus?.OK ?? "OK";
        if (status !== okStatus || !place) {
          reject(new Error(`Place details failed: ${status}`));
          return;
        }

        const geometry = place.geometry as
          | {
              location?: {
                lat?: () => number;
                lng?: () => number;
              };
            }
          | undefined;
        const lat = geometry?.location?.lat?.();
        const lng = geometry?.location?.lng?.();
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          reject(new Error(invalidText));
          return;
        }

        const name = getTextField(place.name);
        const formattedAddress = getTextField(place.formatted_address);
        const resolvedPlaceId = getTextField(place.place_id) || placeId;
        resolve({
          label: name || formattedAddress || resolvedPlaceId,
          formatted_address: formattedAddress || name || resolvedPlaceId,
          place_id: resolvedPlaceId,
          lat: Number(lat),
          lng: Number(lng),
          verified: true
        });
      }
    );
  });
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
  selectedLocation,
  onSelectLocation,
  onManualInput,
  onConfigurationChange
}: LocationAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [mapsConfigured, setMapsConfigured] = useState<boolean | null>(null);
  const [browserPlacesReady, setBrowserPlacesReady] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [sessionToken, setSessionToken] = useState(() => crypto.randomUUID());
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
          const configMessage =
            result.data?.message ||
            (result.data?.missingVariables?.length
              ? `Missing ${result.data.missingVariables.join(" and ")}`
              : configMissingMessage);
          if (process.env.NODE_ENV !== "production") {
            console.info(`[Fuel Bank] Google Maps autocomplete proxy ${configured ? "configured" : "not configured"}.`);
          }
          setMapsConfigured(configured);
          onConfigurationChange?.(configured, configured ? undefined : configMessage);
          if (!configured) {
            setStatusMessage(configMessage);
          }
        }
      } catch (error) {
        if (!cancelled) {
          if (process.env.NODE_ENV !== "production") {
            console.info("[Fuel Bank] Google Maps autocomplete proxy configuration check failed.");
          }
          setMapsConfigured(null);
          setStatusMessage(error instanceof Error ? error.message : "Google location search unavailable, manual entry still allowed.");
        }
      }
    };

    void loadConfiguration();

    return () => {
      cancelled = true;
    };
  }, [configMissingMessage, language, onConfigurationChange]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateBrowserStatus = () => {
      const ready = Boolean(getBrowserPlaces()?.AutocompleteService);
      setBrowserPlacesReady(ready);
      if (ready) {
        setMapsConfigured(true);
        setStatusMessage(helperText ?? null);
        onConfigurationChange?.(true);
      }
    };

    updateBrowserStatus();

    const loaderPromise = (window.__fuelBankGoogleMapsLoader as BrowserGoogleMapsLoader | undefined)?.promise;
    if (loaderPromise) {
      void loaderPromise.then(updateBrowserStatus).catch((error) => {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : "Google Maps script failed to load. Manual entry still allowed."
        );
      });
    }

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
        const browserPredictionRequest = browserPlacesReady
          ? fetchBrowserPredictions(query, language)
          : null;
        const browserPredictions = browserPredictionRequest
          ? await browserPredictionRequest.catch((error) => {
              const message =
                error instanceof Error
                  ? error.message
                  : "Places Autocomplete failed.";
              if (process.env.NODE_ENV !== "production") {
                console.warn("[Fuel Bank] Browser Places Autocomplete failed; trying server proxy.", message);
              }
              setStatusMessage(`${message} Trying server search...`);
              return null;
            })
          : null;

        if (requestIdRef.current !== nextRequestId) {
          return;
        }

        if (browserPredictions) {
          setMapsConfigured(true);
          onConfigurationChange?.(true);
          setStatusMessage(helperText ?? null);
          setSuggestions(browserPredictions);
          setIsOpen(true);
          setActiveIndex(-1);
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
          setIsOpen(false);
          return;
        }

        setMapsConfigured(true);
        onConfigurationChange?.(true);
        setStatusMessage(helperText ?? null);
        setSuggestions((result.data?.suggestions ?? []).map((suggestion) => ({ ...suggestion, source: "server" })));
        setIsOpen(true);
        setActiveIndex(-1);
      } catch (error) {
        if (requestIdRef.current === nextRequestId) {
          setSuggestions([]);
          setStatusMessage(
            error instanceof Error
              ? `${error.message}. Manual entry still allowed.`
              : "Places Autocomplete failed. Manual entry still allowed."
          );
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
      const browserDetailsRequest =
        suggestion.source === "browser"
          ? getBrowserPlaceDetails(suggestion.placeId, invalidText)
          : null;
      const browserDetails = browserDetailsRequest
        ? await browserDetailsRequest.catch(() => null)
        : null;
      if (browserDetails) {
        onChange(browserDetails.formatted_address || browserDetails.label);
        onSelectLocation?.(browserDetails);
        setSuggestions([]);
        setIsOpen(false);
        setActiveIndex(-1);
        setStatusMessage(helperText ?? null);
        setSessionToken(crypto.randomUUID());
        return;
      }

      const result = await fetchJson<StructuredLocation>(
        `/api/location-details?placeId=${encodeURIComponent(suggestion.placeId)}&language=${language}`
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
      setSessionToken(crypto.randomUUID());
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : invalidText);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-field md:col-span-2">
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
          ? `${statusMessage ?? configMissingMessage}. You can still type the full location manually.`
          : loading
            ? loadingText
            : selectedLocation
              ? selectedLocation.place_id
                ? `Verified by Google: ${selectedLocation.formatted_address}`
                : selectedLocation.manual_text
                  ? `${selectedLocation.manual_text} - manual/unverified`
                  : selectedLocation.formatted_address
              : statusMessage ?? helperText ?? "Type at least 2 characters, or paste the full location manually."}
      </p>
    </div>
  );
}
