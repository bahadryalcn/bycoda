import { SocialPlatformError, type SocialHttp } from "../adapter";
import { at, graphNext, requireId } from "./common";

export type FacebookPageProfile = {
  id: string;
  name: string;
  username?: string;
  about?: string;
  description?: string;
  category?: string;
  followersCount?: number;
  /** Meta returns the follower count here for Pages on New Pages Experience. */
  fanCount?: number;
  url?: string;
  website?: string;
  phone?: string;
  emails?: string[];
  hours?: Record<string, string>;
  avatarUrl?: string;
  coverUrl?: string;
};

export function facebookPageEndpoint(graphVersion: string, pageId: string) {
  if (!/^v\d+\.\d+$/.test(graphVersion) || !/^[1-9]\d{0,24}$/.test(pageId))
    throw new SocialPlatformError("rejected");
  return `https://graph.facebook.com/${graphVersion}/${pageId}`;
}

const string = (value: unknown) => (typeof value === "string" ? value : undefined);
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

function publicUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password)
      return url.href;
  } catch {
    // Invalid references are omitted from the read model.
  }
  return undefined;
}

export async function readFacebookPage(
  http: SocialHttp,
  graphVersion: string,
  pageId: string,
  token: string,
): Promise<FacebookPageProfile> {
  const endpoint = facebookPageEndpoint(graphVersion, pageId);
  const fields =
    "id,name,username,about,description,category,followers_count,fan_count,link,website,phone,emails,hours,picture,cover";
  const { value } = await http.request(`${endpoint}?fields=${fields}`, token).catch((error: unknown) => {
    if (error instanceof SocialPlatformError && error.code === "denied")
      throw new SocialPlatformError("denied", undefined, { reasonCode: "facebook.page_read_permissions" });
    throw error;
  });
  if (value.id !== pageId || typeof value.name !== "string")
    throw new SocialPlatformError("unknown");
  const hours = value.hours;
  return {
    id: pageId,
    name: value.name,
    username: string(value.username),
    about: string(value.about),
    description: string(value.description),
    category: string(value.category),
    followersCount: count(value.followers_count),
    fanCount: count(value.fan_count),
    url: publicUrl(value.link),
    website: publicUrl(value.website),
    phone: string(value.phone),
    emails: Array.isArray(value.emails)
      ? value.emails.filter((email): email is string => typeof email === "string")
      : undefined,
    hours: hours && typeof hours === "object" && !Array.isArray(hours)
      ? Object.fromEntries(Object.entries(hours).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : undefined,
    avatarUrl: value.picture?.data?.is_silhouette === true ? undefined : publicUrl(value.picture?.data?.url),
    coverUrl: publicUrl(value.cover?.source),
  };
}

export async function listFacebookPageMentions(
  http: SocialHttp,
  graphVersion: string,
  pageId: string,
  token: string,
  cursor?: string,
) {
  const endpoint = facebookPageEndpoint(graphVersion, pageId);
  if (cursor !== undefined && (typeof cursor !== "string" || !cursor || cursor.length > 2048))
    throw new SocialPlatformError("rejected");
  const query = new URLSearchParams({ fields: "id,message,created_time,permalink_url", limit: "25" });
  if (cursor) query.set("after", cursor);
  const { value } = await http.request(`${endpoint}/tagged?${query}`, token).catch((error: unknown) => {
    if (error instanceof SocialPlatformError && error.code === "denied")
      throw new SocialPlatformError("denied", undefined, { reasonCode: "facebook.mentions_read_permissions" });
    throw error;
  });
  if (!Array.isArray(value.data)) throw new SocialPlatformError("unknown");
  return {
    posts: value.data.map((row: { id?: unknown; message?: unknown; created_time?: unknown; permalink_url?: unknown }) => ({
      id: requireId(row.id),
      text: string(row.message),
      at: at(row.created_time),
      url: publicUrl(row.permalink_url),
    })),
    next: graphNext(value),
  };
}
