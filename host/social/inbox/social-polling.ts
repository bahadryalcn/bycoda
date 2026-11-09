import type { SocialAccount } from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type { SocialServiceInternals } from "../core/social-internals";
import { hash } from "../core/social-helpers";
import { pollIntervalMs, readInboxSettings } from "./inbox-settings";

/** One account's inbox poll. SocialService.pollAccount owns the pending map and coalescing. */
export async function pollOwnedAccount(
  s: SocialServiceInternals,
  accountId: string,
): Promise<{
  ingested: number;
}> {
  const account = await s.get<SocialAccount>("account", accountId);
  const signature = hash(JSON.stringify(account));
  const epoch = await s.setting(`connectionEpoch:${account.id}`);
  const currentConnection = async () => {
    const current = await s.get<SocialAccount>("account", accountId);
    if (
      hash(JSON.stringify(current)) !== signature ||
      epoch !== (await s.setting(`connectionEpoch:${account.id}`))
    )
      throw new Error("Account connection changed while polling. Refresh this account again.");
    s.capability(current, "poll");
    if (current.paused || current.executorId !== s.store.environmentId)
      throw new Error("This host is not the active executor for the account.");
  };
  s.capability(account, "poll");
  if (account.paused || account.executorId !== s.store.environmentId)
    throw new Error("This host is not the active executor for the account.");
  const cooldown = Number((await s.setting(`pollRate:${account.id}`)) ?? 0);
  if (cooldown > s.now()) throw new Error("Inbox polling is waiting for the platform rate limit.");
  const credential = await s.credentials.get(accountId);
  if (!credential || (credential.expiresAt && credential.expiresAt <= s.now()))
    throw new SocialPlatformError("expired");
  try {
    await currentConnection();
    const adapter = s.adapterFor(account);
    // The adapter persists its exact page continuation alongside comment cursors.
    // Query only at its empty-batch boundary; never replace legacy pending IDs.
    const ownedPosts = async (after?: string) => {
      await currentConnection();
      const rows = await s.store.db
        .prepare(`SELECT id,json_extract(value,'$.platformId') AS platform_id FROM social_jobs_all
          WHERE account_id=? AND status='succeeded' AND json_extract(value,'$.kind')='publish'
            AND json_extract(value,'$.platformId') IS NOT NULL AND id>?
          ORDER BY id LIMIT 3`)
        .all(account.id, after ?? "");
      await currentConnection();
      return {
        posts: rows.slice(0, 2).map((row) => String(row.platform_id)),
        next: rows.length > 2 ? String(rows[1].id) : undefined,
      };
    };
    const result = await adapter.poll(
      account,
      credential.accessToken,
      adapter.ownedPostPages
        ? []
        : (
            await s.store.db
              .prepare(`SELECT json_extract(value,'$.platformId') AS platform_id FROM social_jobs_all
         WHERE account_id=? AND status='succeeded' AND json_extract(value,'$.kind')='publish'
           AND json_extract(value,'$.platformId') IS NOT NULL ORDER BY scheduled_at,id`)
              .all(account.id)
          )
            .map((row) => String(row.platform_id))
            .filter(Boolean),
      await s.setting(`cursor:${account.id}`),
      adapter.ownedPostPages ? ownedPosts : undefined,
    );
    return await s.transaction(async () => {
      await currentConnection();
      const ingested = await s.ingest(accountId, result.events);
      await currentConnection();
      await s.setSetting(
        `monitor:${account.id}`,
        JSON.stringify({
          checkedAt: s.now(),
          status: result.coverage?.some((channel) => channel.status === "unavailable")
            ? "partial"
            : "healthy",
          coverage: result.coverage ?? [],
        }),
      );
      if (result.cursor) await s.setSetting(`cursor:${account.id}`, result.cursor);
      const settings = await readInboxSettings(s);
      await s.setSetting(
        `pollRate:${account.id}`,
        String(s.now() + pollIntervalMs(account, settings, s.now())),
      );
      return { ingested };
    });
  } catch (error) {
    await s.setSetting(
      `monitor:${account.id}`,
      JSON.stringify({
        checkedAt: s.now(),
        status: "blocked",
        error: error instanceof SocialPlatformError ? error.code : "unknown",
      }),
    );
    if (error instanceof SocialPlatformError && error.code === "rate_limit")
      await s.setSetting(`pollRate:${account.id}`, String(error.retryAt));
    if (error instanceof SocialPlatformError && error.code === "expired") {
      const current = await s.get<SocialAccount>("account", account.id);
      current.expiresAt = s.now();
      await s.put("account", current.id, current);
    }
    throw error;
  }
}
