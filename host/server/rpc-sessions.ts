import { sessionWorkCwd, type LinkedWorkItem } from "../../src/features/sessions/model/session";
import type { SyncOp } from "../../src/features/sync/model/syncProtocol";
import { parseGithubWorkItemUrl } from "../../src/shared/lib/githubWorkItem";
import { SafeCounterSchema } from "../../src/shared/model/host-contracts/schemas";
import {
  attachmentUploadStatus,
  readAttachmentChunk,
  writeAttachmentChunk,
} from "../attachments/attachments";
import { measure } from "../diagnostics/perf-metrics";
import { ownerVoiceActivity } from "../desktop/desktop-voice-activity";
import { assertDomainAuthority } from "../domains/context";
import { type SessionQueueAction } from "../domains/sessions/queue-service";
import { fileRevertGeneration } from "../sessions/session-file-revert";
import { rewindAuthorityGeneration } from "../sessions/session-rewind";
import { HostAuthorityFenceError } from "../storage/authority-fence";
import { syncPull, syncPush } from "../sync/sync";
import { readSessionUsage } from "../usage/usage-report";
import type { WorkspaceRpcRequest } from "../workspaces/workspace-rpc-contracts";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { assertNotCrewManaged } from "../crews/crew-managed-session";
import { requestingDeviceName } from "../desktop/remoteActivity";
import { recordRemoteActivity } from "./remote-activity-record";
export async function handleSessionsRpc(
  dependencies: Pick<
    ServerBindings,
    | "managed"
    | "workspaceForOwnerRpc"
    | "withWorkspaceOwner"
    | "managedWorkspaces"
    | "engine"
    | "inHost"
    | "sessionService"
    | "adopt"
    | "startWorkspaceActivity"
    | "desktop"
    | "pushNotifications"
    | "desktopDelete"
    | "remoteActivity"
    | "invalidateSessionCopies"
    | "sessionQueues"
    | "handoffHistory"
    | "commandService"
    | "withinBeat"
    | "desktopCommandDelivery"
    | "renewRunLeases"
    | "heartbeatEffects"
    | "providerInbox"
    | "hostNotes"
    | "adoptedChanges"
    | "renewQueueLeases"
    | "runLeases"
    | "queueDrainer"
    | "queueSessionKnown"
    | "writerTransfers"
    | "hostRuns"
    | "sessionQueueService"
    | "attachmentOwnership"
    | "readSessionView"
    | "bindQuestionUpload"
    | "scopedDesktopCall"
  >,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "sessions.managedTurn.begin":
    case "sessions.managedTurn.end":
    case "sessions.managedTurn.status": {
      if (!(await dependencies.managed.exactGitRewind.enabled()))
        throw new Error("Exact Git rewind is disabled on this execution host");
      const value = await dependencies.workspaceForOwnerRpc(request.params.workspaceId);
      if (!value || value.owner.kind !== "session" || value.owner.id !== request.params.sessionId)
        throw new Error("Session does not own this workspace");
      request.result = await dependencies.withWorkspaceOwner<unknown>(
        request.token,
        async (owner) => {
          if (request.input.method === "sessions.managedTurn.begin")
            return dependencies.managed.nativeTurns.begin(
              request.params as unknown as Parameters<
                typeof dependencies.managed.nativeTurns.begin
              >[0],
              owner,
            );
          return dependencies.managed.nativeTurns[
            request.input.method === "sessions.managedTurn.end" ? "end" : "status"
          ](
            request.params as unknown as Parameters<typeof dependencies.managed.nativeTurns.end>[0],
            owner,
          );
        },
      );
      if (request.input.method !== "sessions.managedTurn.status")
        await dependencies.managedWorkspaces.touchActivity(value.id);
      break;
    }
    case "sessions.files.revertPlan":
    case "sessions.files.revert": {
      const sessionId = String(request.params.sessionId ?? "");
      const userBlockId = String(request.params.userBlockId ?? "");
      const generation = fileRevertGeneration(request.params.authorityGeneration);
      await dependencies.engine.store.assertAuthority(sessionId, generation);
      if (!(await dependencies.inHost(sessionId)))
        throw new Error("File revert requires a host-executed session");
      const value = await dependencies.engine.store.session(sessionId);
      if (value.status === "running") throw new Error("Stop the session before reverting files");
      if (!value.session.blocks.some((block) => block.id === userBlockId && block.role === "user"))
        throw new Error("User message not found in this session");
      if (request.params.planToken !== undefined && typeof request.params.planToken !== "string")
        throw new Error("Invalid file revert plan token");
      const cwd = sessionWorkCwd(value.session);
      request.result =
        request.input.method === "sessions.files.revertPlan"
          ? await dependencies.engine.checkpoints.filesRevertPlan(
              sessionId,
              cwd,
              userBlockId,
              ...(generation === undefined ? [] : [generation]),
            )
          : await dependencies.engine.checkpoints.filesRevert(
              sessionId,
              cwd,
              userBlockId,
              request.params.planToken as string | undefined,
              ...(generation === undefined ? [] : [generation]),
            );
      break;
    }
    case "sessions.rewind.status": {
      const value = await dependencies.workspaceForOwnerRpc(request.params.workspaceId);
      if (!value || value.owner.kind !== "session" || value.owner.id !== request.params.sessionId)
        throw new Error("Session does not own this workspace");
      const current = await dependencies.engine.store.sessionStateMetadata(value.owner.id);
      request.result = {
        workspace: value,
        ...(current
          ? { conversationRevision: current.revision }
          : { currentConversationUnavailable: true }),
        operations: (await dependencies.managedWorkspaces.listOperations(value.id)).filter(
          (operation) => operation.kind === "rewind",
        ),
      };
      break;
    }
    case "sessions.rewind.plan":
    case "sessions.rewind.apply":
    case "sessions.rewind.undo": {
      if (
        request.input.method === "sessions.rewind.plan" &&
        !(await dependencies.managed.exactGitRewind.enabled())
      )
        throw new Error("Exact Git rewind is disabled on this execution host");
      const value = await dependencies.workspaceForOwnerRpc(request.params.workspaceId);
      if (!value || value.owner.kind !== "session" || value.owner.id !== request.params.sessionId)
        throw new Error("Session does not own this workspace");
      const action =
        request.input.method === "sessions.rewind.plan"
          ? "plan"
          : request.input.method === "sessions.rewind.undo"
            ? "undo"
            : "apply";
      const existing =
        action !== "plan" && typeof request.params.idempotencyKey === "string"
          ? await dependencies.managedWorkspaces.findOperation({
              workspaceId: value.id,
              kind: "rewind",
              idempotencyKey: request.params.idempotencyKey,
            })
          : null;
      // A durable historical receipt is an outcome, even if new work
      // is now disabled or its authority floor has advanced.
      if (existing?.kind === "rewind" && existing.phase === "complete" && existing.receipt) {
        request.result = await dependencies.managed.rewind[action as "apply" | "undo"](
          request.params as unknown as WorkspaceRpcRequest<"sessions.rewind.apply">,
        );
        break;
      }
      if (!(await dependencies.managed.exactGitRewind.enabled()))
        throw new Error("Exact Git rewind is disabled on this execution host");
      await dependencies.engine.store.assertAuthority(
        value.owner.id,
        rewindAuthorityGeneration(request.params.authorityGeneration),
      );
      if (!(await dependencies.inHost(value.owner.id)))
        throw new Error(
          "Git rewind requires a host-executed session; native protocol is unavailable",
        );
      request.result =
        action === "plan"
          ? await dependencies.managed.rewind.plan(
              request.params as unknown as WorkspaceRpcRequest<"sessions.rewind.plan">,
            )
          : await dependencies.managed.rewind[action](
              request.params as unknown as WorkspaceRpcRequest<"sessions.rewind.apply">,
            );
      break;
    }
    case "sessions.list":
      request.result = await dependencies.sessionService.list(
        request.params,
        request.domainContext,
      );
      break;
    case "sessions.pin.state":
    case "sessions.pin.apply":
    case "sessions.pin.receipt": {
      const sessionId = String(request.params.sessionId ?? "");
      const projectId = String(request.params.projectId ?? "");
      if (!sessionId || !projectId || sessionId.length > 4096 || projectId.length > 4096)
        throw new Error("Invalid pin scope");
      const operationId = String(request.params.operationId ?? "");
      if (
        request.input.method !== "sessions.pin.state" &&
        (!operationId || operationId.length > 4096)
      )
        throw new Error("Invalid pin operation ID");
      if (request.input.method === "sessions.pin.receipt") {
        request.result = await dependencies.engine.store.pinReceipt(
          sessionId,
          projectId,
          operationId,
        );
        break;
      }
      const authorityGeneration =
        request.params.authorityGeneration === undefined
          ? undefined
          : SafeCounterSchema.min(1).parse(request.params.authorityGeneration);
      await dependencies.engine.store.assertAuthority(sessionId, authorityGeneration);
      if (request.input.method === "sessions.pin.state") {
        request.result = await dependencies.engine.store.pinState(
          sessionId,
          projectId,
          authorityGeneration,
        );
      } else {
        if (authorityGeneration === undefined) await dependencies.adopt(sessionId);
        if (typeof request.params.desiredPinned !== "boolean") throw new Error("Invalid pin value");
        const expectedVersion = SafeCounterSchema.parse(request.params.expectedVersion);
        request.result = await dependencies.engine.store.pinApply(
          sessionId,
          projectId,
          operationId,
          request.params.desiredPinned,
          expectedVersion,
          authorityGeneration,
        );
      }
      break;
    }
    case "sessions.update": {
      const sessionId = String(request.params.sessionId ?? "");
      if (request.params.archived === true)
        await assertNotCrewManaged(dependencies.engine.store, sessionId);
      const authorityGeneration =
        request.params.authorityGeneration === undefined
          ? undefined
          : SafeCounterSchema.min(1).parse(request.params.authorityGeneration);
      await dependencies.engine.store.assertAuthority(sessionId, authorityGeneration);
      if (authorityGeneration === undefined) await dependencies.adopt(sessionId);
      const current = await dependencies.engine.store.session(sessionId);
      if (current.projectId !== request.params.projectId)
        throw new Error("Session does not belong to this project");
      const patch: {
        title?: string;
        archived?: boolean;
        pinned?: boolean;
        linkedWorkItem?: LinkedWorkItem | null;
      } = {};
      if (request.params.title !== undefined) {
        if (typeof request.params.title !== "string") throw new Error("Invalid session title");
        patch.title = request.params.title;
      }
      if (request.params.archived !== undefined) {
        if (typeof request.params.archived !== "boolean") throw new Error("Invalid archive value");
        patch.archived = request.params.archived;
      }
      if (request.params.pinned !== undefined) {
        if (typeof request.params.pinned !== "boolean") throw new Error("Invalid pin value");
        patch.pinned = request.params.pinned;
      }
      if (request.params.linkedWorkItem !== undefined) {
        const item = request.params.linkedWorkItem;
        const parsed =
          item && typeof item === "object" && !Array.isArray(item)
            ? parseGithubWorkItemUrl(String((item as LinkedWorkItem).url ?? ""))
            : null;
        if (
          item !== null &&
          (typeof item !== "object" ||
            Array.isArray(item) ||
            !parsed ||
            parsed.kind !== (item as LinkedWorkItem).kind ||
            parsed.repo !== (item as LinkedWorkItem).repo ||
            parsed.number !== (item as LinkedWorkItem).number ||
            parsed.url !== (item as LinkedWorkItem).url)
        )
          throw new Error("Invalid linked work item");
        patch.linkedWorkItem = item as LinkedWorkItem | null;
      }
      if (Object.keys(patch).length === 0) throw new Error("No session changes supplied");
      request.result = await dependencies.engine.updateSession(
        sessionId,
        patch,
        authorityGeneration,
      );
      if (patch.archived === true)
        await recordRemoteActivity(dependencies, request, "archived", {
          projectId: current.projectId,
        });
      break;
    }
    case "sessions.delete": {
      const sessionId = String(request.params.sessionId ?? "");
      await assertNotCrewManaged(dependencies.engine.store, sessionId);
      const requestedGeneration =
        request.params.authorityGeneration === undefined
          ? undefined
          : SafeCounterSchema.min(1).parse(request.params.authorityGeneration);
      let authorityGeneration = requestedGeneration;
      try {
        await dependencies.engine.store.assertAuthority(sessionId, authorityGeneration);
      } catch (error) {
        if (!(error instanceof HostAuthorityFenceError)) throw error;
        // A stale client generation must not make a session undeletable.
        console.warn("Ignoring stale authority generation on session delete.");
        authorityGeneration = await dependencies.engine.store.currentAuthorityGeneration(sessionId);
      }
      const host = await dependencies.engine.store.sessionAuthority(sessionId);
      const workspaceId = host
        ? (await dependencies.engine.store.session(sessionId)).session.workspaceId
        : (await dependencies.managed.list()).find(
            (value) => value.owner.kind === "session" && value.owner.id === sessionId,
          )?.id;
      const managedSession = workspaceId ? await dependencies.managed.get(workspaceId) : undefined;
      if (managedSession) {
        await dependencies.managed.assertWritable(managedSession.id);
      }
      let release: (() => Promise<void>) | undefined;
      if (managedSession?.directoryState === "present") {
        try {
          release = await dependencies.startWorkspaceActivity(
            managedSession.path,
            "mutation",
            "session-delete",
          );
        } catch (error) {
          console.warn("Session delete proceeds without a workspace activity:", error);
        }
      }
      let admittedHost: boolean | undefined;
      let admittedDesktopCwd: string | undefined;
      let admittedWorkspaceId: string | undefined;
      let admittedGeneration: number | undefined;
      let deletionIdentityCaptured = false;
      const admittedDelete = async () => {
        if (!(await dependencies.engine.store.authenticated(request.token)))
          throw new Error("Authentication expired");
        const hostPresent = await dependencies.inHost(sessionId);
        const currentGeneration =
          await dependencies.engine.store.currentAuthorityGeneration(sessionId);
        if (deletionIdentityCaptured && currentGeneration !== admittedGeneration)
          throw new Error("Session authority changed; refresh before deleting");
        if (!deletionIdentityCaptured) {
          admittedGeneration = currentGeneration;
          if (authorityGeneration === undefined) authorityGeneration = currentGeneration;
        }
        if (hostPresent) {
          await dependencies.engine.store.assertAuthority(sessionId, authorityGeneration);
          const current = await dependencies.engine.store.session(sessionId);
          if (current.projectId !== request.params.projectId)
            throw new Error("Session does not belong to this project");
          if (deletionIdentityCaptured && current.session.workspaceId !== admittedWorkspaceId)
            throw new Error("Session workspace changed; refresh before deleting");
          admittedWorkspaceId = current.session.workspaceId;
        }
        const currentCwd = (await dependencies.desktop.projectCwdAsync(sessionId)) ?? undefined;
        if (
          deletionIdentityCaptured &&
          (admittedHost !== hostPresent ||
            !!admittedDesktopCwd !== !!currentCwd ||
            (admittedDesktopCwd &&
              currentCwd &&
              !dependencies.desktop.samePath(admittedDesktopCwd, currentCwd)))
        )
          throw new Error("Session identity changed; refresh before deleting");
        admittedHost = hostPresent;
        admittedDesktopCwd = currentCwd;
        deletionIdentityCaptured = true;
        if (currentCwd) {
          const project = (await dependencies.engine.store.projects()).find((p) =>
            dependencies.desktop.samePath(p.cwd, currentCwd),
          );
          if (!project || project.id !== request.params.projectId)
            throw new Error("Session does not belong to this project");
          if ((await dependencies.desktop.stampAsync(sessionId))?.running)
            throw new Error("Stop this session before deleting it");
        } else if (!hostPresent) throw new Error("Session not found on this machine");
        if (managedSession) await dependencies.managed.assertWritable(managedSession.id);
      };
      try {
        request.result = await dependencies.engine.withRetiredProviderWriterForDeletion(
          sessionId,
          async () => {
            const cwd = await dependencies.desktop.projectCwdAsync(sessionId);
            if (cwd) {
              const project = (await dependencies.engine.store.projects()).find((p) =>
                dependencies.desktop.samePath(p.cwd, cwd),
              );
              if (!project || project.id !== request.params.projectId)
                throw new Error("Session does not belong to this project");
              if (
                (await dependencies.inHost(sessionId)) &&
                (await dependencies.engine.store.session(sessionId)).projectId !== project.id
              )
                throw new Error("Session does not belong to this project");
              if (
                (await dependencies.desktop.stampAsync(sessionId))?.running ||
                // A stored "running" with no live Host run is stale, not a blocker.
                (dependencies.engine.hasActiveRun(sessionId) &&
                  (await dependencies.engine.store.sessionStateMetadata(sessionId))?.status ===
                    "running")
              )
                throw new Error("Stop this session before deleting it");
              await admittedDelete();
              await dependencies.desktopDelete.request(
                sessionId,
                cwd,
                async () => await dependencies.engine.store.authenticated(request.token),
                await requestingDeviceName(dependencies.engine.store, request.token),
              );
              if (await dependencies.desktop.projectCwdAsync(sessionId))
                throw new Error(
                  "The desktop did not remove this conversation. Refresh the list before retrying.",
                );
              // An adopted transcript must go too, or it would reappear in the list.
              if (!(await dependencies.engine.store.authenticated(request.token)))
                throw new Error("Authentication expired");
              if (
                (await dependencies.engine.store.currentAuthorityGeneration(sessionId)) !==
                admittedGeneration
              )
                throw new Error("Session authority changed; refresh before deleting");
              let historyCwd = cwd;
              if (await dependencies.inHost(sessionId)) {
                await dependencies.engine.store.assertAuthority(sessionId, authorityGeneration);
                const current = await dependencies.engine.store.session(sessionId);
                historyCwd = current.session.cwd || cwd;
                if (current.projectId !== project.id)
                  throw new Error("Session does not belong to this project");
                await dependencies.engine.store.deleteSession(sessionId, authorityGeneration, {
                  staleRunning: !dependencies.engine.hasActiveRun(sessionId),
                });
              }
              dependencies.invalidateSessionCopies(sessionId, project.id);
              await dependencies.sessionQueues.delete(sessionId);
              await dependencies.handoffHistory
                .retireSession(sessionId)
                .catch((error) => console.warn("Deleted session handoff history retained:", error));
              await dependencies.engine.checkpoints
                .retireDeletedSessionHistory(sessionId, historyCwd)
                .then((result) => {
                  if (result.retainedUnknown)
                    console.warn(
                      "Deleted session legacy or unreferenced file history retained; ownership is not proven.",
                    );
                })
                .catch((error) => console.warn("Deleted session file history retained:", error));
              return { deleted: true };
            }
            const current = await dependencies.engine.store.session(sessionId);
            if (current.projectId !== request.params.projectId)
              throw new Error("Session does not belong to this project");
            await admittedDelete();
            await dependencies.engine.store.deleteSession(sessionId, authorityGeneration, {
              staleRunning: !dependencies.engine.hasActiveRun(sessionId),
            });
            dependencies.invalidateSessionCopies(sessionId, current.projectId);
            await dependencies.sessionQueues.delete(sessionId);
            await dependencies.handoffHistory
              .retireSession(sessionId)
              .catch((error) => console.warn("Deleted session handoff history retained:", error));
            await dependencies.engine.checkpoints
              .retireDeletedSessionHistory(sessionId, current.session.cwd)
              .then((result) => {
                if (result.retainedUnknown)
                  console.warn(
                    "Deleted session legacy or unreferenced file history retained; ownership is not proven.",
                  );
              })
              .catch((error) => console.warn("Deleted session file history retained:", error));
            return { deleted: true };
          },
          admittedDelete,
        );
        break;
      } finally {
        await release?.();
      }
    }
    case "sessions.page":
      request.result = await dependencies.sessionService.page(
        request.params,
        request.domainContext,
      );
      break;
    case "sessions.sync":
      request.result = await dependencies.sessionService.sync(
        request.params,
        request.domainContext,
      );
      break;
    case "commands.status":
      request.result = await dependencies.commandService.status(
        request.params,
        request.domainContext,
      );
      break;
    case "sessions.desktopLive": {
      const beat = dependencies.desktop.live.beat(request.params);
      ownerVoiceActivity.record(request.params.voiceActiveAgeMs);
      dependencies.pushNotifications.desktopPresence(
        String(request.params.clientId ?? "legacy"),
        request.params.userActive === true,
      );
      // Sequential: an acknowledged command can change the turn the run leases read.
      const durableCommands = await measure("desktopLive.poll", () =>
        dependencies.withinBeat(
          () =>
            dependencies.desktopCommandDelivery.poll(request.params, () =>
              assertDomainAuthority(request.domainContext),
            ),
          [],
        ),
      );
      // Renew the reported epoch before queued busy bookkeeping can implicitly
      // reacquire an expired lease with a new epoch (a false "lost" answer).
      const renewedRunLeases = await measure("desktopLive.runLeases", () =>
        dependencies.renewRunLeases(request.params),
      );
      await measure("desktopLive.effects", () =>
        dependencies.withinBeat(() => dependencies.heartbeatEffects, undefined),
      );
      // These four touch separate state (deletion replies, provider inbox, adopted
      // rows, drain leases) and none reads another's writes from this beat, so they
      // wait on the store together. Each keeps its own bounded wait and fallback.
      const [deletions, inbox, adopted, queueLeases] = await Promise.all([
        measure("desktopLive.deletions", () =>
          dependencies.withinBeat(
            () =>
              dependencies.desktopDelete.beat(
                `${request.tokenHash}:${String(request.params.clientId ?? "")}`,
                request.params.deletions,
              ),
            { jobs: [], acked: [] },
          ),
        ),
        measure("desktopLive.inbox", () =>
          dependencies.withinBeat(
            () =>
              dependencies.providerInbox.beat(
                request.tokenHash,
                request.params.clientId,
                request.params.inbox,
              ),
            { jobs: [], acked: [] },
          ),
        ),
        measure("desktopLive.adopted", () =>
          dependencies.withinBeat(
            () => dependencies.adoptedChanges.changesSince(request.params.adoptedSeq),
            undefined,
          ),
        ),
        // The drain leases a desktop holds: `null` is one it no longer holds, and the
        // host drains that queue itself.
        measure("desktopLive.queueLeases", () =>
          dependencies.withinBeat(() => dependencies.renewQueueLeases(request.params), undefined),
        ),
      ]);
      request.result = {
        ...beat,
        commands: [...beat.commands, ...durableCommands],
        deletions,
        inbox,
        notesRevision: dependencies.hostNotes.revision,
        // Lets the desktop re-read only the shared queues another computer
        // changed, instead of polling every idle one on a timer.
        queues: dependencies.sessionQueues.changesSince(request.params.queueSeq),
        // Likewise the adopted conversations whose host copy moved, so the
        // desktop mirrors them at once instead of polling `sessions.adopted`.
        adopted,
        queueLeases,
        // And its run leases: `null` is a conversation it must stop writing to.
        runLeases: renewedRunLeases,
        // Changes another device made that the desktop shows a notice for.
        activity: dependencies.remoteActivity.since(request.params.activitySeq),
        // Kinds this Host pushes itself; the desktop skips reporting them to the account.
        hostPush: await dependencies.pushNotifications.ownedEvents().catch(() => undefined),
      };
      break;
    }
    case "sessions.adopted":
      request.result = await dependencies.engine.store.adopted();
      break;
    case "sessions.runLease": {
      // A desktop window takes the conversation's run lease just before it
      // starts a turn, and gives it back when the turn ends.
      const id = String(request.params.sessionId ?? "");
      const holder = request.params.clientId;
      if (
        !id ||
        id.length > 200 ||
        typeof holder !== "string" ||
        !holder.startsWith("desktop:") ||
        holder.length > 200
      )
        throw new Error("Invalid run lease request");
      if (request.params.action === "release") {
        const released = dependencies.runLeases.release(
          id,
          holder,
          Number.isSafeInteger(request.params.epoch) ? Number(request.params.epoch) : undefined,
        );
        if (released) dependencies.queueDrainer.kickWaiting();
        request.result = { released };
        break;
      }
      if (request.params.action !== "acquire") throw new Error("Invalid run lease request");
      // The same existence check as the queue calls. A conversation the host
      // already stores is known by one indexed read; only a desktop-only one
      // needs the desktop database, whose notes worker may be busy for long.
      await dependencies.queueSessionKnown(id);
      request.result = await dependencies.engine.withRetiredProviderWriter(id, () =>
        dependencies.engine.store.db.scope(async () => {
          if (!(await dependencies.engine.store.authenticated(request.token)))
            throw new Error("Owner authority revoked; your message was not sent.");
          const hostRunning =
            dependencies.writerTransfers.has(id) || (await dependencies.hostRuns(id));
          return {
            lease: dependencies.runLeases.acquire(id, holder, () => {
              // The host's own turn, or another window's, keeps it from being granted.
              if (hostRunning) return "host";
              const busy = dependencies.desktop.live.busyClient(id);
              return busy && `desktop:${busy}` !== holder ? `desktop:${busy}` : undefined;
            }),
          };
        }),
      );
      break;
    }
    case "sessions.queue.get":
    case "sessions.queue.change":
    case "sessions.queue.claim":
    case "sessions.queue.finish":
    case "sessions.queue.release":
    case "sessions.queue.lease": {
      const action = request.input.method.slice("sessions.queue.".length) as SessionQueueAction;
      request.result = await dependencies.sessionQueueService[action](
        request.params,
        {
          ...request.domainContext,
          exposeAttachments: (ids, exposureParams) =>
            dependencies.attachmentOwnership.expose(request.token, ids, exposureParams),
        },
        { legacy: true },
      );
      break;
    }
    case "sessions.syncChunk":
      request.result = await dependencies.sessionService.syncChunk(
        request.params,
        request.domainContext,
      );
      break;
    case "sessions.block":
      request.result = await dependencies.sessionService.block(
        request.params,
        request.domainContext,
      );
      break;
    case "sessions.get":
      request.result = await dependencies.sessionService.get(request.params, request.domainContext);
      break;
    case "sessions.workedTime":
      request.result = await dependencies.sessionService.workedTime(
        request.params,
        request.domainContext,
      );
      break;
    case "sessions.contextual.preview": {
      request.result = await dependencies.engine.previewContextual(
        request.params,
        await dependencies.readSessionView(String(request.params.sessionId ?? "")),
      );
      break;
    }
    case "commands.dispatch":
      request.result = await dependencies.commandService.dispatch(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;
    case "sync.pull": {
      const sinceRev = Number.isSafeInteger(request.params.sinceRev)
        ? Number(request.params.sinceRev)
        : 0;
      request.result = await syncPull(
        dependencies.engine.store.db,
        sinceRev,
        request.params.paginated === true
          ? {
              untilRev:
                Number.isSafeInteger(request.params.untilRev) &&
                Number(request.params.untilRev) >= sinceRev
                  ? Number(request.params.untilRev)
                  : undefined,
            }
          : undefined,
      );
      break;
    }
    case "sync.push": {
      if (!Array.isArray(request.params.ops)) throw new Error("Invalid sync ops");
      request.result = await dependencies.engine.store.transaction(
        async () => await syncPush(dependencies.engine.store.db, request.params.ops as SyncOp[]),
        "checkpoint",
      );
      break;
    }
    case "usage.sessions.read":
      request.result = await readSessionUsage(dependencies.engine.store, request.params);
      break;
    case "attachments.claim":
      await dependencies.attachmentOwnership.claim(request.token, request.params);
      request.result = { claimed: true };
      break;
    case "attachments.release":
      await dependencies.attachmentOwnership.release(request.token, request.params);
      request.result = { released: true };
      break;
    case "attachments.claims":
      request.result = await dependencies.attachmentOwnership.claims(request.token, request.params);
      break;
    case "attachments.status": {
      const status = await attachmentUploadStatus(
        dependencies.engine.store,
        request.params,
        async () => {
          await dependencies.bindQuestionUpload(request.tokenHash, request.params);
          await dependencies.attachmentOwnership.touch(request.token, request.params);
        },
      );
      await dependencies.attachmentOwnership.uploaded(request.params, status.offset);
      request.result = status;
      break;
    }
    case "attachments.upload": {
      const uploaded = await writeAttachmentChunk(
        dependencies.engine.store,
        request.params,
        async () => {
          await dependencies.bindQuestionUpload(request.tokenHash, request.params);
          await dependencies.attachmentOwnership.touch(request.token, request.params);
        },
      );
      await dependencies.attachmentOwnership.uploaded(request.params, uploaded.offset);
      request.result = uploaded;
      break;
    }
    case "attachments.read":
      request.result = await readAttachmentChunk(dependencies.engine.store, request.params);
      break;
    case "events.read": {
      if (!Number.isSafeInteger(request.params.after) || Number(request.params.after) < 0)
        throw new Error("Invalid event cursor");
      request.result = await dependencies.engine.store.events(
        String(request.params.sessionId ?? ""),
        Number(request.params.after),
      );
      break;
    }
    case "history.import.preview":
    case "history.import.commit":
    case "history.import.status":
    case "history.import.cancel": {
      const mode = request.input.method.slice("history.import.".length);
      const action = mode === "preview" ? "discover" : mode;
      request.result = await dependencies.scopedDesktopCall(
        request.token,
        `historyImport.${action}`,
        request.params,
        mode === "commit"
          ? ["reviewId", "digest", "candidateIds", "operationId"]
          : mode === "preview"
            ? []
            : ["operationId"],
      );
      break;
    }
  }
}
