import { createHash } from "node:crypto";
import { z } from "zod";
import type { HostStore } from "./store";
import type { HostSession } from "../src/features/connections/model/protocol";
import type {
  AssistantJob,
  AssistantProfile,
} from "../src/shared/model/host-contracts/assistant";
import type { HostGoal } from "../src/features/tasks/model/hostGoals";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import type { AsyncHostNotes } from "./host-notes-async";
import { assistantJobProjectIds } from "../src/shared/model/assistantProjects";
import {
  assertAssistantGoalProjects,
  assistantJobSessionBelongs,
} from "./assistant-job-scope";
import { readAssistantQuestionStatus } from "./assistant-questions";
import {
  AssistantChiefProjectReads,
  ChiefProjectReadRequestSchema,
  type ChiefProjectReadRequest,
} from "./assistant-chief-project-reads";

export const CHIEF_READ_LIMITS = {
  calls: 4,
  statuses: 10,
  messages: 3,
  excerptChars: 6000,
  resultChars: 12000,
  cardChars: 20000,
} as const;
const id = z.string().min(1).max(200),
  version = z.number().int().nonnegative();
export const ChiefReadRequestSchema = z.discriminatedUnion("op", [
  ...ChiefProjectReadRequestSchema.options,
  z.strictObject({
    op: z.literal("sessions.status"),
    jobId: id,
    sessionId: id,
  }),
  z.strictObject({
    op: z.literal("sessions.read"),
    jobId: id,
    sessionId: id,
    sourceToken: z.string().regex(/^[a-f0-9]{64}$/),
    limit: z.number().int().min(1).max(3),
  }),
  z.strictObject({
    op: z.literal("tasks.read"),
    jobId: id,
    taskId: id,
    expectedUpdatedAt: version,
  }),
  z.strictObject({
    op: z.literal("goals.read"),
    jobId: id,
    expectedUpdatedAt: version,
  }),
  z.strictObject({
    op: z.literal("notes.read"),
    id,
    expectedUpdatedAt: version,
  }),
]);
export type ChiefReadRequest = z.infer<typeof ChiefReadRequestSchema>;
export function parseChiefReadRequests(raw: unknown): ChiefReadRequest[] {
  const requests = z
    .array(ChiefReadRequestSchema)
    .max(CHIEF_READ_LIMITS.calls)
    .parse(raw);
  const scopes = new Set<string>();
  let excerpts = 0;
  for (const request of requests) {
    const key =
      request.op === "sessions.read" || request.op === "sessions.status"
        ? `${request.op}:${request.jobId}:${request.sessionId}`
        : request.op === "notes.read"
          ? `note:${request.id}`
          : request.op === "goals.read"
            ? `goal:${request.jobId}`
            : request.op === "tasks.read"
              ? `task:${request.jobId}:${request.taskId}`
              : `${request.op}:${request.jobId}:${request.projectId}:${"id" in request ? request.id : "list"}`;
    if (scopes.has(key))
      throw new Error(
        "Chief reads must not repeat an exact scope in one wake.",
      );
    scopes.add(key);
    if (request.op === "sessions.read" && ++excerpts > 1)
      throw new Error(
        "Only one bounded session excerpt is available per wake.",
      );
  }
  return requests;
}
type Authorized = () => boolean | Promise<boolean>;
type ReadResult = { request: ChiefReadRequest; source: string; data: unknown };
type ReadReceipt = {
  fingerprint: string;
  source: string;
  state: "started" | "settled";
  result?: ReadResult;
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cut = (value: string | undefined, max: number) =>
  (value ?? "").slice(0, max);
export function currentAssistantRunActivity(
  record: HostSession,
  now = Date.now(),
): number | undefined {
  const activity = record.runActivity;
  return record.runId &&
    activity?.runId === record.runId &&
    Number.isSafeInteger(activity.lastActivityAt) &&
    activity.lastActivityAt >= 0 &&
    activity.lastActivityAt <= now
    ? activity.lastActivityAt
    : undefined;
}
export class AssistantChiefReads {
  readonly ready: Promise<void>;
  private readonly projectReads: AssistantChiefProjectReads;
  constructor(
    private readonly store: HostStore,
    private readonly notes?: () => Pick<AsyncHostNotes, "list" | "get">,
  ) {
    this.projectReads = new AssistantChiefProjectReads(store, (id) =>
      this.job(id),
    );
    this.ready = store.ready.then(() =>
      store.db.scope(() =>
        store.db.exec(
          "CREATE TABLE IF NOT EXISTS assistant_chief_reads(id TEXT PRIMARY KEY,value TEXT NOT NULL);",
        ),
      ),
    );
  }
  private async assert(authorized: Authorized) {
    await this.store.db.checkAuthorization();
    if (!(await authorized()))
      throw new Error("Chief read authority was revoked.");
  }
  private async job(id: string) {
    const row = await this.store.db
      .prepare(
        "SELECT value FROM assistant_jobs WHERE id=? AND deleted_at IS NULL",
      )
      .get(id);
    if (!row) throw new Error("Chief read job is unavailable.");
    const job = JSON.parse(row.value) as AssistantJob;
    if (job.kind === "quick" || job.goalId !== `assistant-${job.id}`)
      throw new Error("Chief reads require a canonical project job.");
    for (const projectId of assistantJobProjectIds(job))
      await this.store.project(projectId);
    const goalRow = await this.store.db
      .prepare("SELECT value FROM goals WHERE id=?")
      .get(job.goalId);
    if (!goalRow) throw new Error("Chief read goal is unavailable.");
    const goal = JSON.parse(goalRow.value) as HostGoal;
    assertAssistantGoalProjects(job, goal);
    return { job, goal };
  }
  private async session(jobId: string, sessionId: string) {
    const { job } = await this.job(jobId),
      record = await this.store.session(sessionId);
    if (
      !(await assistantJobSessionBelongs(
        this.store,
        job,
        sessionId,
        record.projectId,
      ))
    )
      throw new Error("Chief read session is outside its canonical job.");
    const sourceToken = hash({
      jobId,
      goalId: job.goalId,
      projects: assistantJobProjectIds(job),
      sessionId,
      projectId: record.projectId,
      cwd: record.session.worktreeCwd ?? record.session.cwd,
      generation: record.authorityGeneration,
      runId: record.runId,
      harness: record.session.harness,
      account: record.session.providerAccountId,
      model: record.session.model,
      settings: record.session.modelSettings,
    });
    return { record, sourceToken };
  }
  private async status(
    jobId: string,
    sessionId: string,
    profile: Pick<AssistantProfile, "allowRoutineQuestions">,
  ) {
    const { record, sourceToken } = await this.session(jobId, sessionId),
      question = await readAssistantQuestionStatus(
        this.store,
        record,
        jobId,
        profile.allowRoutineQuestions,
      );
    const activity = currentAssistantRunActivity(record);
    return {
      jobId,
      sessionId,
      sourceToken,
      projectId: record.projectId,
      state: record.status,
      ...(activity === undefined
        ? { activityKnown: false }
        : { activityKnown: true, lastActivityAt: activity }),
      context: record.session.context
        ? {
            used: record.session.context.used,
            window: record.session.context.window,
          }
        : null,
      pendingApproval: record.session.blocks.some(
        (block) => !!block.approval && !block.approval.decided,
      ),
      pendingQuestion: !!record.session.pendingQuestion,
      ...(question
        ? {
            questionOwnerRequired: question.questionOwnerRequired,
            questionOwnerReason: question.questionOwnerReason,
          }
        : {}),
      lastAssistantMessage: cut(
        record.session.blocks
          .filter((block) => block.role === "assistant")
          .at(-1)?.text,
        400,
      ),
    };
  }
  private async resolve(request: ChiefReadRequest) {
    if (isProjectRead(request)) return this.projectReads.resolve(request);
    if (request.op === "notes.read") {
      if (!this.notes) throw new Error("Assistant notes are unavailable.");
      const note = (await this.notes().list()).notes.find(
        (note) => note.id === request.id,
      );
      if (
        !note ||
        note.sourceCwd ||
        note.sourceSessionId ||
        !note.tags.includes("assistant") ||
        note.updatedAt !== request.expectedUpdatedAt
      )
        throw new Error("The assistant note source changed.");
      return {
        source: hash({ id: note.id, updatedAt: note.updatedAt }),
        data: async () => {
          const current = await this.notes!().get(request.id);
          if (
            !current ||
            current.sourceCwd ||
            current.sourceSessionId ||
            !current.tags.includes("assistant") ||
            current.updatedAt !== request.expectedUpdatedAt
          )
            throw new Error("The assistant note source changed.");
          return {
            id: current.id,
            title: cut(current.title, 200),
            body: cut(current.body, 4000),
            truncated: current.body.length > 4000,
          };
        },
      };
    }
    if (request.op === "sessions.status") {
      const row = await this.store.db
        .prepare(
          "SELECT value FROM assistant_profile WHERE id='profile' AND deleted_at IS NULL",
        )
        .get();
      const status = await this.status(request.jobId, request.sessionId, {
        allowRoutineQuestions: row
          ? JSON.parse(row.value).allowRoutineQuestions === true
          : false,
      });
      return { source: hash(status), data: () => status };
    }
    if (request.op === "sessions.read") {
      const { record, sourceToken } = await this.session(
        request.jobId,
        request.sessionId,
      );
      if (request.sourceToken !== sourceToken)
        throw new Error(
          "Read fresh status before requesting this session excerpt.",
        );
      return {
        source: sourceToken,
        data: async () => {
          const messages = record.session.blocks
              .filter(
                (block) =>
                  (block.role === "user" || block.role === "assistant") &&
                  !block.draft &&
                  block.text.trim(),
              )
              .slice(-request.limit),
            each = Math.floor(
              CHIEF_READ_LIMITS.excerptChars / Math.max(1, messages.length),
            );
          return {
            sessionId: request.sessionId,
            sourceToken,
            messages: messages.map((block) => ({
              role: block.role,
              text: cut(block.text, each),
            })),
            truncated: messages.some((block) => block.text.length > each),
            historyIncomplete: !!(
              record.session.historyPartial ||
              record.session.historyLoading ||
              record.session.historyLoadError
            ),
          };
        },
      };
    }
    const { job, goal } = await this.job(request.jobId);
    if (request.op === "goals.read") {
      if (goal.updatedAt !== request.expectedUpdatedAt)
        throw new Error("The goal changed; take fresh status.");
      return {
        source: hash({ jobId: job.id, id: goal.id, updatedAt: goal.updatedAt }),
        data: () => ({
          id: goal.id,
          status: goal.status,
          prompt: cut(goal.prompt, 2000),
          error: cut(goal.error ?? goal.planError, 500),
          tasks: goal.plan?.tasks.slice(0, 20).map((task) => ({
            key: task.key,
            title: cut(task.title, 120),
            projectId: task.projectId,
            dependsOn: task.dependsOn,
          })),
          truncated: goal.prompt.length > 2000,
        }),
      };
    }
    const row = await this.store.db
        .prepare("SELECT value FROM tasks WHERE id=?")
        .get(request.taskId),
      task = row ? (JSON.parse(row.value) as HostTask) : undefined;
    if (
      !task ||
      task.goalId !== goal.id ||
      !goal.taskIds.includes(task.id) ||
      !assistantJobProjectIds(job).includes(task.projectId) ||
      task.updatedAt !== request.expectedUpdatedAt
    )
      throw new Error("The task changed or is outside the saved job.");
    return {
      source: hash({
        jobId: job.id,
        id: task.id,
        updatedAt: task.updatedAt,
        projectId: task.projectId,
      }),
      data: () => ({
        id: task.id,
        projectId: task.projectId,
        title: cut(task.title, 200),
        status: task.status,
        prompt: cut(task.prompt, 2000),
        error: cut(task.error, 500),
        sessionId: task.sessionId,
        truncated: task.prompt.length > 2000,
      }),
    };
  }
  async execute(
    input: { operationId: string; requests: ChiefReadRequest[] },
    authorized: Authorized,
  ) {
    await this.ready;
    await this.assert(authorized);
    id.parse(input.operationId);
    const requests = parseChiefReadRequests(input.requests),
      results: ReadResult[] = [];
    const overLimit = (request: ChiefReadRequest): ReadResult => ({
      request,
      source: "unavailable",
      data: { unavailable: "Wake read result limit reached." },
    });
    const bound = (result: ReadResult, index: number): ReadResult =>
      JSON.stringify([
        ...results,
        result,
        ...requests.slice(index + 1).map(overLimit),
      ]).length > CHIEF_READ_LIMITS.resultChars
        ? overLimit(result.request)
        : result;
    const batchKey = `${input.operationId}:batch`,
      batchFingerprint = hash(requests);
    await this.store.transaction(async () => {
      const old = await this.store.db
        .prepare("SELECT value FROM assistant_chief_reads WHERE id=?")
        .get(batchKey);
      if (old) {
        if (JSON.parse(old.value).fingerprint !== batchFingerprint)
          throw new Error(
            "A Chief read retry must preserve its original request.",
          );
      } else
        await this.store.db
          .prepare("INSERT INTO assistant_chief_reads(id,value) VALUES(?,?)")
          .run(
            batchKey,
            JSON.stringify({ kind: "batch", fingerprint: batchFingerprint }),
          );
    }, "critical");
    for (const [index, request] of requests.entries()) {
      await this.assert(authorized);
      const key = `${input.operationId}:${index}`,
        fingerprint = hash(request),
        old = await this.store.db
          .prepare("SELECT value FROM assistant_chief_reads WHERE id=?")
          .get(key);
      if (
        old &&
        (JSON.parse(old.value) as ReadReceipt).fingerprint !== fingerprint
      )
        throw new Error(
          "A Chief read retry must preserve its original request.",
        );
      let result: ReadResult;
      try {
        const source = await this.resolve(request);
        await this.assert(authorized);
        if (old) {
          const saved = JSON.parse(old.value) as ReadReceipt;
          if (saved.fingerprint !== fingerprint)
            throw new Error("Changed Chief read retry.");
          if (saved.source !== source.source)
            throw new Error("Changed Chief read source.");
          result =
            saved.state === "settled"
              ? saved.result!
              : {
                  request,
                  source: source.source,
                  data: {
                    unavailable:
                      "Original read outcome is unknown; request fresh status.",
                  },
                };
        } else {
          await this.store.transaction(
            () =>
              this.store.db
                .prepare(
                  "INSERT INTO assistant_chief_reads(id,value) VALUES(?,?)",
                )
                .run(
                  key,
                  JSON.stringify({
                    fingerprint,
                    source: source.source,
                    state: "started",
                  } satisfies ReadReceipt),
                ),
            "critical",
          );
          const data = await source.data();
          await this.assert(authorized);
          if ((await this.resolve(request)).source !== source.source)
            throw new Error("Chief read source changed before disclosure.");
          result = { request, source: source.source, data };
          result = bound(result, index);
          await this.store.transaction(
            () =>
              this.store.db
                .prepare("UPDATE assistant_chief_reads SET value=? WHERE id=?")
                .run(
                  JSON.stringify({
                    fingerprint,
                    source: source.source,
                    state: "settled",
                    result,
                  } satisfies ReadReceipt),
                  key,
                ),
            "critical",
          );
        }
      } catch {
        result = {
          request,
          source: "unavailable",
          data: {
            unavailable:
              "The original read source is unavailable or changed; request fresh status.",
          },
        };
      }
      await this.assert(authorized);
      results.push(bound(result, index));
    }
    await this.store.transaction(
      () =>
        this.store.db
          .prepare(
            "INSERT INTO assistant_chief_reads(id,value) VALUES('latest',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
          )
          .run(JSON.stringify({ operationId: input.operationId, results })),
      "critical",
    );
    return { operationId: input.operationId, results };
  }
  async snapshot(
    profile: Pick<AssistantProfile, "allowRoutineQuestions">,
    authorized: Authorized,
  ) {
    await this.ready;
    await this.assert(authorized);
    const jobs: unknown[] = [],
      statuses: unknown[] = [],
      notes: unknown[] = [];
    const projectReads: Awaited<
      ReturnType<AssistantChiefProjectReads["snapshot"]>
    >[] = [];
    const projectScopes = new Set<string>();
    let omittedJobs = 0,
      omittedSessions = 0,
      statusCalls = 0,
      unavailableSessions = 0,
      unavailableProjectScopes = 0,
      notesAvailable = !!this.notes;
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM assistant_jobs WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 101",
      )
      .all();
    for (const row of rows) {
      const job = JSON.parse(row.value) as AssistantJob;
      for (const projectId of (
        job.kind === "quick"
          ? job.quickAction.kind === "automation"
          : !["done", "failed", "cancelled"].includes(job.status)
      )
        ? assistantJobProjectIds(job)
        : []) {
        const key = `${job.id}:${projectId}`;
        if (projectScopes.size >= 5 || projectScopes.has(key)) continue;
        projectScopes.add(key);
        try {
          projectReads.push(
            await this.projectReads.snapshot(job.id, projectId),
          );
          await this.assert(authorized);
        } catch {
          unavailableProjectScopes++;
        }
      }
      if (
        job.kind === "quick" ||
        ["done", "failed", "cancelled"].includes(job.status)
      )
        continue;
      if (jobs.length >= 5) {
        omittedJobs++;
        continue;
      }
      try {
        const { goal } = await this.job(job.id),
          tasks = [];
        for (const taskId of goal.taskIds.slice(0, 5)) {
          const value = await this.store.db
            .prepare("SELECT value FROM tasks WHERE id=?")
            .get(taskId);
          if (!value) continue;
          const task = JSON.parse(value.value) as HostTask;
          if (
            task.goalId === goal.id &&
            assistantJobProjectIds(job).includes(task.projectId)
          )
            tasks.push({
              id: task.id,
              title: cut(task.title, 80),
              status: task.status,
              updatedAt: task.updatedAt,
            });
        }
        jobs.push({
          jobId: job.id,
          projectIds: assistantJobProjectIds(job),
          goal: { id: goal.id, status: goal.status, updatedAt: goal.updatedAt },
          tasks,
          omittedTasks: Math.max(0, goal.taskIds.length - tasks.length),
        });
        for (const sessionId of job.sessionIds) {
          if (statusCalls >= CHIEF_READ_LIMITS.statuses) {
            omittedSessions++;
            continue;
          }
          statusCalls++;
          try {
            const status = await this.status(job.id, sessionId, profile);
            await this.assert(authorized);
            if (
              (await this.session(job.id, sessionId)).sourceToken !==
              status.sourceToken
            ) {
              unavailableSessions++;
              continue;
            }
            statuses.push(status);
          } catch {
            unavailableSessions++;
          }
        }
      } catch {
        /* Unverified sources never become context or read grants. */
      }
    }
    if (this.notes)
      try {
        const list = await this.notes().list();
        for (const note of list.notes
          .filter(
            (note) =>
              !note.sourceCwd &&
              !note.sourceSessionId &&
              note.tags.includes("assistant"),
          )
          .slice(0, 10))
          notes.push({
            id: note.id,
            title: cut(note.title, 120),
            updatedAt: note.updatedAt,
          });
      } catch {
        notesAvailable = false;
      }
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_chief_reads WHERE id='latest'")
      .get();
    const latest = row
        ? (JSON.parse(row.value) as {
            operationId: string;
            results: ReadResult[];
          })
        : undefined,
      results: ReadResult[] = [];
    if (latest)
      for (const result of latest.results) {
        try {
          if ((await this.resolve(result.request)).source === result.source)
            results.push(result);
          else
            results.push({
              ...result,
              data: { unavailable: "The accepted read source changed." },
            });
        } catch {
          results.push({
            ...result,
            data: { unavailable: "The accepted read source is unavailable." },
          });
        }
      }
    const card = {
      limits: CHIEF_READ_LIMITS,
      jobs,
      statuses,
      notes,
      notesAvailable,
      projectReads,
      projectReadsLimited: projectScopes.size >= 5,
      unavailableProjectScopes,
      externalProviderInbox: {
        available: false,
        reason:
          "External provider Inbox reads require a Chief account and desktop privacy grant; that admission contract is unavailable.",
      },
      statusCalls,
      unavailableSessions,
      omittedJobs,
      omittedSessions,
      ...(latest
        ? { readResults: { operationId: latest.operationId, results } }
        : {}),
    };
    while (
      JSON.stringify(card).length > CHIEF_READ_LIMITS.cardChars &&
      (statuses.length || jobs.length || notes.length || projectReads.length)
    ) {
      if (projectReads.length) {
        projectReads.pop();
        card.projectReadsLimited = true;
      } else if (notes.length) notes.pop();
      else if (jobs.length) {
        jobs.pop();
        card.omittedJobs++;
      } else {
        statuses.pop();
        card.omittedSessions++;
      }
    }
    await this.assert(authorized);
    for (let index = projectReads.length - 1; index >= 0; index--) {
      const value = projectReads[index];
      try {
        if (
          (await this.projectReads.snapshot(value.jobId, value.projectId))
            .sourceToken === value.sourceToken
        )
          continue;
      } catch {}
      projectReads.splice(index, 1);
      card.unavailableProjectScopes++;
    }
    for (let index = statuses.length - 1; index >= 0; index--) {
      const status = statuses[index] as {
        jobId: string;
        sessionId: string;
        sourceToken: string;
      };
      try {
        if (
          (await this.session(status.jobId, status.sessionId)).sourceToken ===
          status.sourceToken
        )
          continue;
      } catch {}
      statuses.splice(index, 1);
      card.omittedSessions++;
    }
    for (let index = results.length - 1; index >= 0; index--) {
      const result = results[index];
      try {
        if ((await this.resolve(result.request)).source === result.source)
          continue;
      } catch {}
      results[index] = {
        ...result,
        data: {
          unavailable: "The accepted read source changed before disclosure.",
        },
      };
    }
    await this.assert(authorized);
    return card;
  }
}
function isProjectRead(
  request: ChiefReadRequest,
): request is ChiefProjectReadRequest {
  return ChiefProjectReadRequestSchema.safeParse(request).success;
}
