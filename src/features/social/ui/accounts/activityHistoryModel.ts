import type { AiAction } from "../../model/autonomy";
import type { SocialJob } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";

/** Jobs read per page; the Host caps a page at 100 and reports the total. */
export const JOB_PAGE = 20;
/** Pages skipped in one read when the Host filtered a whole AI action page away. */
const EMPTY_ACTION_PAGES = 4;

export type JobsRead = { jobs: SocialJob[]; next?: number };
export type ActionsRead = { items: AiAction[]; next?: string };
/** Rows read so far for `request`; a `next` marks a source the Host still holds rows for. */
export type LoadedHistory = {
  request?: object;
  jobs: SocialJob[];
  jobsNext?: number | undefined;
  actions: AiAction[];
  actionsNext?: string | undefined;
};
export type ActivityEntry =
  | { kind: "job"; at: number; job: SocialJob }
  | { kind: "action"; at: number; action: AiAction };

/** One job page. `next` is the offset of the following page, absent when the Host holds no more rows. */
export async function readJobs(
  client: SocialClient,
  projectId: string | undefined,
  offset = 0,
): Promise<JobsRead> {
  const response = await client.sectionSnapshot({
    section: "history",
    limit: JOB_PAGE,
    ...(offset ? { offsets: { jobs: offset } } : {}),
    ...(projectId ? { projectId } : {}),
  });
  const jobs = response.snapshot?.jobs ?? [];
  const page = response.snapshot?.pages?.jobs;
  // The Host clamps an offset past the end, so the effective offset comes from its page.
  const end = (page?.offset ?? offset) + jobs.length;
  return {
    jobs,
    ...(page && jobs.length && end < page.total ? { next: end } : {}),
  };
}

/** One AI action page; the Host scopes it to the accounts the principal can read. */
export async function readActions(client: SocialClient, cursor?: string): Promise<ActionsRead> {
  let page = await client.ai.actions(cursor ? { cursor } : {});
  // The Host filters a page by readable account after slicing it, so it can come back empty with a cursor.
  for (let skipped = 0; skipped < EMPTY_ACTION_PAGES && !page.items.length && page.next; skipped++)
    page = await client.ai.actions({ cursor: page.next });
  return { items: page.items, ...(page.next ? { next: page.next } : {}) };
}

export function appendUnique<T extends { id: string }>(rows: T[], more: T[]): T[] {
  return [...new Map([...rows, ...more].map((row) => [row.id, row])).values()];
}

const oldest = (times: number[]) => (times.length ? Math.min(...times) : undefined);

/**
 * Jobs and AI actions as one newest-first list. A source with more rows on the Host may still hold
 * rows newer than what the other source has loaded further back, so entries older than the oldest
 * row of every unfinished source wait until that source loads past them.
 */
export function mergeActivity(
  jobs: SocialJob[],
  actions: AiAction[],
  jobsMore: boolean,
  actionsMore: boolean,
): { entries: ActivityEntry[]; held: number } {
  const all: ActivityEntry[] = [
    ...jobs.map((job): ActivityEntry => ({
      kind: "job",
      at: job.createdAt,
      job,
    })),
    ...actions.map((action): ActivityEntry => ({
      kind: "action",
      at: action.at,
      action,
    })),
  ].sort((a, b) => b.at - a.at);
  const edges = [
    ...(jobsMore ? [oldest(jobs.map((job) => job.createdAt))] : []),
    ...(actionsMore ? [oldest(actions.map((action) => action.at))] : []),
  ].filter((edge): edge is number => edge !== undefined);
  const frontier = edges.length ? Math.max(...edges) : -Infinity;
  const entries = all.filter((entry) => entry.at >= frontier);
  return { entries, held: all.length - entries.length };
}
