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
export type HostPinReceipt = {
  state: "current" | "applied" | "superseded" | "refused";
  version: number;
  pinned: boolean | null;
};

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
    preview?: boolean,
  ): Promise<HostSessionPage>;
  sync(
    sessionId: string,
    options?: {
      revision?: number;
      sourceEpoch?: string;
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
  pinState(
    sessionId: string,
    projectId: string,
    authorityGeneration?: number,
  ): Promise<HostPinReceipt>;
  pinApply(
    sessionId: string,
    projectId: string,
    operationId: string,
    desiredPinned: boolean,
    expectedVersion: number,
    authorityGeneration?: number,
  ): Promise<HostPinReceipt>;
  pinReceipt(
    sessionId: string,
    projectId: string,
    operationId: string,
  ): Promise<HostPinReceipt | null>;
  delete(sessionId: string, projectId: string, authorityGeneration?: number): Promise<unknown>;
}

function hostAccess(kind: SessionAccess["kind"], request: HostSessionRequest): SessionAccess {
  return {
    kind,
    list: (projectId, known) =>
      request("sessions.list", {
        projectId,
        ...(known === undefined ? {} : { known }),
      }),
    page: (sessionId, before, revision, digests, preview = true) =>
      request("sessions.page", {
        sessionId,
        before,
        revision,
        preview,
        ...(digests ? { digests: true } : {}),
      }),
    sync: (sessionId, options = {}) => request("sessions.sync", { sessionId, ...options }),
    block: (sessionId, blockId, revision) =>
      request("sessions.block", { sessionId, blockId, revision }),
    dispatch: (command) => request("commands.dispatch", command),
    status: (commandId) => request("commands.status", { commandId }),
    update: (sessionId, patch) => request("sessions.update", { ...patch, sessionId }),
    pinState: (sessionId, projectId, authorityGeneration) =>
      request("sessions.pin.state", { sessionId, projectId, authorityGeneration }),
    pinApply: (
      sessionId,
      projectId,
      operationId,
      desiredPinned,
      expectedVersion,
      authorityGeneration,
    ) =>
      request("sessions.pin.apply", {
        sessionId,
        projectId,
        operationId,
        desiredPinned,
        expectedVersion,
        authorityGeneration,
      }),
    pinReceipt: (sessionId, projectId, operationId) =>
      request("sessions.pin.receipt", { sessionId, projectId, operationId }),
    delete: (sessionId, projectId, authorityGeneration) =>
      request("sessions.delete", {
        sessionId,
        projectId,
        ...(authorityGeneration === undefined ? {} : { authorityGeneration }),
      }),
  };
}
export const localHostSessionAccess = (request: HostSessionRequest): SessionAccess =>
  hostAccess("local-host", request);
export const remoteHostSessionAccess = (request: HostSessionRequest): SessionAccess =>
  hostAccess("remote-host", request);
