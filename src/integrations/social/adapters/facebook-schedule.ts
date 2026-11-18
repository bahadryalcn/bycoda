import {
  SocialPlatformError,
  type SocialAccount,
  type SocialHttp,
  type SocialJob,
} from "../adapter";

export function facebookNativeScheduleAt(
  options: SocialJob["payload"]["facebook"],
): number | undefined {
  return options?.target === "feed" || options?.target === "video"
    ? options.scheduledPublishAt
    : undefined;
}

/** The Page Feed permits 10 minutes–75 days; this window also fits Page Videos. */
export function facebookScheduleTime(at: number, now: number): number | undefined {
  if (!Number.isSafeInteger(at)) return;
  const seconds = Math.floor(at / 1000);
  const delay = seconds * 1000 - now;
  return delay >= 10 * 60_000 && delay <= 75 * 86_400_000 ? seconds : undefined;
}

export async function updateFacebookPost(
  http: SocialHttp,
  graphVersion: string,
  account: SocialAccount,
  token: string,
  postId: string,
  message: string,
  beforeSubmit?: () => Promise<void>,
): Promise<void> {
  if (
    account.platform !== "facebook" ||
    account.accountType !== "page" ||
    account.connection === "browser" ||
    !["pages_manage_posts", "pages_read_engagement"].every((scope) =>
      account.scopes.includes(scope),
    )
  )
    throw new SocialPlatformError("denied");
  if (
    !/^v\d{1,3}\.\d{1,2}$/.test(graphVersion) ||
    !/^[1-9]\d{0,24}_[1-9]\d{0,24}$/.test(postId) ||
    !message.trim() ||
    message.length > 63_206
  )
    throw new SocialPlatformError("unsupported");
  if (postId.split("_")[0] !== account.platformId) throw new SocialPlatformError("denied");
  const endpoint = `https://graph.facebook.com/${graphVersion}/${postId}`;
  const { value: post } = await http.request(`${endpoint}?fields=id,from`, token);
  if (post.id !== postId || post.from?.id !== account.platformId)
    throw new SocialPlatformError("denied");
  await beforeSubmit?.();
  const { value } = await http.json(endpoint, token, { message });
  if (value.success !== true) throw new SocialPlatformError("unknown");
}
