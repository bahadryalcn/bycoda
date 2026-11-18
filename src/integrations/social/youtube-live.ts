import { SocialHttp, SocialPlatformError } from "./adapter";
import type { YouTubeQuota, YouTubeQuotaOperation } from "./youtube-quota";

const endpoint = "https://www.googleapis.com/youtube/v3/";
const broadcastParts = "id,snippet,contentDetails,status";
const broadcastIdPattern = /^[\w-]{11}$/;
const channelIdPattern = /^UC[\w-]{22}$/;
const resourceIdPattern = /^[\w.=-]{1,400}$/;
const privacyStatuses = ["private", "unlisted", "public"] as const;
const transitionStatuses = ["testing", "live", "complete"] as const;

type LivePrivacy = (typeof privacyStatuses)[number];
export type YouTubeLiveTransition = (typeof transitionStatuses)[number];
export type YouTubeLiveCreateInput = {
  title: string;
  description?: string;
  scheduledStartTime: string;
  privacyStatus: LivePrivacy;
  madeForKids: boolean;
};

export type YouTubeLiveBroadcast = {
  id: string;
  channelId: string;
  title: string;
  scheduledStartTime?: string;
  privacyStatus?: string;
  status?: string;
  streamId?: string;
  chatId?: string;
  monitorStreamEnabled?: boolean;
};

export type YouTubeLiveIngestSecret = {
  streamId: string;
  rtmpUrl: string;
  streamKey: string;
};

type IngestReference = Omit<YouTubeLiveIngestSecret, "streamKey"> & { credentialRef: string };
export type YouTubeLiveCreateResult =
  | { status: "created"; broadcast: YouTubeLiveBroadcast; ingest: IngestReference }
  | {
      status: "partial";
      broadcastId: string;
      streamId?: string;
      ingest?: IngestReference;
      stage: "stream" | "credential" | "bind";
      code: SocialPlatformError["code"];
      reasonCode?: string;
    };

type LiveRequest = { method: "POST" | "DELETE"; body?: unknown };
async function requestLive(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  operation: YouTubeQuotaOperation,
  path: string,
  params: Record<string, string>,
  request?: LiveRequest,
) {
  quota.charge(operation);
  const url = `${endpoint}${path}?${new URLSearchParams(params)}`;
  const { value } =
    request?.body === undefined
      ? await http.request(url, token, request && { method: request.method })
      : await http.json(url, token, request.body);
  return value;
}

function safeId(value: unknown, pattern = resourceIdPattern): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function resourceId(value: unknown, pattern = resourceIdPattern): string {
  const id = safeId(value, pattern);
  if (!id) throw new SocialPlatformError("unknown");
  return id;
}

function pageToken(cursor?: string): Record<string, string> {
  if (cursor === undefined) return {};
  if (typeof cursor !== "string" || !cursor.length || cursor.length > 4096)
    throw new SocialPlatformError("rejected");
  return { pageToken: cursor };
}

type BroadcastResource = {
  id?: unknown;
  snippet?: { channelId?: unknown; title?: unknown; scheduledStartTime?: unknown; liveChatId?: unknown };
  contentDetails?: { boundStreamId?: unknown; monitorStream?: { enableMonitorStream?: unknown } };
  status?: { privacyStatus?: unknown; lifeCycleStatus?: unknown };
};

function normalizeBroadcast(value: BroadcastResource): YouTubeLiveBroadcast {
  const monitorStreamEnabled = value.contentDetails?.monitorStream?.enableMonitorStream;
  return {
    id: resourceId(value.id, broadcastIdPattern),
    channelId: resourceId(value.snippet?.channelId, channelIdPattern),
    title: optionalString(value.snippet?.title) ?? "",
    scheduledStartTime: optionalString(value.snippet?.scheduledStartTime),
    privacyStatus: optionalString(value.status?.privacyStatus),
    status: optionalString(value.status?.lifeCycleStatus),
    streamId: safeId(value.contentDetails?.boundStreamId),
    chatId: safeId(value.snippet?.liveChatId),
    monitorStreamEnabled: typeof monitorStreamEnabled === "boolean" ? monitorStreamEnabled : undefined,
  };
}

