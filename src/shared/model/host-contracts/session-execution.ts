import type { CommandDispatchParams, CommandReceipt } from "./session-commands";
import type {
  SessionsListParams,
  SessionsListResult,
  SessionsPageParams,
  SessionsPageResult,
  SessionsSyncParams,
  SessionSyncResponse,
} from "./session-reads";

/** Adapt native/DOM cancellation at the platform boundary; it only stops waiting. */
export interface HostCancellationSignal {
  readonly aborted: boolean;
  subscribe(listener: () => void): () => void;
}
export type SessionRequestOptions = { readonly signal?: HostCancellationSignal };
/** Session execution authority is the environment route, not the initiating device. */
export interface SessionExecutionClient {
  readonly environmentId: string;
  listSessions(
    params: SessionsListParams,
    options?: SessionRequestOptions,
  ): Promise<SessionsListResult>;
  pageSession(
    params: SessionsPageParams,
    options?: SessionRequestOptions,
  ): Promise<SessionsPageResult>;
  syncSession(
    params: SessionsSyncParams,
    options?: SessionRequestOptions,
  ): Promise<SessionSyncResponse>;
  commandStatus(commandId: string, options?: SessionRequestOptions): Promise<CommandReceipt | null>;
  /** A lost acknowledgement requires status lookup with this same commandId. */
  dispatchCommand(
    command: CommandDispatchParams,
    options?: SessionRequestOptions,
  ): Promise<CommandReceipt>;
}
