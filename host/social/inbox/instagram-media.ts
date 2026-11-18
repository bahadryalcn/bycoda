import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import {
  INSTAGRAM_DIRECT_MEDIA_LIMITS,
  isInstagramDirectMediaKind,
  type InstagramDirectMediaKind,
} from "../../../src/integrations/social/adapters/instagram-direct-media";
import type { HostStore } from "../../store";
import { url } from "../core/social-helpers";
import type { SocialMediaCustody } from "../media-custody";

const GRANT_LIFETIME_MS = 15 * 60_000;
const uploadIdPattern = /^[a-f0-9-]{36}$/;

function origin(raw: unknown): string {
  const parsed = new URL(url(raw, "public media base URL"));
  if (parsed.pathname !== "/" || parsed.search || parsed.hash)
    throw new Error("Use an HTTPS origin for Instagram attachment delivery.");
  return parsed.origin;
}

export function instagramLocalMediaAvailable(raw = process.env.BYCODA_SOCIAL_PUBLIC_MEDIA_BASE_URL) {
  try {
    origin(raw);
    return true;
  } catch {
    return false;
  }
}

/** The supplied kind selects the container checks and prevents extensions from deciding MIME. */
export function instagramAttachmentMime(kind: InstagramDirectMediaKind, data: Uint8Array) {
  if (data.length < 12 || data.length > INSTAGRAM_DIRECT_MEDIA_LIMITS[kind])
    throw new Error("Instagram attachment exceeds the supported size.");
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const start = bytes.subarray(0, 128);
  const container = start.toString("ascii", 0, 4);
  const brand = start.toString("ascii", 8, 12);
  const mp4 = start.toString("ascii", 4, 8) === "ftyp";
  switch (kind) {
    case "image":
      if (start.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        return "image/png";
      if (start[0] === 255 && start[1] === 216 && start[2] === 255) return "image/jpeg";
      break;
    case "video":
      if (mp4 && brand === "qt  ") return "video/quicktime";
      if (mp4) return "video/mp4";
      if (container === "RIFF" && brand === "AVI ") return "video/x-msvideo";
      if (container === "OggS" && start.includes("theora")) return "video/ogg";
      if (start.readUInt32BE(0) === 0x1a45dfa3 && start.includes("webm")) return "video/webm";
      break;
    case "audio":
      if (mp4) return "audio/mp4";
      if (container === "RIFF" && brand === "WAVE") return "audio/wav";
      if (start[0] === 0xff && (start[1] & 0xf6) === 0xf0) return "audio/aac";
      break;
    case "document":
      if (
        /^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/.test(start.toString("ascii")) &&
        /%%EOF\s*$/.test(bytes.subarray(-1024).toString("ascii"))
      )
        return "application/pdf";
      break;
  }
  throw new Error("The file contents do not match the selected Instagram attachment type.");
}

/** Only immutable owner uploads referenced by a reviewed DM can receive a temporary fetch URL. */
export class InstagramMessageMedia {
  private readonly secret = randomBytes(32);

  constructor(
    private readonly store: HostStore,
    private readonly custody: SocialMediaCustody,
    private readonly directory: string,
    private readonly now: () => number,
  ) {}

  async register(actorId: string, uploadId: string, kind: InstagramDirectMediaKind, data: Uint8Array) {
    instagramAttachmentMime(kind, data);
    await this.store.db.checkAuthorization();
    await this.custody.registerManagedUpload({ accountId: `owner:${actorId}` }, uploadId, data);
  }

  async assertOwned(actorId: string, uploadId: string) {
    const row = await this.store.db.prepare(
      "SELECT 1 FROM social_media_files WHERE id=? AND account_id=? AND state='active'",
    ).get(uploadId, `owner:${actorId}`);
    if (!row) throw new Error("Attach a file uploaded by this owner.");
  }

  private token(id: string, kind: InstagramDirectMediaKind, expires: number): Buffer {
    return createHmac("sha256", this.secret).update(`${id}:${kind}:${expires}`).digest();
  }

  async grant(draftId: string, id: string, kind: InstagramDirectMediaKind): Promise<string> {
    const base = origin(process.env.BYCODA_SOCIAL_PUBLIC_MEDIA_BASE_URL);
    const claim = await this.store.db.prepare(
      "SELECT 1 FROM social_media_claims WHERE media_id=? AND owner_kind='record:draft' AND owner_id=? AND state='active'",
    ).get(id, draftId);
    if (!claim) throw new Error("The reviewed reply no longer holds this file.");
    await this.readVerified(id, kind);
    const expires = this.now() + GRANT_LIFETIME_MS;
    const token = this.token(id, kind, expires).toString("hex");
    return `${base}/social/media/instagram-direct/${id}?kind=${kind}&expires=${expires}&token=${token}`;
  }

  async serve(id: string, query: URLSearchParams) {
    const kind = query.get("kind");
    const expires = Number(query.get("expires"));
    const token = query.get("token");
    if (
      !isInstagramDirectMediaKind(kind) ||
      !Number.isSafeInteger(expires) ||
      expires <= this.now() ||
      !token ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !timingSafeEqual(this.token(id, kind, expires), Buffer.from(token, "hex"))
    )
      throw new Error("Instagram attachment unavailable.");
    return this.readVerified(id, kind);
  }

  private async readVerified(id: string, kind: InstagramDirectMediaKind) {
    if (!uploadIdPattern.test(id)) throw new Error("Invalid Instagram attachment.");
    const registered = await this.store.db.prepare(
      "SELECT sha256 FROM social_media_files WHERE id=? AND state='active'",
    ).get(id);
    if (!registered) throw new Error("Instagram attachment unavailable.");
    const file = await open(join(this.directory, "media", id), "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 12 || stat.size > INSTAGRAM_DIRECT_MEDIA_LIMITS[kind])
        throw new Error("Instagram attachment exceeds the supported size.");
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new Error("Instagram attachment changed.");
        offset += bytesRead;
      }
      if (
        (await file.stat()).size !== stat.size ||
        createHash("sha256").update(bytes).digest("hex") !== registered.sha256
      )
        throw new Error("Instagram attachment changed.");
      return { bytes, mime: instagramAttachmentMime(kind, bytes) };
    } finally {
      await file.close();
    }
  }
}
