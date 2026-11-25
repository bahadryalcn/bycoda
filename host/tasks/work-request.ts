import { createHash } from "node:crypto";
import type { HostStore } from "../store";
import type { HostTasks } from "./tasks";
import type { HostTask, HostTaskInput, WorkOrigin } from "../../src/features/tasks/model/hostTasks";

/** Fields a surface chooses for the run; each surface still resolves its own model for now. */
export type WorkExecution = Pick<HostTaskInput, "harness" | "model" | "modelSettings"> &
  Pick<HostTaskInput, "runtimeMode" | "providerAccountId" | "modelChoice">;

export type WorkOptions = Pick<HostTaskInput, "dependsOn" | "verifyCommand" | "isolate"> &
  Partial<
    Pick<
      HostTaskInput,
      "crewDefinitionId" | "maxRunMinutes" | "source" | "stewardId" | "automationId"
    >
  > & {
    /** Where the task starts. Defaults to the board's to-do column. */
    status?: "todo" | "queued";
    /** Defaults to on, except for a crew task, whose crew reviews its own work. */
    review?: boolean;
    deliveryApprovalRequired?: boolean;
  };

export type WorkRequest = {
  id: string;
  projectId: string;
  /** The owner's words, unchanged. */
  request: string;
  /** A short summary or reference the owner did not type; appended after the request. */
  context?: string;
  title: string;
  source: WorkOrigin;
  execution: WorkExecution;
  options?: WorkOptions;
};

/** The same stable request id delivered twice yields one task. */
export type WorkReceipt = { requestId: string };

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** What a request becomes: the owner's words, then any context, never rewritten. */
export function workPrompt(request: string, context?: string): string {
  const note = context?.trim();
  return note ? `${request}\n\nContext:\n${note}` : request;
}

/**
 * The one place a task is created from a request, whichever surface asked.
 * Callers check their own permission and approval first; defaults live here:
 * the task is reviewed, never merges or continues unattended on its own, and
 * its run length is inherited from the Host.
 */
export async function createWork(
  deps: { store: HostStore; tasks: Pick<HostTasks, "ready" | "get" | "save"> },
  work: WorkRequest,
  receipt: WorkReceipt,
): Promise<HostTask> {
  const { options = {} } = work;
  const task = {
    ...work.execution,
    ...(options.crewDefinitionId ? { crewDefinitionId: options.crewDefinitionId } : {}),
    ...(options.dependsOn ? { dependsOn: options.dependsOn } : {}),
    ...(options.verifyCommand === undefined ? {} : { verifyCommand: options.verifyCommand }),
    ...(options.isolate === undefined ? {} : { isolate: options.isolate }),
    ...(options.source ? { source: options.source } : {}),
    ...(options.stewardId ? { stewardId: options.stewardId } : {}),
    ...(options.automationId ? { automationId: options.automationId } : {}),
    ...(work.source.automationRunId ? { automationRunId: work.source.automationRunId } : {}),
    ...(options.deliveryApprovalRequired ? { deliveryApprovalRequired: true } : {}),
    id: work.id,
    projectId: work.projectId,
    title: work.title,
    prompt: workPrompt(work.request, work.context),
    request: work.request,
    origin: work.source,
    // shortcut: 0 inherits the Host's run length; budgets are owned by the runtime budget code.
    maxRunMinutes: options.maxRunMinutes ?? 0,
    review: options.review ?? !options.crewDefinitionId,
    // Neither an agent nor an automation may enable delivery or open-ended retries.
    autoMerge: false,
    continueUntilDone: false,
    status: options.status === "queued" ? ("queued" as const) : ("todo" as const),
  };
  const key = `work-request:${digest([work.projectId, receipt.requestId]).slice(0, 48)}`;
  const fingerprint = digest(task);
  // Opening the transaction first would hold the database while the task service starts up.
  await deps.tasks.ready;
  return deps.store.transaction(async () => {
    // The receipt is claimed before any effect; a replay finds it and creates nothing.
    const claimed = await deps.store.db
      .prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)")
      .run(key, JSON.stringify({ fingerprint, taskId: work.id }));
    if (Number(claimed.changes) !== 1) {
      const saved = (await deps.store.db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get(key)) as { value: string } | undefined;
      const existing = await deps.tasks.get(work.id);
      if (
        !saved ||
        (JSON.parse(String(saved.value)) as { fingerprint?: string }).fingerprint !== fingerprint ||
        !existing ||
        existing.projectId !== work.projectId
      )
        throw new Error("Task ID was reused or its task no longer exists.");
      return existing;
    }
    return deps.tasks.save({ ...task, expectedAbsent: true });
  });
}
