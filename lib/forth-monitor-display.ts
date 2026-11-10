/**
 * Optional Fleet Monitor column preferences.
 * Only fields that already exist on Forth/EES records are offered — no invented sensors.
 */

export type ForthMonitorDisplayField =
  | "driver"
  | "location"
  | "speed"
  | "engine"
  | "gpsConfidence"
  | "reportAge";

export const FORTH_MONITOR_DISPLAY_DEFAULTS: Record<ForthMonitorDisplayField, boolean> = {
  driver: true,
  location: true,
  speed: true,
  engine: true,
  gpsConfidence: true,
  reportAge: true
};

/** Compact ops view keeps the driver visible for dispatch identification. */
export const FORTH_MONITOR_DISPLAY_OPERATIONS: Record<ForthMonitorDisplayField, boolean> = {
  driver: true,
  location: true,
  speed: true,
  engine: true,
  gpsConfidence: false,
  reportAge: true
};

/** Full secondary detail for investigation. */
export const FORTH_MONITOR_DISPLAY_DETAILED: Record<ForthMonitorDisplayField, boolean> = {
  ...FORTH_MONITOR_DISPLAY_DEFAULTS
};

export type ForthMonitorDisplayPreset = "operations" | "detailed" | "custom";

export function resolveForthMonitorDisplayPreset(
  value: Record<ForthMonitorDisplayField, boolean>
): ForthMonitorDisplayPreset {
  const matches = (preset: Record<ForthMonitorDisplayField, boolean>) =>
    (Object.keys(preset) as ForthMonitorDisplayField[]).every((field) => value[field] === preset[field]);
  if (matches(FORTH_MONITOR_DISPLAY_OPERATIONS)) return "operations";
  if (matches(FORTH_MONITOR_DISPLAY_DETAILED)) return "detailed";
  return "custom";
}

export const FORTH_MONITOR_DISPLAY_STORAGE_KEY = "ees.forth.monitorDisplay.v1";

export function normalizeForthMonitorDisplay(
  value: Partial<Record<ForthMonitorDisplayField, boolean>> | null | undefined
): Record<ForthMonitorDisplayField, boolean> {
  return {
    driver: value?.driver !== false,
    location: value?.location !== false,
    speed: value?.speed !== false,
    engine: value?.engine !== false,
    gpsConfidence: value?.gpsConfidence !== false,
    reportAge: value?.reportAge !== false
  };
}

export function readForthMonitorDisplay(storage: { getItem(key: string): string | null } | null | undefined) {
  if (!storage) return { ...FORTH_MONITOR_DISPLAY_DEFAULTS };
  try {
    const raw = storage.getItem(FORTH_MONITOR_DISPLAY_STORAGE_KEY);
    if (!raw) return { ...FORTH_MONITOR_DISPLAY_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Record<ForthMonitorDisplayField, boolean>>;
    return normalizeForthMonitorDisplay(parsed);
  } catch {
    return { ...FORTH_MONITOR_DISPLAY_DEFAULTS };
  }
}

export function writeForthMonitorDisplay(
  storage: { setItem(key: string, value: string): void } | null | undefined,
  value: Record<ForthMonitorDisplayField, boolean>
) {
  if (!storage) return;
  try {
    storage.setItem(FORTH_MONITOR_DISPLAY_STORAGE_KEY, JSON.stringify(normalizeForthMonitorDisplay(value)));
  } catch {
    // Session storage may be unavailable; defaults still apply in memory.
  }
}
