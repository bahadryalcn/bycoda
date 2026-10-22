import { confirm } from "@tauri-apps/plugin-dialog";
import type { ServerRecord } from "./serverInventory";
import { previewSshConfiguration } from "./sshGroupDefaults";

export type SshWorkspaceContext = {
  actorId: string;
  environmentId: string;
  sourceSessionId: string;
  projectCwd: string;
  workingCwd: string;
  valid: () => boolean;
  authorize: () => Promise<boolean>;
};
export type SshWorkspaceConnection = {
  id: string;
  name: string;
  host: string;
  port: number;
  hasIdentity: boolean;
  hasJump: boolean;
  hasProxy: boolean;
};
export type SshWorkspaceStatus = {
  state: "unknown" | "pending" | "opening" | "opened-on-computer" | "exited" | "closed" | "failed";
  workspaceId?: string;
  connectionId?: string;
  terminalCount?: number;
  pendingNativeApproval?: boolean;
};
export type SshWorkspaceReview = {
  reviewId: string;
  expiresAt: number;
  operation: "connect" | "close";
  connection: SshWorkspaceConnection;
  configurationDigest: string;
  workspaceId?: string;
  terminalCount: number;
  nativeApprovalRequired: true;
  phoneTerminal: false;
};
export type SshWorkspaceUiOwner = {
  open: (
    resourceId: string,
    server: ServerRecord,
    digest: string,
    valid: () => boolean,
    state: (value: SshWorkspaceStatus["state"]) => void,
    authorize: () => Promise<boolean>,
  ) => Promise<boolean>;
  close: (resourceId: string) => Promise<void>;
  impact: (resourceId: string) => { state: SshWorkspaceStatus["state"]; count: number };
};
let catalog: (() => { ready: boolean; servers: ServerRecord[] }) | undefined;
let uiOwner: SshWorkspaceUiOwner | undefined;
export function registerSshWorkspaceCatalog(value: NonNullable<typeof catalog>) {
  catalog = value;
  return () => {
    if (catalog === value) catalog = undefined;
  };
}
export function registerSshWorkspaceUi(value: SshWorkspaceUiOwner) {
  uiOwner = value;
  return () => {
    if (uiOwner === value) uiOwner = undefined;
  };
}
export function projectSshWorkspaceConnection(server: ServerRecord): SshWorkspaceConnection {
  const endpoint = server.effectiveSshEndpoint ?? server.sshEndpoint;
  if (
    server.kind !== "ssh" ||
    !endpoint ||
    !server.id ||
    !server.name ||
    server.name.length > 200 ||
    endpoint.host.length > 255 ||
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1 ||
    endpoint.port > 65535
  )
    throw new Error("Unsupported personal SSH target");
  return {
    id: server.id,
    name: server.name,
    host: endpoint.host,
    port: endpoint.port,
    hasIdentity: !!endpoint.identityFile,
    hasJump: !!endpoint.jumpHost || !!endpoint.jumpHosts?.length || !!endpoint.jumpPolicies?.length,
    hasProxy: !!endpoint.httpProxy,
  };
}
const exact = (input: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(input).some((key) => !keys.includes(key)))
    throw new Error("Unsupported SSH workspace field");
};
const id = (value: unknown): string => {
  if (typeof value !== "string" || !value || value.length > 200 || /[\0\r\n]/.test(value))
    throw new Error("Invalid SSH workspace identity");
  return value;
};
const scope = (context: SshWorkspaceContext) =>
  JSON.stringify([
    context.actorId,
    context.environmentId,
    context.sourceSessionId,
    context.projectCwd,
    context.workingCwd,
  ]);
