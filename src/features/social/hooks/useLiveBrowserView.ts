import { useEffect, useRef, useState } from "react";
import {
  createRefreshScheduler,
  type RefreshScheduler,
} from "../../automations/model/refreshScheduler";
import type { BrowserViewFrame, BrowserViewRead } from "../model/socialActions";
import type { SocialClient } from "../model/socialClient";

/** Wait between frame reads while the Host answers; the Host stops the screencast when reads stop. */
export const LIVE_VIEW_POLL_MS = 700;
/** Longest wait after repeated failures; the owner is watching, so this stays short. */
export const LIVE_VIEW_MAX_BACKOFF_MS = 15_000;

export type LiveBrowserViewStatus = "connecting" | "live" | "waiting" | "error";

/** The state is tagged with what it was read for, so a switch never shows the old account's picture. */
type View = {
  client: SocialClient;
  accountId: string;
  frame: BrowserViewFrame | null;
  status: LiveBrowserViewStatus;
};

/**
 * Keeps one account's browser picture current. Reads never overlap, double their wait after each
 * failure (the last picture stays) and stop while the document is hidden; showing it again reads at
 * once. A read that finishes after the account changed, the view was hidden or the panel closed is
 * dropped. `retry` reads now and forgets earlier failures; `markError` reports a failure the caller
 * saw (input) for the view it was sent to, and is ignored once the view moved on.
 */
export function useLiveBrowserView(client: SocialClient, accountId: string) {
  const [view, setView] = useState<View>({ client, accountId, frame: null, status: "connecting" });
  const schedulerRef = useRef<RefreshScheduler | null>(null);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps the Host frame reads attached while the panel is mounted and visible, and restarts them for a new client or account.
  useEffect(() => {
    // Sequence of the picture on screen; the Host answers "unchanged" instead of resending it.
    let seen: number | undefined;
    const publish = (patch: Partial<Pick<View, "frame" | "status">>) =>
      setView((prev) => ({
        ...(prev.client === client && prev.accountId === accountId
          ? prev
          : { client, accountId, frame: null, status: "connecting" as const }),
        ...patch,
      }));
    const scheduler = createRefreshScheduler({
      run: async (isCurrent) => {
        let next: BrowserViewRead;
        try {
          next = await client.browserViewFrame(accountId, seen);
        } catch (cause) {
          // The scheduler backs off on the rejection; the last picture stays on screen.
          if (isCurrent()) publish({ status: "error" });
          throw cause;
        }
        if (!isCurrent()) return;
        if (next && "unchanged" in next) {
          publish({ status: "live" });
        } else if (next) {
          seen = next.seq;
          publish({ frame: next, status: "live" });
        } else {
          publish({ status: "waiting" });
        }
      },
      intervalMs: LIVE_VIEW_POLL_MS,
      // Hidden documents stop the scheduler instead, so this cadence is never used.
      hiddenIntervalMs: LIVE_VIEW_POLL_MS,
      maxBackoffMs: LIVE_VIEW_MAX_BACKOFF_MS,
    });
    schedulerRef.current = scheduler;
    let running = false;
    const sync = () => {
      const show = !document.hidden;
      if (show === running) return;
      running = show;
      // Stopping drops a read still in flight; starting reads at once.
      if (show) scheduler.start();
      else scheduler.stop();
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      scheduler.stop();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, [client, accountId]);

  const retry = () => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;
    scheduler.resetBackoff();
    scheduler.refresh().catch(() => undefined);
  };

  const markError = (forClient: SocialClient, forAccountId: string) =>
    setView((prev) =>
      prev.client === forClient && prev.accountId === forAccountId
        ? { ...prev, status: "error" }
        : prev,
    );

  const current = view.client === client && view.accountId === accountId;
  return {
    frame: current ? view.frame : null,
    status: current ? view.status : ("connecting" as const),
    retry,
    markError,
  };
}
