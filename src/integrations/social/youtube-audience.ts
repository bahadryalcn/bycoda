import { SocialHttp, SocialPlatformError, type SocialAccount } from "./adapter";
import type { CaptureSource, CollectedPerson } from "./audience-types";
import type { YouTubeQuota } from "./youtube-quota";

const endpoint = "https://www.googleapis.com/youtube/v3/";
const videoIdPattern = /^[\w-]{11}$/;
/** Videos read per keyword page. Each page costs one search call plus one comment call per video. */
const KEYWORD_VIDEOS = 5;
const COMMENTS_PER_THREAD_PAGE = 100;

type Result = { people: CollectedPerson[]; next?: string };

/** Maps one commentThreads item to a person, or undefined when the item is unusable. */
function personFromThread(
  thread: Record<string, any>,
  account: SocialAccount,
  video: string,
): CollectedPerson | undefined {
  const snippet = thread.snippet?.topLevelComment?.snippet;
  const author = snippet?.authorChannelId?.value;
  // An unusable comment is skipped alone; it must not stop the rest of the page.
  if (typeof author !== "string" || !/^[A-Za-z0-9_-]{1,300}$/.test(author)) return undefined;
  if (author === account.platformId) return undefined;
  const at = Date.parse(snippet.publishedAt);
  if (!Number.isFinite(at)) return undefined;
  return {
    platformId: author,
    name: String(snippet.authorDisplayName ?? author),
    profileUrl: `https://www.youtube.com/channel/${author}`,
    text: String(snippet.textOriginal ?? snippet.textDisplay ?? ""),
    kind: "comment",
    ref: video,
    at,
  };
}

async function threadPeople(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  account: SocialAccount,
  params: Record<string, string>,
): Promise<{ people: CollectedPerson[]; next?: string }> {
  quota.charge("commentThreads.list");
  const { value } = await http.request(
    `${endpoint}commentThreads?${new URLSearchParams({
      part: "snippet",
      maxResults: String(COMMENTS_PER_THREAD_PAGE),
      order: "time",
      textFormat: "plainText",
      ...params,
    })}`,
    token,
  );
  const people: CollectedPerson[] = [];
  for (const thread of value.items ?? []) {
    // Owned-channel scans keep only threads on this channel's videos, like the poll path.
    if (!params.videoId && thread.snippet?.channelId !== account.platformId) continue;
    const video = thread.snippet?.videoId;
    if (typeof video !== "string" || !videoIdPattern.test(video)) continue;
    const person = personFromThread(thread, account, video);
    if (person) people.push(person);
  }
  return {
    people,
    next:
      typeof value.nextPageToken === "string" && value.nextPageToken
        ? value.nextPageToken
        : undefined,
  };
}

/** Commenters of owned videos (own_post_comments) and of public videos matching a keyword. */
export async function collectYouTubeAudience(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  account: SocialAccount,
  source: CaptureSource,
  cursor?: string,
): Promise<Result> {
  if (source.accountId !== account.id) throw new SocialPlatformError("denied");
  if (source.kind === "own_post_comments") {
    if (source.postRef !== undefined && !videoIdPattern.test(source.postRef))
      throw new SocialPlatformError("rejected");
    return threadPeople(http, token, quota, account, {
      ...(source.postRef
        ? { videoId: source.postRef }
        : { allThreadsRelatedToChannelId: account.platformId }),
      ...(cursor ? { pageToken: cursor } : {}),
    });
  }
  if (source.kind !== "keyword" && source.kind !== "hashtag")
    throw new SocialPlatformError("unsupported");
  const query = source.query.trim().replace(/^#/, "");
  if (!query || query.length > 200) throw new SocialPlatformError("rejected");
  quota.charge("search.list");
  const { value: search } = await http.request(
    `${endpoint}search?${new URLSearchParams({
      part: "snippet",
      type: "video",
      q: query,
      maxResults: String(KEYWORD_VIDEOS),
      order: "date",
      ...(cursor ? { pageToken: cursor } : {}),
    })}`,
    token,
  );
  const videos = (search.items ?? [])
    .map((item: Record<string, any>) => item.id?.videoId)
    .filter((id: unknown): id is string => typeof id === "string" && videoIdPattern.test(id));
  const people: CollectedPerson[] = [];
  for (const video of videos) {
    try {
      const page = await threadPeople(http, token, quota, account, { videoId: video });
      people.push(...page.people);
    } catch (error) {
      // Comments disabled on one video is expected; other failures stop the page.
      if (!(error instanceof SocialPlatformError && error.code === "comments_disabled"))
        throw error;
    }
  }
  return {
    people,
    next:
      typeof search.nextPageToken === "string" && search.nextPageToken
        ? search.nextPageToken
        : undefined,
  };
}