type Deps = {
  catalog: () => { ready: boolean; servers: ServerRecord[] } | undefined;
  owner: () => SshWorkspaceUiOwner | undefined;
  preview: (
    connectionId: string,
  ) => Promise<{ connectionId: string; configuration: { digest: string } }>;
  confirmClose: (review: SshWorkspaceReview) => Promise<boolean>;
  now: () => number;
  id: () => string;
};
const defaults: Deps = {
  catalog: () => catalog?.(),
  owner: () => uiOwner,
  preview: (connectionId) => previewSshConfiguration(connectionId, null, true),
  now: Date.now,
  id: () => crypto.randomUUID(),
  confirmClose: (review) =>
    confirm(
      `A paired mobile device requests closing its SSH terminal on this computer:\n${review.connection.name}\n${review.connection.host}:${review.connection.port}\nOwned terminals: ${review.terminalCount}\nOther desktop SSH resources are not included.`,
      {
        title: "Close mobile SSH workspace",
        kind: "warning",
        okLabel: "Close owned terminal",
        cancelLabel: "Cancel",
      },
    ),
};
export function createSshMobileWorkspaceControl(overrides: Partial<Deps> = {}) {
  const deps = { ...defaults, ...overrides };
  const workspaces = new Map<
    string,
    {
      scope: string;
      owner: SshWorkspaceUiOwner;
      resourceId: string;
      connection: SshWorkspaceConnection;
      state: SshWorkspaceStatus["state"];
    }
  >();
  const reviews = new Map<
    string,
    { scope: string; public: SshWorkspaceReview; signature: string; impact?: string }
  >();
  const attempts = new Map<
    string,
    { scope: string; reviewId: string; workspaceId?: string; state: SshWorkspaceStatus["state"] }
  >();
  const assert = (context: SshWorkspaceContext) => {
    id(context.actorId);
    if (
      !context.valid() ||
      context.projectCwd.startsWith("remote://") ||
      context.workingCwd.startsWith("remote://")
    )
      throw new Error("SSH source is unavailable or private");
  };
  const visible = () => {
    const value = deps.catalog();
    if (!value?.ready || value.servers.length > 500)
      throw new Error("Open the current Servers view on the computer first");
    return value.servers.filter((row) => row.kind === "ssh");
  };
  const target = (connectionId: string) => {
    const row = visible().find((row) => row.id === connectionId);
    if (!row) throw new Error("SSH target is not visible on the computer");
    return row;
  };
  const signature = (server: ServerRecord) =>
    JSON.stringify([
      server.id,
      server.name,
      server.sshEndpoint,
      server.effectiveSshEndpoint,
      server.metadata.sshInheritance,
    ]);
  const findWorkspace = (context: SshWorkspaceContext, workspaceId: string) => {
    const value = workspaces.get(workspaceId);
    if (!value || value.scope !== scope(context)) throw new Error("SSH workspace is unavailable");
    return value;
  };
  const status = (context: SshWorkspaceContext, workspaceId: string): SshWorkspaceStatus => {
    const entry = findWorkspace(context, workspaceId);
    // A changed source window is not permission to adopt a foreign replacement resource.
    if (deps.owner() !== entry.owner)
      return { state: "unknown", workspaceId, connectionId: entry.connection.id };
    target(entry.connection.id);
    const impact = entry.owner.impact(entry.resourceId);
    return {
      state: ["pending", "opening", "unknown", "failed", "closed"].includes(entry.state)
        ? entry.state
        : impact.state,
      workspaceId,
      connectionId: entry.connection.id,
      terminalCount: impact.count,
      pendingNativeApproval: entry.state === "opening",
    };
  };
  return async (
    context: SshWorkspaceContext,
    action: string,
    input: Record<string, unknown>,
  ): Promise<unknown> => {
    assert(context);
    if (action === "ssh.workspace.catalog.read") {
      exact(input, []);
      return {
        connections: visible().map(projectSshWorkspaceConnection),
        phoneTerminal: false,
        sftp: false,
        forwards: false,
        runbooks: false,
      };
    }
    if (action === "ssh.workspace.status") {
      exact(input, ["requestId", "workspaceId"]);
      if ((input.requestId === undefined) === (input.workspaceId === undefined))
        throw new Error("Choose one SSH workspace receipt identity");
      if (input.workspaceId !== undefined) return status(context, id(input.workspaceId));
      const attempt = attempts.get(id(input.requestId));
      if (!attempt) return { state: "unknown" };
      if (attempt.scope !== scope(context)) throw new Error("SSH receipt source mismatch");
      return attempt.workspaceId
        ? {
            ...status(context, attempt.workspaceId),
            ...(["failed", "unknown", "closed"].includes(attempt.state)
              ? { state: attempt.state }
              : {}),
          }
        : { state: attempt.state };
    }
    if (action === "ssh.workspace.review" || action === "ssh.workspace.close.review") {
      const closing = action === "ssh.workspace.close.review";
      exact(input, [closing ? "workspaceId" : "connectionId"]);
      const workspaceId = closing ? id(input.workspaceId) : undefined;
      const workspace = workspaceId ? findWorkspace(context, workspaceId) : undefined;
      const server = target(workspace?.connection.id ?? id(input.connectionId));
      const owner = deps.owner();
      if (!owner || (workspace && owner !== workspace.owner))
        throw new Error("Native SSH workspace owner is unavailable");
      const before = signature(server),
        configuration = await deps.preview(server.id);
      assert(context);
      if (
        signature(target(server.id)) !== before ||
        configuration.connectionId !== server.id ||
        !/^[a-f0-9]{64}$/.test(configuration.configuration.digest)
      )
        throw new Error("SSH target changed during review");
      const impact = workspace ? workspace.owner.impact(workspace.resourceId) : undefined;
      if (
        closing &&
        (!impact || !["opened-on-computer", "exited", "failed"].includes(impact.state))
      )
        throw new Error("Wait for the native SSH connection review to finish");
      const review: SshWorkspaceReview = {
        reviewId: deps.id(),
        expiresAt: deps.now() + 120000,
        operation: closing ? "close" : "connect",
        connection: projectSshWorkspaceConnection(server),
        configurationDigest: configuration.configuration.digest,
        ...(workspaceId ? { workspaceId } : {}),
        terminalCount: impact?.count ?? 1,
        nativeApprovalRequired: true,
        phoneTerminal: false,
      };
      for (const [key, entry] of reviews)
        if (entry.public.expiresAt < deps.now()) reviews.delete(key);
      if (reviews.size >= 128) throw new Error("Too many pending SSH reviews");
      reviews.set(review.reviewId, {
        scope: scope(context),
        public: review,
        signature: before,
        impact: impact && JSON.stringify(impact),
      });
      return review;
    }
    if (action !== "ssh.workspace.approve" && action !== "ssh.workspace.close.approve")
      throw new Error("Unsupported SSH workspace action");
    exact(input, ["reviewId", "requestId"]);
    const reviewId = id(input.reviewId),
      requestId = id(input.requestId),
      previous = attempts.get(requestId);
    if (previous) {
      if (previous.scope !== scope(context) || previous.reviewId !== reviewId)
        throw new Error("SSH request identity was already used");
      return previous.workspaceId
        ? {
            ...status(context, previous.workspaceId),
            ...(["failed", "unknown", "closed"].includes(previous.state)
              ? { state: previous.state }
              : {}),
          }
        : { state: previous.state };
    }
    const review = reviews.get(reviewId),
      closing = action === "ssh.workspace.close.approve";
    if (
      !review ||
      review.scope !== scope(context) ||
      review.public.expiresAt <= deps.now() ||
      (review.public.operation === "close") !== closing
    )
      throw new Error("SSH review is unavailable; review again");
    if (attempts.size >= 256 || (!closing && workspaces.size >= 128))
      throw new Error("SSH workspace receipt budget reached");
    reviews.delete(reviewId);
    const attempt = {
      scope: scope(context),
      reviewId,
      state: "pending" as SshWorkspaceStatus["state"],
      workspaceId: undefined as string | undefined,
    };
    attempts.set(requestId, attempt);
    let server: ServerRecord;
    try {
      server = target(review.public.connection.id);
    } catch {
      attempt.state = "failed";
      return { state: "failed" };
    }
    const owner = deps.owner();
    if (!owner || signature(server) !== review.signature) {
      attempt.state = "failed";
      return { state: "failed" };
    }
    const valid = () => {
      try {
        assert(context);
        return (
          deps.now() < review.public.expiresAt &&
          deps.owner() === owner &&
          signature(target(server.id)) === review.signature
        );
      } catch {
        return false;
      }
    };
    const authorize = async () => {
      try {
        return valid() && (await context.authorize()) && valid();
      } catch {
        return false;
      }
    };
    if (closing) {
      const workspaceId = review.public.workspaceId!,
        workspace = findWorkspace(context, workspaceId);
      attempt.workspaceId = workspaceId;
      let approved = false;
      try {
        approved = await deps.confirmClose(review.public);
      } catch {
        /* A failed native dialog is not authorization. */
      }
      if (
        !approved ||
        !valid() ||
        workspace.owner !== owner ||
        JSON.stringify(owner.impact(workspace.resourceId)) !== review.impact
      ) {
        attempt.state = "failed";
        return { state: "failed", workspaceId };
      }
      if (!(await authorize())) {
        attempt.state = "failed";
        return { state: "failed", workspaceId };
      }
      try {
        await owner.close(workspace.resourceId);
        workspace.state = "closed";
        attempt.state = "closed";
      } catch {
        workspace.state = "unknown";
        attempt.state = "unknown";
      }
      return status(context, workspaceId);
    }
    let configuration: Awaited<ReturnType<Deps["preview"]>>;
    try {
      configuration = await deps.preview(server.id);
    } catch {
      attempt.state = "failed";
      return { state: "failed" };
    }
    if (!valid() || configuration.configuration.digest !== review.public.configurationDigest) {
      attempt.state = "failed";
      return { state: "failed" };
    }
    const workspaceId = deps.id(),
      resourceId = `ssh-mobile:${deps.id()}`;
    attempt.workspaceId = workspaceId;
    const workspace = {
      scope: scope(context),
      owner,
      resourceId,
      connection: review.public.connection,
      state: "opening" as SshWorkspaceStatus["state"],
    };
    workspaces.set(workspaceId, workspace);
    try {
      const opened = await owner.open(
        resourceId,
        server,
        review.public.configurationDigest,
        valid,
        (value) => {
          workspace.state = value;
        },
        authorize,
      );
      if (!opened) workspace.state = "failed";
    } catch {
      workspace.state = "unknown";
    }
    attempt.state = workspace.state;
    return status(context, workspaceId);
  };
}
export const handleSshMobileWorkspace = createSshMobileWorkspaceControl();
