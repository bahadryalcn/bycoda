import { SocialPlatformError, type SocialHttp } from "./adapter";

const SINGLE_CHUNK_MAX = 64_000_000;
const CHUNK_SIZE = 10_000_000;
const VIDEO_MAX = 4_000_000_000;

/** Match the provider's documented chunk count. Trailing bytes belong to the last chunk. */
export function planTikTokUpload(bytes: Uint8Array) {
  if (bytes.byteLength < 12 || bytes.byteLength > VIDEO_MAX)
    throw new SocialPlatformError("unsupported");

  let mime: string;
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    mime = brand === "qt  " ? "video/quicktime" : "video/mp4";
  } else if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    mime = "video/webm";
  } else throw new SocialPlatformError("unsupported");

  const chunkSize = bytes.byteLength <= SINGLE_CHUNK_MAX ? bytes.byteLength : CHUNK_SIZE;
  return {
    mime,
    sourceInfo: {
      source: "FILE_UPLOAD" as const,
      video_size: bytes.byteLength,
      chunk_size: chunkSize,
      total_chunk_count: Math.floor(bytes.byteLength / chunkSize),
    },
  };
}

export async function transferTikTokVideo(
  http: SocialHttp,
  uploadUrl: unknown,
  bytes: Uint8Array,
  plan: ReturnType<typeof planTikTokUpload>,
  beforeSubmit?: () => Promise<void>,
): Promise<void> {
  if (typeof uploadUrl !== "string" || uploadUrl.length > 256)
    throw new SocialPlatformError("unknown");
  const url = URL.parse(uploadUrl);
  if (
    !url ||
    url.protocol !== "https:" ||
    !/^(?:open-upload|upload\.[a-z0-9-]+)\.tiktokapis\.com$/.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.pathname !== "/video/" ||
    !url.searchParams.get("upload_id") ||
    !url.searchParams.get("upload_token")
  )
    throw new SocialPlatformError("unknown");

  const { chunk_size: size, total_chunk_count: count, video_size: total } = plan.sourceInfo;
  for (let index = 0; index < count; index++) {
    const start = index * size;
    const final = index === count - 1;
    const end = final ? total : start + size;
    await beforeSubmit?.();
    // Preserve the exact signed URL, keep it in memory, and never resend an unconfirmed chunk.
    const status = await http.tiktokUploadChunk(uploadUrl, plan.mime, bytes.subarray(start, end), {
      start,
      end,
      total,
    });
    if (status !== (final ? 201 : 206)) throw new SocialPlatformError("unknown");
  }
}
