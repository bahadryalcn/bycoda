import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useRemoteMachines } from "./connections";
import {
  blocksSending,
  INITIAL_CONNECTION,
  type ReconnectOutcome,
  type RemoteConnectionState,
} from "./remoteConnection";
import { readRemoteConnection, subscribeChanges } from "./remoteHealth";
import { parseRemotePath } from "./remoteProjects";
import {
  isReconnecting,
  reconnectRemoteMachine,
  startRemoteAutoRecovery,
  subscribeReconnecting,
} from "./remoteReconnect";

const LOCAL: RemoteConnectionState = { status: "connected" };

/** The environment a remote path or a bare environment ID refers to. */
const environmentOf = (value?: string) =>
  value
    ? (parseRemotePath(value)?.environmentId ?? (/^[\w-]+$/.test(value) ? value : undefined))
    : undefined;

/** The connection to the machine behind a remote path (or an environment ID):
 * one shared status, fed by every view's requests. Anything else is local and
 * always `connected`. */
export function useRemoteConnection(cwdOrEnvironmentId?: string) {
  const environmentId = environmentOf(cwdOrEnvironmentId);
  const read = () => (environmentId ? readRemoteConnection(environmentId) : LOCAL);
  const state = useSyncExternalStore(subscribeChanges, read, () => INITIAL_CONNECTION);
  const reconnecting = useSyncExternalStore(
    subscribeReconnecting,
    () => !!environmentId && isReconnecting(environmentId),
    () => false,
  );
  const { machines } = useRemoteMachines(!!environmentId);
  const machine = environmentId
    ? machines.find((entry) => entry.environmentId === environmentId)
    : undefined;
  // Background reconnecting runs for the rest of the app's life once any view needs it.
  useEffect(() => {
    if (environmentId) startRemoteAutoRecovery();
  }, [environmentId]);
  const reconnect = useCallback(
    (options?: { signIn?: boolean }): Promise<ReconnectOutcome> =>
      environmentId
        ? reconnectRemoteMachine(environmentId, options)
        : Promise.resolve({ ok: true }),
    [environmentId],
  );
  return {
    environmentId,
    machine,
    status: state.status,
    error: state.error,
    lastSeen: state.lastSeen,
    /** A reconnect the user asked for is under way. */
    reconnecting,
    /** Whether a message can reach the machine, as far as is known. */
    canSend: !blocksSending(state.status),
    reconnect,
  };
}
