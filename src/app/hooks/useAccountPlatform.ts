import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  accountApi,
  accountDeviceInfo,
  accountIdentity,
  accountSharingDestination,
  accountNotificationsPort,
  reportAccountFailure,
  startAccount,
  useAccountState,
  useAnonymousStats,
} from "../../features/account";
import { useDiagnostics } from "../../features/diagnostics";
import { getDiagnosticsMode } from "../../features/diagnostics/model/diagnosticsConsent";
import { dataTransfers } from "../../features/data-sharing";
import { useActivitySync, useActivityTracker } from "../../features/activity";
import { useRemoteMachines } from "../../features/connections/public/connections";
import {
  bindNotificationsServer,
  useOwnerApprovalMirror,
  useServerNotifications,
} from "../../features/notifications";
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
 * Only the local sync Host is ever used: a remote machine never receives this computer's activity.
 */
export function useAccountPlatform(): void {
  const account = useAccountState();
  const accountId = account.phase === "signed-in" ? account.context.user.id : null;
  const { machines } = useRemoteMachines();
  const hostId = machines.find(isLocalSyncMachine)?.id;
  useState(() => bindNotificationsServer(accountNotificationsPort()));
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Releases the account-owned sharing queue and receipts on identity change or unmount.
  useLayoutEffect(() => () => dataTransfers.accountChanged(), [accountId]);
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
    destination: accountSharingDestination,
    review: (details, send) => dataTransfers.run(details, getDiagnosticsMode, send),
    onFailure: reportAccountFailure,
    environment: () => appDiagnosticsFacts(machinesRef.current),
    readPerformance: readLocalHostPerformance,
    // oxlint-disable-next-line react-hooks-js/refs -- the getter reads the ref only when a report is collected, never during render
    remoteHosts: remoteHostLogSource(() => machinesRef.current),
  });
  useActivityTracker(hostId);
  useActivitySync(hostId, accountApi, reportAccountFailure);
  useServerNotifications();
  useOwnerApprovalMirror(hostId);
  useDailySummary(hostId);
}
