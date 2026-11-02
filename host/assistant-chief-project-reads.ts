import { createHash } from "node:crypto";
import { z } from "zod";
import type { HostStore } from "./store";
import { hostInbox } from "./host-notes";
import type { HostGoal } from "../src/features/tasks/model/hostGoals";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import type { HostSteward } from "../src/features/tasks/model/hostStewards";
import type { HostAutomation } from "../src/features/automations/model/hostAutomations";
import type { AssistantJob } from "../src/shared/model/host-contracts/assistant";
import { assistantJobProjectIds } from "../src/shared/model/assistantProjects";
import {
  assistantQuickAutomationId,
  assistantQuickAutomationFingerprint,
  type AssistantQuickAutomationReceipt,
} from "./assistant-quick-automations";

const id = z.string().min(1).max(200),
  version = z.number().int().nonnegative();
const scope = { jobId: id, projectId: id };
export const ChiefProjectReadRequestSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("stewards.list"), ...scope }),
  z.strictObject({
    op: z.literal("stewards.read"),
    ...scope,
    id,
    expectedUpdatedAt: version,
  }),
  z.strictObject({ op: z.literal("automations.list"), ...scope }),
  z.strictObject({
    op: z.literal("automations.read"),
    ...scope,
    id,
    expectedUpdatedAt: version,
  }),
  z.strictObject({ op: z.literal("inbox.list"), ...scope }),
  z.strictObject({
    op: z.literal("inbox.read"),
    ...scope,
    id,
    sourceToken: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);
export type ChiefProjectReadRequest = z.infer<
  typeof ChiefProjectReadRequestSchema
>;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cut = (text: string | undefined, max: number) =>
  (text ?? "").slice(0, max);
const EXTERNAL_INBOX = {
  available: false,
  reason:
    "External provider Inbox reads require a Chief account and desktop privacy grant; that admission contract is unavailable.",
} as const;
type JobSource = { job: AssistantJob; goal: HostGoal };
type ScopeSource = {
  job: AssistantJob;
  projectId: string;
  source: string;
  goal?: HostGoal;
  automationId?: string;
};

/** Metadata-only observations. No automation/steward lifecycle port or provider credential bridge. */
export class AssistantChiefProjectReads {
  constructor(
    private readonly store: HostStore,
    private readonly projectJob: (id: string) => Promise<JobSource>,
  ) {}
  private async row<T>(
    table:
      | "stewards"
      | "automations"
      | "assistant_jobs"
      | "tasks"
      | "assistant_quick_automations",
    id: string,
  ): Promise<T | undefined> {
    const available = await this.store.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
    if (!available) return undefined;
    const row = await this.store.db
      .prepare(
        `SELECT value FROM ${table} WHERE ${table === "assistant_quick_automations" ? "job_id" : "id"}=?${table === "assistant_jobs" ? " AND deleted_at IS NULL" : ""}`,
      )
      .get(id);
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  private async scope(jobId: string, projectId: string): Promise<ScopeSource> {
    const job = await this.row<AssistantJob>("assistant_jobs", jobId);
    if (!job) throw new Error("The original assistant job is unavailable.");
    const project = await this.store.project(projectId);
    if (job.kind !== "quick") {
      const canonical = await this.projectJob(jobId);
      if (!assistantJobProjectIds(canonical.job).includes(projectId))
        throw new Error("Read project is outside the saved job.");
      return {
        job: canonical.job,
        goal: canonical.goal,
        projectId,
        source: hash({
          jobId,
          version: canonical.job.version,
          projects: assistantJobProjectIds(canonical.job),
          goalId: canonical.goal.id,
          project,
        }),
      };
    }
    if (
      job.quickAction.kind !== "automation" ||
      job.projectId !== projectId ||
      job.quickAction.projectId !== projectId
    )
      throw new Error("A quick job has no project-wide read grant.");
    const receipt = await this.row<AssistantQuickAutomationReceipt>(
      "assistant_quick_automations",
      job.id,
    );
    const automationId = assistantQuickAutomationId(job.id),
      automation = await this.row<HostAutomation>("automations", automationId);
    if (
      !receipt ||
      receipt.state !== "completed" ||
      receipt.jobId !== job.id ||
      receipt.automationId !== automationId ||
      receipt.fingerprint !== assistantQuickAutomationFingerprint(job) ||
      job.quickIntent?.automationId !== automationId ||
      !automation ||
      automation.projectId !== projectId ||
      automation.createdAt !== receipt.automationCreatedAt
    )
      throw new Error(
        "The exact automation creation receipt is unavailable or changed.",
      );
    return {
      job,
      projectId,
      automationId,
      source: hash({ jobId, version: job.version, project, receipt }),
    };
  }
  private async rows<T extends { id: string; projectId: string }>(
    table: "stewards" | "automations",
    source: ScopeSource,
  ): Promise<{ available: boolean; items: T[]; truncated: boolean }> {
    if (table === "stewards" && source.automationId)
      return { available: false, items: [], truncated: false };
    const available = await this.store.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
    if (!available) return { available: false, items: [], truncated: false };
    const rows = source.automationId
      ? [
          {
            value: JSON.stringify(
              await this.row<HostAutomation>(
                "automations",
                source.automationId,
              ),
            ),
          },
        ]
      : await this.store.db
          .prepare(
            `SELECT value FROM ${table} WHERE json_extract(value,'$.projectId')=? ORDER BY json_extract(value,'$.updatedAt') DESC,id LIMIT 11`,
          )
          .all(source.projectId);
    const items = rows
      .map((row) => JSON.parse(row.value) as T)
      .filter((value) => value?.projectId === source.projectId);
    return {
      available: true,
      items: items.slice(0, 10),
      truncated: items.length > 10,
    };
  }
  private steward(value: HostSteward) {
    return {
      id: value.id,
      projectId: value.projectId,
      updatedAt: value.updatedAt,
      enabled: value.enabled,
      nextRunAt: value.nextRunAt,
      lastRunAt: value.lastRunAt,
      lastRunStatus: value.lastRunStatus,
      lastProposed: value.lastProposed,
      running: !!value.run,
      needsOwnerDeliveryApproval: !!value.deliveryApprovalRequired,
    };
  }
  private automation(value: HostAutomation) {
    return {
      id: value.id,
      projectId: value.projectId,
      updatedAt: value.updatedAt,
      name: cut(value.name, 120),
      enabled: value.enabled,
      nextRunAt: value.nextRunAt,
      lastRunAt: value.lastRunAt,
      lastRunStatus: value.lastRunStatus,
      needsInput: !!value.needsInput,
    };
  }
  private async attention(
    source: ScopeSource,
    automations: HostAutomation[],
    automationList: { available: boolean; truncated: boolean },
  ) {
    const tasks: HostTask[] = [];
    if (source.goal) {
      for (const id of source.goal.taskIds.slice(0, 20)) {
        const task = await this.row<HostTask>("tasks", id);
        if (
          task &&
          task.goalId === source.goal.id &&
          assistantJobProjectIds(source.job).includes(task.projectId) &&
          task.projectId === source.projectId
        )
          tasks.push(task);
      }
    }
    const goals = source.goal ? [source.goal] : [];
    // Session attention is already in the shared ten-attempt status budget; do
    // not silently spend extra session reads or borrow social-thread authority.
    const items = hostInbox(
      { sessions: [], tasks, goals, automations, threads: [] },
      source.projectId,
    ).items.map((item) => ({
      ...item,
      title: cut(item.title, 120),
      detail: cut(item.detail, 500),
    }));
    const truncated =
      items.length > 10 ||
      automationList.truncated ||
      !!(source.goal && source.goal.taskIds.length > 20);
    return {
      scope: "host-attention" as const,
      items: items.slice(0, 10),
      truncated,
      automationAttentionAvailable: automationList.available,
      sessionAttentionIncluded: false,
      socialAttentionIncluded: false,
      externalProviderInboxAvailable: false,
      externalProviders: EXTERNAL_INBOX,
      source: hash({
        scope: source.source,
        tasks,
        goals,
        automations,
        automationList,
        truncated,
      }),
    };
  }
  async resolve(request: ChiefProjectReadRequest) {
    const scope = await this.scope(request.jobId, request.projectId);
    if (request.op.startsWith("stewards.")) {
      if (scope.automationId)
        throw new Error("A quick automation cannot read project stewards.");
      const list = await this.rows<HostSteward>("stewards", scope);
      if (request.op === "stewards.list")
        return {
          source: hash({ scope: scope.source, ...list }),
          data: () => ({
            available: list.available,
            items: list.items.map((value) => this.steward(value)),
            truncated: list.truncated,
          }),
        };
      const target = request as Extract<
          ChiefProjectReadRequest,
          { op: "stewards.read" }
        >,
        value = await this.row<HostSteward>("stewards", target.id);
      if (
        !value ||
        value.projectId !== scope.projectId ||
        value.updatedAt !== target.expectedUpdatedAt
      )
        throw new Error("The steward changed or is outside the saved job.");
      return {
        source: hash({ scope: scope.source, value }),
        data: () => this.steward(value),
      };
    }
    const automations = await this.rows<HostAutomation>("automations", scope);
    if (request.op === "automations.list")
      return {
        source: hash({ scope: scope.source, ...automations }),
        data: () => ({
          available: automations.available,
          items: automations.items.map((value) => this.automation(value)),
          truncated: automations.truncated,
        }),
      };
    if (request.op === "automations.read") {
      const value = await this.row<HostAutomation>("automations", request.id);
      if (
        !value ||
        value.projectId !== scope.projectId ||
        value.updatedAt !== request.expectedUpdatedAt ||
        (scope.automationId && scope.automationId !== value.id)
      )
        throw new Error("The automation changed or is outside the saved job.");
      return {
        source: hash({ scope: scope.source, value }),
        data: () => this.automation(value),
      };
    }
    const inbox = await this.attention(scope, automations.items, automations);
    if (request.op === "inbox.list")
      return { source: inbox.source, data: () => inbox };
    if (request.op !== "inbox.read" || request.sourceToken !== inbox.source)
      throw new Error("The attention source changed; take fresh status.");
    const value = inbox.items.find((value) => value.id === request.id);
    if (!value)
      throw new Error(
        "This attention item is not in the bounded canonical queue.",
      );
    return {
      source: hash({ scope: scope.source, inboxSource: inbox.source, value }),
      data: () => ({
        scope: "host-attention",
        item: value,
        externalProviderInboxAvailable: false,
      }),
    };
  }
  async snapshot(jobId: string, projectId: string) {
    const scope = await this.scope(jobId, projectId),
      stewards = await this.rows<HostSteward>("stewards", scope),
      automations = await this.rows<HostAutomation>("automations", scope),
      inbox = await this.attention(scope, automations.items, automations);
    return {
      jobId,
      projectId,
      sourceToken: hash({
        scope: scope.source,
        stewards,
        automations,
        inbox: inbox.source,
      }),
      stewards: {
        available: stewards.available,
        items: stewards.items.slice(0, 3).map((value) => this.steward(value)),
        truncated: stewards.truncated || stewards.items.length > 3,
      },
      automations: {
        available: automations.available,
        items: automations.items
          .slice(0, 3)
          .map((value) => this.automation(value)),
        truncated: automations.truncated || automations.items.length > 3,
      },
      inbox: {
        ...inbox,
        items: inbox.items.slice(0, 3),
        truncated: inbox.truncated || inbox.items.length > 3,
      },
    };
  }
}
