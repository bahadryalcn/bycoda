import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ManagedWorkspace,
  SessionRewindPlan,
  SessionRewindReceipt,
  TurnGitSnapshot,
  WorkspaceRewindOperation,
} from "./workspace-contracts";
import type {
  ExecutionActivityReservations,
  SessionRewindService,
  WorkspaceRegistry,
} from "./workspace-service-contracts";
import type { WorkspaceRpcRequest } from "./workspace-rpc-contracts";
import { durableWrite, GitTurnHistory, gitText, refComponent, rewindRef } from "./turn-git-history";
import { withHostGitMutation } from "./git-mutations";

/** Both HostStore and native SQLite must implement this boundary atomically. No provider file revert. */
export interface ConversationRewindAdapter {
  read(sessionId: string): Promise<{ revision: number; userBlockIds: string[] }>;
  /** Stop provider/background processes, settle queues, and reject unresolved editor buffers. */
  settle(sessionId: string): Promise<void>;
  withSessionGate<T>(sessionId: string, work: () => Promise<T>): Promise<T>;
  /** Durable immutable transcript rescue, BEFORE any Git mutation. */
  rescue(operationId: string, sessionId: string, expectedRevision: number): Promise<string>;
  /** Atomically archive/truncate or restore rescue, clear provider binding, set literal replay,
   * and persist a receipt. A retry returns that receipt without changing the conversation again. */
  restore(request: {
    operationId: string;
    sessionId: string;
    userBlockId: string;
    direction: "rewind" | "undo";
    transcriptRescueId?: string;
    expectedRevision: number;
  }): Promise<{ revision: number }>;
  receipt(operationId: string): Promise<{ revision: number } | null>;
  /** Native cross-store acknowledgement after the Host journal is durable. Idempotent. */
  complete?(operationId: string): Promise<void>;
}
export interface GitSessionRewindOptions {
  root: string;
  history: GitTurnHistory;
  registry: WorkspaceRegistry;
  activity: ExecutionActivityReservations;
  conversation: ConversationRewindAdapter;
  now?: () => number;
  /** Testable failure boundary; production need not supply it. Invoked AFTER durable phase save. */
  afterPhase?: (phase: WorkspaceRewindOperation["phase"]) => Promise<void>;
}
type PlanRecord = {
  plan: SessionRewindPlan;
  target: TurnGitSnapshot;
  undoTranscriptRescueId?: string;
};
/** Extended only in this module: frozen wire operation remains consumable by other streams. */
export interface DurableRewindOperation extends WorkspaceRewindOperation {
  target: TurnGitSnapshot;
  undoTranscriptRescueId?: string;
  reservationId: string;
  finalized?: boolean;
  rescueUserBlockIds: string[];
  requestFingerprint: string;
  conversationResult?: { revision: number };
}
type ApplyRequest = WorkspaceRpcRequest<"sessions.rewind.apply">;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Plans, rescue refs and journal are durable. All mutation ingress must call assertWritable,
 * including immediately after restart; recovery never silently releases an unfinished fence. */
