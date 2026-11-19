import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { RemoteMachine } from "../../connections";
import { useReloadOnMachineReconnect } from "../../connections/public/useReloadOnReconnect";
import {
  composerDraftsLoaded,
  flushComposerDrafts,
  subscribeComposerDraftLoadState,
} from "../data/composerDraftStore";
import { hasUnsentComposerDraft, subscribeComposerDrafts } from "../model/draftCache";

export function draftPresenceChanged(
  previous: readonly string[] | undefined,
  next: readonly string[],
): boolean {
  return (
    previous === undefined ||
    JSON.stringify([...new Set(previous)].sort()) !== JSON.stringify([...new Set(next)].sort())
  );
}

const REPORT_INTERVAL_MS = 30_000;

/** Full snapshots only after successful hydration; failures retain Host's last conservative state. */
export function useDraftPresenceReporter(): void {
  const [environmentId, setEnvironmentId] = useState<string>();
  const reconnect = useRef<() => void>(() => {});
  useReloadOnMachineReconnect(environmentId, () => reconnect.current(), { active: true });
  // App lifetime subscription: capture live edits before child composers mount.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps the composer draft cache subscription and the Host draft-presence report timer in step while the app is open
  useEffect(() => {
    if (!isTauri()) return;
    const known = new Set<string>();
    let loaded = false,
      stopped = false,
      flight = false,
      rerun = false;
    // `undefined` means the Host has not confirmed the current snapshot; ticks and visibility retry it.
    let previous: string[] | undefined,
      lastReport = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (stopped || !composerDraftsLoaded()) return;
      // A change during an in-flight report reruns once after it settles instead of being dropped.
      if (flight) {
        rerun = true;
        return;
      }
      flight = true;
      try {
        if (!loaded) {
          await flushComposerDrafts();
          const rows = await invoke<Array<{ sessionId: string }>>("session_list_drafts");
          if (!Array.isArray(rows) || rows.some((row) => typeof row?.sessionId !== "string"))
            return;
          for (const row of rows) known.add(row.sessionId);
          loaded = true;
        }
        const sessionIds = [...known].filter(hasUnsentComposerDraft).sort();
        if (
          !draftPresenceChanged(previous, sessionIds) &&
          Date.now() - lastReport < REPORT_INTERVAL_MS
        )
          return;
        const target = await invoke<RemoteMachine | null>("local_host_connect");
        if (!target || stopped) {
          previous = undefined;
          return;
        }
        setEnvironmentId(target.environmentId);
        const { remoteRequest } = await import("../../connections/public/connections");
        try {
          await remoteRequest(
            target.id,
            "drafts.presence.report",
            {
              clientId: `desktop:${getCurrentWindow().label}`,
              sessionIds,
              complete: true,
            },
            false,
            false,
            target.environmentId,
          );
        } catch (error) {
          previous = undefined;
          throw error;
        }
        previous = sessionIds;
        lastReport = Date.now();
      } finally {
        flight = false;
        if (rerun && !stopped) {
          rerun = false;
          schedule();
        }
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void run().catch(() => {});
      }, 400);
    };
    reconnect.current = () => {
      previous = undefined;
      schedule();
    };
    const unsubscribe = subscribeComposerDrafts((id) => {
      known.add(id);
      schedule();
    });
    const unsubscribeLoaded = subscribeComposerDraftLoadState(schedule);
    // Returning to a visible window refreshes or retries the snapshot without waiting for a tick.
    const onVisible = () => {
      if (!document.hidden) schedule();
    };
    document.addEventListener("visibilitychange", onVisible);
    schedule();
    // Heartbeats keep a confirmed snapshot fresh. A hidden window stays quiet unless its snapshot is
    // unconfirmed; draft edits and visibility recovery still report while hidden.
    const heartbeat = setInterval(() => {
      if (document.hidden && previous !== undefined) return;
      void run().catch(() => {});
    }, REPORT_INTERVAL_MS);
    return () => {
      stopped = true;
      reconnect.current = () => {};
      clearTimeout(timer);
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
      unsubscribeLoaded();
    };
  }, []);
}
