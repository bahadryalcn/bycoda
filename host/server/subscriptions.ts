import { createHash } from "node:crypto";
import {
  JsonValueSchema,
  WS_LIMITS,
  type JsonValue,
} from "../../src/shared/model/host-contracts";
import { normalizeJsonWire, readNormalizedJsonWire } from "../transport/normalized-wire";
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
import { StreamDeltaEncoder, tailStreamKey, tailStreamSessionId } from "../sync/stream-delta";
import {
  ProjectDeltaEncoder,
  projectStreamKey,
  projectStreamProjectId,
} from "../sync/project-delta";
import { HostSubscriptionHub } from "../transport/ws/subscriptions";
import type { ServerBindings } from "./bindings";
import { onProviderAccountStatusChange } from "./native";
/** Quiet period that merges a burst of catalog or sign-in changes into one models reload. */
const MODELS_INVALIDATE_DEBOUNCE_MS = 250;
/** Well inside DESKTOP_BEAT_STALE_MS so a lapsed desktop snapshot reaches phones promptly. */
const DIRECTORY_AGING_CHECK_MS = 5_000;
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
    | "modelsService"
    | "catalogs"
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
  // Sender state of tail streams (newest page first, compact deltas), per principal and session.
  const streamDeltas = new StreamDeltaEncoder();
  // Sender state of project list streams opened with `delta`, per principal and project.
  const projectDeltas = new ProjectDeltaEncoder();
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
              : target.kind === "models"
                ? `models:${target.projectId ?? ""}`
                : "environment";
        const lease = bulkTransfers.begin(principalId, resource);
        try {
          let value: unknown;
          let revision: number | undefined;
          let baseRevision: number | undefined;
          let sourceEpoch: string | undefined;
          let kind: "snapshot" | "delta" = "snapshot";
          if (target.kind === "environment") {
            // Taken before the reads: an age-out during them still shows on the next tick.
            const freshClients = dependencies.desktop.live.freshDirectoryClients();
            // `projects` stays the legacy list; `directory` is the authoritative groups,
            // privacy proof and desktop-only entries (capability projects.directory.stream.v1).
            value = {
              projects: await dependencies.projectsService.list(),
              directory: dependencies.desktop.live.projectDirectory(
                await dependencies.engine.store.projects(),
                dependencies.engine.store.environmentId,
                dependencies.desktop.live.groupLock.access(principalId),
              ),
            };
            // Only a load that finished vouches for this age; a failed one keeps the timer retrying.
            directoryFreshClients = freshClients;
          } else if (target.kind === "models")
            // Same service and authority as `models.list`; `pending` shrinks as providers land.
            value = await dependencies.engine.store.db.withAuthorization(context.authorized, () =>
              dependencies.modelsService.list(
                { ...(target.projectId ? { projectId: target.projectId } : {}), progressive: true },
                { authorized: context.authorized, principalId, signal },
              ),
            );
          else if (target.kind === "project") {
            streamProjectVersions.set(
              target.projectId,
              dependencies.engine.store.projectVersion(target.projectId),
            );
            const current = await dependencies.projectSessionList(target.projectId);
            if (target.delta !== true) value = { etag: current.etag, sessions: current.list };
            else {
              signal.throwIfAborted();
              const read = projectDeltas.encode(
                projectStreamKey(principalId, target.projectId),
                current,
                context.revision,
                context.forceSnapshot,
              );
              revision = read.revision;
              if (read.kind === "unchanged") return read;
              value = read.value;
              if (read.kind === "delta") {
                kind = "delta";
                baseRevision = read.base;
              }
            }
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
            streamSessionVersions.set(
              target.sessionId,
              dependencies.engine.store.versions.session(target.sessionId, false),
            );
            if (projectId) {
              streamProjects.set(target.sessionId, projectId);
              if (!streamProjectScopes.has(projectId))
                streamProjectScopes.set(
                  projectId,
                  dependencies.engine.store.versions.scope(projectId, false),
                );
              if (!streamProjectVersions.has(projectId))
                streamProjectVersions.set(
                  projectId,
                  dependencies.engine.store.projectVersion(projectId),
                );
            }
            const tailKey =
              target.tail === true ? tailStreamKey(principalId, target.sessionId) : undefined;
            // An incremental read of a windowed tail stream keeps the window's first block.
            const windowStart =
              tailKey && !context.forceSnapshot
                ? streamDeltas.windowStart(tailKey, context.revision)
                : undefined;
            const read = await dependencies.engine.store.db.withAuthorization(
              context.authorized,
              () =>
                dependencies.sessionService.stream(
                  {
                    sessionId: target.sessionId,
                    revision: context.revision,
                    sourceEpoch: context.sourceEpoch,
                    ...(tailKey ? { tail: true } : {}),
                    ...(windowStart ? { partial: true, loadedBlockIds: [windowStart] } : {}),
                  },
                  { authorized: context.authorized, signal },
                ),
            );
            const sync =
              tailKey && read.kind !== "unchanged" ? streamDeltas.encode(tailKey, read) : read;
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
          // One serialization: the schema check, the bulk size decision and the hub's
          // fingerprint all read this capture instead of re-stringifying the snapshot.
          const initial = normalizeJsonWire(value);
          const wire = readNormalizedJsonWire(initial).wire as JsonValue;
          JsonValueSchema.parse(wire);
          const data = bulkTransfers.encodeNormalized(
            lease,
            initial,
            WS_LIMITS.streamChunkBytes - 1024,
          ) as JsonValue;
          return {
            kind,
            revision,
            baseRevision,
            ...(sourceEpoch ? { sourceEpoch } : {}),
            data,
            // A bulk descriptor replaces the content, so only an inline snapshot has a capture.
            ...(data === wire ? { capture: initial } : {}),
          };
        } finally {
          bulkTransfers.release(lease);
        }
      }),
  });
  // The desktop snapshots the last environment load counted; undefined until one succeeds.
  let directoryFreshClients: string | undefined;
  const streamProjects = new Map<string, string>();
  const streamProjectVersions = new Map<string, number>();
  // Session streams refresh from their own save counter, or when an unattributed
  // change hit their project; a sibling's streaming save does neither.
  const streamProjectScopes = new Map<string, number>();
  const streamSessionVersions = new Map<string, number>();
  const pruneStreamVersions = () => {
    const targets = subscriptionHub.targets();
    const sessions = new Set(
      targets.flatMap((target) => (target.kind === "session" ? [target.sessionId] : [])),
    );
    streamDeltas.retain((key) => sessions.has(tailStreamSessionId(key)));
    const deltaProjects = new Set(
      targets.flatMap((target) =>
        target.kind === "project" && target.delta === true ? [target.projectId] : [],
      ),
    );
    projectDeltas.retain((key) => deltaProjects.has(projectStreamProjectId(key)));
    for (const id of streamProjects.keys()) if (!sessions.has(id)) streamProjects.delete(id);
    for (const id of streamSessionVersions.keys())
      if (!sessions.has(id)) streamSessionVersions.delete(id);
    const projects = new Set([
      ...targets.flatMap((target) => (target.kind === "project" ? [target.projectId] : [])),
      ...streamProjects.values(),
    ]);
    for (const id of streamProjectVersions.keys())
      if (!projects.has(id)) streamProjectVersions.delete(id);
    for (const id of streamProjectScopes.keys())
      if (!projects.has(id)) streamProjectScopes.delete(id);
  };
  let unattributedVersion = dependencies.engine.store.unattributedChangeVersion;
  const unsubscribeStoreChanges = dependencies.engine.store.subscribeChanges(() => {
    const globalChange =
      unattributedVersion !== dependencies.engine.store.unattributedChangeVersion;
    unattributedVersion = dependencies.engine.store.unattributedChangeVersion;
    for (const [projectId, version] of streamProjectVersions) {
      const current = dependencies.engine.store.projectVersion(projectId);
      if (current === version) continue;
      streamProjectVersions.set(projectId, current);
      subscriptionHub.invalidate({ kind: "project", projectId });
    }
    for (const [projectId, scope] of streamProjectScopes) {
      const current = dependencies.engine.store.versions.scope(projectId, false);
      if (current === scope) continue;
      streamProjectScopes.set(projectId, current);
      for (const [sessionId, project] of streamProjects)
        if (project === projectId) subscriptionHub.invalidate({ kind: "session", sessionId });
    }
    for (const [sessionId, version] of streamSessionVersions) {
      const current = dependencies.engine.store.versions.session(sessionId, false);
      if (current === version) continue;
      streamSessionVersions.set(sessionId, current);
      subscriptionHub.invalidate({ kind: "session", sessionId });
    }
    // Only SQL outside the session tables (queue, approval, settings…) has no version to
    // explain it and still refreshes every stream. A commit whose session-table writes
    // moved no streamed version changed nothing a project or session stream shows.
    if (globalChange) subscriptionHub.invalidate();
    else subscriptionHub.invalidate({ kind: "environment" });
  });
  // The desktop project directory lives outside the store: a rail change arrives in a
  // heartbeat and a stale heartbeat only ages out, so neither is a store commit.
  const refreshDirectoryStreams = () => subscriptionHub.invalidate({ kind: "environment" });
  const previousDirectoryChange = dependencies.desktop.live.onDirectoryChange;
  dependencies.desktop.live.onDirectoryChange = () => {
    previousDirectoryChange?.();
    refreshDirectoryStreams();
  };
  const agingTimer = setInterval(() => {
    // Retired streams drop their version entries here, not only when another stream loads.
    pruneStreamVersions();
    if (!subscriptionHub.targets().some((target) => target.kind === "environment")) return;
    // Reload only when a desktop snapshot crossed the stale threshold since the last load;
    // an unset age (no load finished yet) keeps refreshing, as before.
    if (dependencies.desktop.live.freshDirectoryClients() !== directoryFreshClients)
      refreshDirectoryStreams();
  }, DIRECTORY_AGING_CHECK_MS);
  agingTimer.unref();
  const unsubscribeChanges = () => {
    unsubscribeStoreChanges();
    clearInterval(agingTimer);
    clearTimeout(modelsTimer);
    modelsTimer = undefined;
    unsubscribeAccountStatus();
    dependencies.catalogs.onChange = undefined;
    dependencies.desktop.live.onDirectoryChange = previousDirectoryChange;
  };
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
  const invalidateAllProjectStreams = () => {
    for (const projectId of streamProjectVersions.keys())
      subscriptionHub.invalidate({ kind: "project", projectId });
  };
  dependencies.desktop.live.onChange = (sessionIds) => {
    previousDesktopChange?.(sessionIds);
    subscriptionHub.invalidate({ kind: "environment" });
    const unmapped: string[] = [];
    for (const sessionId of sessionIds) {
      subscriptionHub.invalidate({ kind: "session", sessionId });
      const projectId = streamProjects.get(sessionId);
      if (projectId) subscriptionHub.invalidate({ kind: "project", projectId });
      else unmapped.push(sessionId);
    }
    if (!unmapped.length) return;
    // A changed session without a stream here still belongs to the project of its Host
    // store row. Only a desktop-only session (no row; its membership lives in the desktop
    // database) can be in any project, so only that case refreshes every project stream.
    void dependencies
      .sessionRead(undefined, () =>
        Promise.all(
          unmapped.map(async (sessionId) => {
            const row = await dependencies.engine.store.db
              .prepare("SELECT project_id FROM session_state WHERE id=?")
              .get(sessionId);
            return row ? String(row.project_id) : undefined;
          }),
        ),
      )
      .then(
        (projectIds) => {
          if (projectIds.includes(undefined)) invalidateAllProjectStreams();
          for (const projectId of projectIds)
            if (projectId) subscriptionHub.invalidate({ kind: "project", projectId });
        },
        () => invalidateAllProjectStreams(),
      );
  };
  // Discovery lands provider by provider and sign-in probes finish in bursts, so a short
  // trailing debounce keeps the hub at one reload per burst.
  let modelsTimer: ReturnType<typeof setTimeout> | undefined;
  const invalidateModelCatalog = () => {
    if (modelsTimer) return;
    modelsTimer = setTimeout(() => {
      modelsTimer = undefined;
      for (const target of subscriptionHub.targets())
        if (target.kind === "models") subscriptionHub.invalidate(target);
    }, MODELS_INVALIDATE_DEBOUNCE_MS);
    modelsTimer.unref();
  };
  dependencies.catalogs.onChange = invalidateModelCatalog;
  const unsubscribeAccountStatus = onProviderAccountStatusChange(invalidateModelCatalog);
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
    streamProjectScopes,
    streamSessionVersions,
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
    invalidateModelCatalog,
  };
}
