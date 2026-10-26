import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { durableWrite, refComponent } from "./turn-git-history";
import {
  GitSessionRewindService,
  type ConversationRewindAdapter,
  type DurableRewindOperation,
  type GitSessionRewindOptions,
} from "./session-rewind";
import type { WorkspaceOwnerAuthorization } from "./workspace-service-contracts";
import type { WorkspaceRpcRequest } from "./workspace-rpc-contracts";

type Boundary = { revision: number; userBlockIds: string[] };
type Mutation = WorkspaceRpcRequest<"sessions.rewind.apply">;
type Direction = "rewind" | "undo";
type Binding = { owner: string; workspaceId: string; sessionId: string; conversation: Boundary };
type NativeOperation = {
  transcriptRescueId?: string;
  receipt?: { revision: number };
  conversation?: Boundary;
};
type PreparationKey = { workspaceId: string; sessionId: string; idempotencyKey: string };
type CancelledPreparation = PreparationKey & { owner: string };
class AwaitNativeReceipt extends Error {}
const fingerprint = (owner: WorkspaceOwnerAuthorization) =>
  createHash("sha256").update(owner.ownerId).digest("hex");

/** Native SQLite owns transcripts. Durable pauses keep the shared Git journal and
 * reservation fenced until the same device supplies its rescue and receipt. */
