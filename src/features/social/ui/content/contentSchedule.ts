import { t } from "../../../../shared/i18n";
import { truncateGraphemes } from "../../../../shared/lib/text/truncate";
import type { SocialAccount, SocialJob } from "../../model/social";

/** Only YouTube (publishAt) and Facebook (native schedule) hold a later post on the platform. */
export function schedulesOnPlatform(account: SocialAccount): boolean {
  return (
    account.connection !== "browser" &&
    (account.platform === "youtube" || account.platform === "facebook")
  );
}

/** One short line for an account whose later post is sent by bycoda at that time, else undefined. */
export function localScheduleHint(account: SocialAccount): string | undefined {
  if (schedulesOnPlatform(account)) return undefined;
  return t("{p0}: bycoda sends it, so it must be running then.", { p0: account.name });
}

export type QuoteTarget = { id: string; label: string };

/** Posts MonoCode published to an X account, newest first, for choosing a quote target. */
export function publishedXPosts(
  jobs: readonly SocialJob[],
  accountId: string,
  limit = 20,
): QuoteTarget[] {
  return jobs
    .filter(
      (job) =>
        job.accountId === accountId &&
        job.kind === "publish" &&
        job.status === "succeeded" &&
        !!job.platformId &&
        /^\d{1,19}$/.test(job.platformId),
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((job) => ({
      id: job.platformId!,
      label: truncateGraphemes(job.payload.text.replace(/\s+/g, " ").trim(), 60) || job.platformId!,
    }));
}
