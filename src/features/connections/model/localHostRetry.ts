import { subscribeRemoteRecovered } from "./remoteHealth";

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000];

export interface LocalHostRetry {
  /** Schedule one more `retry` after a short backoff; no-op once the attempts are spent. */
  later(): void;
  /** The push went through: the next failure starts the backoff from the beginning. */
  reset(): void;
  stop(): void;
}

/**
 * Re-runs a settings push that found this computer's Host missing or unready. It retries on a
 * bounded backoff (a cold start or update takes seconds) and at once when a machine reports
 * recovery; after the attempts are spent only that signal or the next change retries. `retry`
 * must send only the setting's current value and do nothing when it is already published.
 */
export function retryOnLocalHostAvailable(
  retry: () => void,
  onRecovered?: () => void,
): LocalHostRetry {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const stopRecovered = subscribeRemoteRecovered(() => {
    if (stopped) return;
    clear();
    attempt = 0;
    onRecovered?.();
    retry();
  });
  return {
    later() {
      const delay = RETRY_DELAYS_MS[attempt];
      if (stopped || timer !== undefined || delay === undefined) return;
      attempt++;
      timer = setTimeout(() => {
        timer = undefined;
        retry();
      }, delay);
    },
    reset() {
      attempt = 0;
    },
    stop() {
      stopped = true;
      clear();
      stopRecovered();
    },
  };
}
