import { SocialPlatformError, type SocialErrorCode, type SocialHttp } from "../adapter";
import { facebookPageEndpoint } from "./facebook-page";

export type FacebookPagePatch = {
  about?: string;
  description?: string;
  website?: string;
  phone?: string;
  emails?: string[];
  hours?: Record<string, string>;
  avatarPhotoId?: string;
  coverPhotoId?: string;
};

type PageField = keyof FacebookPagePatch;
type PageUpdateFailure = { code: SocialErrorCode; retryAt?: number; reasonCode?: string };

export type FacebookPageUpdate =
  | { status: "updated"; updated: PageField[] }
  | { status: "partial"; updated: PageField[]; unconfirmed: PageField[]; failure: PageUpdateFailure };

const fields = ["about", "description", "website", "phone", "emails", "hours", "avatarPhotoId", "coverPhotoId"] as const;
const stringLimits = { about: 100, description: 2000, website: 2048, phone: 100, avatarPhotoId: 25, coverPhotoId: 25 } as const;
const hoursKey = /^(mon|tue|wed|thu|fri|sat|sun)_[12]_(open|close)$/;
const time = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;

function invalid(): never {
  throw new SocialPlatformError("rejected", undefined, { reasonCode: "facebook.page_invalid_settings" });
}

function pageHours(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const entries = Object.entries(value);
  const hours: Record<string, string> = {};
  for (const [key, hour] of entries) {
    if (
      !hoursKey.test(key) ||
      typeof hour !== "string" ||
      (!time.test(hour) && !(key.endsWith("_close") && hour === "24:00"))
    ) return invalid();
    hours[key] = hour.padStart(5, "0");
  }
  for (const key of Object.keys(hours)) {
    const opening = key.endsWith("_open");
    const range = key.slice(0, key.lastIndexOf("_"));
    if (hours[`${range}_${opening ? "close" : "open"}`] === undefined) return invalid();
  }
  return hours;
}

export function parseFacebookPagePatch(raw: unknown): FacebookPagePatch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const entries = Object.entries(raw);
  if (!entries.length) return invalid();
  const patch: FacebookPagePatch = {};
  for (const [key, value] of entries) {
    if (!fields.includes(key as PageField)) return invalid();
    if (key === "hours") {
      patch.hours = pageHours(value);
      continue;
    }
    if (key === "emails") {
      if (!Array.isArray(value) || value.length > 20) return invalid();
      patch.emails = value.map((email: unknown) => {
        if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          return invalid();
        return email;
      });
      continue;
    }
    const field = key as keyof typeof stringLimits;
    if (typeof value !== "string" || [...value].length > stringLimits[field]) return invalid();
    if (field === "avatarPhotoId" || field === "coverPhotoId") {
      if (!/^[1-9]\d{0,24}$/.test(value)) return invalid();
    }
    if (field === "website" && value) {
      try {
        const url = new URL(value);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
          return invalid();
      } catch {
        return invalid();
      }
    }
    if (field === "phone" && value && !/^\+?[\d .()#x-]+$/i.test(value)) return invalid();
    patch[field] = value;
  }
  return patch;
}

async function confirmedWrite(
  http: SocialHttp,
  endpoint: string,
  token: string,
  body: Record<string, unknown>,
) {
  const { value } = await http.json(endpoint, token, body).catch((error: unknown) => {
    if (error instanceof SocialPlatformError && error.code === "denied")
      throw new SocialPlatformError("denied", undefined, { reasonCode: "facebook.page_update_permissions" });
    throw error;
  });
  if (value.success !== true) throw new SocialPlatformError("unknown");
}

/** A failure after the first confirmed write reports the exact remaining field and never retries it. */
export async function updateFacebookPage(
  http: SocialHttp,
  graphVersion: string,
  pageId: string,
  token: string,
  raw: unknown,
): Promise<FacebookPageUpdate> {
  const endpoint = facebookPageEndpoint(graphVersion, pageId);
  const { avatarPhotoId, coverPhotoId, ...settings } = parseFacebookPagePatch(raw);
  const updated = Object.keys(settings) as PageField[];
  if (coverPhotoId) updated.push("coverPhotoId");
  if (updated.length)
    await confirmedWrite(http, endpoint, token, {
      ...settings,
      ...(coverPhotoId ? { cover: coverPhotoId, no_feed_story: true, no_notification: true } : {}),
    });
  if (avatarPhotoId) {
    try {
      await confirmedWrite(http, `${endpoint}/picture`, token, { photo: avatarPhotoId, suppress_stories: true });
    } catch (error) {
      if (!updated.length || !(error instanceof SocialPlatformError)) throw error;
      return {
        status: "partial",
        updated,
        unconfirmed: ["avatarPhotoId"],
        failure: { code: error.code, retryAt: error.retryAt, reasonCode: error.detail?.reasonCode },
      };
    }
    updated.push("avatarPhotoId");
  }
  return { status: "updated", updated };
}
