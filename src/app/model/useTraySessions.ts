import { useEffect, useMemo, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t, useLocale } from "../../shared/i18n";
import { retainAsyncSubscription } from "../../shared/lib/asyncSubscription";
import { useRecentSessions } from "../../features/sessions/hooks/useRecentSessions";
import { traySessions } from "./traySessions";

export const TRAY_OPEN_EVENT = "bycoda:tray-open-session";
const TRAY_UPDATE_MS = 1000;

export function useTraySessions(
  options: Omit<Parameters<typeof traySessions>[0], "stored"> & {
    history: Parameters<typeof useRecentSessions>[0];
    onOpen: (sessionId: string) => void;
    onSettings: () => void;
  },
) {
  const locale = useLocale();
  const enabled = isTauri();
  const { rows: stored } = useRecentSessions(
    options.history,
    options.live,
    enabled,
  );
  const onOpen = useRef(options.onOpen);
  onOpen.current = options.onOpen;
  const onSettings = useRef(options.onSettings);
  onSettings.current = options.onSettings;
  const rows = useMemo(
    () => traySessions({ ...options, stored }),
    [
      enabled,
      stored,
      options.live,
      options.agents,
      options.projectKeys,
      options.ownedKeys,
      locale,
    ],
  );
  const currentRows = useRef(rows);
  const published = useRef<string | null>(null);
  const lastSent = useRef(0);
  const sendTimer = useRef<number | undefined>(undefined);
  currentRows.current = rows;

  useEffect(() => {
    if (!enabled) return;
    return retainAsyncSubscription(
      listen<string>(TRAY_OPEN_EVENT, ({ payload }) => {
        // Check current visibility again: a menu click can race a group lock.
        if (currentRows.current.some((row) => row.id === payload))
          onOpen.current(payload);
      }),
      (error) => console.warn("Session menu subscription failed", error),
    );
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    return retainAsyncSubscription(
      listen("bycoda:tray-notifications", () => onSettings.current()),
      (error) =>
        console.warn("Session menu settings subscription failed", error),
    );
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    // Native state is partitioned by the invoking window. No last-writer wins
    // across windows and no streamed transcript is sent to the native layer.
    const payload = {
      rows,
      labels: {
        recent: t("Last sessions"),
        empty: t("No matching sessions"),
        working: t("Working"),
        input: t("Needs input"),
        done: t("Done"),
        active: t("Active"),
        failed: t("Failed or usage limit"),
        retrying: t("Retrying"),
        notifications: t("Notifications"),
      },
    };
    const signature = JSON.stringify(payload);
    if (sendTimer.current !== undefined) window.clearTimeout(sendTimer.current);
    sendTimer.current = undefined;
    if (published.current === signature) return;
    const send = () => {
      sendTimer.current = undefined;
      lastSent.current = Date.now();
      published.current = signature;
      void invoke("tray_sessions_update", payload).catch((error) => {
        if (published.current === signature) published.current = null;
        console.warn("Session menu update failed", error);
      });
    };
    // At most one native menu update per second; the latest snapshot always lands.
    const wait = lastSent.current + TRAY_UPDATE_MS - Date.now();
    if (wait <= 0) send();
    else sendTimer.current = window.setTimeout(send, wait);
  }, [enabled, rows, locale]);
  useEffect(
    () => () => {
      if (sendTimer.current !== undefined) window.clearTimeout(sendTimer.current);
    },
    [],
  );
  return rows;
}
