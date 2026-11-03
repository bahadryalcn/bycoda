import { createHash, randomUUID } from "node:crypto";
import type { HostStore } from "./store";
import type { AssistantJob } from "../src/shared/model/host-contracts/assistant";
import type { HostGoal } from "../src/features/tasks/model/hostGoals";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import { assertAssistantGoalProjects } from "./assistant-job-scope";
import { assistantJobProjectIds } from "../src/shared/model/assistantProjects";
import {
  AssistantOwnerQuestionAskSchema,
  AssistantOwnerQuestionPresentSchema,
  AssistantOwnerQuestionMutationSchema,
  AssistantOwnerQuestionSchema,
  validateAssistantOwnerAnswer,
  type AssistantOwnerQuestion,
  type AssistantOwnerQuestionAsk,
  type AssistantOwnerQuestionMutation,
  type AssistantOwnerQuestionReceipt,
  type AssistantOwnerQuestionPresent,
} from "../src/shared/model/assistantOwnerQuestions";

type Source = { jobId: string; jobVersion: number; projectIds: string[]; sourceToken: string };
type Result = {
  ownerQuestion: AssistantOwnerQuestion | null;
  ownerQuestionReceipt?: AssistantOwnerQuestionReceipt;
};
export type AssistantOwnerProposalBinding = Pick<
  AssistantOwnerQuestionPresent,
  "threadId" | "ownerMessageId" | "contextProjectIds" | "causalContextId"
