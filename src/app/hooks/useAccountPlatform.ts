import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  accountApi,
  accountDeviceInfo,
  accountIdentity,
  accountNotificationsPort,
  reportAccountFailure,
  startAccount,
  useAnonymousStats,
} from "../../features/account";
import { useDiagnostics } from "../../features/diagnostics";
import { useActivitySync, useActivityTracker } from "../../features/activity";
import { useRemoteMachines } from "../../features/connections/public/connections";
import { bindNotificationsServer, useServerNotifications } from "../../features/notifications";
import { useDailySummary } from "../../features/notifications/hooks/useDailySummary";
import {
  appDiagnosticsFacts,
  readLocalHostPerformance,
  remoteHostLogSource,
} from "../model/diagnosticsFacts";
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
  const machinesRef = useRef(machines);
  useLayoutEffect(() => {
    machinesRef.current = machines;
  }, [machines]);
  useDiagnostics({
    api: accountApi,
    deviceInfo: accountDeviceInfo,
    identity: accountIdentity,
    onFailure: reportAccountFailure,
    environment: () => appDiagnosticsFacts(machinesRef.current),
    readPerformance: readLocalHostPerformance,
    // oxlint-disable-next-line react-hooks-js/refs -- the getter reads the ref only when a report is collected, never during render
    remoteHosts: remoteHostLogSource(() => machinesRef.current),
  });
  useActivityTracker(hostId);
  useActivitySync(hostId, accountApi, reportAccountFailure);
  useServerNotifications();
  useDailySummary(hostId);
}
