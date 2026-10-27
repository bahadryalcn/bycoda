import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { withHostGitMutation } from "./git-mutations";
import { nativeProcessPrefix, nativeTurnOwner } from "./native-activity-identity";
import { durableWrite, GitTurnHistory, refComponent } from "./turn-git-history";
import type { ManagedWorkspace, TurnGitRecord, WorkspaceActivity } from "./workspace-contracts";
import type {
  ExecutionActivityReservations,
  WorkspaceOwnerAuthorization,
} from "./workspace-service-contracts";

export interface ManagedNativeTurnRequest {
  workspaceId: string;
  sessionId: string;
  userBlockId: string;
  runId: string;
  /** Authenticated window context; native persistence keeps its original identity. */
  clientId?: string;
}
export interface ManagedNativeTurnBeginRequest extends ManagedNativeTurnRequest {
  conversationRevision: number;
}
interface NativeTurnBinding extends ManagedNativeTurnBeginRequest {
  ownerFingerprint: string;
  activityOwnerId: string;
  /** Exact admitted provider lease; older/pidless bindings remain fenced. */
  processActivityOwnerId?: string;
  /** Durable cancellation receipt: execution can never start for this key. */
  released?: boolean;
}

/** Trusted owner/native capture bridge only. This does not implement native
 * conversation rescue/restore and does not authorize native Git rewind. */
