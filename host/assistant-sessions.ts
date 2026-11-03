import { createHash } from "node:crypto";
import { z } from "zod";
import type { HostStore } from "./store";
import type {
  AssistantJob,
  AssistantProjectJob,
  AssistantProfile,
} from "../src/shared/model/host-contracts/assistant";
import type { SessionMessageAuthor } from "../src/features/sessions/model/session";
import { workerContextAction } from "./assistant/cost";
import type { ManualSupervisionGrant } from "../src/shared/model/assistantManual";
import type { HostSession } from "../src/features/connections/model/protocol";
import type { AssistantRecoveryResult } from "./assistant-worker-recovery";
import {
  readAssistantQuestionStatus,
  validateAssistantQuestionReply,
  assistantQuestionToken,
  type AssistantQuestionAnswer,
} from "./assistant-questions";
import { currentAssistantRunActivity } from "./assistant-chief-reads";
import { assistantJobSessionBelongs } from "./assistant-job-scope";

const id = z.string().min(1).max(200);
export const AssistantManagedSessionRequestSchema = z
  .discriminatedUnion("op", [
    z.strictObject({
      op: z.literal("status"),
      jobId: id.optional(),
      supervisionId: id.optional(),
      sessionId: id,
    }),
    z.strictObject({
      op: z.literal("answer"),
      jobId: id,
      sessionId: id,
      requestId: id,
      questionToken: z.string().regex(/^[a-f0-9]{64}$/),
      answers: z.record(id, z.array(id).max(10)).refine((value) => Object.keys(value).length <= 5),
      custom: z
        .record(id, z.string().min(1).max(1000))
        .refine((value) => Object.keys(value).length <= 5)
        .optional(),
    }),
    z.strictObject({
      op: z.literal("nudge"),
      jobId: id.optional(),
      supervisionId: id.optional(),
      sessionId: id,
      requestId: id,
      text: z.string().min(1).max(300),
      reason: z.enum(["nudge", "answer", "steer"]),
    }),
  ])
  .superRefine((value, ctx) => {
    if (!!value.jobId === ("supervisionId" in value && !!value.supervisionId))
      ctx.addIssue({
        code: "custom",
        message: "Choose exactly one job or manual supervision source.",
      });
  });
export type AssistantManagedSessionRequest = z.infer<typeof AssistantManagedSessionRequestSchema>;
export type AssistantSessionStatus = {
  sessionId: string;
  projectId: string;
  title: string;
  executionCwd: string;
  authorityGeneration?: number;
  runId?: string;
  state: "idle" | "running" | "interrupted";
  lastActivityAt?: number;
  contextTokens?: number;
  contextWindow?: number;
  pendingApproval: boolean;
  pendingQuestion: boolean;
  lastAssistantMessage: string;
  questionId?: string;
  questionSummary?: string;
  questionOwnerRequired?: boolean;
  questionToken?: string;
  questions?: import("../src/features/sessions/model/userQuestion").UserQuestion[];
  questionOwnerReason?: string;
};
export type AssistantSessionOperation = {
  requestId: string;
  sessionId: string;
  state: "unknown" | "settled";
  delivery: "unknown" | "not_delivered" | "delivered" | "submitted";
  action: "send" | "compact" | "handoff" | "answer";
  newSessionId?: string;
};
export type AssistantManagedSessionResponse = {
  recovery?: AssistantRecoveryResult;
  status?: AssistantSessionStatus & {
    jobId?: string;
    supervisionId?: string;
    contextAction: "send" | "compact" | "handoff";
    nudges: number;
  };
  operation?: AssistantSessionOperation;
};
export type AssistantSupervisorPrincipal = { kind: "chief"; id: string };
type EffectScope =
  | { scope: "job"; jobId: string }
  | { scope: "manual"; supervisionId: string; grantVersion: number };