export function createManagedNativeRewind(
  options: Omit<GitSessionRewindOptions, "conversation"> & {
    conversation: ConversationRewindAdapter;
    authorize(owner: WorkspaceOwnerAuthorization): Promise<boolean>;
    isHostSession(sessionId: string): Promise<boolean>;
    afterReceiptSaved?(): Promise<void>;
  },
) {
  const directory = join(options.root, "native-conversations");
  const sessionPath = (id: string) => join(directory, `session-${refComponent(id)}.json`);
  const operationPath = (id: string) => join(directory, `operation-${refComponent(id)}.json`);
  const cancellationPath = (key: PreparationKey) =>
    join(
      directory,
      `cancelled-${createHash("sha256")
        .update(JSON.stringify([key.workspaceId, key.idempotencyKey]))
        .digest("hex")}.json`,
    );
  const read = async <T>(path: string): Promise<T | null> => {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  const binding = (id: string) => read<Binding>(sessionPath(id));
  const state = async (id: string) => (await read<NativeOperation>(operationPath(id))) ?? {};
  const operation = async (id: string) => {
    const value = await options.registry.getOperation(id);
    if (!value || value.kind !== "rewind" || !(await binding(value.plan.sessionId)))
      throw new Error("Unknown native rewind operation");
    return value as DurableRewindOperation;
  };
  const validateBoundary = (value: Boundary) => {
    if (
      !value ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      !Array.isArray(value.userBlockIds) ||
      value.userBlockIds.length > 100_000 ||
      value.userBlockIds.some(
        (id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id),
      ) ||
      new Set(value.userBlockIds).size !== value.userBlockIds.length
    )
      throw new Error("Invalid native conversation boundary");
  };
  const authorizeSession = async (
    workspaceId: string,
    sessionId: string,
    owner: WorkspaceOwnerAuthorization,
  ) => {
    if (!(await options.authorize(owner))) throw new Error("Authenticated native owner required");
    const workspace = await options.history.workspace(workspaceId);
    if (
      workspace.owner.kind !== "session" ||
      workspace.owner.id !== sessionId ||
      (await options.isHostSession(sessionId))
    )
      throw new Error("Native transcript does not own this workspace");
    const current = await binding(sessionId);
    if (current && (current.owner !== fingerprint(owner) || current.workspaceId !== workspaceId))
      throw new Error("Native conversation belongs to another device or workspace");
    return current;
  };
  const bind = async (
    request: { workspaceId: string; sessionId: string },
    conversation: Boundary,
    owner: WorkspaceOwnerAuthorization,
  ) => {
    validateBoundary(conversation);
    const current = await authorizeSession(request.workspaceId, request.sessionId, owner);
    const pending = (await options.registry.listOperations(request.workspaceId)).some(
      (entry) =>
        entry.kind === "rewind" &&
        (entry.phase !== "complete" || !(entry as DurableRewindOperation).finalized),
    );
    if (
      pending &&
      (!current || JSON.stringify(current.conversation) !== JSON.stringify(conversation))
    )
      throw new Error("Native rewind recovery is pending");
    await durableWrite(
      sessionPath(request.sessionId),
      JSON.stringify({ owner: fingerprint(owner), ...request, conversation } satisfies Binding),
    );
  };
  const adapter: ConversationRewindAdapter = {
    async read(sessionId) {
      const value = await binding(sessionId);
      if (!value) return options.conversation.read(sessionId);
      let conversation = value.conversation;
      for (const entry of await options.registry.listOperations(value.workspaceId)) {
        if (entry.kind !== "rewind" || entry.plan.sessionId !== sessionId) continue;
        const saved = await state(entry.id);
        if (
          saved.conversation &&
          saved.receipt?.revision === saved.conversation.revision &&
          saved.conversation.revision > conversation.revision
        )
          conversation = saved.conversation;
      }
      return conversation;
    },
    async settle(sessionId) {
      if (!(await binding(sessionId))) await options.conversation.settle(sessionId);
      // Shared activity.reserve checks native process and buffer reports.
    },
    withSessionGate: (sessionId, work) => options.conversation.withSessionGate(sessionId, work),
    async rescue(operationId, sessionId, revision) {
      const value = await binding(sessionId);
      if (!value) return options.conversation.rescue(operationId, sessionId, revision);
      if (value.conversation.revision !== revision) throw new Error("Native conversation changed");
      const native = await state(operationId);
      if (!native.transcriptRescueId)
        throw new AwaitNativeReceipt("Awaiting native transcript rescue");
      return native.transcriptRescueId;
    },
    async restore(request) {
      if (!(await binding(request.sessionId))) return options.conversation.restore(request);
      const native = await state(request.operationId);
      if (!native.receipt) throw new AwaitNativeReceipt("Awaiting native transcript receipt");
      return native.receipt;
    },
    async receipt(operationId) {
      const entry = await options.registry.getOperation(operationId);
      if (entry?.kind !== "rewind" || !(await binding(entry.plan.sessionId)))
        return options.conversation.receipt(operationId);
      return (await state(operationId)).receipt ?? null;
    },
    async complete(operationId) {
      const entry = await options.registry.getOperation(operationId);
      if (entry?.kind !== "rewind" || !(await binding(entry.plan.sessionId)))
        await options.conversation.complete?.(operationId);
    },
  };
  const service = new GitSessionRewindService({ ...options, conversation: adapter });
  const ownedOperation = async (id: string, owner: WorkspaceOwnerAuthorization) => {
    const entry = await operation(id);
    await authorizeSession(entry.workspaceId, entry.plan.sessionId, owner);
    return entry;
  };
  const advance = async (id: string) => {
    try {
      await service.recover(id);
    } catch (error) {
      if (!(error instanceof AwaitNativeReceipt)) throw error;
    }
    return operation(id);
  };
  const checkMutation = (
    entry: DurableRewindOperation,
    request: Mutation,
    direction: Direction,
  ) => {
    if (
      entry.workspaceId !== request.workspaceId ||
      entry.plan.sessionId !== request.sessionId ||
      entry.plan.token !== request.planToken ||
      entry.idempotencyKey !== request.idempotencyKey ||
      entry.expectedRevision !== request.expectedRevision ||
      entry.plan.expectedConversationRevision !== request.expectedConversationRevision ||
      entry.plan.direction !== direction
    )
      throw new Error("Native rewind mutation changed");
  };
  const preparedDescriptor = (entry: DurableRewindOperation) => ({
    operationId: entry.id,
    workspaceId: entry.workspaceId,
    sessionId: entry.plan.sessionId,
    direction: entry.plan.direction,
    expectedConversationRevision: entry.plan.expectedConversationRevision,
  });
  const api = {
    service,
    isNativeSession: async (sessionId: string) => !!(await binding(sessionId)),
    /** Read-only discovery after loss of the preparation response. Authentication
     * binds the key to its original native device, workspace and session. */
    async lookup(input: PreparationKey, owner: WorkspaceOwnerAuthorization) {
      refComponent(input.idempotencyKey);
      await authorizeSession(input.workspaceId, input.sessionId, owner);
      const entry = (await options.registry.findOperation({
        workspaceId: input.workspaceId,
        kind: "rewind",
        idempotencyKey: input.idempotencyKey,
      })) as DurableRewindOperation | null;
      if (!entry) return null;
      if (entry.plan.sessionId !== input.sessionId)
        throw new Error("Native rewind session identity changed");
      await ownedOperation(entry.id, owner);
      return preparedDescriptor(entry);
    },
    /** Only an absent operation may be cancelled. Serialize with prepare and
     * retain a durable key tombstone so a delayed request cannot create it later. */
    async cancelPreparation(input: PreparationKey, owner: WorkspaceOwnerAuthorization) {
      refComponent(input.idempotencyKey);
      await authorizeSession(input.workspaceId, input.sessionId, owner);
      const key: PreparationKey = {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
      };
      const entry = (await options.registry.findOperation({
        workspaceId: key.workspaceId,
        kind: "rewind",
        idempotencyKey: key.idempotencyKey,
      })) as DurableRewindOperation | null;
      if (entry) {
        await ownedOperation(entry.id, owner);
        if (entry.plan.sessionId !== key.sessionId)
          throw new Error("Native rewind session identity changed");
        return { ...key, cancelled: false as const, operation: preparedDescriptor(entry) };
      }
      const cancelled: CancelledPreparation = { ...key, owner: fingerprint(owner) };
      const previous = await read<CancelledPreparation>(cancellationPath(key));
      if (previous && JSON.stringify(previous) !== JSON.stringify(cancelled))
        throw new Error("Cancelled native preparation belongs to another device or session");
      if (!previous) await durableWrite(cancellationPath(key), JSON.stringify(cancelled));
      return { ...key, cancelled: true as const };
    },
    async bindTurn(
      request: { workspaceId: string; sessionId: string; conversationRevision: number },
      owner: WorkspaceOwnerAuthorization,
    ) {
      const current = await authorizeSession(request.workspaceId, request.sessionId, owner);
      if (!current)
        await bind(request, { revision: request.conversationRevision, userBlockIds: [] }, owner);
    },
    async plan(
      input: { request: WorkspaceRpcRequest<"sessions.rewind.plan">; conversation: Boundary },
      owner: WorkspaceOwnerAuthorization,
    ) {
      await bind(input.request, input.conversation, owner);
      return service.plan(input.request);
    },
    async prepare(
      input: { request: Mutation; direction: Direction; conversation: Boundary },
      owner: WorkspaceOwnerAuthorization,
    ) {
      if (input.direction !== "rewind" && input.direction !== "undo")
        throw new Error("Invalid rewind direction");
      refComponent(input.request.idempotencyKey);
      await authorizeSession(input.request.workspaceId, input.request.sessionId, owner);
      if (await read<CancelledPreparation>(cancellationPath(input.request)))
        throw new Error("Native rewind preparation was cancelled; preview again with a new key");
      await bind(input.request, input.conversation, owner);
      try {
        await service[input.direction === "undo" ? "undo" : "apply"](input.request);
      } catch (error) {
        if (!(error instanceof AwaitNativeReceipt)) throw error;
      }
      const entry = (await options.registry.findOperation({
        workspaceId: input.request.workspaceId,
        kind: "rewind",
        idempotencyKey: input.request.idempotencyKey,
      })) as DurableRewindOperation | null;
      if (!entry) throw new Error("Native rewind preparation has no journal");
      checkMutation(entry, input.request, input.direction);
      return preparedDescriptor(entry);
    },
    async apply(
      input: {
        operationId: string;
        request: Mutation;
        direction: Direction;
        transcriptRescueId: string;
      },
      owner: WorkspaceOwnerAuthorization,
    ) {
      const entry = await ownedOperation(input.operationId, owner);
      checkMutation(entry, input.request, input.direction);
      refComponent(input.transcriptRescueId);
      const native = await state(entry.id);
      if (native.transcriptRescueId && native.transcriptRescueId !== input.transcriptRescueId)
        throw new Error("Native rescue identity changed");
      await durableWrite(
        operationPath(entry.id),
        JSON.stringify({ ...native, transcriptRescueId: input.transcriptRescueId }),
      );
      const result = await advance(entry.id);
      return { operationId: result.id, phase: result.phase };
    },
    async status(input: { operationId: string }, owner: WorkspaceOwnerAuthorization) {
      let entry = await ownedOperation(input.operationId, owner);
      if (!entry.finalized && (await state(entry.id)).transcriptRescueId)
        entry = await advance(entry.id);
      return {
        operationId: entry.id,
        phase: entry.phase,
        finalized: entry.finalized === true,
        receipt: entry.receipt,
        ...(["git-restored", "conversation-restored", "complete"].includes(entry.phase)
          ? {
              restoreRequest: {
                operationId: entry.id,
                sessionId: entry.plan.sessionId,
                userBlockId: entry.plan.userBlockId,
                direction: entry.plan.direction,
                transcriptRescueId: entry.undoTranscriptRescueId,
                expectedRevision: entry.plan.expectedConversationRevision,
              },
            }
          : {}),
      };
    },
    async ack(
      input: { operationId: string; receipt: { revision: number } },
      owner: WorkspaceOwnerAuthorization,
    ) {
      const entry = await ownedOperation(input.operationId, owner);
      if (!["git-restored", "conversation-restored", "complete"].includes(entry.phase))
        throw new Error("Git restoration is not confirmed");
      if (
        !Number.isSafeInteger(input.receipt?.revision) ||
        input.receipt.revision <= entry.plan.expectedConversationRevision
      )
        throw new Error("Invalid native transcript receipt revision");
      const native = await state(entry.id);
      if (native.receipt && native.receipt.revision !== input.receipt.revision)
        throw new Error("Native receipt changed");
      if (entry.finalized && entry.receipt)
        return {
          operationId: entry.id,
          acknowledged: true,
          finalized: true,
          receipt: entry.receipt,
        };
      const original =
        entry.plan.direction === "undo"
          ? await operation(entry.plan.rescueOperationId!)
          : undefined;
      await durableWrite(
        operationPath(entry.id),
        JSON.stringify({
          ...native,
          receipt: input.receipt,
          conversation: {
            revision: input.receipt.revision,
            userBlockIds: original
              ? original.rescueUserBlockIds
              : entry.rescueUserBlockIds.filter(
                  (id) => !entry.plan.removedUserBlockIds.includes(id),
                ),
          },
        } satisfies NativeOperation),
      );
      await options.afterReceiptSaved?.();
      const result = await advance(entry.id);
      if (!result.finalized || !result.receipt)
        throw new Error("Native rewind finalization pending");
      return {
        operationId: entry.id,
        acknowledged: true,
        finalized: true,
        receipt: result.receipt,
      };
    },
  };
  // Serialize transport mutations as well as service recovery. In particular a
  // retrying apply must never overwrite a concurrently acknowledged receipt.
  let tail: Promise<unknown> = Promise.resolve();
  const serialized =
    <Args extends unknown[], Result>(fn: (...args: Args) => Promise<Result>) =>
    (...args: Args) => {
      const result = tail.then(() => fn(...args));
      tail = result.catch(() => undefined);
      return result;
    };
  return {
    ...api,
    bindTurn: serialized(api.bindTurn),
    plan: serialized(api.plan),
    lookup: serialized(api.lookup),
    cancelPreparation: serialized(api.cancelPreparation),
    prepare: serialized(api.prepare),
    apply: serialized(api.apply),
    status: serialized(api.status),
    ack: serialized(api.ack),
  };
}