export function createManagedNativeTurns(deps: {
  workspace(workspaceId: string): Promise<ManagedWorkspace>;
  history: GitTurnHistory;
  activity: ExecutionActivityReservations;
  assertWritable(workspaceId: string): Promise<void>;
  authorize(owner: WorkspaceOwnerAuthorization): Promise<boolean>;
  reconcileProcess?(
    request: ManagedNativeTurnRequest & { activityOwnerId: string },
    owner: WorkspaceOwnerAuthorization,
  ): Promise<boolean>;
}) {
  // Transport identities may be credential-derived. Persist only a one-way binding.
  const ownerFingerprint = (owner: WorkspaceOwnerAuthorization) =>
    createHash("sha256").update(owner.ownerId).digest("hex");
  const bindingPath = (request: ManagedNativeTurnRequest) =>
    join(
      deps.history.options.root,
      "native-turns",
      refComponent(request.workspaceId),
      `${refComponent(request.userBlockId)}.json`,
    );
  const readBinding = async (
    request: ManagedNativeTurnRequest,
  ): Promise<NativeTurnBinding | null> => {
    try {
      return JSON.parse(await readFile(bindingPath(request), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  const validate = async (
    request: ManagedNativeTurnRequest,
    owner: WorkspaceOwnerAuthorization,
  ) => {
    if (!owner?.ownerId || !owner.authorizationId || !(await deps.authorize(owner)))
      throw new Error("Managed native turns require authenticated owner authorization");
    for (const value of [
      request.workspaceId,
      request.sessionId,
      request.userBlockId,
      request.runId,
    ])
      if (typeof value !== "string" || !value.trim() || value.length > 256)
        throw new Error("Invalid managed native turn identity");
    if (
      request.clientId !== undefined &&
      (typeof request.clientId !== "string" ||
        !request.clientId.trim() ||
        request.clientId.length > 256 ||
        request.clientId.includes("\0"))
    )
      throw new Error("Invalid native desktop client identity");
    const workspace = await deps.workspace(request.workspaceId);
    if (
      workspace.id !== request.workspaceId ||
      workspace.owner.kind !== "session" ||
      workspace.owner.id !== request.sessionId ||
      workspace.directoryState !== "present"
    )
      throw new Error("Session does not own this managed workspace");
    return workspace;
  };
  const checkBinding = (
    binding: NativeTurnBinding,
    request: ManagedNativeTurnRequest,
    owner: WorkspaceOwnerAuthorization,
    revision?: number,
  ) => {
    if (binding.ownerFingerprint !== ownerFingerprint(owner))
      throw new Error("Native turn belongs to another owner device");
    for (const key of ["workspaceId", "sessionId", "userBlockId", "runId"] as const)
      if (binding[key] !== request[key]) throw new Error("Native turn identity changed");
    if (revision !== undefined && binding.conversationRevision !== revision)
      throw new Error("Native turn conversation revision changed");
  };
  const checkRecord = (record: TurnGitRecord | null, request: ManagedNativeTurnRequest) => {
    if (
      record &&
      (record.workspaceId !== request.workspaceId ||
        record.sessionId !== request.sessionId ||
        record.userBlockId !== request.userBlockId ||
        record.runId !== request.runId)
    )
      throw new Error("Accepted native turn identity changed");
  };
  const activities = async (
    request: ManagedNativeTurnRequest,
    binding: NativeTurnBinding,
    owner: WorkspaceOwnerAuthorization,
    completed = false,
    admitProviderProcess = false,
  ) => {
    const all = await deps.activity.list(request.workspaceId);
    const owned = all.filter(
      (entry) => entry.kind === "provider" && entry.ownerId === binding.activityOwnerId,
    );
    if (owned.length > 1) throw new Error("Duplicate native turn activity requires reconciliation");
    const processes = all.filter(
      (entry) =>
        entry.kind === "provider" &&
        entry.ownerId.startsWith(
          nativeProcessPrefix(owner.ownerId, request.sessionId, request.clientId),
        ),
    );
    // Provider preflight precedes turn capture. Two processes are ambiguous even
    // when both were registered by this device for the same session.
    if (!completed && processes.length > 1)
      throw new Error("Multiple native provider processes require reconciliation");
    if (
      !completed &&
      all.some(
        (entry) =>
          entry.kind !== "readLease" &&
          ![...owned, ...(admitProviderProcess ? processes : [])].some(
            (own) => own.id === entry.id,
          ),
      )
    )
      throw new Error("Another workspace writer or unknown activity is still active");
    return owned[0] ?? null;
  };
  const completeCapturedTurn = async (
    request: ManagedNativeTurnRequest,
    owner: WorkspaceOwnerAuthorization,
  ): Promise<TurnGitRecord> => {
    await deps.assertWritable(request.workspaceId);
    const binding = await readBinding(request);
    if (!binding) throw new Error("Unknown accepted native turn");
    checkBinding(binding, request, owner);
    if (binding.clientId !== request.clientId)
      throw new Error("Native turn belongs to another desktop client");
    const previous = await deps.history.get(request.workspaceId, request.userBlockId);
    checkRecord(previous, request);
    if (previous?.before.status !== "complete")
      throw new Error("Native turn has no complete before capture");
    const activity = await activities(
      request,
      binding,
      owner,
      previous.after?.status === "complete",
    );
    if (!activity && previous.after?.status !== "complete")
      throw new Error("Native turn activity is missing; reconcile before capturing its end");
    const record =
      previous.after?.status === "complete" ? previous : await deps.history.end(request);
    if (record.after?.status !== "complete")
      throw new Error(record.after?.reason ?? "Native turn after capture is incomplete");
    if (activity) await deps.activity.stop(activity.id);
    return record;
  };
  return {
    async begin(
      request: ManagedNativeTurnBeginRequest,
      owner: WorkspaceOwnerAuthorization,
    ): Promise<TurnGitRecord> {
      const workspace = await validate(request, owner);
      if (!Number.isSafeInteger(request.conversationRevision) || request.conversationRevision < 0)
        throw new Error("Invalid native turn conversation revision");
      return withHostGitMutation(workspace.path, async () => {
        await validate(request, owner);
        await deps.assertWritable(request.workspaceId);
        let binding = await readBinding(request);
        let record = await deps.history.get(request.workspaceId, request.userBlockId);
        checkRecord(record, request);
        if (binding) {
          checkBinding(binding, request, owner, request.conversationRevision);
          if (binding.clientId !== request.clientId)
            throw new Error("Native turn belongs to another desktop client");
          if (binding.released) throw new Error("Native turn was released before execution");
        } else {
          if (record) throw new Error("Existing Git turn has no native owner binding");
          binding = {
            ...request,
            ownerFingerprint: ownerFingerprint(owner),
            activityOwnerId: nativeTurnOwner(owner.ownerId, request),
          };
          // Bind the accepted boundary before installing activity/capturing Git.
          // Retries retain device identity even if the host dies before acknowledgement.
          await durableWrite(bindingPath(request), JSON.stringify(binding));
        }
        let activity: WorkspaceActivity | null = null;
        try {
          activity = await activities(
            request,
            binding,
            owner,
            record?.after?.status === "complete",
            true,
          );
          if (record?.after?.status === "complete") {
            if (activity) await deps.activity.stop(activity.id);
            return record;
          }
          if (!activity)
            activity = await deps.activity.start({
              workspaceId: request.workspaceId,
              kind: "provider",
              ownerId: binding.activityOwnerId,
            });
          // Admission can await durable storage. Recheck writers that appeared
          // while installing this marker before authorizing native execution.
          await activities(request, binding, owner, false, true);
          const processes = (await deps.activity.list(request.workspaceId)).filter(
            (entry) =>
              entry.kind === "provider" &&
              entry.ownerId.startsWith(
                nativeProcessPrefix(owner.ownerId, request.sessionId, request.clientId),
              ),
          );
          if (processes.length === 1 && !binding.processActivityOwnerId) {
            binding.processActivityOwnerId = processes[0].ownerId;
            await durableWrite(bindingPath(request), JSON.stringify(binding));
          }
          record = await deps.history.begin(request);
          if (record.before.status !== "complete") throw new Error(record.before.reason);
          return record;
        } catch (error) {
          // Re-read the durable outcome: a complete capture may already have
          // authorized execution even if an awaited assignment was interrupted.
          const captured = await deps.history.get(request.workspaceId, request.userBlockId);
          checkRecord(captured, request);
          if (captured?.before.status !== "complete") {
            const markers = (await deps.activity.list(request.workspaceId)).filter(
              (entry) => entry.kind === "provider" && entry.ownerId === binding.activityOwnerId,
            );
            for (const marker of markers) await deps.activity.stop(marker.id);
            // Definitive preauthorization rejection, including foreign writers.
            // Keep a tombstone so delayed retries can never authorize this key.
            binding.released = true;
            await durableWrite(bindingPath(request), JSON.stringify(binding));
          }
          throw error;
        }
      });
    },
    async end(
      request: ManagedNativeTurnRequest,
      owner: WorkspaceOwnerAuthorization,
    ): Promise<TurnGitRecord> {
      const workspace = await validate(request, owner);
      return withHostGitMutation(workspace.path, async () => {
        await validate(request, owner);
        return completeCapturedTurn(request, owner);
      });
    },
    async recover(
      request: ManagedNativeTurnBeginRequest,
      owner: WorkspaceOwnerAuthorization,
    ): Promise<
      ManagedNativeTurnBeginRequest & {
        released: boolean;
        reason?: string;
        completed?: boolean;
        record?: TurnGitRecord;
      }
    > {
      const workspace = await validate(request, owner);
      if (!Number.isSafeInteger(request.conversationRevision) || request.conversationRevision < 0)
        throw new Error("Invalid native turn conversation revision");
      return withHostGitMutation(workspace.path, async () => {
        await validate(request, owner);
        let binding = await readBinding(request);
        const record = await deps.history.get(request.workspaceId, request.userBlockId);
        checkRecord(record, request);
        if (binding) checkBinding(binding, request, owner, request.conversationRevision);
        else if (record) throw new Error("Existing Git turn has no native owner binding");
        if (record?.before.status === "complete") {
          if (
            binding?.clientId === request.clientId &&
            (record.after?.status === "complete" ||
              (binding?.processActivityOwnerId &&
                deps.reconcileProcess &&
                (await deps.reconcileProcess(
                  { ...request, activityOwnerId: binding.processActivityOwnerId },
                  owner,
                ))))
          ) {
            const completed = await completeCapturedTurn(request, owner);
            return { ...request, released: true, completed: true, record: completed };
          }
          return {
            ...request,
            released: false,
            reason: "Native turn has a complete before capture; execution may have started",
          };
        }
        // A rejected begin or prior recovery already durably forbids this key.
        if (binding?.released) return { ...request, released: true };
        if (
          (await deps.activity.list(request.workspaceId)).some(
            (entry) => entry.kind !== "readLease",
          )
        )
          return {
            ...request,
            released: false,
            reason: "Workspace activity is still active or unknown",
          };
        binding ??= {
          ...request,
          ownerFingerprint: ownerFingerprint(owner),
          activityOwnerId: nativeTurnOwner(owner.ownerId, request),
        };
        binding.released = true;
        await durableWrite(bindingPath(request), JSON.stringify(binding));
        return { ...request, released: true };
      });
    },
    async status(
      request: ManagedNativeTurnRequest,
      owner: WorkspaceOwnerAuthorization,
    ): Promise<{
      record: TurnGitRecord | null;
      activity: WorkspaceActivity | null;
    }> {
      const workspace = await validate(request, owner);
      return withHostGitMutation(workspace.path, async () => {
        await validate(request, owner);
        const binding = await readBinding(request);
        const record = await deps.history.get(request.workspaceId, request.userBlockId);
        checkRecord(record, request);
        if (!binding) {
          if (record) throw new Error("Existing Git turn has no native owner binding");
          return { record: null, activity: null };
        }
        checkBinding(binding, request, owner);
        const owned = (await deps.activity.list(request.workspaceId)).filter(
          (entry) => entry.kind === "provider" && entry.ownerId === binding.activityOwnerId,
        );
        if (owned.length > 1)
          throw new Error("Duplicate native turn activity requires reconciliation");
        return { record, activity: owned[0] ?? null };
      });
    },
  };
}
