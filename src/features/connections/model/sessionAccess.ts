import type {
  CommandReceipt,
  HostCommand,
  HostSessionSummary,
  SessionSyncResponse,
} from "./protocol";

export type HostSessionPage = {
  sync: SessionSyncResponse;
  before?: number;
  totalBlocks: number;
  revision: number;
};
export type HostSessionList =
  | HostSessionSummary[]
  | { unchanged: true; etag: string }
  | { etag: string; sessions: HostSessionSummary[] };
export type HostSessionRequest = <T>(method: string, params: unknown) => Promise<T>;

/** Both adapters address the owner host. A transport failure never routes the
 * operation to the other host or creates a writable local copy. */
export interface SessionAccess {
  readonly kind: "local-host" | "remote-host";
  list(projectId: string, known?: string): Promise<HostSessionList>;
  page(
    sessionId: string,
    before?: number,
    revision?: number,
    /** Ask for block digests and the transcript head (`sessions.digests`). */
    digests?: boolean,
  ): Promise<HostSessionPage>;
  sync(
    sessionId: string,
    options?: {
      revision?: number;
      waitMs?: number;
      partial?: boolean;
      loadedBlockIds?: string[];
      windowStart?: number;
      /** Ask for block digests and the transcript head (`sessions.digests`). */
      digests?: boolean;
    },
  ): Promise<SessionSyncResponse>;
  block(sessionId: string, blockId: string, revision: number): Promise<SessionSyncResponse>;
  dispatch(command: HostCommand): Promise<CommandReceipt>;
  status(commandId: string): Promise<CommandReceipt | null>;
  update(sessionId: string, patch: Record<string, unknown>): Promise<unknown>;
  delete(sessionId: string, projectId: string): Promise<unknown>;
}

function hostAccess(kind: SessionAccess["kind"], request: HostSessionRequest): SessionAccess {
  return {
    kind,
    list: (projectId, known) =>
      request("sessions.list", {
        projectId,
        ...(known === undefined ? {} : { known }),
      }),
    page: (sessionId, before, revision, digests) =>
      request("sessions.page", {
        sessionId,
        before,
        revision,
        preview: true,
        ...(digests ? { digests: true } : {}),
      }),
    sync: (sessionId, options = {}) => request("sessions.sync", { sessionId, ...options }),
    block: (sessionId, blockId, revision) =>
      request("sessions.block", { sessionId, blockId, revision }),
    dispatch: (command) => request("commands.dispatch", command),
    status: (commandId) => request("commands.status", { commandId }),
    update: (sessionId, patch) => request("sessions.update", { ...patch, sessionId }),
    delete: (sessionId, projectId) => request("sessions.delete", { sessionId, projectId }),
  };
}
export const localHostSessionAccess = (request: HostSessionRequest): SessionAccess =>
  hostAccess("local-host", request);
export const remoteHostSessionAccess = (request: HostSessionRequest): SessionAccess =>
  hostAccess("remote-host", request);
