import { useEffect, useRef } from "react";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Keeps the Host browser picture current while the panel is visible. A Host that
 * streams answers each read with `frameSequence` and holds the read until the page
 * repaints, so reads run back to back and beside input. An older Host answers at once
 * with a screenshot; those reads stay one per second and wait for idle input.
 * `streaming.current` tells the caller which of the two is in effect.
 */
export function useBrowserLiveFrames({
  enabled,
  read,
  idle,
  onError,
}: {
  enabled: boolean;
  /** Reads one frame after sequence `after`; `beside` lets it run next to input. */
  read: (after: number, beside: boolean) => Promise<{ frameSequence?: number } | undefined>;
  /** Whether no other browser request is pending. */
  idle: () => boolean;
  onError: (cause: unknown) => void;
}) {
  const streaming = useRef(false);
  const latest = useRef({ read, idle, onError });
  latest.current = { read, idle, onError };
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = async () => {
      let after = 0;
      await sleep(250);
      while (!cancelled) {
        if (document.hidden || (!streaming.current && !latest.current.idle())) {
          await sleep(streaming.current ? 250 : 1000);
          continue;
        }
        const started = performance.now();
        const result = await latest.current.read(after, streaming.current);
        if (cancelled) return;
        streaming.current = result?.frameSequence !== undefined;
        if (!streaming.current) await sleep(1000);
        else {
          after = result!.frameSequence!;
          // A Host that answers instantly must not turn this into a busy loop.
          if (performance.now() - started < 30) await sleep(30);
        }
      }
    };
    run().catch((cause) => {
      if (!cancelled) latest.current.onError(cause);
    });
    return () => {
      cancelled = true;
      streaming.current = false;
    };
  }, [enabled]);
  return streaming;
}

/**
 * Renews the control lease shortly before it ends while the controlling panel is
 * visible. A renewal that falls due while hidden runs when the panel is shown again.
 */
export function useBrowserLeaseKeepAlive(
  enabled: boolean,
  expiresAt: number | undefined,
  renew: () => void,
) {
  const renewRef = useRef(renew);
  renewRef.current = renew;
  useEffect(() => {
    if (!enabled || expiresAt == null) return;
    let due = false;
    const fire = () => {
      if (document.hidden) {
        due = true;
        return;
      }
      due = false;
      renewRef.current();
    };
    const onVisible = () => {
      if (due && !document.hidden) fire();
    };
    const timer = setTimeout(fire, Math.max(1000, expiresAt - Date.now() - 10_000));
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, expiresAt]);
}
