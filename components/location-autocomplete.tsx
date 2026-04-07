"use client";

import { MapPinned } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { fetchJson } from "@/lib/http";

type LocationSuggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

type LocationAutocompleteProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  language?: "en" | "th";
  disabled?: boolean;
  configMissingMessage: string;
  helperText?: string;
  loadingText?: string;
  onConfigurationChange?: (configured: boolean) => void;
};

export function LocationAutocomplete({
  label,
  value,
  onChange,
  required = false,
  language = "en",
  disabled = false,
  configMissingMessage,
  helperText,
  loadingText = "Loading location suggestions...",
  onConfigurationChange
}: LocationAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [mapsConfigured, setMapsConfigured] = useState<boolean | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [sessionToken, setSessionToken] = useState(() => crypto.randomUUID());
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const listboxId = useId();

  useEffect(() => {
    let cancelled = false;

    const loadConfiguration = async () => {
      try {
        const result = await fetchJson<{
          configured?: boolean;
          suggestions?: LocationSuggestion[];
        }>(`/api/location-autocomplete?language=${language}`);

        if (!cancelled) {
          const configured = Boolean(result.data?.configured);
          setMapsConfigured(configured);
          onConfigurationChange?.(configured);
          if (result.data?.configured === false) {
            setStatusMessage(configMissingMessage);
          }
        }
      } catch {
        if (!cancelled) {
          setMapsConfigured(null);
        }
      }
    };

    void loadConfiguration();

    return () => {
      cancelled = true;
    };
  }, [configMissingMessage, language, onConfigurationChange]);

  useEffect(() => {
    if (disabled || mapsConfigured === false) {
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
        const result = await fetchJson<{
          configured?: boolean;
          suggestions?: LocationSuggestion[];
        }>(
          `/api/location-autocomplete?input=${encodeURIComponent(query)}&language=${language}&sessionToken=${encodeURIComponent(sessionToken)}`
        );

        if (requestIdRef.current !== nextRequestId) {
          return;
        }

        if (result.data?.configured === false) {
          setMapsConfigured(false);
          onConfigurationChange?.(false);
          setSuggestions([]);
          setStatusMessage(configMissingMessage);
          setIsOpen(false);
          return;
        }

        setMapsConfigured(true);
        onConfigurationChange?.(true);
        setStatusMessage(helperText ?? null);
        setSuggestions(result.data?.suggestions ?? []);
        setIsOpen(true);
        setActiveIndex(-1);
      } catch {
        if (requestIdRef.current === nextRequestId) {
          setSuggestions([]);
          setStatusMessage(helperText ?? null);
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

  const selectSuggestion = (suggestion: LocationSuggestion) => {
    onChange(suggestion.description);
    setSuggestions([]);
    setIsOpen(false);
    setActiveIndex(-1);
    setStatusMessage(helperText ?? null);
    setSessionToken(crypto.randomUUID());
  };

  return (
    <div className="form-field md:col-span-2">
      <label className="form-label form-label-required">{label}</label>
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
            onChange(event.target.value);
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
              selectSuggestion(suggestions[activeIndex]);
              return;
            }

            if (event.key === "Escape") {
              setIsOpen(false);
            }
          }}
          className="form-input bg-white pl-11"
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
                  selectSuggestion(suggestion);
                }}
                onClick={() => selectSuggestion(suggestion)}
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
          ? configMissingMessage
          : loading
            ? loadingText
            : statusMessage ?? helperText ?? ""}
      </p>
    </div>
  );
}
