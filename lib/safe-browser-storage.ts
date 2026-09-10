type StorageArea = "localStorage" | "sessionStorage";

const memoryStores: Record<StorageArea, Map<string, string>> = {
  localStorage: new Map<string, string>(),
  sessionStorage: new Map<string, string>()
};

function getBrowserStorage(area: StorageArea): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window[area];
  } catch {
    return null;
  }
}

export function createSafeBrowserStorage(area: StorageArea) {
  const memoryStorage = memoryStores[area];

  return {
    getItem(key: string) {
      const storage = getBrowserStorage(area);
      if (storage) {
        try {
          return storage.getItem(key);
        } catch {
          // Fall through to the in-memory copy for storage-restricted browser contexts.
        }
      }

      return memoryStorage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      const storage = getBrowserStorage(area);
      if (storage) {
        try {
          storage.setItem(key, value);
          memoryStorage.set(key, value);
          return;
        } catch {
          // Fall through to memory storage.
        }
      }

      memoryStorage.set(key, value);
    },
    removeItem(key: string) {
      const storage = getBrowserStorage(area);
      if (storage) {
        try {
          storage.removeItem(key);
        } catch {
          // Fall through to memory cleanup.
        }
      }

      memoryStorage.delete(key);
    }
  };
}

export const safeLocalStorage = createSafeBrowserStorage("localStorage");
export const safeSessionStorage = createSafeBrowserStorage("sessionStorage");