export async function listYouTubeLiveBroadcasts(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  cursor?: string,
) {
  const result = await requestLive(http, token, quota, "liveBroadcasts.list", "liveBroadcasts", {
    part: broadcastParts,
    mine: "true",
    broadcastType: "all",
    maxResults: "50",
    ...pageToken(cursor),
  });
  return {
    broadcasts: (result.items ?? []).map(normalizeBroadcast) as YouTubeLiveBroadcast[],
    next: optionalString(result.nextPageToken),
  };
}

export async function getYouTubeLiveBroadcast(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  channelId: string,
  broadcastId: string,
): Promise<YouTubeLiveBroadcast> {
  if (!safeId(broadcastId, broadcastIdPattern) || !safeId(channelId, channelIdPattern))
    throw new SocialPlatformError("rejected");
  const result = await requestLive(http, token, quota, "liveBroadcasts.list", "liveBroadcasts", {
    part: broadcastParts,
    id: broadcastId,
  });
  const raw = result.items?.find((item: BroadcastResource) => item.id === broadcastId);
  if (raw?.snippet?.channelId !== channelId) throw new SocialPlatformError("denied");
  return normalizeBroadcast(raw);
}

function ingestionAddress(value: unknown, streamKey: string): string | undefined {
  const url = typeof value === "string" ? URL.parse(value) : null;
  if (
    !url ||
    (url.protocol !== "rtmps:" && url.protocol !== "rtmp:") ||
    !url.hostname.endsWith(".youtube.com") ||
    !/^\/live2\/?$/.test(url.pathname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    value === streamKey
  )
    return undefined;
  return url.toString();
}

/** Creates exactly one broadcast and stream. Reports partial outcomes without replaying writes. */
export async function createYouTubeLiveBroadcast(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  input: YouTubeLiveCreateInput,
  options: {
    saveIngest(secret: YouTubeLiveIngestSecret): Promise<string>;
    /** Revalidates Host account, grants and stops before each remote write. */
    beforeWrite?(): Promise<void>;
    now?(): number;
  },
): Promise<YouTubeLiveCreateResult> {
  const now = (options.now ?? Date.now)();
  const scheduledAt = Date.parse(input.scheduledStartTime);
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (
    !title ||
    title.length > 100 ||
    (input.description !== undefined &&
      (typeof input.description !== "string" || input.description.length > 5000)) ||
    !Number.isFinite(scheduledAt) ||
    scheduledAt <= now ||
    !privacyStatuses.includes(input.privacyStatus) ||
    typeof input.madeForKids !== "boolean"
  )
    throw new SocialPlatformError("rejected");

  await options.beforeWrite?.();
  const created = await requestLive(
    http,
    token,
    quota,
    "liveBroadcasts.insert",
    "liveBroadcasts",
    { part: broadcastParts },
    {
      method: "POST",
      body: {
        snippet: {
          title,
          description: input.description,
          scheduledStartTime: new Date(scheduledAt).toISOString(),
        },
        status: {
          privacyStatus: input.privacyStatus,
          selfDeclaredMadeForKids: input.madeForKids,
        },
        contentDetails: { enableAutoStart: false, enableAutoStop: false },
      },
    },
  );
  const broadcastId = resourceId(created.id, broadcastIdPattern);
  let stage: "stream" | "credential" | "bind" = "stream";
  let streamId: string | undefined;
  let ingest: IngestReference | undefined;
  try {
    await options.beforeWrite?.();
    const stream = await requestLive(
      http,
      token,
      quota,
      "liveStreams.insert",
      "liveStreams",
      { part: "id,snippet,cdn,contentDetails" },
      {
        method: "POST",
        body: {
          snippet: { title },
          cdn: { frameRate: "variable", resolution: "variable", ingestionType: "rtmp" },
          contentDetails: { isReusable: false },
        },
      },
    );
    streamId = resourceId(stream.id);
    const details = stream.cdn?.ingestionInfo;
    const streamKey = safeId(details?.streamName);
    if (!streamKey) throw new SocialPlatformError("unknown");
    const rtmpUrl =
      ingestionAddress(details.rtmpsIngestionAddress, streamKey) ??
      ingestionAddress(details.ingestionAddress, streamKey);
    if (!rtmpUrl) throw new SocialPlatformError("unknown");
    stage = "credential";
    const credentialRef = await options.saveIngest({ streamId, rtmpUrl, streamKey });
    ingest = { streamId, rtmpUrl, credentialRef };

    stage = "bind";
    await options.beforeWrite?.();
    const bound = await requestLive(
      http,
      token,
      quota,
      "liveBroadcasts.bind",
      "liveBroadcasts/bind",
      { id: broadcastId, streamId, part: broadcastParts },
      { method: "POST" },
    );
    const broadcast = normalizeBroadcast(bound);
    if (broadcast.id !== broadcastId || broadcast.streamId !== streamId)
      throw new SocialPlatformError("unknown");
    return { status: "created", broadcast, ingest };
  } catch (error) {
    const platformError = error instanceof SocialPlatformError ? error : undefined;
    return {
      status: "partial",
      broadcastId,
      streamId,
      ingest,
      stage,
      code: platformError?.code ?? "unknown",
      reasonCode: platformError?.detail?.reasonCode,
    };
  }
}

export async function transitionYouTubeLiveBroadcast(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  channelId: string,
  broadcastId: string,
  status: YouTubeLiveTransition,
  beforeWrite?: () => Promise<void>,
): Promise<YouTubeLiveBroadcast> {
  if (!transitionStatuses.includes(status)) throw new SocialPlatformError("rejected");
  const broadcast = await getYouTubeLiveBroadcast(http, token, quota, channelId, broadcastId);
  if (
    broadcast.status === status ||
    (status === "testing" && broadcast.status === "testStarting") ||
    (status === "live" && broadcast.status === "liveStarting")
  )
    return broadcast;
  if (status !== "complete") {
    const stream = broadcast.streamId
      ? await requestLive(http, token, quota, "liveStreams.list", "liveStreams", {
          part: "id,status",
          id: broadcast.streamId,
        })
      : undefined;
    if (stream?.items?.[0]?.status?.streamStatus !== "active")
      throw new SocialPlatformError("rejected", undefined, {
        reasonCode: "youtube_live_stream_inactive",
      });
    if (status === "live" && broadcast.monitorStreamEnabled && broadcast.status !== "testing")
      throw new SocialPlatformError("rejected", undefined, {
        reasonCode: "youtube_live_testing_required",
      });
  }
  await beforeWrite?.();
  const transitioned = await requestLive(
    http,
    token,
    quota,
    "liveBroadcasts.transition",
    "liveBroadcasts/transition",
    { id: broadcastId, broadcastStatus: status, part: broadcastParts },
    { method: "POST" },
  );
  return normalizeBroadcast(transitioned);
}

type SuperChatAmount = {
  amountMicros?: string;
  currency?: string;
  displayAmount?: string;
};

function unsignedMicros(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return typeof value === "string" && /^\d{1,20}$/.test(value) ? value : undefined;
}

export type YouTubeLiveChatEvent = {
  id: string;
  type: string;
  text?: string;
  authorChannelId?: string;
  authorName?: string;
  publishedAt?: string;
  superChat?: SuperChatAmount;
};

type ApiSuperChatAmount = { amountMicros?: unknown; currency?: unknown; amountDisplayString?: unknown };
type LiveChatResource = {
  id?: unknown;
  snippet?: {
    type?: unknown;
    displayMessage?: unknown;
    publishedAt?: unknown;
    superChatDetails?: ApiSuperChatAmount;
    superStickerDetails?: ApiSuperChatAmount;
  };
  authorDetails?: { channelId?: unknown; displayName?: unknown };
};

function normalizeChatEvent(event: LiveChatResource): YouTubeLiveChatEvent {
  const snippet = event.snippet;
  const paid = snippet?.superChatDetails ?? snippet?.superStickerDetails;
  return {
    id: resourceId(event.id),
    type: optionalString(snippet?.type) ?? "",
    text: optionalString(snippet?.displayMessage),
    authorChannelId: safeId(event.authorDetails?.channelId, channelIdPattern),
    authorName: optionalString(event.authorDetails?.displayName),
    publishedAt: optionalString(snippet?.publishedAt),
    ...(paid && {
      superChat: {
        amountMicros: unsignedMicros(paid.amountMicros),
        currency: optionalString(paid.currency),
        displayAmount: optionalString(paid.amountDisplayString),
      },
    }),
  };
}

export async function listYouTubeLiveChat(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  chatId: string,
  cursor?: string,
) {
  if (!safeId(chatId)) throw new SocialPlatformError("rejected");
  const result = await requestLive(
    http,
    token,
    quota,
    "liveChatMessages.list",
    "liveChat/messages",
    {
      liveChatId: chatId,
      part: "id,snippet,authorDetails",
      maxResults: "200",
      ...pageToken(cursor),
    },
  );
  return {
    events: (result.items ?? []).map(normalizeChatEvent) as YouTubeLiveChatEvent[],
    next: optionalString(result.nextPageToken),
    pollingIntervalMillis:
      Number.isSafeInteger(result.pollingIntervalMillis) && result.pollingIntervalMillis > 0
        ? Number(result.pollingIntervalMillis)
        : undefined,
    offlineAt: optionalString(result.offlineAt),
  };
}

export async function sendYouTubeLiveChatMessage(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  chatId: string,
  message: string,
): Promise<{ id: string }> {
  if (!safeId(chatId) || typeof message !== "string" || !message.trim() || message.length > 200)
    throw new SocialPlatformError("rejected");
  const value = await requestLive(
    http,
    token,
    quota,
    "liveChatMessages.insert",
    "liveChat/messages",
    { part: "snippet" },
    {
      method: "POST",
      body: {
        snippet: {
          liveChatId: chatId,
          type: "textMessageEvent",
          textMessageDetails: { messageText: message },
        },
      },
    },
  );
  return { id: resourceId(value.id) };
}

export async function deleteYouTubeLiveChatMessage(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  messageId: string,
): Promise<void> {
  if (!safeId(messageId)) throw new SocialPlatformError("rejected");
  await requestLive(
    http,
    token,
    quota,
    "liveChatMessages.delete",
    "liveChat/messages",
    { id: messageId },
    { method: "DELETE" },
  );
}

export async function banYouTubeLiveChatUser(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  chatId: string,
  userChannelId: string,
  durationSeconds?: number,
): Promise<{ id: string }> {
  if (
    !safeId(chatId) ||
    !safeId(userChannelId, channelIdPattern) ||
    (durationSeconds !== undefined &&
      (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 86_400))
  )
    throw new SocialPlatformError("rejected");
  const value = await requestLive(http, token, quota, "liveChatBans.insert", "liveChat/bans", {
    part: "snippet",
  }, {
    method: "POST",
    body: {
      snippet: {
        liveChatId: chatId,
        type: durationSeconds === undefined ? "permanent" : "temporary",
        banDurationSeconds: durationSeconds,
        bannedUserDetails: { channelId: userChannelId },
      },
    },
  });
  return { id: resourceId(value.id) };
}

export async function unbanYouTubeLiveChatUser(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  banId: string,
): Promise<void> {
  if (!safeId(banId)) throw new SocialPlatformError("rejected");
  await requestLive(
    http,
    token,
    quota,
    "liveChatBans.delete",
    "liveChat/bans",
    { id: banId },
    { method: "DELETE" },
  );
}

export type YouTubeSuperChatEvent = SuperChatAmount & {
  id: string;
  at?: string;
  text?: string;
  supporter?: string;
  isSticker: boolean;
};

type SuperChatResource = {
  id?: unknown;
  snippet?: {
    createdAt?: unknown;
    commentText?: unknown;
    supporterDetails?: { displayName?: unknown };
    amountMicros?: unknown;
    currency?: unknown;
    displayString?: unknown;
    isSuperStickerEvent?: unknown;
  };
};

export async function listYouTubeSuperChats(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  cursor?: string,
) {
  const result = await requestLive(http, token, quota, "superChatEvents.list", "superChatEvents", {
    part: "id,snippet",
    maxResults: "50",
    ...pageToken(cursor),
  });
  const events: YouTubeSuperChatEvent[] = (result.items ?? []).map(
    (event: SuperChatResource): YouTubeSuperChatEvent => ({
      id: resourceId(event.id),
      at: optionalString(event.snippet?.createdAt),
      text: optionalString(event.snippet?.commentText),
      supporter: optionalString(event.snippet?.supporterDetails?.displayName),
      amountMicros: unsignedMicros(event.snippet?.amountMicros),
      currency: optionalString(event.snippet?.currency),
      displayAmount: optionalString(event.snippet?.displayString),
      isSticker: event.snippet?.isSuperStickerEvent === true,
    }),
  );
  return { events, next: optionalString(result.nextPageToken) };
}
