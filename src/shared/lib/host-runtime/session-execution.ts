import type {
  SessionExecutionClient,
  SessionRequestOptions,
} from "../../model/host-contracts/session-execution";
import type {
  CommandDispatchParams,
  CommandReceipt,
} from "../../model/host-contracts/session-commands";
import type {
  SessionsListParams,
  SessionsListResult,
  SessionsPageParams,
  SessionsPageResult,
  SessionsSyncParams,
  SessionSyncResponse,
} from "../../model/host-contracts/session-reads";

/** Platform adapters supply the already authenticated, owner-routed request. */
export type SessionExecutionPort = {
  /** Match a platform's wire snapshot without requiring a global clone API. */
  snapshotCommand?(command: CommandDispatchParams): CommandDispatchParams;
  list(params: SessionsListParams): Promise<SessionsListResult>;
  page(params: SessionsPageParams): Promise<SessionsPageResult>;
  sync(params: SessionsSyncParams): Promise<SessionSyncResponse>;
  dispatch(command: CommandDispatchParams): Promise<CommandReceipt>;
  status(commandId: string): Promise<CommandReceipt | null>;
};

/** Cancellation detaches this waiter. It never cancels accepted Host work. */
function waitFor<T>(start: () => Promise<T>, options?: SessionRequestOptions): Promise<T> {
  const signal = options?.signal;
  const detached = () => new Error("Session request detached");
  if (signal?.aborted) return Promise.reject(detached());
  if (!signal) return start();
  return new Promise<T>((resolve, reject) => {
    let unsubscribe = () => {};
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      complete();
    };
    unsubscribe = signal.subscribe(() => finish(() => reject(detached())));
    if (signal.aborted) finish(() => reject(detached()));
    if (settled) {
      unsubscribe();
      return;
    }
    Promise.resolve()
      .then(() => {
        if (settled || signal.aborted) throw detached();
        return start();
      })
      .then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
  });
}

/** Common execution policy. Unknown delivery is reconciled by status with the
 * original ID by the durable outbox; this layer never invents a retry ID. */
export function commonHostSessionExecutionClient(
  environmentId: string,
  port: SessionExecutionPort,
): SessionExecutionClient {
  if (!environmentId) throw new Error("Missing session owner environment");
  return {
    environmentId,
    listSessions: (params, options) => waitFor(() => port.list(params), options),
    pageSession: (params, options) => waitFor(() => port.page(params), options),
    syncSession: (params, options) => waitFor(() => port.sync(params), options),
    dispatchCommand: (command, options) => {
      // Snapshot the request before an asynchronous transport can observe edits.
      const captured = port.snapshotCommand
        ? port.snapshotCommand(command)
        : structuredClone(command);
      return waitFor(() => port.dispatch(captured), options);
    },
    commandStatus: (commandId, options) => waitFor(() => port.status(commandId), options),
  };
}