> & { messageIds?: string[]; causalContextVersion?: number };
export type AssistantOwnerProposalSource = {
  sourceToken: string;
  projectIds: string[];
  origin: "voice-proposal" | "thread-proposal";
  messageIds: string[];
  causalContextId?: string;
  causalContextVersion?: number;
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const pending = (question: AssistantOwnerQuestion) =>
  question.status === "open" || question.status === "snoozed";

/** Decisions are durable data. This service has no Engine, approval or tool ports. */
export class HostAssistantOwnerQuestions {
  readonly ready: Promise<void>;
  constructor(
    private readonly store: HostStore,
    private readonly now: () => number = Date.now,
    private readonly proposalSource?: (
      input: AssistantOwnerProposalBinding,
    ) => Promise<AssistantOwnerProposalSource>,
  ) {
    this.ready = store.ready
      .then(() =>
        store.db.exec(
          `CREATE TABLE IF NOT EXISTS assistant_owner_questions(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,value TEXT NOT NULL,source TEXT,UNIQUE(job_id,request_id));CREATE TABLE IF NOT EXISTS assistant_owner_question_receipts(question_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(question_id,request_id));`,
        ),
      )
      .then(() => undefined);
  }
  async source(jobId: string): Promise<Source> {
    await this.ready;
    const row = await this.store.db
        .prepare("SELECT value FROM assistant_jobs WHERE id=? AND deleted_at IS NULL")
        .get(jobId),
      job = row ? (JSON.parse(row.value) as AssistantJob) : undefined;
    if (
      !job ||
      job.kind === "quick" ||
      job.goalId !== `assistant-${job.id}` ||
      ["done", "failed", "cancelled", "paused"].includes(job.status) ||
      job.pendingTaskDeletion ||
      job.awaitingOwnerRestart
    )
      throw new Error(
        "Only a current project job assigned to this assistant can request a decision.",
      );
    const goalRow = await this.store.db
      .prepare("SELECT value FROM goals WHERE id=?")
      .get(job.goalId);
    if (!goalRow) throw new Error("The canonical assistant goal is unavailable.");
    const goal = JSON.parse(goalRow.value) as HostGoal;
    assertAssistantGoalProjects(job, goal);
    if (goal.awaitingOwnerRestart || ["done", "cancelled"].includes(goal.status))
      throw new Error("The original goal no longer accepts this decision.");
    const rows = await this.store.db
        .prepare("SELECT value FROM tasks WHERE json_extract(value,'$.goalId')=? ORDER BY id")
        .all(goal.id),
      tasks = rows.map((row) => JSON.parse(row.value) as HostTask),
      projects = assistantJobProjectIds(job);
    if (
      new Set(goal.taskIds).size !== goal.taskIds.length ||
      tasks.length !== goal.taskIds.length ||
      tasks.some((task) => !goal.taskIds.includes(task.id) || !projects.includes(task.projectId))
    )
      throw new Error("The actual goal/task scope changed; review its canonical records.");
    for (const id of projects) await this.store.project(id);
    const sessionSources = [
      ...(goal.plannerSessionId
        ? [{ id: goal.plannerSessionId, runId: goal.plannerRunId, projectId: goal.leadProjectId }]
        : []),
      ...(goal.finalAcceptance?.sessionId
        ? [
            {
              id: goal.finalAcceptance.sessionId,
              runId: goal.finalAcceptance.runId,
              projectId: goal.leadProjectId,
            },
          ]
        : []),
      ...tasks.flatMap((task) => [
        ...(task.sessionId
          ? [{ id: task.sessionId, runId: task.runId, projectId: task.projectId }]
          : []),
        ...(task.reviewer?.sessionId
          ? [{ id: task.reviewer.sessionId, runId: task.reviewer.runId, projectId: task.projectId }]
          : []),
      ]),
    ];
    const sessions = [];
    for (const source of sessionSources) {
      const record = await this.store.session(source.id);
      if (record.projectId !== source.projectId || source.runId !== record.runId)
        throw new Error("A source session was replaced; review the new execution before asking.");
      sessions.push({
        id: source.id,
        runId: record.runId,
        projectId: record.projectId,
        authorityGeneration: record.authorityGeneration,
        cwd: record.session.worktreeCwd ?? record.session.cwd,
        harness: record.session.harness,
        model: record.session.model,
        modelSettings: record.session.modelSettings,
        runtimeMode: record.session.runtimeMode,
        providerAccountId: record.session.providerAccountId,
      });
    }
    return {
      jobId,
      jobVersion: job.version,
      projectIds: projects,
      sourceToken: hash({
        jobId,
        goalId: goal.id,
        goalPrompt: hash(goal.prompt),
        harness: goal.harness,
        model: goal.model,
        modelSettings: goal.modelSettings,
        plannerExecution: goal.plannerExecution,
        runtimeMode: goal.runtimeMode,
        projectIds: projects,
        leadProjectId: goal.leadProjectId,
        taskIds: [...goal.taskIds].sort(),
        tasks: tasks.map((task) => ({
          id: task.id,
          projectId: task.projectId,
          workspaceGenerationId: task.workspaceGenerationId,
          prompt: hash(task.prompt),
          harness: task.harness,
          model: task.model,
          modelSettings: task.modelSettings,
          runtimeMode: task.runtimeMode,
          providerAccountId: task.providerAccountId,
        })),
        sessions,
      }),
    };
  }
  private async read(id: string): Promise<AssistantOwnerQuestion | null> {
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_owner_questions WHERE id=?")
      .get(id);
    return row ? AssistantOwnerQuestionSchema.parse(JSON.parse(row.value)) : null;
  }
  private async currentSource(
    question: AssistantOwnerQuestion,
  ): Promise<{ sourceToken: string; projectIds: string[] }> {
    if (question.jobId) return this.source(question.jobId);
    const row = await this.store.db
      .prepare("SELECT source FROM assistant_owner_questions WHERE id=?")
      .get(question.id);
    if (!row?.source || !this.proposalSource)
      throw new Error("The original proposal source is unavailable.");
    return this.proposalSource(JSON.parse(row.source));
  }
  private async output(question: AssistantOwnerQuestion): Promise<AssistantOwnerQuestion> {
    let sourceCurrent = false;
    try {
      sourceCurrent = (await this.currentSource(question)).sourceToken === question.sourceToken;
    } catch {}
    return { ...question, sourceCurrent };
  }
  async get(id: string, requestId?: string): Promise<Result> {
    await this.ready;
    const question = await this.read(id);
    const receipt = requestId
      ? await this.store.db
          .prepare(
            "SELECT value FROM assistant_owner_question_receipts WHERE question_id=? AND request_id=?",
          )
          .get(id, requestId)
      : undefined;
    return {
      ownerQuestion: question ? await this.output(question) : null,
      ...(receipt
        ? { ownerQuestionReceipt: JSON.parse(receipt.value) as AssistantOwnerQuestionReceipt }
        : {}),
    };
  }
  async retainedScope(id: string, requestId: string): Promise<string[] | undefined> {
    await this.ready;
    const question = await this.read(id),
      row = await this.store.db
        .prepare(
          "SELECT value FROM assistant_owner_question_receipts WHERE question_id=? AND request_id=?",
        )
        .get(id, requestId);
    if (!question || !row) return undefined;
    const receipt = JSON.parse(row.value) as AssistantOwnerQuestionReceipt;
    if (receipt.input.id !== id || receipt.requestId !== requestId) return undefined;
    if (question.jobId) {
      const jobRow = await this.store.db
        .prepare("SELECT value FROM assistant_jobs WHERE id=?")
        .get(question.jobId);
      if (!jobRow) return undefined;
      const projects = assistantJobProjectIds(JSON.parse(jobRow.value) as AssistantJob);
      if (JSON.stringify(projects) !== JSON.stringify(question.projectIds)) return undefined;
    } else {
      try {
        if ((await this.currentSource(question)).sourceToken !== question.sourceToken)
          return undefined;
      } catch {
        return undefined;
      }
    }
    for (const projectId of question.projectIds) {
      try {
        await this.store.project(projectId);
      } catch {
        return undefined;
      }
    }
    return [...question.projectIds];
  }
  async capturedVoiceContext(id: string): Promise<string | undefined> {
    await this.ready;
    const row = await this.store.db
      .prepare("SELECT source FROM assistant_owner_questions WHERE id=?")
      .get(id);
    if (!row?.source) return undefined;
    const source = JSON.parse(row.source) as AssistantOwnerProposalBinding;
    return source.causalContextId;
  }
  async list(): Promise<AssistantOwnerQuestion[]> {
    await this.ready;
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM assistant_owner_questions ORDER BY CASE WHEN json_extract(value,'$.status') IN ('open','snoozed') THEN 0 ELSE 1 END,json_extract(value,'$.updatedAt') DESC,id LIMIT 40",
      )
      .all();
    return Promise.all(
      rows.map((row) => this.output(AssistantOwnerQuestionSchema.parse(JSON.parse(row.value)))),
    );
  }
  async dueSnoozed(): Promise<AssistantOwnerQuestion[]> {
    await this.ready;
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM assistant_owner_questions WHERE json_extract(value,'$.status')='snoozed' AND json_extract(value,'$.snoozedUntil')<=? LIMIT 20",
      )
      .all(this.now());
    return rows.map((row) => AssistantOwnerQuestionSchema.parse(JSON.parse(row.value)));
  }
  async ask(
    raw: AssistantOwnerQuestionAsk,
    authorized: () => Promise<boolean>,
    onPersist?: (question: AssistantOwnerQuestion) => Promise<void>,
  ): Promise<Result> {
    const input = AssistantOwnerQuestionAskSchema.parse(raw);
    await this.ready;
    return this.store.transaction(async () => {
      if (!(await authorized()))
        throw new Error("Current Chief authority is required to request a decision.");
      const fingerprint = hash(input),
        existing = await this.store.db
          .prepare(
            "SELECT fingerprint,value FROM assistant_owner_questions WHERE job_id=? AND request_id=?",
          )
          .get(input.jobId, input.requestId);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new Error("This decision request ID already has a different payload.");
        return {
          ownerQuestion: await this.output(
            AssistantOwnerQuestionSchema.parse(JSON.parse(existing.value)),
          ),
        };
      }
      const source = await this.source(input.jobId);
      if (
        source.jobVersion !== input.expectedJobVersion ||
        source.sourceToken !== input.sourceToken
      )
        throw new Error("The captured job source changed; refresh before requesting a decision.");
      const superseded = input.supersedesId ? await this.read(input.supersedesId) : null;
      if (
        input.supersedesId &&
        (!superseded ||
          !pending(superseded) ||
          superseded.jobId !== input.jobId ||
          superseded.version !== input.expectedSupersededVersion)
      )
        throw new Error("The question to supersede changed; review it first.");
      const count = await this.store.db
        .prepare(
          "SELECT count(*) AS total FROM assistant_owner_questions WHERE json_extract(value,'$.status') IN ('open','snoozed')",
        )
        .get();
      if (Number(count?.total ?? 0) - (superseded ? 1 : 0) >= 20)
        throw new Error(
          "Twenty owner decisions are already pending; resolve one before adding another.",
        );
      const now = this.now(),
        id = randomUUID(),
        question: AssistantOwnerQuestion = {
          id,
          version: 1,
          jobId: source.jobId,
          projectIds: source.projectIds,
          sourceToken: source.sourceToken,
          origin: "chief",
          prompt: {
            requestId: 0,
            occurrenceId: id,
            ...(input.title ? { title: input.title } : {}),
            behavior: "nonBlocking",
            questions: input.questions.map((draft) => ({
              ...draft,
              id: randomUUID(),
              options: draft.options.map((option) => ({ ...option, id: randomUUID() })),
            })),
          },
          status: "open",
          createdAt: now,
          updatedAt: now,
        };
      if (!(await authorized()))
        throw new Error("Current Chief authority changed before the decision was saved.");
      if (superseded)
        await this.write({
          ...superseded,
          status: "superseded",
          supersededBy: id,
          version: superseded.version + 1,
          updatedAt: now,
        });
      await this.store.db.checkAuthorization();
      await this.store.db
        .prepare(
          "INSERT INTO assistant_owner_questions(id,job_id,request_id,fingerprint,value) VALUES(?,?,?,?,?)",
        )
        .run(id, input.jobId, input.requestId, fingerprint, JSON.stringify(question));
      await onPersist?.(question);
      return { ownerQuestion: { ...question, sourceCurrent: true } };
    }, "critical");
  }
  private async write(question: AssistantOwnerQuestion) {
    await this.store.db.checkAuthorization();
    await this.store.db
      .prepare("UPDATE assistant_owner_questions SET value=? WHERE id=?")
      .run(JSON.stringify(question), question.id);
  }
  async present(
    raw: AssistantOwnerQuestionPresent,
    onPersist?: (question: AssistantOwnerQuestion) => Promise<void>,
  ): Promise<Result> {
    const input = AssistantOwnerQuestionPresentSchema.parse(raw);
    await this.ready;
    if (!this.proposalSource) throw new Error("Canonical proposal sources are unavailable.");
    return this.store.transaction(async () => {
      const key = `thread:${input.threadId}:${input.ownerMessageId}`,
        fingerprint = hash(input),
        existing = await this.store.db
          .prepare(
            "SELECT fingerprint,value FROM assistant_owner_questions WHERE job_id=? AND request_id=?",
          )
          .get(key, input.requestId);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new Error("This proposal request ID already has a different payload.");
        return {
          ownerQuestion: await this.output(
            AssistantOwnerQuestionSchema.parse(JSON.parse(existing.value)),
          ),
        };
      }
      const source = await this.proposalSource!(input),
        count = await this.store.db
          .prepare(
            "SELECT count(*) AS total FROM assistant_owner_questions WHERE json_extract(value,'$.status') IN ('open','snoozed')",
          )
          .get();
      if (Number(count?.total ?? 0) >= 20)
        throw new Error(
          "Twenty owner decisions are already pending; resolve one before adding another.",
        );
      const now = this.now(),
        id = randomUUID(),
        question: AssistantOwnerQuestion = {
          id,
          version: 1,
          jobId: null,
          threadId: input.threadId,
          ownerMessageId: input.ownerMessageId,
          projectIds: source.projectIds,
          sourceToken: source.sourceToken,
          origin: source.origin,
          prompt: {
            requestId: 0,
            occurrenceId: id,
            ...(input.title ? { title: input.title } : {}),
            behavior: "nonBlocking",
            questions: input.questions.map((draft) => ({
              ...draft,
              id: randomUUID(),
              options: draft.options.map((option) => ({ ...option, id: randomUUID() })),
            })),
          },
          status: "open",
          createdAt: now,
          updatedAt: now,
        };
      await this.store.db.checkAuthorization();
      await this.store.db
        .prepare(
          "INSERT INTO assistant_owner_questions(id,job_id,request_id,fingerprint,value,source) VALUES(?,?,?,?,?,?)",
        )
        .run(
          id,
          key,
          input.requestId,
          fingerprint,
          JSON.stringify(question),
          JSON.stringify({
            threadId: input.threadId,
            ownerMessageId: input.ownerMessageId,
            contextProjectIds: input.contextProjectIds,
            messageIds: source.messageIds,
            ...(source.causalContextId
              ? {
                  causalContextId: source.causalContextId,
                  causalContextVersion: source.causalContextVersion,
                }
              : {}),
          }),
        );
      await onPersist?.(question);
      return { ownerQuestion: { ...question, sourceCurrent: true } };
    }, "critical");
  }
  async mutate(
    raw: AssistantOwnerQuestionMutation,
    onPersist?: (
      question: AssistantOwnerQuestion,
      kind: AssistantOwnerQuestionReceipt["kind"],
    ) => Promise<void>,
  ): Promise<Result> {
    const input = AssistantOwnerQuestionMutationSchema.parse(raw);
    await this.ready;
    return this.store.transaction(async () => {
      const fingerprint = hash(input),
        old = await this.store.db
          .prepare(
            "SELECT fingerprint,value FROM assistant_owner_question_receipts WHERE question_id=? AND request_id=?",
          )
          .get(input.id, input.requestId);
      if (old) {
        if (old.fingerprint !== fingerprint)
          throw new Error("This owner request ID already has a different decision payload.");
        return {
          ...(await this.get(input.id)),
          ownerQuestionReceipt: JSON.parse(old.value) as AssistantOwnerQuestionReceipt,
        };
      }
      const question = await this.read(input.id);
      if (!question || question.version !== input.expectedVersion || !pending(question))
        throw new Error("This owner decision changed; reload its current record.");
      const now = this.now(),
        kind =
          input.op === "questions.answer"
            ? "answer"
            : input.op === "questions.snooze"
              ? "snooze"
              : "cancel",
        version = question.version + 1,
        receipt: AssistantOwnerQuestionReceipt = {
          requestId: input.requestId,
          kind,
          version,
          at: now,
          input,
        };
      let next: AssistantOwnerQuestion = {
        ...question,
        version,
        updatedAt: now,
        lastOwnerAction: receipt,
      };
      if (input.op === "questions.answer") {
        const source = await this.currentSource(question);
        if (
          source.sourceToken !== question.sourceToken ||
          JSON.stringify(source.projectIds) !== JSON.stringify(question.projectIds)
        )
          throw new Error(
            "The decision source changed; cancel it or request a fresh decision before answering.",
          );
        const answer = validateAssistantOwnerAnswer(question.prompt.questions, {
          answers: input.answers,
          custom: input.custom,
        });
        next = {
          ...next,
          status: "answered",
          snoozedUntil: undefined,
          answer: { ...answer, requestId: input.requestId, answeredAt: now, version },
        };
      } else if (input.op === "questions.snooze") {
        if (input.until <= now || input.until > now + 7 * 86400000)
          throw new Error("Choose a reminder within the next seven days.");
        next = { ...next, status: "snoozed", snoozedUntil: input.until };
      } else next = { ...next, status: "cancelled", snoozedUntil: undefined };
      await this.write(next);
      await this.store.db
        .prepare(
          "INSERT INTO assistant_owner_question_receipts(question_id,request_id,fingerprint,value) VALUES(?,?,?,?)",
        )
        .run(input.id, input.requestId, fingerprint, JSON.stringify(receipt));
      await onPersist?.(next, kind);
      return { ownerQuestion: await this.output(next), ownerQuestionReceipt: receipt };
    }, "critical");
  }
}
