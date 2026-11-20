import { useEffect, useRef } from "react";
import { monotonicNow } from "../../../shared/lib/time/timestamps";
import { remainingUntil } from "../../../shared/lib/time/hostLifetime";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Consecutive failed frame reads after which the error is surfaced and Live stops. */
const LIVE_READ_MAX_FAILURES = 4;
/** First pause after a failed frame read; it doubles for each further failure. */
const LIVE_READ_RETRY_MS = 500;

const frameRetryDelay = (failures: number) => LIVE_READ_RETRY_MS * 2 ** (failures - 1);

/**
 * One frame read that retries transient failures with the same back-off as the live loop.
 * The last failure is thrown after `LIVE_READ_MAX_FAILURES` reads, or at once when `stopped()`
 * reports the caller is gone. Only for reads: a frame read never needs the control lease, so
 * a retry cannot act on the page or renew control.
 */
export async function readFrameWithRetry<T>(
  read: () => Promise<T>,
  stopped: () => boolean,
): Promise<T> {
  for (let failures = 1; ; failures++) {
    try {
      return await read();
    } catch (cause) {
      if (stopped() || failures >= LIVE_READ_MAX_FAILURES) throw cause;
      await sleep(frameRetryDelay(failures));
    }
  }
}

/**
 * Keeps the Host browser picture current while the panel is visible. A Host that
 * streams answers each read with `frameSequence` and holds the read until the page
 * repaints, so reads run back to back and beside input. An older Host answers at once
 * with a screenshot; those reads stay one per second and wait for idle input.
 * `streaming.current` tells the caller which of the two is in effect. A failed read is
 * retried with exponential back-off (the last frame stays); `onError` runs only after
 * several consecutive failures, once, and ends the loop.
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
      let failures = 0;
      await sleep(250);
      while (!cancelled) {
        if (document.hidden || (!streaming.current && !latest.current.idle())) {
          await sleep(streaming.current ? 250 : 1000);
          continue;
        }
        const started = performance.now();
        let result: { frameSequence?: number } | undefined;
        try {
          result = await latest.current.read(after, streaming.current);
        } catch (cause) {
          if (cancelled) return;
          // A transient read failure keeps the last frame and retries with back-off; only a
          // run of failures reaches `onError`, which blocks input and turns Live off.
          if (++failures >= LIVE_READ_MAX_FAILURES) throw cause;
          await sleep(frameRetryDelay(failures));
          continue;
        }
        if (cancelled) return;
        failures = 0;
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

/** How long before the lease ends the first renewal runs. */
const LEASE_RENEW_LEAD_MS = 10_000;
/** Pause between failed renewals. */
const LEASE_RETRY_MS = 3000;

/**
 * Renews the control lease shortly before it ends while the controlling panel is
 * visible. A renewal that falls due while hidden runs when the panel is shown again;
 * going back online or visible renews at once. A failed renewal is retried every few
 * seconds, but only while the lease observed at `expiresAt` is still valid: once it has
 * ended (or the lease changed, which re-runs this effect) nothing is renewed, because a
 * claim after expiry would mint a new lease the owner never granted.
 * `expiresAt` is a local `monotonicNow()` deadline (see `hostLifetimeDeadline`), never a
 * Host wall-clock time. `onResult` reports each attempt so the caller can show a
 * persistent failure.
 */
export function useBrowserLeaseKeepAlive(
  enabled: boolean,
  expiresAt: number | undefined,
  renew: () => Promise<unknown>,
  onResult?: (failure: unknown | undefined) => void,
) {
  const latest = useRef({ renew, onResult });
  latest.current = { renew, onResult };
  useEffect(() => {
    if (!enabled || expiresAt == null) return;
    let cancelled = false;
    let running = false;
    let due = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const valid = () => monotonicNow() < expiresAt;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(attempt, ms);
    };
    const attempt = async () => {
      clearTimeout(timer);
      if (cancelled || running || !valid()) return;
      if (document.hidden) {
        due = true;
        return;
      }
      due = false;
      running = true;
      try {
        await latest.current.renew();
        if (!cancelled) latest.current.onResult?.(undefined);
      } catch (cause) {
        if (cancelled) return;
        latest.current.onResult?.(cause ?? new Error("Browser control renewal failed"));
      } finally {
        running = false;
      }
      // A successful renewal normally replaces `expiresAt` and re-runs this effect.
      if (!cancelled && valid())
        schedule(Math.max(250, Math.min(LEASE_RETRY_MS, remainingUntil(expiresAt) - 250)));
    };
    const resume = () => void attempt();
    const onVisible = () => {
      if (due && !document.hidden) void attempt();
    };
    schedule(Math.max(1000, remainingUntil(expiresAt) - LEASE_RENEW_LEAD_MS));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", resume);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", resume);
    };
    // `expiresAt` identifies the lease being kept alive; a new value starts a new window.
  }, [enabled, expiresAt]);
}
