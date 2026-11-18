import { SocialPlatformError, retryAfter, type SocialHttp } from "./adapter";

export const YOUTUBE_MAX_VIDEO_BYTES = 256 * 1024 ** 3;
export const YOUTUBE_UPLOAD_CHUNK_BYTES = 8 * 1024 ** 2;
const uploadEndpoint = "https://www.googleapis.com/upload/youtube/v3/videos";

export type YouTubeVideoSource = {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
};

export type YouTubeUploadAccess = {
  open(uploadId: string): Promise<YouTubeVideoSource>;
  loadSession(): Promise<string | undefined>;
  saveSession(uri: string): Promise<void>;
  clearSession(): Promise<void>;
};

function sessionUrl(value: string | null): string {
  if (!value || value.length > 4096) throw new SocialPlatformError("unknown");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SocialPlatformError("unknown");
  }
  if (
    url.origin !== "https://www.googleapis.com" ||
    url.username ||
    url.password ||
    url.pathname !== "/upload/youtube/v3/videos" ||
    url.hash ||
    url.searchParams.getAll("upload_id").length !== 1 ||
    !url.searchParams.get("upload_id")
  )
    throw new SocialPlatformError("unknown");
  return url.href;
}

function acceptedOffset(headers: Headers, maximum: number): number {
  const range = headers.get("range");
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range);
  const offset = Number(match?.[1]) + 1;
  if (!Number.isSafeInteger(offset) || offset > maximum) throw new SocialPlatformError("unknown");
  return offset;
}

export async function uploadYouTubeFile(input: {
  http: SocialHttp;
  token: string;
  metadata: unknown;
  source: YouTubeVideoSource;
  knownSession?: string;
  checkpoint(uri: string): Promise<void>;
  beforeWrite?: () => Promise<void>;
  onStart(): void;
  now: () => number;
}) {
  const { http, token, source, now } = input;
  if (
    !Number.isSafeInteger(source.size) ||
    source.size < 12 ||
    source.size > YOUTUBE_MAX_VIDEO_BYTES
  )
    throw new SocialPlatformError("unsupported");
  const header = await source.read(0, 12);
  const mime =
    new TextDecoder().decode(header.subarray(4, 8)) === "ftyp"
      ? "video/mp4"
      : header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3
        ? "video/webm"
        : undefined;
  if (header.length !== 12 || !mime) throw new SocialPlatformError("unsupported");

  let uri = input.knownSession;
  let offset = 0;
  const transfer = async (url: string, headers: Record<string, string>, body?: Uint8Array) => {
    try {
      return await http.request(url, token, {
        method: "PUT",
        headers,
        ...(body ? { body: new Uint8Array(body) } : {}),
      });
    } catch (error) {
      if (error instanceof SocialPlatformError && error.code === "unknown" && !error.detail)
        throw new SocialPlatformError("processing", now() + 60_000);
      throw error;
    }
  };
  if (uri) {
    uri = sessionUrl(uri);
    await input.beforeWrite?.();
    const probe = await transfer(uri, {
      "Content-Length": "0",
      "Content-Range": `bytes */${source.size}`,
    });
    if (!probe.youtubeIncomplete) return probe;
    offset = acceptedOffset(probe.headers, source.size);
    if (probe.headers.has("retry-after"))
      throw new SocialPlatformError("processing", retryAfter(probe.headers, now()));
  } else {
    await input.beforeWrite?.();
    input.onStart();
    const start = await http.json(
      `${uploadEndpoint}?uploadType=resumable&part=snippet,status`,
      token,
      input.metadata,
      { "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(source.size) },
    );
    uri = sessionUrl(start.headers.get("location"));
    // The vault and public job marker must both be durable before sending bytes.
    await input.checkpoint(uri);
  }
  while (offset < source.size) {
    const length = Math.min(YOUTUBE_UPLOAD_CHUNK_BYTES, source.size - offset);
    const bytes = await source.read(offset, length);
    if (bytes.length !== length) throw new SocialPlatformError("unknown");
    await input.beforeWrite?.();
    const result = await transfer(
      uri,
      {
        "Content-Type": mime,
        "Content-Length": String(length),
        "Content-Range": `bytes ${offset}-${offset + length - 1}/${source.size}`,
      },
      bytes,
    );
    if (!result.youtubeIncomplete) {
      if (offset + length !== source.size) throw new SocialPlatformError("unknown");
      return result;
    }
    const next = acceptedOffset(result.headers, offset + length);
    if (next < offset) throw new SocialPlatformError("unknown");
    if (next === offset || result.headers.has("retry-after"))
      throw new SocialPlatformError("processing", retryAfter(result.headers, now()));
    offset = next;
  }
  // A 308 acknowledging all bytes still needs an authoritative creation response.
  throw new SocialPlatformError("processing", now() + 60_000);
}
