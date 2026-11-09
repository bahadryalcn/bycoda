import { SocialPlatformError, type SocialOwnedPostPage, type SocialJob } from "../adapter";

/** Helpers shared by platform adapters. Behavior is unchanged from the former platformAdapters.ts. */
export const id = (value: unknown) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_:.(),-]{1,300}$/.test(value))
    throw new SocialPlatformError("rejected");
  return encodeURIComponent(value);
};
export const text = (job: SocialJob) =>
  [job.payload.text, job.payload.link].filter(Boolean).join("\n");
export type Scan = {
  /** Pending bounded batch; legacy cursors drain their original IDs without eviction. */
  posts: string[];
  knownIndex?: number;
  knownAfter?: string;
  discoveryStart?: number;
  index: number;
  after: Record<string, string>;
  conversations?: string;
  discovery?: string;
  starts: Record<string, number>;
};
export function scanState(cursor?: string): Scan {
  try {
    const saved = JSON.parse(cursor ?? "{}");
    if (Array.isArray(saved.posts) && saved.after && saved.starts && Number.isInteger(saved.index))
      return saved;
  } catch {
    /* Old/no cursor starts a bounded scan. */
  }
  return { posts: [], index: 0, after: {}, starts: {} };
}
/** Retain active work only; paged Host readers advance at the drained-batch boundary. */
export async function enqueueKnownPosts(
  scan: Scan,
  posts: string[],
  source?: SocialOwnedPostPage,
): Promise<void> {
  if (source) {
    const page = await source(scan.knownAfter);
    if (page.posts.length > 2) throw new SocialPlatformError("unknown");
    for (const post of page.posts) {
      if (!scan.posts.includes(post)) scan.posts.push(post);
    }
    scan.knownAfter = page.next;
    return;
  }
  if (!posts.length) return;
  const start = Math.max(0, scan.knownIndex ?? 0) % posts.length;
  for (let offset = 0; offset < Math.min(2, posts.length); offset++) {
    const post = posts[(start + offset) % posts.length];
    if (!scan.posts.includes(post)) scan.posts.push(post);
  }
  scan.knownIndex = (start + Math.min(2, posts.length)) % posts.length;
}
export function completeScanPost(scan: Scan, post: string): void {
  delete scan.after[post];
  delete scan.starts[post];
  scan.posts.splice(scan.index, 1);
  if (scan.posts.length) scan.index %= scan.posts.length;
  else scan.index = 0;
}
export const graphNext = (value: Record<string, any>): string | undefined =>
  value.paging?.next && typeof value.paging?.cursors?.after === "string"
    ? value.paging.cursors.after
    : undefined;
export function requireId(value: unknown): string {
  if (typeof value !== "string" || !value) throw new SocialPlatformError("unknown");
  return value;
}
export const at = (value: unknown) => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number(value);
  if (!Number.isFinite(parsed)) throw new SocialPlatformError("rejected");
  return parsed;
};
