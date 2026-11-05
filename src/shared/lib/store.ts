/** Synchronous listener registry with Set subscription semantics. */
type WindowStoreSource = {
  event: string;
  storageKeys?: readonly string[];
  acceptStorage?: (event: StorageEvent) => boolean;
  onStorage?: (event: StorageEvent) => void;
  /** Retain callers which can subscribe during server rendering. */
  guardWindow?: boolean;
};

export function createStore<Args extends unknown[] = []>(
  options: {
    snapshot?: boolean;
    onError?: (error: unknown) => void;
  } = {},
) {
  const listeners = new Set<(...args: Args) => void>();
  return {
    subscribe(listener: (...args: Args) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify(...args: Args): void {
      const current = options.snapshot ? [...listeners] : listeners;
      for (const listener of current) {
        if (!options.onError) listener(...args);
        else {
          try {
            listener(...args);
          } catch (error) {
            options.onError(error);
          }
        }
      }
    },
    clear(): void {
      listeners.clear();
    },
    get size(): number {
      return listeners.size;
    },
  };
}

/** Per-subscription window listeners retain DOM deduplication and storage ordering. */
export function createWindowStore(source: WindowStoreSource) {
  return {
    subscribe(listener: () => void): () => void {
      if (source.guardWindow && typeof window === "undefined") return () => {};
      const onStorage = (event: StorageEvent) => {
        if (source.acceptStorage) {
          if (!source.acceptStorage(event)) return;
        } else if (event.key !== null && !source.storageKeys?.includes(event.key)) return;
        source.onStorage?.(event);
        listener();
      };
      window.addEventListener(source.event, listener);
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener(source.event, listener);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}

/** Store a value as the newest entry, evicting oldest entries over the limit. */
export function boundedSet<K, V>(cache: Map<K, V>, key: K, value: V, limit = 64): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
}
