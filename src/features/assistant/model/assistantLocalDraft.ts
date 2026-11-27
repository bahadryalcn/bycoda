import { registerAssistantDraftFlusher } from "./assistantDraftFlush";

// Same policy as the conversation drafts: a quiet 400 ms, never more than 2 s behind.
const DEBOUNCE_MS = 400;
const MAX_WAIT_MS = 2000;

export type LocalDraftWriter = {
  /** Marks the draft changed. `serialize` runs only when the write happens, not per keystroke. */
  schedule(serialize: () => string): void;
  /** Writes the latest draft now. Returns false when storage refuses; the draft stays pending. */
  flush(): boolean;
  /** Drops a pending write without touching storage, because a durable record now owns the key. */
  cancel(): void;
  /** Cancels pending writes and removes the stored draft (explicit discard or completed save). */
  clear(): void;
  /** Flushes on pagehide and window close until the returned teardown runs. */
  attach(): () => void;
};

/**
 * Debounced localStorage writer for one draft key. Each write is skipped when the serialized
 * value equals the last stored one, so a failed write is retried by the next flush.
 */
export function createLocalDraftWriter(
  key: string,
  onStatus?: (saved: boolean) => void,
): LocalDraftWriter {
  let serialize: (() => string) | null = null;
  let stored: string | undefined;
  let debounce: number | undefined;
  let maximum: number | undefined;

  function cancelTimers() {
    window.clearTimeout(debounce);
    window.clearTimeout(maximum);
    debounce = undefined;
    maximum = undefined;
  }
  function write(): boolean {
    if (!serialize) return true;
    const value = serialize();
    if (value === stored) return true;
    try {
      localStorage.setItem(key, value);
      stored = value;
      onStatus?.(true);
      return true;
    } catch {
      onStatus?.(false);
      return false;
    }
  }
  function flush(): boolean {
    cancelTimers();
    return write();
  }
  return {
    schedule(next) {
      serialize = next;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(flush, DEBOUNCE_MS);
      maximum ??= window.setTimeout(flush, MAX_WAIT_MS);
    },
    flush,
    cancel() {
      cancelTimers();
    },
    clear() {
      cancelTimers();
      serialize = null;
      stored = undefined;
      try {
        localStorage.removeItem(key);
      } catch {
        /* Nothing stored to remove. */
      }
    },
    attach() {
      const onPageHide = () => {
        flush();
      };
      window.addEventListener("pagehide", onPageHide);
      const unregister = registerAssistantDraftFlusher(async () => {
        if (!flush())
          throw new Error("An assistant draft could not be saved. Recover it before closing.");
      });
      return () => {
        window.removeEventListener("pagehide", onPageHide);
        unregister();
      };
    },
  };
}