type Effect = EffectScope & {
  sessionId: string;
  requestId: string;
  signal: AbortSignal;
  recheck: () => Promise<void>;
  source: Pick<
    AssistantSessionStatus,
    "projectId" | "executionCwd" | "authorityGeneration" | "runId"
  >;
};
export interface AssistantSessionPorts {
  ready?: Promise<void>;
  nudgeLimit?(): Promise<number>;
  allowed(): Promise<boolean>;
  questionsAllowed?(): Promise<boolean>;
  resolveManual?(
    supervisionId: string,
    sessionId: string,
    expectedVersion?: number,
  ): Promise<{ grant: ManualSupervisionGrant; session: HostSession; name: string }>;
  validateWrite?(scope: EffectScope, sessionId: string): Promise<void>;
  recoverWorker?(input: Effect & { scope: "job"; jobId: string }): Promise<AssistantRecoveryResult>;
  onManualLimit?(supervisionId: string, sessionId: string): Promise<void>;
  onReceiptChanged?(): Promise<void>;
  onReceiptNotificationError?(error: unknown): void;
  reserveTokens(input: {
    jobId?: string;
    supervisionId?: string;
    requestId: string;
    estimatedTokens: number;
    phase: "compact" | "handoff" | "send" | "answer";
    answerSource?: { sessionId: string; runId: string; questionToken: string; turnBlockId: string };
  }): Promise<void>;
  status?(sessionId: string): Promise<AssistantSessionStatus>;
  compact?(
    input: Effect & {
      author: Extract<SessionMessageAuthor, { kind: "assistant" | "assistant-manual" }>;
    },
  ): Promise<{ completed: boolean }>;
  send?(
    input: Effect & {
      text: string;
      author: Extract<SessionMessageAuthor, { kind: "assistant" | "assistant-manual" }>;
    },
  ): Promise<{ delivery: "unknown" | "not_delivered" | "delivered" }>;
  answerQuestion?(
    input: Effect &
      AssistantQuestionAnswer & {
        scope: "job";
        jobId: string;
        author: Extract<SessionMessageAuthor, { kind: "assistant" }>;
      },
  ): Promise<{ delivery: "submitted" | "unknown"; answeredBlockId?: string; turnBlockId?: string }>;
  onAnswerSubmitted?(input: {
    jobId: string;
    operationId: string;
    sessionId: string;
    runId: string;
    questionToken: string;
    turnBlockId: string;
    answeredBlockId: string;
  }): Promise<void>;
  handoff?(
    input: Effect & {
      text: string;
      author: Extract<SessionMessageAuthor, { kind: "assistant" | "assistant-manual" }>;
    },
  ): Promise<{ delivery: "unknown" | "not_delivered" | "delivered"; newSessionId?: string }>;
  onActivity?(input: {
    jobId?: string;
    supervisionId?: string;
    sessionId: string;
    kind: string;
    operationId: string;
  }): Promise<void>;
}
type StoredOperation = {
  fingerprint: string;
  operation?: AssistantSessionOperation;
  recovery?: AssistantRecoveryResult;
};
type Target =
  | { scope: "job"; job: AssistantJob }
  | {
      scope: "manual";
      job: Pick<AssistantJob, "id" | "projectId" | "status">;
      grantVersion: number;
    };
/** The only supervisor write grant. A job relationship is verified from the
 * durable Host job table; names and client-projected managedBy are not grants. */
