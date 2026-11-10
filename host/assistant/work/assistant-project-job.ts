import type { HostStore } from "../../store";
import { assistantJobProjectIds as projectIdsOf } from "../../../src/shared/model/assistantProjects";
import type {
  AssistantJob,
  AssistantRequest,
} from "../../../src/shared/model/host-contracts/assistant";
import type { AssistantRepository, RecordValue } from "../repository";
import { assertJobAfter, jobAfterKey } from "./assistant-job-after";

type ProjectCreate = Exclude<Extract<AssistantRequest, { op: "jobs.create" }>, { kind: "quick" }>;
const FINISHED = new Set(["done", "failed", "cancelled"]);
export const MAX_ACTIVE_JOBS = 100;

/** `jobs.create` for a project job: one idempotent receipt, an optional `after` dependency recorded in
 * the same commit so the tick can never start the job before its dependency is known. */
export async function createAssistantProjectJob(
  deps: {
    store: HostStore;
    repository: AssistantRepository;
    stamp(): RecordValue;
    activity(kind: string, summary: string, extra: { jobId: string }): Promise<unknown>;
    setRuntime(id: string, value: unknown): Promise<unknown>;
  },
  input: ProjectCreate,
  projectIds: string[],
): Promise<AssistantJob> {
  const { repository } = deps;
  return deps.store.transaction(async () => {
    const old = await repository.byKey<AssistantJob>("jobs", input.idempotencyKey);
    if (old) {
      if (
        old.kind === "quick" ||
        old.title !== input.title ||
        old.request !== input.request ||
        old.projectId !== input.projectId ||
        JSON.stringify(projectIdsOf(old)) !== JSON.stringify(projectIds)
      )
        throw new Error("A job retry must preserve the original request.");
      return old;
    }
    const active = (await repository.list<AssistantJob>("jobs", 10000)).filter(
      (job) => !FINISHED.has(job.status),
    );
    if (active.length >= MAX_ACTIVE_JOBS)
      throw new Error("The assistant already tracks 100 active jobs.");
    if (input.after)
      await assertJobAfter(
        {
          job: (id) => repository.get<AssistantJob>("jobs", id),
          after: (id) =>
            repository
              .get<{ value: { after: string } }>("runtime", jobAfterKey(id))
              .then((row) => row?.value ?? null),
        },
        input.after,
      );
    const value = await repository.put(
      "jobs",
      {
        ...deps.stamp(),
        title: input.title,
        request: input.request,
        projectId: input.projectId,
        projectIds,
        status: "queued" as const,
        taskIds: [],
        sessionIds: [],
        progress: { done: 0, total: 0 },
        summary: "",
        tokens: 0,
        idempotencyKey: input.idempotencyKey,
        dispatchState: "pending" as const,
      },
      0,
      input.idempotencyKey,
    );
    if (input.after) await deps.setRuntime(jobAfterKey(value.id), { after: input.after });
    await deps.activity("job.received", "A new job was received.", { jobId: value.id });
    return value as unknown as AssistantJob;
  }, "critical");
}
