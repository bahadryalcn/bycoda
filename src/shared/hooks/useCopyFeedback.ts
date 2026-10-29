import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type CopyFeedbackStatus = "idle" | "pending" | "copied" | "failed";

export type CopyFeedbackOptions = {
  /**
   * Identity of the copied content. When any entry changes (compared with `Object.is`) the shown
   * outcome clears, a copy in flight is abandoned and its late result is ignored, so a stale result
   * can never mark newer content as copied. Pass the id for snapshot content, and the content too
   * for streaming content that should reset on every change.
   */
  resetKeys?: readonly unknown[];
  /** How long the copied confirmation stays before returning to idle. */
  successMs?: number;
};

type View = {
  keys: readonly unknown[];
  /** Bumped whenever the content identity changes; operations only settle into their own epoch. */
  epoch: number;
  status: CopyFeedbackStatus;
  error?: string;
};

const NO_KEYS: readonly unknown[] = [];

function sameKeys(a: readonly unknown[], b: readonly unknown[]) {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

/**
 * Async copy feedback owned in one place: a synchronous single-flight lock (a second click while a
 * copy runs starts nothing), operation identity so results from a replaced content never apply, a
 * timed success flash, a persistent error until retried, and timer teardown on unmount. The payload
 * and the clipboard call stay with the caller: `copy(() => copyText(text))`.
 */
export function useCopyFeedback({ resetKeys = NO_KEYS, successMs = 2000 }: CopyFeedbackOptions = {}) {
  const [view, setView] = useState<View>({ keys: resetKeys, epoch: 0, status: "idle" });
  // Adjusting during render shows the idle state for the new content on its very first paint.
  if (!sameKeys(view.keys, resetKeys)) {
    setView({ keys: resetKeys, epoch: view.epoch + 1, status: "idle" });
  }
  const mounted = useRef(false);
  const epoch = useRef(view.epoch);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A new epoch abandons the previous operation: release the lock and drop its confirmation timer.
  useLayoutEffect(() => {
    epoch.current = view.epoch;
    inFlight.current = false;
    clearTimeout(timer.current);
  }, [view.epoch]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  /** Starts `run` unless a copy is already in flight. Returns whether it started. */
  const copy = useCallback(
    (run: () => Promise<unknown> | void): boolean => {
      if (inFlight.current || !mounted.current) return false;
      inFlight.current = true;
      const owner = epoch.current;
      clearTimeout(timer.current);
      setView((prev) =>
        prev.epoch === owner ? { ...prev, status: "pending", error: undefined } : prev,
      );
      const settle = (status: "copied" | "failed", reason?: unknown) => {
        if (!mounted.current || epoch.current !== owner) return;
        inFlight.current = false;
        const error =
          status === "failed" ? (reason instanceof Error ? reason.message : String(reason)) : undefined;
        setView((prev) => (prev.epoch === owner ? { ...prev, status, error } : prev));
        if (status === "copied") {
          timer.current = setTimeout(() => {
            setView((prev) =>
              prev.epoch === owner && prev.status === "copied" ? { ...prev, status: "idle" } : prev,
            );
          }, successMs);
        }
      };
      let result: Promise<unknown>;
      try {
        result = Promise.resolve(run());
      } catch (reason) {
        result = Promise.reject(reason);
      }
      void result.then(
        () => settle("copied"),
        (reason: unknown) => settle("failed", reason),
      );
      return true;
    },
    [successMs],
  );

  /** Clears any outcome and abandons a copy in flight. */
  const reset = useCallback(() => {
    setView((prev) => ({ keys: prev.keys, epoch: prev.epoch + 1, status: "idle" }));
  }, []);

  return {
    status: view.status,
    pending: view.status === "pending",
    copied: view.status === "copied",
    failed: view.status === "failed",
    /** Message of the last failure; cleared when a new copy starts. */
    error: view.error,
    copy,
    reset,
  };
}
