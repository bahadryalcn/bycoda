import { createHash } from "node:crypto";
import { JsonValueSchema, WS_LIMITS } from "../../src/shared/model/host-contracts";
import {
  HostBulkTransfers,
  automationBulkDeleteKeys,
  createHostBulkHandler,
  crewAgentBulkDeleteKeys,
  crewDefinitionBulkDeleteKeys,
  crewRunBulkDeleteKeys,
  goalBulkDeleteKeys,
  noteBulkDeleteKeys,
  stewardBulkDeleteKeys,
  taskBulkDeleteKeys,
} from "../transport/http/bulk";
import { HostSubscriptionHub } from "../transport/ws/subscriptions";
import type { ServerBindings } from "./bindings";
export function createSubscriptionsRuntime(
  dependencies: Pick<
    ServerBindings,
    | "engine"
    | "tasks"
    | "goals"
    | "automations"
    | "stewards"
    | "crews"
    | "hostNotes"
    | "projectsService"
    | "projectSessionList"
    | "desktop"
    | "sessionRead"
    | "sessionService"
    | "signal"
    | "invalidateSessionSource"
    | "transfers"
  >,
) {
  const bulkTransfers = new HostBulkTransfers({
    environmentId: dependencies.engine.store.environmentId,
  });
  const previousTaskDelete = dependencies.tasks.onDelete;
  const taskDeleted: NonNullable<typeof dependencies.tasks.onDelete> = (task) => {
    for (const key of taskBulkDeleteKeys(task)) bulkTransfers.invalidate(key);
    previousTaskDelete?.(task);
  };
  dependencies.tasks.onDelete = taskDeleted;
  const previousGoalDelete = dependencies.goals.onDelete;
  const goalDeleted: NonNullable<typeof dependencies.goals.onDelete> = (goal) => {
    for (const key of goalBulkDeleteKeys(goal)) bulkTransfers.invalidate(key);
    previousGoalDelete?.(goal);
  };
  dependencies.goals.onDelete = goalDeleted;
  const previousAutomationDelete = dependencies.automations.onDelete;
  const automationDeleted: NonNullable<typeof dependencies.automations.onDelete> = (automation) => {
    for (const key of automationBulkDeleteKeys(automation)) bulkTransfers.invalidate(key);
    previousAutomationDelete?.(automation);
  };
  dependencies.automations.onDelete = automationDeleted;
  const previousStewardDelete = dependencies.stewards.onDelete;
  const stewardDeleted: NonNullable<typeof dependencies.stewards.onDelete> = (steward) => {
    for (const key of stewardBulkDeleteKeys(steward)) bulkTransfers.invalidate(key);
    previousStewardDelete?.(steward);
  };
  dependencies.stewards.onDelete = stewardDeleted;
  const previousCrewDefinitionDeleted = dependencies.crews.onDefinitionDeleted;
  const crewDefinitionDeleted: NonNullable<typeof dependencies.crews.onDefinitionDeleted> = (
    change,
  ) => {
    for (const key of crewDefinitionBulkDeleteKeys(change)) bulkTransfers.invalidate(key);
    return previousCrewDefinitionDeleted?.(change);
  };
  dependencies.crews.onDefinitionDeleted = crewDefinitionDeleted;
  const previousCrewAgentDeleted = dependencies.crews.onAgentDeleted;
  const crewAgentDeleted: NonNullable<typeof dependencies.crews.onAgentDeleted> = (change) => {
    for (const key of crewAgentBulkDeleteKeys(change)) bulkTransfers.invalidate(key);
    return previousCrewAgentDeleted?.(change);
  };
  dependencies.crews.onAgentDeleted = crewAgentDeleted;
  const previousCrewRunDeleted = dependencies.crews.onRunDeleted;
  const crewRunDeleted: NonNullable<typeof dependencies.crews.onRunDeleted> = (change) => {
    for (const key of crewRunBulkDeleteKeys(change)) bulkTransfers.invalidate(key);
    return previousCrewRunDeleted?.(change);
  };
  dependencies.crews.onRunDeleted = crewRunDeleted;
  dependencies.hostNotes.onDelete = (note) => {
    for (const key of noteBulkDeleteKeys(note)) bulkTransfers.invalidate(key);
  };
  const authenticateDevice = async (token: string) =>
    (await dependencies.engine.store.authenticated(token))
      ? createHash("sha256").update(token).digest("hex")
      : null;
  const bulkHandler = createHostBulkHandler({
    transfers: bulkTransfers,
    authenticate: authenticateDevice,
  });
  const subscriptionHub = new HostSubscriptionHub({
    environmentId: dependencies.engine.store.environmentId,
    load: async (target, principalId, signal, context) =>
      await dependencies.engine.store.db.outsideScope(async () => {
        signal.throwIfAborted();
        pruneStreamVersions();
        const resource =
          target.kind === "session"
            ? `session:${target.sessionId}`
            : target.kind === "project"
              ? `project:${target.projectId}`
              : "environment";
        const lease = bulkTransfers.begin(principalId, resource);
        try {
          let value: unknown;
          let revision: number | undefined;
          let baseRevision: number | undefined;
          let sourceEpoch: string | undefined;
          let kind: "snapshot" | "delta" = "snapshot";
          if (target.kind === "environment")
            value = { projects: await dependencies.projectsService.list() };
          else if (target.kind === "project") {
            streamProjectVersions.set(
              target.projectId,
              dependencies.engine.store.projectVersion(target.projectId),
            );
            const current = await dependencies.projectSessionList(target.projectId);
            value = { etag: current.etag, sessions: current.list };
          } else {
            if (
              !(await dependencies.engine.store.withReadCancellation(signal, () =>
                dependencies.engine.store.sessionStateMetadata(target.sessionId),
              )) &&
              !(await dependencies.desktop.projectCwdAsync(target.sessionId, signal))
            )
              return null;
            const projectRow = await dependencies.sessionRead(signal, () =>
              dependencies.engine.store.db
                .prepare("SELECT project_id FROM session_state WHERE id=?")
                .get(target.sessionId),
            );
            const projectId = projectRow ? String(projectRow.project_id) : undefined;
            if (projectId) {
              streamProjects.set(target.sessionId, projectId);
              if (!streamProjectVersions.has(projectId))
                streamProjectVersions.set(
                  projectId,
                  dependencies.engine.store.projectVersion(projectId),
                );
            }
            const sync = await dependencies.engine.store.db.withAuthorization(
              context.authorized,
              () =>
                dependencies.sessionService.stream(
                  {
                    sessionId: target.sessionId,
                    revision: context.revision,
                    sourceEpoch: context.sourceEpoch,
                  },
                  { authorized: context.authorized, signal },
                ),
            );
            sourceEpoch = sync.kind === "unchanged" ? sync.sourceEpoch : sync.value.sourceEpoch;
            if (sync.kind === "unchanged")
              return {
                kind: "unchanged" as const,
                revision: sync.revision,
                sourceEpoch: sync.sourceEpoch,
              };
            if (sync.kind === "delta") {
              value = sync;
              kind = "delta";
              baseRevision = sync.base;
            } else value = sync.value;
            revision = sync.value.revision;
          }
          signal.throwIfAborted();
          const data = JsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
          return {
            kind,
            revision,
            baseRevision,
            ...(sourceEpoch ? { sourceEpoch } : {}),
            data: bulkTransfers.encode(lease, data, WS_LIMITS.streamChunkBytes - 1024),
          };
        } finally {
          bulkTransfers.release(lease);
        }
      }),
  });
  const streamProjects = new Map<string, string>();
  const streamProjectVersions = new Map<string, number>();
  const pruneStreamVersions = () => {
    const targets = subscriptionHub.targets();
    const sessions = new Set(
      targets.flatMap((target) => (target.kind === "session" ? [target.sessionId] : [])),
    );
    for (const id of streamProjects.keys()) if (!sessions.has(id)) streamProjects.delete(id);
    const projects = new Set([
      ...targets.flatMap((target) => (target.kind === "project" ? [target.projectId] : [])),
      ...streamProjects.values(),
    ]);
    for (const id of streamProjectVersions.keys())
      if (!projects.has(id)) streamProjectVersions.delete(id);
  };
  let unattributedVersion = dependencies.engine.store.unattributedChangeVersion;
  const unsubscribeChanges = dependencies.engine.store.subscribeChanges(() => {
    const globalChange =
      unattributedVersion !== dependencies.engine.store.unattributedChangeVersion;
    unattributedVersion = dependencies.engine.store.unattributedChangeVersion;
    let attributed = false;
    for (const [projectId, version] of streamProjectVersions) {
      const current = dependencies.engine.store.projectVersion(projectId);
      if (current === version) continue;
      attributed = true;
      streamProjectVersions.set(projectId, current);
      subscriptionHub.invalidate({ kind: "project", projectId });
      for (const [sessionId, project] of streamProjects)
        if (project === projectId) subscriptionHub.invalidate({ kind: "session", sessionId });
    }
    // A commit no project version explains (queue, approval, settings…) still
    // refreshes every stream, as before targeted invalidation.
    if (globalChange || !attributed) subscriptionHub.invalidate();
    else subscriptionHub.invalidate({ kind: "environment" });
  });
  const httpTokenHashes = new WeakMap<object, { token: string; hash: string }>();
  const heldPolls = new Map<{ revoked: boolean }, string>();
  const unsubscribeAuthorization = dependencies.engine.store.subscribeAuthorizationChanges(() => {
    for (const [state, token] of heldPolls)
      void dependencies.engine.store.authenticated(token).then(
        (valid) => {
          state.revoked = !valid;
          if (!valid) dependencies.signal.notify();
        },
        () => {
          state.revoked = true;
          dependencies.signal.notify();
        },
      );
  });
  const unsubscribeAuthority = dependencies.engine.store.subscribeAuthorityChanges((change) => {
    dependencies.invalidateSessionSource(change.sessionId);
    bulkTransfers.invalidate(`session:${change.sessionId}`);
    dependencies.transfers.forget(change.sessionId);
    subscriptionHub.resnapshot({ kind: "session", sessionId: change.sessionId });
    if (change.projectId) {
      bulkTransfers.invalidate(`project:${change.projectId}`);
      subscriptionHub.resnapshot({ kind: "project", projectId: change.projectId });
    }
  });
  const previousDesktopChange = dependencies.desktop.live.onChange;
  const previousDesktopSourceChange = dependencies.desktop.live.onSourceChange;
  dependencies.desktop.live.onSourceChange = (sessionIds) => {
    previousDesktopSourceChange?.(sessionIds);
    for (const sessionId of sessionIds) {
      dependencies.invalidateSessionSource(sessionId);
      bulkTransfers.invalidate(`session:${sessionId}`);
      dependencies.transfers.forget(sessionId);
      subscriptionHub.resnapshot({ kind: "session", sessionId });
    }
  };
  dependencies.desktop.live.onChange = (sessionIds) => {
    previousDesktopChange?.(sessionIds);
    subscriptionHub.invalidate({ kind: "environment" });
    for (const sessionId of sessionIds) {
      subscriptionHub.invalidate({ kind: "session", sessionId });
      const projectId = streamProjects.get(sessionId);
      if (projectId) subscriptionHub.invalidate({ kind: "project", projectId });
    }
    // Desktop-only project membership can be outside the Host session store.
    for (const projectId of streamProjectVersions.keys())
      subscriptionHub.invalidate({ kind: "project", projectId });
  };
  const invalidateSessionCopies = (sessionId: string, projectId: string) => {
    subscriptionHub.forget({ kind: "session", sessionId });
    bulkTransfers.invalidate(`session:${sessionId}`);
    dependencies.transfers.forget(sessionId);
    bulkTransfers.invalidate(`project:${projectId}`);
    subscriptionHub.resnapshot({ kind: "project", projectId });
  };
  return {
    bulkTransfers,
    previousTaskDelete,
    taskDeleted,
    previousGoalDelete,
    goalDeleted,
    previousAutomationDelete,
    automationDeleted,
    previousStewardDelete,
    stewardDeleted,
    previousCrewDefinitionDeleted,
    crewDefinitionDeleted,
    previousCrewAgentDeleted,
    crewAgentDeleted,
    previousCrewRunDeleted,
    crewRunDeleted,
    authenticateDevice,
    bulkHandler,
    subscriptionHub,
    streamProjects,
    streamProjectVersions,
    pruneStreamVersions,
    get unattributedVersion() {
      return unattributedVersion;
    },
    set unattributedVersion(value: typeof unattributedVersion) {
      unattributedVersion = value;
    },
    unsubscribeChanges,
    httpTokenHashes,
    heldPolls,
    unsubscribeAuthorization,
    unsubscribeAuthority,
    previousDesktopChange,
    previousDesktopSourceChange,
    invalidateSessionCopies,
  };
}
