import type {
  SocialAccount,
  SocialContact,
  SocialJob,
  SocialThread,
} from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";

const PRIVATE_REPLY_WINDOW = 7 * 24 * 60 * 60 * 1000;

/** Instagram browser compose resolves this handle back to the approved numeric recipient. */
export function instagramDirectHandle(contact: SocialContact): string | undefined {
  const profileHandle = /^https:\/\/www\.instagram\.com\/([a-z0-9._]{1,30})\/?$/i.exec(
    contact.profileUrl ?? "",
  )?.[1];
  return profileHandle ?? (/^[a-z0-9._]{1,30}$/i.test(contact.name) ? contact.name : undefined);
}

/** A private reply targets the verified inbound comment. Meta enforces the active LIVE session. */
export function instagramPrivateReplyTarget(
  account: SocialAccount,
  thread: SocialThread | undefined,
  now: number,
): NonNullable<SocialJob["payload"]["instagramPrivateReply"]> {
  if (
    account.platform !== "instagram" ||
    account.connection === "browser" ||
    thread?.kind !== "comment" ||
    thread.accountId !== account.id ||
    thread.replyAllowed === false
  )
    throw new SocialPlatformError("unsupported");
  const inbound = thread.events.filter((event) => event.direction === "inbound").at(-1);
  const until = (inbound?.at ?? 0) + PRIVATE_REPLY_WINDOW;
  if (!inbound || until <= now)
    throw new SocialPlatformError("rejected", undefined, { reasonCode: "meta.window_closed" });
  return { commentId: inbound.platformId, until };
}