export class GitSessionRewindService implements SessionRewindService {
  private tails = new Map<string, Promise<unknown>>();
  constructor(readonly options: GitSessionRewindOptions) {}
  private now() {
    return (this.options.now ?? Date.now)();
  }
  private async queue<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(work);
    this.tails.set(sessionId, pending);
    try {
      return await pending;
    } finally {
      if (this.tails.get(sessionId) === pending) this.tails.delete(sessionId);
    }
  }
  async assertWritable(workspaceId: string) {
    const operations = await this.options.registry.listOperations(workspaceId);
    if (
      operations.some(
        (operation) =>
          operation.phase !== "complete" ||
          (operation.kind === "rewind" && !(operation as DurableRewindOperation).finalized),
      )
    )
      throw new Error("Workspace recovery is pending; reconcile before writing");
  }
  private async workspace(id: string, sessionId: string, revision: number) {
    const workspace = await this.options.history.workspace(id);
    if (workspace.owner.kind !== "session" || workspace.owner.id !== sessionId)
      throw new Error("Session does not own this managed workspace");
    if (workspace.revision !== revision)
      throw new Error("Workspace revision changed; preview again");
    return workspace;
  }
  private planPath(token: string) {
    return join(this.options.root, "plans", `${refComponent(token)}.json`);
  }
  async plan(request: WorkspaceRpcRequest<"sessions.rewind.plan">): Promise<SessionRewindPlan> {
    await this.assertWritable(request.workspaceId);
    const workspace = await this.workspace(
      request.workspaceId,
      request.sessionId,
      request.expectedRevision,
    );
    return this.options.conversation.withSessionGate(request.sessionId, () =>
      withHostGitMutation(workspace.path, async () => {
        const conversation = await this.options.conversation.read(request.sessionId);
        if (conversation.revision !== request.expectedConversationRevision)
          throw new Error("Conversation changed; preview again");
        let target: TurnGitSnapshot;
        let userBlockId: string;
        let rescueOperationId: string | undefined;
        let undoTranscriptRescueId: string | undefined;
        let removedUserBlockIds: string[] = [];
        if (request.direction === "undo") {
          const original = (await this.options.registry.getOperation(
            request.operationId,
          )) as DurableRewindOperation | null;
          if (
            !original ||
            original.kind !== "rewind" ||
            original.phase !== "complete" ||
            !original.rescue ||
            !original.transcriptRescueId ||
            original.workspaceId !== workspace.id ||
            original.plan.sessionId !== request.sessionId ||
            original.plan.direction !== "rewind"
          )
            throw new Error("No completed rewind rescue for this session");
          target = original.rescue;
          userBlockId = original.plan.userBlockId;
          rescueOperationId = original.id;
          undoTranscriptRescueId = original.transcriptRescueId;
          if (!original.rescueUserBlockIds)
            throw new Error("Undo transcript boundary inventory is missing");
          const restoredTurns = new Set(original.rescueUserBlockIds);
          removedUserBlockIds = conversation.userBlockIds.filter((id) => !restoredTurns.has(id));
        } else {
          const boundary = await this.options.history.get(workspace.id, request.userBlockId);
          if (
            !boundary ||
            boundary.sessionId !== request.sessionId ||
            boundary.branchRef !== workspace.branchRef ||
            boundary.before.status !== "complete"
          )
            throw new Error("This turn has no complete exact Git boundary");
          const index = conversation.userBlockIds.indexOf(request.userBlockId);
          if (index < 0) throw new Error("Turn is no longer in the active conversation");
          target = boundary.before.snapshot;
          userBlockId = request.userBlockId;
          removedUserBlockIds = conversation.userBlockIds.slice(index);
        }
        const current = await this.options.history.capture(workspace);
        const affectedPaths = [
          ...new Set(
            [...current.paths, ...target.paths]
              .filter(
                (entry) =>
                  current.paths.find((path) => path.path === entry.path)?.fingerprint !==
                  target.paths.find((path) => path.path === entry.path)?.fingerprint,
              )
              .map((entry) => entry.path),
          ),
        ].sort();
        const affectedCommits = (
          await gitText(workspace.path, ["rev-list", `${target.head}...${current.head}`])
        )
          .split("\n")
          .filter(Boolean);
        const publishedRefs = await gitText(workspace.path, [
          "for-each-ref",
          "--contains",
          current.head,
          "--format=%(refname)",
          "refs/remotes/",
        ]);
        const upstream = await gitText(workspace.path, [
          "for-each-ref",
          "--format=%(upstream)",
          workspace.branchRef,
        ]);
        const plan: SessionRewindPlan = {
          token: randomUUID(),
          expiresAt: this.now() + 60_000,
          direction: request.direction,
          ...(rescueOperationId ? { rescueOperationId } : {}),
          workspaceId: workspace.id,
          sessionId: request.sessionId,
          userBlockId,
          expectedRevision: workspace.revision,
          expectedConversationRevision: conversation.revision,
          branchRef: workspace.branchRef,
          currentHead: current.head,
          targetHead: target.head,
          statusFingerprint: this.options.history.snapshotFingerprint(workspace, current),
          removedUserBlockIds,
          affectedCommits,
          affectedPaths,
          blockers: [],
          published: !!(publishedRefs || upstream),
          merged: workspace.state === "merged",
        };
        await durableWrite(
          this.planPath(plan.token),
          JSON.stringify({ plan, target, undoTranscriptRescueId } satisfies PlanRecord),
        );
        return plan;
      }),
    );
  }
  async apply(request: ApplyRequest): Promise<SessionRewindReceipt> {
    return this.execute(request, "rewind");
  }
  async undo(request: ApplyRequest): Promise<SessionRewindReceipt> {
    return this.execute(request, "undo");
  }
  private async execute(
    request: ApplyRequest,
    direction: "rewind" | "undo",
  ): Promise<SessionRewindReceipt> {
    return this.queue(request.sessionId, async () => {
      const duplicate = (await this.options.registry.findOperation({
        workspaceId: request.workspaceId,
        kind: "rewind",
        idempotencyKey: request.idempotencyKey,
      })) as DurableRewindOperation | null;
      const requestFingerprint = hash([
        request.workspaceId,
        request.sessionId,
        request.expectedRevision,
        request.expectedConversationRevision,
        request.planToken,
        request.idempotencyKey,
        direction,
      ]);
      if (duplicate) {
        if (duplicate.requestFingerprint !== requestFingerprint)
          throw new Error("Idempotency key was used for another rewind request");
        if (duplicate.phase === "complete" && duplicate.finalized && duplicate.receipt)
          return duplicate.receipt;
        await this.recover(duplicate.id);
        const recovered = await this.operation(duplicate.id);
        if (!recovered.receipt) throw new Error("Rewind recovery has no receipt");
        return recovered.receipt;
      }
      const saved = JSON.parse(
        await readFile(this.planPath(request.planToken), "utf8"),
      ) as PlanRecord;
      const { plan } = saved;
      if (
        plan.direction !== direction ||
        plan.workspaceId !== request.workspaceId ||
        plan.sessionId !== request.sessionId ||
        plan.expectedRevision !== request.expectedRevision ||
        plan.expectedConversationRevision !== request.expectedConversationRevision ||
        plan.expiresAt < this.now() ||
        plan.blockers.length
      )
        throw new Error("Rewind preview is stale or does not match the request");
      await this.assertWritable(request.workspaceId);
      await this.options.conversation.settle(request.sessionId);
      return this.options.conversation.withSessionGate(request.sessionId, async () => {
        const workspace = await this.workspace(
          request.workspaceId,
          request.sessionId,
          request.expectedRevision,
        );
        const operationId = randomUUID();
        const reservation = await this.options.activity.reserve({
          workspaceId: workspace.id,
          operationId,
          purpose: "rewind",
          expectedRevision: workspace.revision,
        });
        let journaled = false;
        try {
          return await withHostGitMutation(workspace.path, async () => {
            const freshWorkspace = await this.workspace(
              workspace.id,
              request.sessionId,
              request.expectedRevision,
            );
            await this.assertWritable(workspace.id);
            const conversation = await this.options.conversation.read(request.sessionId);
            if (
              conversation.revision !== plan.expectedConversationRevision ||
              freshWorkspace.branchRef !== plan.branchRef ||
              (await this.options.history.fingerprint(freshWorkspace)) !== plan.statusFingerprint
            )
              throw new Error("Workspace or conversation changed after preview");
            const rescue = await this.options.history.capture(freshWorkspace);
            if (
              this.options.history.snapshotFingerprint(freshWorkspace, rescue) !==
              plan.statusFingerprint
            )
              throw new Error("Workspace changed while preparing rescue; preview again");
            await this.workspace(workspace.id, request.sessionId, request.expectedRevision);
            await this.options.history.retain(freshWorkspace, rescue, [
              rewindRef(operationId, "rescue-head"),
              rewindRef(operationId, "rescue-index"),
              rewindRef(operationId, "rescue-worktree"),
            ]);
            const operation: DurableRewindOperation = {
              id: operationId,
              kind: "rewind",
              phase: "prepared",
              workspaceId: workspace.id,
              idempotencyKey: request.idempotencyKey,
              expectedRevision: workspace.revision,
              createdAt: this.now(),
              updatedAt: this.now(),
              plan,
              rescue,
              rescueUserBlockIds: conversation.userBlockIds.slice(),
              target: saved.target,
              undoTranscriptRescueId: saved.undoTranscriptRescueId,
              reservationId: reservation.id,
              requestFingerprint,
            };
            await this.options.registry.saveOperation(operation, null);
            journaled = true;
            // Persist the Host intent BEFORE asking native SQLite to install its durable fence.
            // A crash between the stores can then retry rescue using the same operation identity.
            operation.transcriptRescueId = await this.options.conversation.rescue(
              operationId,
              request.sessionId,
              plan.expectedConversationRevision,
            );
            await this.options.registry.saveOperation(operation, "prepared");
            await this.options.afterPhase?.("prepared");
            return (await this.reconcile(operation, freshWorkspace)).receipt!;
          });
        } finally {
          // Once journaled, reconciliation alone may release the reservation.
          if (!journaled) await this.options.activity.release(reservation.id);
        }
      });
    });
  }
  private async operation(id: string): Promise<DurableRewindOperation> {
    const operation = await this.options.registry.getOperation(id);
    if (!operation || operation.kind !== "rewind") throw new Error("Unknown rewind operation");
    return operation as DurableRewindOperation;
  }
  private async phase(operation: DurableRewindOperation, phase: DurableRewindOperation["phase"]) {
    const previous = operation.phase;
    const next = { ...operation, phase, updatedAt: this.now() };
    await this.options.registry.saveOperation(next, previous);
    Object.assign(operation, next);
    await this.options.afterPhase?.(phase);
  }
  private async reconcile(
    operation: DurableRewindOperation,
    workspace: ManagedWorkspace,
  ): Promise<DurableRewindOperation> {
    if (!operation.rescue)
      throw new Error("Incomplete Git rescue journal; manual recovery required");
    if (
      workspace.branchRef !== operation.plan.branchRef ||
      workspace.owner.kind !== "session" ||
      workspace.owner.id !== operation.plan.sessionId
    )
      throw new Error("Workspace ownership changed during recovery");
    const conversation = await this.options.conversation.read(operation.plan.sessionId);
    const conversationReceipt = await this.options.conversation.receipt(operation.id);
    if (
      !conversationReceipt &&
      conversation.revision !== operation.plan.expectedConversationRevision
    )
      throw new Error("External transcript drift; recovery blocked");
    if (conversationReceipt && conversation.revision !== conversationReceipt.revision)
      throw new Error("Transcript changed after recovery receipt");
    if (!operation.transcriptRescueId) {
      if (
        operation.phase !== "prepared" ||
        (await this.options.history.fingerprint(workspace)) !==
          this.options.history.snapshotFingerprint(workspace, operation.rescue)
      )
        throw new Error("Incomplete transcript rescue with Git drift; recovery blocked");
      operation.transcriptRescueId = await this.options.conversation.rescue(
        operation.id,
        operation.plan.sessionId,
        operation.plan.expectedConversationRevision,
      );
      await this.options.registry.saveOperation(operation, "prepared");
    }
    if (operation.phase === "prepared") {
      await this.options.history.restore(
        workspace,
        operation.target,
        operation.rescue,
        operation.id,
      );
      await this.phase(operation, "git-restored");
    }
    if (operation.phase === "git-restored") {
      if (
        (await this.options.history.fingerprint(workspace)) !==
        this.options.history.snapshotFingerprint(workspace, operation.target)
      )
        throw new Error("Git changed after restore; recovery blocked");
      operation.conversationResult =
        conversationReceipt ??
        (await this.options.conversation.restore({
          operationId: operation.id,
          sessionId: operation.plan.sessionId,
          userBlockId: operation.plan.userBlockId,
          direction: operation.plan.direction,
          transcriptRescueId: operation.undoTranscriptRescueId,
          expectedRevision: operation.plan.expectedConversationRevision,
        }));
      await this.phase(operation, "conversation-restored");
    }
    if (operation.phase === "conversation-restored") {
      const receipt = await this.options.conversation.receipt(operation.id);
      if (!receipt || receipt.revision !== operation.conversationResult?.revision)
        throw new Error("Conversation receipt needs reconciliation");
      if (
        (await this.options.history.fingerprint(workspace)) !==
        this.options.history.snapshotFingerprint(workspace, operation.target)
      )
        throw new Error("Git changed after transcript restore");
      // Registry.update is idempotent under this key: a crash after it must not increment twice.
      const updated = await this.options.registry.update({
        workspaceId: workspace.id,
        idempotencyKey: operation.id,
        expectedRevision: operation.expectedRevision,
        reservationId: operation.reservationId,
        changes: { lastActivityAt: operation.createdAt },
      });
      operation.receipt = {
        operationId: operation.id,
        workspaceId: workspace.id,
        sessionId: operation.plan.sessionId,
        direction: operation.plan.direction,
        workspaceRevision: updated.revision,
        conversationRevision: receipt.revision,
        head: operation.target.head,
        ...(operation.plan.direction === "rewind" ? { undoOperationId: operation.id } : {}),
      };
      await this.phase(operation, "complete");
    }
    if (operation.phase === "complete") {
      await this.finalize(operation);
    }
    return operation;
  }
  private async finalize(operation: DurableRewindOperation) {
    if (operation.finalized) return;
    await this.options.conversation.complete?.(operation.id);
    await this.options.activity.release(operation.reservationId);
    operation.finalized = true;
    await this.options.registry.saveOperation(operation, "complete");
  }
  async recover(operationId: string): Promise<DurableRewindOperation> {
    const operation = await this.operation(operationId);
    // Do not nest queue(): execute duplicate recovery already owns that queue.
    return this.options.conversation.withSessionGate(operation.plan.sessionId, async () => {
      if (operation.phase === "complete") {
        await this.finalize(operation);
        return operation;
      }
      const workspace = await this.options.history.workspace(operation.workspaceId);
      if (
        workspace.revision !== operation.expectedRevision &&
        workspace.revision !== operation.expectedRevision + 1
      )
        throw new Error("Workspace revision drift; recovery blocked");
      // reserve must be durable/idempotent by operation ID; on restart this also freshly
      // checks for surviving processes/dirty buffers before touching partially restored Git.
      const reservation = await this.options.activity.reserve({
        workspaceId: workspace.id,
        operationId: operation.id,
        purpose: "rewind",
        expectedRevision: operation.expectedRevision,
      });
      if (reservation.id !== operation.reservationId)
        throw new Error("Recovery reservation identity changed; reconcile activity journal first");
      return withHostGitMutation(workspace.path, () => this.reconcile(operation, workspace));
    });
  }
  /** Call on startup before enabling managed writes. Failed entries remain discoverable/fenced. */
  async recoverPending(): Promise<{ operationId: string; error?: string }[]> {
    // Complete journals may still need their native acknowledgement / reservation release after a crash.
    const operations = (await this.options.registry.listOperations()).filter(
      (operation) =>
        operation.kind === "rewind" &&
        (operation.phase !== "complete" || !(operation as DurableRewindOperation).finalized),
    );
    const results: { operationId: string; error?: string }[] = [];
    for (const operation of operations) {
      try {
        await this.recover(operation.id);
        results.push({ operationId: operation.id });
      } catch (error) {
        results.push({
          operationId: operation.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }
}
