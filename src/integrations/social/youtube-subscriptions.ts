import { SocialPlatformError } from "./adapter";
import {
  readOwnedYouTubeChannel,
  type YouTubeManagementContext,
  type YouTubePage,
  youtubePageToken,
  youtubeResourceIdPattern,
} from "./youtube-manage";

const endpoint = "https://www.googleapis.com/youtube/v3/";
const channelIdPattern = /^UC[\w-]{22}$/u;

export type YouTubeSubscriptionDirection = "incoming" | "outgoing";
export type YouTubeSubscriptionAction = "subscribe" | "unsubscribe";
export type YouTubeSubscription = { id: string; channelId: string; title: string };

function subscriptionFromResource(
  resource: Record<string, any>,
  ownChannelId: string,
  direction: YouTubeSubscriptionDirection,
): YouTubeSubscription | undefined {
  const { id, snippet, subscriberSnippet } = resource;
  if (typeof id !== "string" || !youtubeResourceIdPattern.test(id)) return undefined;
  if (
    direction === "outgoing"
      ? snippet?.channelId !== ownChannelId
      : snippet?.resourceId?.channelId !== ownChannelId
  )
    return undefined;
  const channelId =
    direction === "outgoing" ? snippet?.resourceId?.channelId : subscriberSnippet?.channelId;
  const title = direction === "outgoing" ? snippet?.title : subscriberSnippet?.title;
  if (typeof channelId !== "string" || !channelIdPattern.test(channelId)) return undefined;
  return { id, channelId, title: typeof title === "string" ? title : channelId };
}

export async function listYouTubeSubscriptions(
  context: YouTubeManagementContext,
  direction: YouTubeSubscriptionDirection,
  pageToken?: string,
): Promise<YouTubePage<YouTubeSubscription>> {
  if (direction !== "incoming" && direction !== "outgoing")
    throw new SocialPlatformError("rejected");
  const page = youtubePageToken(pageToken);
  await readOwnedYouTubeChannel(context, "id");
  const { http, token, quota, channelId } = context;
  const query = new URLSearchParams({
    part: direction === "outgoing" ? "snippet" : "snippet,subscriberSnippet",
    maxResults: "50",
    ...page,
  });
  query.set(direction === "outgoing" ? "mine" : "mySubscribers", "true");
  quota.charge("subscriptions.list");
  const { value } = await http.request(`${endpoint}subscriptions?${query}`, token);
  const items: YouTubeSubscription[] = [];
  for (const resource of value.items ?? []) {
    if (!resource) continue;
    const subscription = subscriptionFromResource(resource, channelId, direction);
    if (subscription) items.push(subscription);
  }
  return {
    items,
    nextPageToken: typeof value.nextPageToken === "string" ? value.nextPageToken : undefined,
  };
}

function validateTarget(
  ownChannelId: string,
  targetChannelId: string,
  action: YouTubeSubscriptionAction,
) {
  if (
    typeof targetChannelId !== "string" ||
    !channelIdPattern.test(targetChannelId) ||
    targetChannelId === ownChannelId ||
    (action !== "subscribe" && action !== "unsubscribe")
  )
    throw new SocialPlatformError("rejected");
}

async function currentSubscription(
  { http, token, quota, channelId }: YouTubeManagementContext,
  targetChannelId: string,
): Promise<YouTubeSubscription | undefined> {
  const query = new URLSearchParams({
    part: "snippet",
    mine: "true",
    forChannelId: targetChannelId,
  });
  quota.charge("subscriptions.list");
  const { value } = await http.request(`${endpoint}subscriptions?${query}`, token);
  if (value.items === undefined || (Array.isArray(value.items) && !value.items.length))
    return undefined;
  if (!Array.isArray(value.items) || value.items.length !== 1 || !value.items[0])
    throw new SocialPlatformError("unknown");
  const subscription = subscriptionFromResource(value.items[0], channelId, "outgoing");
  if (subscription?.channelId !== targetChannelId) throw new SocialPlatformError("unknown");
  return subscription;
}

/** Read-only consequence preview, including the canonical channel identity for suppression. */
export async function previewYouTubeSubscription(
  context: YouTubeManagementContext,
  targetChannelId: string,
  action: YouTubeSubscriptionAction,
): Promise<{
  channelId: string;
  title: string;
  action: YouTubeSubscriptionAction;
  subscribed: boolean;
  wouldChange: boolean;
  writeQuotaUnits: number;
}> {
  const { http, token, quota, channelId } = context;
  validateTarget(channelId, targetChannelId, action);
  await readOwnedYouTubeChannel(context, "id");
  quota.charge("channels.list");
  const { value } = await http.request(
    `${endpoint}channels?${new URLSearchParams({ part: "snippet", id: targetChannelId })}`,
    token,
  );
  const target = value.items?.[0];
  if (target?.id !== targetChannelId) throw new SocialPlatformError("rejected");
  const subscribed = Boolean(await currentSubscription(context, targetChannelId));
  const wouldChange = subscribed !== (action === "subscribe");
  return {
    channelId: targetChannelId,
    title: typeof target.snippet?.title === "string" ? target.snippet.title : targetChannelId,
    action,
    subscribed,
    wouldChange,
    writeQuotaUnits: wouldChange ? 50 : 0,
  };
}

/** Host authorizes this mutation. Re-read membership to avoid unnecessary or wrong-target writes. */
export async function changeYouTubeSubscription(
  context: YouTubeManagementContext,
  targetChannelId: string,
  action: YouTubeSubscriptionAction,
): Promise<{ channelId: string; subscribed: boolean; changed: boolean }> {
  const { http, token, quota, channelId } = context;
  validateTarget(channelId, targetChannelId, action);
  await readOwnedYouTubeChannel(context, "id");
  const current = await currentSubscription(context, targetChannelId);
  if (action === "unsubscribe") {
    if (!current) return { channelId: targetChannelId, subscribed: false, changed: false };
    await context.beforeWrite?.();
    quota.charge("subscriptions.delete");
    await http.request(
      `${endpoint}subscriptions?${new URLSearchParams({ id: current.id })}`,
      token,
      { method: "DELETE" },
    );
    return { channelId: targetChannelId, subscribed: false, changed: true };
  }
  if (current) return { channelId: targetChannelId, subscribed: true, changed: false };
  await context.beforeWrite?.();
  quota.charge("subscriptions.insert");
  const { value } = await http.json(`${endpoint}subscriptions?part=snippet`, token, {
    snippet: { resourceId: { kind: "youtube#channel", channelId: targetChannelId } },
  });
  if (subscriptionFromResource(value, channelId, "outgoing")?.channelId !== targetChannelId)
    throw new SocialPlatformError("unknown");
  return { channelId: targetChannelId, subscribed: true, changed: true };
}
