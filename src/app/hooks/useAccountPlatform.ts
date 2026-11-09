import { useEffect, useState } from "react";
import {
  accountApi,
  accountNotificationsPort,
  reportAccountFailure,
  startAccount,
  useAnonymousStats,
} from "../../features/account";
import { useActivitySync, useActivityTracker } from "../../features/activity";
import { useRemoteMachines } from "../../features/connections/public/connections";
import { bindNotificationsServer, useServerNotifications } from "../../features/notifications";
import { useDailySummary } from "../../features/notifications/hooks/useDailySummary";
import { isLocalSyncMachine } from "../../features/connections/public/localSync";

/**
 * Starts the individual account once, tracks active time on this computer's Host and uploads
 * it while signed in. Everything here is inert without a local Host or a signed-in account.
 */
export function useAccountPlatform(): void {
  const { machines } = useRemoteMachines();
  const hostId = (machines.find(isLocalSyncMachine) ?? machines[0])?.id;
  useState(() => bindNotificationsServer(accountNotificationsPort()));
  useEffect(() => {
    void startAccount().catch(() => undefined);
  }, []);
  useAnonymousStats();
  useActivityTracker(hostId);
  useActivitySync(hostId, accountApi, reportAccountFailure);
  useServerNotifications();
  useDailySummary(hostId);
}
