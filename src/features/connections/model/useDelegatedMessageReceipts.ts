import { useEffect, useState, useSyncExternalStore } from "react";
import {
  DELEGATION_MESSAGES_STREAM,
  DelegationMessagesSchema,
  type DelegationMessage,
} from "../../../shared/model/host-contracts/delegation";
import {
  cachedRemoteCapabilities,
  loadRemoteCapabilities,
  savedMachineForEnvironment,
  subscribeRemoteCapabilities,
  subscribeRemoteMachineList,
  useRemoteMachineOnline,
} from "./connections";
import { acquireRemoteHostRuntime } from "./remoteMachineChannel";

const EMPTY: readonly DelegationMessage[] = [];

export function useDelegatedMessageReceipts(
  environmentId: string | undefined,
  sessionId: string | undefined,
  localMachineId?: string,
): readonly DelegationMessage[] {
  const readMachine = () =>
    localMachineId ?? (environmentId && savedMachineForEnvironment(environmentId)?.id);
  const machineId = useSyncExternalStore(subscribeRemoteMachineList, readMachine, readMachine);
  const readCapability = () =>
    !!environmentId &&
    cachedRemoteCapabilities(environmentId)?.includes(DELEGATION_MESSAGES_STREAM) === true;
  const supported = useSyncExternalStore(
    subscribeRemoteCapabilities,
    readCapability,
    readCapability,
  );
  const online = useRemoteMachineOnline(machineId);
  const key =
    supported && sessionId && machineId ? `${environmentId}/${machineId}/${sessionId}` : undefined;
  const [snapshot, setSnapshot] = useState<{ key: string; rows: readonly DelegationMessage[] }>();

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Populate the shared Host capability cache for the selected route before retaining its stream.
  useEffect(() => {
    if (environmentId && sessionId && cachedRemoteCapabilities(environmentId) === undefined)
      void loadRemoteCapabilities(environmentId).catch(() => {});
  }, [environmentId, sessionId]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep the selected child's Host subscription open only while the panel is visible.
  useEffect(() => {
    if (!key || !sessionId || !machineId) return;
    let active = true;
    let route: ReturnType<typeof acquireRemoteHostRuntime>;
    let release: (() => void) | undefined;
    const clear = () => {
      if (active) setSnapshot((previous) => (previous?.key === key ? undefined : previous));
    };
    try {
      route = acquireRemoteHostRuntime(machineId);
      release = route?.runtime.retain(
        { kind: "delegationMessages", sessionId },
        {
          parse: (data) => DelegationMessagesSchema.parse(data),
          commit: (rows, input) => {
            if (active && input.isCurrent()) setSnapshot({ key, rows });
          },
          closed: clear,
          onError: clear,
        },
      );
    } catch {
      route?.release();
      return;
    }
    return () => {
      active = false;
      release?.();
      route?.release();
    };
  }, [key, machineId, sessionId]);

  return key && online !== false && snapshot?.key === key ? snapshot.rows : EMPTY;
}