export class HostAssistantSessions {
  readonly ready: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private closing = false;
  private active?: AbortController;
  private generation = 0;
  private activeJobId?: string;
  private activeSessionId?: string;
  private readonly jobEpochs = new Map<string, number>();
  private readonly pausedJobs = new Set<string>();
  private readonly withdrawnSessions = new Set<string>();
  constructor(
    private readonly store: HostStore,
    private readonly ports: AssistantSessionPorts,
  ) {
    this.ready = (async () => {
      await store.ready;
      await ports.ready;
      await store.db.scope(() =>
        store.db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_session_receipts(id TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_session_counts(id TEXT PRIMARY KEY,nudges INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_question_claims(token TEXT PRIMARY KEY,receipt_id TEXT NOT NULL);
    `),
      );
    })();
  }
  stop() {
    this.generation++;
    this.stopped = true;
    this.active?.abort();
  }
  resume() {
    if (!this.closing) this.stopped = false;
  }
  pauseJob(id: string) {
    this.jobEpochs.set(id, (this.jobEpochs.get(id) ?? 0) + 1);
    this.pausedJobs.add(id);
    if (this.activeJobId === id) this.active?.abort();
  }
  resumeJob(id: string) {
    this.pausedJobs.delete(id);
  }
  /** Owner-only service port. Withdrawal never stops or restarts the canonical worker. */
  async detach(
    jobId: string,
    sessionId: string,
    expectedVersion: number,
  ): Promise<{ detached: true }> {
    await this.ready;
    await this.store.transaction(async () => {
      const job = await this.job(jobId, sessionId);
      // The identical already-committed withdrawal is safe to reconcile after a lost ACK.
      if (job.detachedSessionIds?.includes(sessionId)) return;
      if (job.version !== expectedVersion)
        throw new Error("The assistant job changed. Refresh before detaching its session.");
      const status = await this.status(sessionId);
      if (!(await assistantJobSessionBelongs(this.store, job, sessionId, status.projectId)))
        throw new Error("The session's canonical job/task/project relationship changed.");
      const updatedAt = Math.max(Date.now(), job.updatedAt + 1);
      const next = {
        ...job,
        detachedSessionIds: [...(job.detachedSessionIds ?? []), sessionId],
        version: job.version + 1,
        updatedAt,
      };
      await this.store.db
        .prepare(
          "UPDATE assistant_jobs SET value=?,version=?,updated_at=? WHERE id=? AND deleted_at IS NULL",
        )
        .run(JSON.stringify(next), next.version, updatedAt, jobId);
      this.withdrawnSessions.add(`${jobId}:${sessionId}`);
      if (this.activeJobId === jobId && this.activeSessionId === sessionId) this.active?.abort();
    }, "critical");
    return { detached: true };
  }
  async close() {
    this.closing = true;
    this.stop();
    await this.tail;
  }
  async request(
    raw: unknown,
    principal: AssistantSupervisorPrincipal,
  ): Promise<AssistantManagedSessionResponse> {
    if (!principal || principal.kind !== "chief" || !principal.id || principal.id.length > 200)
      return Promise.reject(
        new Error("Managed sessions require the captured supervisor principal."),
      );
    const input = AssistantManagedSessionRequestSchema.parse(raw);
    const generation = this.generation;
    const jobEpoch = input.jobId ? (this.jobEpochs.get(input.jobId) ?? 0) : 0;
    const task = this.tail.then(async () => {
      await this.ready;
      if (this.closing) throw new Error("Managed-session service is closing.");
      await this.store.db.checkAuthorization();
      if (input.op !== "status" && generation !== this.generation)
        throw new Error("A newer supervision Stop fenced this queued command.");
      return this.dispatch(input, principal, generation, jobEpoch);
    });
    this.tail = task.catch(() => undefined);
    return task;
  }
  private async job(jobId: string, sessionId: string, write = false): Promise<AssistantProjectJob> {
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_jobs WHERE id=? AND deleted_at IS NULL")
      .get(jobId);
    if (!row) throw new Error("The assistant job is unavailable.");
    const job = JSON.parse(row.value) as AssistantJob;
    if (job.kind === "quick")
      throw new Error("Global quick jobs do not grant session supervision.");
    if (job.goalId !== `assistant-${job.id}` || !job.sessionIds.includes(sessionId))
      throw new Error(
        "This session was not started by the selected assistant job. Manual sessions remain outside the supervisor grant.",
      );
    if (write && ["paused", "cancelled", "done", "failed"].includes(job.status))
      throw new Error("This job is not active; its sessions cannot be nudged.");
    if (write && job.detachedSessionIds?.includes(sessionId))
      throw new Error("The owner detached this session from assistant supervision.");
    return job;
  }
  private async target(input: AssistantManagedSessionRequest): Promise<Target> {
    if ("supervisionId" in input && input.supervisionId) {
      if (!this.ports.resolveManual) throw new Error("Manual supervision is unavailable.");
      const { grant } = await this.ports.resolveManual(input.supervisionId, input.sessionId);
      return {
        scope: "manual",
        job: { id: grant.id, projectId: grant.source.projectId, status: "running" },
        grantVersion: grant.version,
      };
    }
    return {
      scope: "job",
      job: await this.job(input.jobId!, input.sessionId, input.op !== "status"),
    };
  }
  private effectScope(target: Target): EffectScope {
    return target.scope === "job"
      ? { scope: "job", jobId: target.job.id }
      : { scope: "manual", supervisionId: target.job.id, grantVersion: target.grantVersion };
  }
  private targetKey(target: Target) {
    return target.scope === "job" ? target.job.id : `manual:${target.job.id}`;
  }
  private async status(sessionId: string): Promise<AssistantSessionStatus> {
    if (this.ports.status) {
      const value = await this.ports.status(sessionId);
      if (value.sessionId !== sessionId)
        throw new Error("Session status resolved to a different source.");
      return value;
    }
    const record = await this.store.session(sessionId);
    const session = record.session;
    const question = session.pendingQuestion;
    const questionStatus = await readAssistantQuestionStatus(
      this.store,
      record,
      undefined,
      (await this.ports.questionsAllowed?.()) ?? false,
    );
    const lastActivityAt = currentAssistantRunActivity(record);
    return {
      sessionId: session.id,
      projectId: record.projectId,
      title: session.title,
      executionCwd: session.worktreeCwd ?? session.cwd,
      ...(record.authorityGeneration === undefined
        ? {}
        : { authorityGeneration: record.authorityGeneration }),
      ...(record.runId ? { runId: record.runId } : {}),
      state: record.status,
      ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
      ...(session.context
        ? {
            contextTokens: session.context.used,
            ...(session.context.window ? { contextWindow: session.context.window } : {}),
          }
        : {}),
      pendingApproval: session.blocks.some((block) => !!block.approval && !block.approval.decided),
      pendingQuestion: !!question,
      ...(question
        ? {
            questionId: String(question.requestId),
            questionSummary: question.questions
              .map((item) => item.prompt)
              .join(" · ")
              .slice(0, 400),
            questionOwnerRequired: true,
            ...questionStatus,
          }
        : {}),
      lastAssistantMessage:
        session.blocks
          .filter((block) => block.role === "assistant")
          .at(-1)
          ?.text.slice(0, 400) ?? "",
    };
  }
  private async nudgeLimit() {
    const value = (await this.ports.nudgeLimit?.()) ?? 2;
    if (!Number.isSafeInteger(value) || value < 0 || value > 2)
      throw new Error("The saved nudge limit is invalid.");
    return value;
  }
  private async recheckNudgeLimit(targetKey: string, sessionId: string) {
    const limit = await this.nudgeLimit();
    if (limit === 0 || (await this.count(targetKey, sessionId)) > limit)
      throw new Error("The saved nudge limit changed before delivery.");
  }
  private async count(jobId: string, sessionId: string) {
    return Number(
      (
        await this.store.db
          .prepare("SELECT nudges FROM assistant_session_counts WHERE id=?")
          .get(`${jobId}:${sessionId}`)
      )?.nudges ?? 0,
    );
  }
  private async guard(
    target: Target,
    sessionId: string,
    generation: number,
    validate = true,
    jobEpoch = 0,
  ) {
    const withdrawn = () =>
      target.scope === "job" && this.withdrawnSessions.has(`${target.job.id}:${sessionId}`);
    if (withdrawn()) throw new Error("The owner detached this session from assistant supervision.");
    if (
      target.scope === "job" &&
      (this.pausedJobs.has(target.job.id) || (this.jobEpochs.get(target.job.id) ?? 0) !== jobEpoch)
    )
      throw new Error("A newer owner job hold fenced this queued supervisor action.");
    if (generation !== this.generation)
      throw new Error("A newer supervision Stop fenced this command.");
    if (this.stopped || this.closing || !(await this.ports.allowed()))
      throw new Error("The supervisor is paused or lacks execution authority.");
    await this.store.db.checkAuthorization();
    if (this.stopped || this.closing || generation !== this.generation)
      throw new Error("The supervisor was stopped.");
    let current;
    if (target.scope === "manual") {
      if (!this.ports.resolveManual) throw new Error("Manual supervision is unavailable.");
      await this.ports.resolveManual(target.job.id, sessionId, target.grantVersion);
      current = target.job;
    } else current = await this.job(target.job.id, sessionId, true);
    if (validate) await this.ports.validateWrite?.(this.effectScope(target), sessionId);
    if (this.stopped || this.closing || generation !== this.generation || withdrawn())
      throw new Error("A newer supervision Stop or withdrawal fenced this command.");
    return current;
  }
  private identity(status: AssistantSessionStatus) {
    return {
      projectId: status.projectId,
      executionCwd: status.executionCwd,
      ...(status.authorityGeneration === undefined
        ? {}
        : { authorityGeneration: status.authorityGeneration }),
      ...(status.runId ? { runId: status.runId } : {}),
    };
  }
  private sameSource(original: AssistantSessionStatus, current: AssistantSessionStatus) {
    if (
      original.sessionId !== current.sessionId ||
      original.projectId !== current.projectId ||
      original.executionCwd !== current.executionCwd ||
      original.authorityGeneration !== current.authorityGeneration
    )
      throw new Error("The managed session's source identity changed.");
  }
  private estimate(status: AssistantSessionStatus, text: string) {
    const context = status.contextTokens ?? status.contextWindow;
    if (context === undefined || !Number.isFinite(context) || context < 0)
      throw new Error(
        "Session context is unknown; a bounded compaction cost could not be reserved. Read context before writing.",
      );
    return Math.ceil(context + text.length / 4 + 1000);
  }
  private async saveReceipt(id: string, value: StoredOperation) {
    await this.store.transaction(
      () =>
        this.store.db
          .prepare(
            "INSERT INTO assistant_session_receipts(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
          )
          .run(id, JSON.stringify(value)),
      "critical",
    );
    try {
      await this.ports.onReceiptChanged?.();
    } catch (error) {
      try {
        this.ports.onReceiptNotificationError?.(error);
      } catch {
        /* Reporting cannot invalidate an accepted receipt. */
      }
    }
  }
  private async contextAction(
    status: Pick<AssistantSessionStatus, "contextTokens" | "contextWindow">,
  ) {
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_profile WHERE id='profile'")
      .get();
    return workerContextAction(
      status.contextTokens,
      status.contextWindow,
      row ? JSON.parse(row.value) : {},
    );
  }
  private async dispatch(
    input: AssistantManagedSessionRequest,
    principal: AssistantSupervisorPrincipal,
    generation: number,
    jobEpoch: number,
  ): Promise<AssistantManagedSessionResponse> {
    if (input.op === "answer") return this.answer(input, principal, generation, jobEpoch);
    const target = await this.target(input),
      job = target.job,
      targetKey = this.targetKey(target),
      scope = this.effectScope(target);
    if (input.op === "status") {
      const status = await this.status(input.sessionId);
      const question = status.pendingQuestion
        ? target.scope === "job" && (await this.ports.questionsAllowed?.())
          ? await readAssistantQuestionStatus(
              this.store,
              await this.store.session(input.sessionId),
              job.id,
              true,
            )
          : { questionOwnerRequired: true }
        : undefined;
      return {
        status: {
          ...status,
          ...question,
          ...(target.scope === "job" ? { jobId: job.id } : { supervisionId: job.id }),
          contextAction: await this.contextAction(status),
          nudges: await this.count(targetKey, input.sessionId),
        },
      };
    }
    const receiptId = `${targetKey}:${input.sessionId}:${input.requestId}`;
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ ...input, chiefId: principal.id }))
      .digest("hex");
    const existing = await this.store.db
      .prepare("SELECT value FROM assistant_session_receipts WHERE id=?")
      .get(receiptId);
    if (existing) {
      const previous = JSON.parse(existing.value) as StoredOperation;
      if (previous.fingerprint !== fingerprint)
        throw new Error("A supervisor retry must preserve its original source and payload.");
      return {
        operation: previous.operation,
        ...(previous.recovery ? { recovery: previous.recovery } : {}),
      };
    }
    await this.guard(target, input.sessionId, generation, true, jobEpoch);
    let status = await this.status(input.sessionId);
    if (
      !(
        target.scope === "manual"
          ? [job.projectId]
          : ((job as AssistantJob).projectIds ?? [job.projectId])
      ).includes(status.projectId)
    )
      throw new Error("The session moved outside its job's project.");
    if (status.pendingApproval)
      throw new Error(
        "This session is waiting for owner approval. The supervisor cannot approve it.",
      );
    if (status.pendingQuestion)
      throw new Error("This question needs the owner's answer; a nudge cannot bypass it.");
    if (input.reason === "answer")
      throw new Error(
        "Use the exact occurrence-bound routine question operation; a text nudge cannot answer questions.",
      );
    const nudgeLimit = await this.nudgeLimit();
    if (nudgeLimit === 0) throw new Error("Follow-ups are disabled by the saved nudge limit.");
    if ((await this.count(targetKey, input.sessionId)) >= nudgeLimit) {
      const limitMessage =
        nudgeLimit === 2
          ? "The session reached its two-nudge limit. Owner review is required."
          : "The session reached its saved nudge limit. Owner review is required.";
      if (target.scope === "manual") {
        await this.ports.onManualLimit?.(job.id, input.sessionId);
        throw new Error(limitMessage);
      }
      if (!this.ports.recoverWorker) throw new Error(limitMessage);
      const controller = new AbortController();
      this.active = controller;
      this.activeJobId = job.id;
      this.activeSessionId = input.sessionId;
      try {
        const recovery = await this.ports.recoverWorker({
          scope: "job",
          jobId: job.id,
          sessionId: input.sessionId,
          requestId: receiptId,
          source: this.identity(status),
          signal: controller.signal,
          recheck: async () => {
            await this.guard(target, input.sessionId, generation, false, jobEpoch);
            const limit = await this.nudgeLimit();
            if (limit === 0 || (await this.count(targetKey, input.sessionId)) < limit)
              throw new Error("The saved nudge limit changed before worker recovery.");
          },
        });
        await this.saveReceipt(receiptId, { fingerprint, recovery });
        return { recovery };
      } finally {
        if (this.active === controller) {
          this.active = undefined;
          this.activeJobId = undefined;
          this.activeSessionId = undefined;
        }
      }
    }
    const profileRow = await this.store.db
      .prepare("SELECT value FROM assistant_profile WHERE id='profile'")
      .get();
    const profile = profileRow ? (JSON.parse(profileRow.value) as AssistantProfile) : undefined;
    if (!profile?.name?.trim()) throw new Error("The assistant identity is not configured.");
    const author: Extract<SessionMessageAuthor, { kind: "assistant" | "assistant-manual" }> = {
      ...(target.scope === "job"
        ? { kind: "assistant" as const, jobId: job.id }
        : { kind: "assistant-manual" as const, supervisionId: job.id }),
      name: profile.name,
      reason: input.reason,
      operationId: receiptId,
    };
    const action = await this.contextAction(status);
    if (action === "handoff" && !this.ports.handoff)
      throw new Error(
        "This worker needs a fresh-session handoff; sending into its large context is refused.",
      );
    if (action === "compact" && !this.ports.compact)
      throw new Error(
        "This worker must be compacted before another message; compaction is unavailable.",
      );
    if (action !== "handoff" && !status.pendingQuestion && !this.ports.send)
      throw new Error("Managed-session sending is unavailable.");
    if (status.pendingQuestion && action !== "send")
      throw new Error("A pending question must be resolved before context maintenance.");
    const initial = status;
    const controller = new AbortController();
    this.active = controller;
    this.activeJobId = target.scope === "job" ? job.id : undefined;
    this.activeSessionId = input.sessionId;
    let operation: AssistantSessionOperation = {
      requestId: input.requestId,
      sessionId: input.sessionId,
      state: "unknown",
      delivery: "unknown",
      action,
    };
    // Count and preserve intent before any provider effect, including compaction.
    await this.store.transaction(async () => {
      const count = await this.count(targetKey, input.sessionId);
      if (count >= (await this.nudgeLimit()))
        throw new Error("The session reached its saved nudge limit.");
      await this.store.db
        .prepare(
          "INSERT INTO assistant_session_counts(id,nudges) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET nudges=nudges+1",
        )
        .run(`${targetKey}:${input.sessionId}`);
      await this.store.db
        .prepare("INSERT INTO assistant_session_receipts(id,value) VALUES(?,?)")
        .run(receiptId, JSON.stringify({ fingerprint, operation }));
    }, "critical");
    try {
      if (action === "compact") {
        await this.ports.reserveTokens({
          ...(target.scope === "job" ? { jobId: job.id } : { supervisionId: job.id }),
          requestId: `${receiptId}:compact`,
          estimatedTokens: this.estimate(status, ""),
          phase: "compact",
        });
        await this.guard(target, input.sessionId, generation, true, jobEpoch);
        const result = await this.ports.compact!({
          ...scope,
          author: { ...author, operationId: `${receiptId}:compact` },
          sessionId: input.sessionId,
          requestId: `${receiptId}:compact`,
          source: this.identity(status),
          signal: controller.signal,
          recheck: async () => {
            await this.guard(target, input.sessionId, generation, true, jobEpoch);
            await this.recheckNudgeLimit(targetKey, input.sessionId);
          },
        });
        if (!result.completed)
          throw new Error("Compaction has not been confirmed; the nudge was not sent.");
        status = await this.status(input.sessionId);
        this.sameSource(initial, status);
        if ((await this.contextAction(status)) !== "send")
          throw new Error(
            "Compaction did not establish a small enough context; the nudge was not sent.",
          );
      }
      await this.guard(target, input.sessionId, generation, true, jobEpoch);
      if (controller.signal.aborted) throw new Error("The supervisor was stopped.");
      const current = await this.status(input.sessionId);
      this.sameSource(status, current);
      if (
        current.runId !== status.runId ||
        current.pendingApproval ||
        current.pendingQuestion !== status.pendingQuestion ||
        current.questionId !== status.questionId ||
        (current.pendingQuestion && current.questionOwnerRequired !== false)
      )
        throw new Error("The original turn or pending input changed; the nudge was not sent.");
      status = current;
      if (action !== "handoff" && (await this.contextAction(status)) !== "send")
        throw new Error("The context grew before delivery; take a fresh status.");
      await this.ports.reserveTokens({
        ...(target.scope === "job" ? { jobId: job.id } : { supervisionId: job.id }),
        requestId: `${receiptId}:${action === "handoff" ? "handoff" : "send"}`,
        estimatedTokens: this.estimate(status, input.text),
        phase: action === "handoff" ? "handoff" : "send",
      });
      await this.guard(target, input.sessionId, generation, true, jobEpoch);
      if (controller.signal.aborted) throw new Error("The supervisor was stopped.");
      const recheck = async () => {
        await this.guard(target, input.sessionId, generation, true, jobEpoch);
        await this.recheckNudgeLimit(targetKey, input.sessionId);
        if (action === "handoff") return;
        const live = await this.status(input.sessionId);
        this.sameSource(status, live);
        // The canonical command owner validates its accepted continuation run.
        // A send may have legitimately advanced the run before its provider fence.
        if (live.pendingApproval || live.pendingQuestion)
          throw new Error("Pending owner input changed before delivery.");
        if ((await this.contextAction(live)) !== "send")
          throw new Error(
            "The context or saved worker limits changed before delivery; take fresh status.",
          );
      };
      await recheck();
      const effect = {
        ...scope,
        sessionId: input.sessionId,
        requestId: receiptId,
        source: this.identity(status),
        signal: controller.signal,
        recheck,
        text: input.text,
        author,
      };
      const result =
        action === "handoff" ? await this.ports.handoff!(effect) : await this.ports.send!(effect);
      operation = {
        ...operation,
        state: "settled",
        delivery: result.delivery,
        ...("newSessionId" in result && typeof result.newSessionId === "string"
          ? { newSessionId: result.newSessionId }
          : {}),
      };
      await this.saveReceipt(receiptId, { fingerprint, operation });
      await this.ports.onActivity?.({
        ...(target.scope === "job" ? { jobId: job.id } : { supervisionId: job.id }),
        sessionId: input.sessionId,
        kind: action === "handoff" ? "session.handoff" : "session.nudged",
        operationId: receiptId,
      });
      return { operation };
    } catch {
      return { operation };
    } finally {
      if (this.active === controller) {
        this.active = undefined;
        this.activeJobId = undefined;
        this.activeSessionId = undefined;
      }
    }
  }
  private async answer(
    input: Extract<AssistantManagedSessionRequest, { op: "answer" }>,
    principal: AssistantSupervisorPrincipal,
    generation: number,
    jobEpoch: number,
  ): Promise<AssistantManagedSessionResponse> {
    const target = await this.target(input);
    if (target.scope !== "job")
      throw new Error("Routine answers are restricted to current assistant job workers.");
    const receiptId = `${target.job.id}:${input.sessionId}:${input.requestId}`,
      fingerprint = createHash("sha256")
        .update(JSON.stringify({ ...input, chiefId: principal.id }))
        .digest("hex");
    const prior = await this.store.db
      .prepare("SELECT value FROM assistant_session_receipts WHERE id=?")
      .get(receiptId);
    if (prior) {
      const saved = JSON.parse(prior.value) as StoredOperation;
      if (saved.fingerprint !== fingerprint)
        throw new Error("A question retry must preserve its exact occurrence and answer.");
      return { operation: saved.operation };
    }
    await this.guard(target, input.sessionId, generation, true, jobEpoch);
    if (!(await this.ports.questionsAllowed?.()) || !this.ports.answerQuestion)
      throw new Error("The owner has not enabled routine worker answers.");
    const record = await this.store.session(input.sessionId),
      question = await readAssistantQuestionStatus(this.store, record, target.job.id, true);
    if (!question || question.questionOwnerRequired)
      throw new Error(
        question?.questionOwnerReason ?? "The original question is no longer pending.",
      );
    validateAssistantQuestionReply(record, input);
    const turnBlock = record.session.blocks.findLast(
      (block) => block.role === "user" && !block.draft && !block.continuationOf,
    );
    if (!turnBlock || !record.runId)
      throw new Error("The original worker turn is missing; ask the owner.");
    const row = await this.store.db
        .prepare("SELECT value FROM assistant_profile WHERE id='profile'")
        .get(),
      profile = row ? (JSON.parse(row.value) as AssistantProfile) : undefined;
    if (!profile?.name?.trim()) throw new Error("The assistant identity is not configured.");
    const controller = new AbortController();
    let operation: AssistantSessionOperation = {
      requestId: input.requestId,
      sessionId: input.sessionId,
      state: "unknown",
      delivery: "unknown",
      action: "answer",
    };
    await this.store.transaction(async () => {
      if (
        await this.store.db
          .prepare("SELECT receipt_id FROM assistant_question_claims WHERE token=?")
          .get(input.questionToken)
      )
        throw new Error(
          "This question already has a durable answer intent. Inspect its original receipt; it will not be replayed.",
        );
      await this.store.db
        .prepare("INSERT INTO assistant_question_claims(token,receipt_id) VALUES(?,?)")
        .run(input.questionToken, receiptId);
      await this.store.db
        .prepare("INSERT INTO assistant_session_receipts(id,value) VALUES(?,?)")
        .run(receiptId, JSON.stringify({ fingerprint, operation }));
    }, "critical");
    this.active = controller;
    this.activeJobId = target.job.id;
    this.activeSessionId = input.sessionId;
    const recheck = async () => {
      await this.guard(target, input.sessionId, generation, true, jobEpoch);
      if (!(await this.ports.questionsAllowed?.()))
        throw new Error("Routine answers were disabled.");
      const current = await this.store.session(input.sessionId);
      if (assistantQuestionToken(current) !== input.questionToken)
        throw new Error("The original question occurrence changed before delivery.");
      const question = await readAssistantQuestionStatus(
        this.store,
        current,
        target.job.id,
        true,
        input.questionToken,
      );
      if (!question || question.questionOwnerRequired)
        throw new Error(
          question?.questionOwnerReason ?? "The original question is no longer pending.",
        );
      controller.signal.throwIfAborted();
    };
    try {
      await this.ports.reserveTokens({
        jobId: target.job.id,
        requestId: `${receiptId}:answer`,
        estimatedTokens: Math.max(
          256,
          Math.ceil(JSON.stringify({ answers: input.answers, custom: input.custom }).length / 4) +
            256,
        ),
        phase: "answer",
        answerSource: {
          sessionId: input.sessionId,
          runId: record.runId,
          questionToken: input.questionToken,
          turnBlockId: turnBlock.id,
        },
      });
      await recheck();
      const result = await this.ports.answerQuestion({
        ...this.effectScope(target),
        scope: "job",
        jobId: target.job.id,
        sessionId: input.sessionId,
        requestId: receiptId,
        source: this.identity(await this.status(input.sessionId)),
        signal: controller.signal,
        recheck,
        questionToken: input.questionToken,
        answers: input.answers,
        ...(input.custom ? { custom: input.custom } : {}),
        author: {
          kind: "assistant",
          jobId: target.job.id,
          name: profile.name,
          reason: "answer",
          operationId: receiptId,
        },
      });
      if (
        result.delivery === "submitted" &&
        result.answeredBlockId &&
        result.turnBlockId === turnBlock.id
      ) {
        await this.ports.onAnswerSubmitted?.({
          jobId: target.job.id,
          operationId: receiptId,
          sessionId: input.sessionId,
          runId: record.runId,
          questionToken: input.questionToken,
          turnBlockId: turnBlock.id,
          answeredBlockId: result.answeredBlockId,
        });
        operation = { ...operation, state: "settled", delivery: "submitted" };
      }
      await this.saveReceipt(receiptId, { fingerprint, operation });
      await this.ports.onActivity?.({
        jobId: target.job.id,
        sessionId: input.sessionId,
        kind:
          operation.delivery === "submitted" ? "session.answerSubmitted" : "session.answerUnknown",
        operationId: receiptId,
      });
      return { operation };
    } catch {
      return { operation };
    } finally {
      if (this.active === controller) {
        this.active = undefined;
        this.activeJobId = undefined;
        this.activeSessionId = undefined;
      }
    }
  }
}
