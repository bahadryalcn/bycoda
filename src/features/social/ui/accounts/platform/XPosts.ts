import type { SocialJob } from "../../../model/social";

/** The text a published post is listed by: its first words, or its X id when it has no text. */
export function xPostLabel(job: Pick<SocialJob, "payload" | "platformId">) {
  return job.payload.text.trim().slice(0, 100) || job.platformId || "";
}

/** Posts this account published through MonoCode that X confirmed; only these have an X post id. */
export function xPublishedPosts(jobs: SocialJob[], accountId: string) {
  return jobs.filter(
    (job) =>
      job.accountId === accountId &&
      job.kind === "publish" &&
      job.status === "succeeded" &&
      job.platformId,
  );
}
