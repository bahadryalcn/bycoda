type StoredSettingOptions<T> = {
  key: string;
  fallback: T;
  parse: (raw: string) => T;
  serialize: (value: T) => string;
  event?: string;
  storageEvents?: boolean;
};

/** Storage failures retain the existing fallback contract; subscriptions are opt-in. */
export function createStoredSetting<T>(options: StoredSettingOptions<T>) {
  const load = (): T => {
    try {
      const raw = localStorage.getItem(options.key);
      return raw === null ? options.fallback : options.parse(raw);
    } catch {
      return options.fallback;
    }
  };
  const save = (value: T): void => {
    try {
      localStorage.setItem(options.key, options.serialize(value));
    } catch {
      // Existing settings remain usable in private mode / at quota.
    }
    if (options.event && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(options.event, { detail: value }));
    }
  };
  const subscribe = (onChange: () => void) => {
    if (typeof window === "undefined") return () => {};
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key === null || event.key === options.key) onChange();
    };
    if (options.event) window.addEventListener(options.event, onChange);
    if (options.storageEvents) window.addEventListener("storage", onStorage);
    return () => {
      if (options.event) window.removeEventListener(options.event, onChange);
      if (options.storageEvents) window.removeEventListener("storage", onStorage);
    };
  };
  return { load, save, subscribe };
}

export function storedFlag(
  key: string,
  fallback: boolean | null,
  event?: string,
  storageEvents = false,
) {
  return createStoredSetting<boolean | null>({
    key,
    fallback,
    event,
    storageEvents,
    parse: (raw) => raw === "1" || raw === "true",
    serialize: (value) => (value ? "1" : "0"),
  });
}
