import { assistantJobProjectIds } from "../../../src/shared/model/assistantProjects";
import type {
  AssistantJob,
  AssistantNotification,
} from "../../../src/shared/model/host-contracts/assistant";

/** Runtime record per job: `{ after: <job id> }`. Kept off the job object so every client's strict job schema stays valid. */
export const jobAfterKey = (jobId: string) => `jobAfter:${jobId}`;
const MAX_CHAIN = 20;

type Db = {
  prepare(sql: string): {
    all(): Array<Record<string, unknown>> | Promise<Array<Record<string, unknown>>>;
  };
};
type Notice = Omit<AssistantNotification, "eligible" | "deferredReason">;

/** Dependencies by job id (`job -> the job it follows`), for the snapshot's `dependency` holds. */
export async function loadJobDependencies(db: Db): Promise<Record<string, string>> {
  const rows = await db
    .prepare(
      "SELECT id,json_extract(value,'$.value.after') AS after FROM assistant_runtime WHERE id LIKE 'jobAfter:%' AND deleted_at IS NULL LIMIT 1000",
    )
    .all();
  const links: Record<string, string> = {};
  for (const row of rows)
    if (typeof row.after === "string") links[String(row.id).slice("jobAfter:".length)] = row.after;
  return links;
}

/** The job a new job may follow: an existing, live project job whose own chain is short and acyclic. */
export async function assertJobAfter(
  deps: {
    job(id: string): Promise<Pick<AssistantJob, "id" | "kind"> | undefined>;
    after(id: string): Promise<{ after: string } | null>;
  },
  afterId: string,
  newJobId?: string,
): Promise<void> {
  const seen = new Set<string>(newJobId ? [newJobId] : []);
  for (let id: string | undefined = afterId, depth = 0; id; depth++) {
    if (seen.has(id) || depth >= MAX_CHAIN)
      throw new Error("A job cannot wait on itself or on a circular chain of jobs.");
    seen.add(id);
    const found = await deps.job(id);
    if (!found || found.kind === "quick")
      throw new Error("The job to wait for was not found or is not a project job.");
    id = (await deps.after(id))?.after;
  }
}

/** True while the job must stay queued because the job it follows is not done. The first time the
 * followed job ends without finishing, one waiting notification says so. */
export async function holdForDependency(
  deps: {
    after(id: string): Promise<{ after: string } | null>;
    queueNotification(value: Notice): Promise<unknown>;
    now(): number;
  },
  job: AssistantJob,
  jobs: readonly AssistantJob[],
): Promise<boolean> {
  const link = await deps.after(job.id);
  if (!link) return false;
  const target = jobs.find((item) => item.id === link.after);
  if (target?.status === "done") return false;
  const ended =
    !target || target.status === "cancelled"
      ? "was cancelled"
      : target.status === "failed"
        ? "failed"
        : undefined;
  if (ended)
    await deps.queueNotification({
      id: `job-dependency:${job.id}`,
      kind: "job.waiting",
      title: job.title,
      body: `Waiting for ${target?.title ?? "an earlier job"}, which ${ended}.`,
      createdAt: deps.now(),
      jobId: job.id,
      ...(job.projectId ? { projectId: job.projectId } : {}),
      projectIds: assistantJobProjectIds(job),
    });
  return true;
}
