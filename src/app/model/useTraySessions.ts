import { useEffect, useMemo, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { IS_MAC, IS_LINUX } from "../../platform/tauri/platform";
import { t, useLocale } from "../../shared/i18n";
import { retainAsyncSubscription } from "../../shared/lib/asyncSubscription";
import { useRecentSessions } from "../../features/sessions/hooks/useRecentSessions";
import { traySessions } from "./traySessions";

export const TRAY_OPEN_EVENT = "bycoda:tray-open-session";

export function useTraySessions(
  options: Omit<Parameters<typeof traySessions>[0], "stored"> & {
    history: Parameters<typeof useRecentSessions>[0];
    onOpen: (sessionId: string) => void;
    onSettings: () => void;
  },
) {
  const locale = useLocale();
  const enabled = (IS_MAC || IS_LINUX) && isTauri();
  const { rows: stored } = useRecentSessions(options.history, options.live, enabled);
  const onOpen = useRef(options.onOpen);
  onOpen.current = options.onOpen;
  const onSettings = useRef(options.onSettings);
  onSettings.current = options.onSettings;
  const rows = useMemo(
    () => (enabled ? traySessions({ ...options, stored }) : []),
    [enabled, stored, options.live, options.agents, options.projectKeys, options.ownedKeys, locale],
  );
  const currentRows = useRef(rows);
  currentRows.current = rows;

  useEffect(() => {
    if (!enabled) return;
    return retainAsyncSubscription(
      listen<string>(TRAY_OPEN_EVENT, ({ payload }) => {
        // Check current visibility again: a menu click can race a group lock.
        if (currentRows.current.some((row) => row.id === payload)) onOpen.current(payload);
      }),
      (error) => console.warn("Session menu subscription failed", error),
    );
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    return retainAsyncSubscription(
      listen("bycoda:tray-notifications", () => onSettings.current()),
      (error) => console.warn("Session menu settings subscription failed", error),
    );
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    // Native state is partitioned by the invoking window. No last-writer wins
    // across windows and no streamed transcript is sent to the native layer.
    void invoke("tray_sessions_update", {
      rows,
      labels: {
        recent: t("Last sessions"),
        empty: t("No matching sessions"),
        working: t("Working"),
        input: t("Needs input"),
        done: t("Done"),
        active: t("Active"),
        notifications: t("Notifications"),
      },
    }).catch((error) => console.warn("Session menu update failed", error));
  }, [enabled, rows, locale]);
}
