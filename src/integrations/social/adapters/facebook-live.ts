import { SocialPlatformError, type SocialHttp } from "../adapter";
import { graphNext } from "./common";

export type FacebookLiveStatus = "unpublished" | "live" | "ended" | "unknown";
export type FacebookLiveComment = {
  id: string;
  text: string;
  at?: number;
  authorId?: string;
  authorName?: string;
  canReply: boolean;
};

const GRAPH = "https://graph.facebook.com";
const COMMENT_FIELDS = "id,message,created_time,from{id,name},can_comment";

export function facebookLiveId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d{0,29}$/.test(value))
    throw new SocialPlatformError("rejected");
  return value;
}

export function facebookLiveCommentId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d{0,29}(?:_[1-9]\d{0,29})?$/.test(value))
    throw new SocialPlatformError("rejected");
  return value;
}

function safeText(value: unknown, limit: number): string | undefined {
  return typeof value === "string" ? value.split("\0").join("").slice(0, limit) : undefined;
}

function commentFrom(value: Record<string, any>): FacebookLiveComment {
  const authorId =
    typeof value.from?.id === "string" && /^[1-9]\d{0,29}$/.test(value.from.id)
      ? value.from.id
      : undefined;
  const timestamp = typeof value.created_time === "string" ? Date.parse(value.created_time) : NaN;
  return {
    id: facebookLiveCommentId(value.id),
    text: safeText(value.message, 12000) ?? "",
    ...(Number.isFinite(timestamp) ? { at: timestamp } : {}),
    ...(authorId ? { authorId, authorName: safeText(value.from?.name, 300) } : {}),
    canReply: value.can_comment === true && authorId !== undefined && Number.isFinite(timestamp),
  };
}

/** RTMPS ingest URLs carry stream keys. Only the credential vault and the owner encoder route use them. */
export function facebookEncoderUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol === "rtmps:" &&
      url.hostname.endsWith(".facebook.com") &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname.split("/").filter(Boolean).length >= 2
    )
      return url.toString();
  } catch {
    // Provider values are never put in error messages.
  }
  return undefined;
}

function liveStatus(value: unknown): FacebookLiveStatus {
  switch (value) {
    case "UNPUBLISHED":
      return "unpublished";
    case "LIVE":
    case "LIVE_NOW":
      return "live";
    case "LIVE_STOPPED":
    case "PROCESSING":
    case "VOD":
    case "SCHEDULED_CANCELED":
    case "SCHEDULED_EXPIRED":
      return "ended";
    default:
      return "unknown";
  }
}

/** Meta Live Video API, restricted to managed Page broadcasts and their comments. */
export function facebookLiveApi(http: SocialHttp, version: string) {
  if (!/^v\d{1,3}\.0$/.test(version)) throw new SocialPlatformError("denied");
  const node = (liveId: string) => `${GRAPH}/${version}/${facebookLiveId(liveId)}`;
  return {
    async create(pageId: string, token: string, title: string, description?: string) {
      const { value } = await http.json(`${node(pageId)}/live_videos`, token, {
        status: "UNPUBLISHED",
        title,
        ...(description ? { description } : {}),
      });
      const id =
        typeof value.id === "string" && /^[1-9]\d{0,29}$/.test(value.id) ? value.id : undefined;
      if (!id) throw new SocialPlatformError("unknown");
      return { id, encoderUrl: facebookEncoderUrl(value.secure_stream_url) };
    },
    async status(liveId: string, token: string, pageId: string) {
      const { value } = await http.request(`${node(liveId)}?fields=id,status,from{id}`, token);
      if (value.id !== liveId || (value.from?.id !== undefined && value.from.id !== pageId))
        throw new SocialPlatformError("denied");
      return liveStatus(value.status);
    },
    async update(liveId: string, token: string, change: "start" | "end") {
      const { value } = await http.json(
        node(liveId),
        token,
        change === "start" ? { status: "LIVE_NOW" } : { end_live_video: true },
      );
      if (value.success !== true && value.id !== liveId) throw new SocialPlatformError("unknown");
    },
    async comments(liveId: string, token: string, cursor?: string) {
      const query = new URLSearchParams({
        fields: COMMENT_FIELDS,
        limit: "50",
        order: "reverse_chronological",
      });
      if (cursor) query.set("after", cursor);
      const { value } = await http.request(`${node(liveId)}/comments?${query}`, token);
      if (!Array.isArray(value.data) || value.data.length > 50)
        throw new SocialPlatformError("unknown");
      return {
        comments: value.data.filter((item) => item && typeof item === "object").map(commentFrom),
        next: graphNext(value),
      };
    },
  };
}
