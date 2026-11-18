import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { SocialAccount, SocialJob } from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import {
  YOUTUBE_UPLOAD_CHUNK_BYTES,
  type YouTubeUploadAccess,
} from "../../../src/integrations/social/youtube-upload";
import type { SocialCredentialStore } from "../social-credentials";

export function youtubeDiskUpload(
  directory: string,
  credentials: SocialCredentialStore,
  account: SocialAccount,
  job: SocialJob,
): YouTubeUploadAccess {
  const uploadId = job.payload.media[0]?.uploadId;
  const key =
    "youtube:upload:" +
    createHash("sha256")
      .update(
        JSON.stringify([
          account.executorId,
          account.id,
          account.platformId,
          job.id,
          job.dedupeKey,
          uploadId,
        ]),
      )
      .digest("hex");
  let fileIdentity: string | undefined;
  return {
    async open(id) {
      if (id !== uploadId || !/^[a-f0-9-]{36}$/.test(id)) throw new SocialPlatformError("denied");
      const path = join(directory, "media", id);
      const identity = (info: Stats) =>
        JSON.stringify([info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs]);
      const file = await open(path, "r");
      let size: number;
      try {
        const info = await file.stat();
        if (!info.isFile()) throw new SocialPlatformError("unsupported");
        fileIdentity = identity(info);
        size = info.size;
      } finally {
        await file.close();
      }
      return {
        size,
        async read(offset, length) {
          if (
            !Number.isSafeInteger(offset) ||
            offset < 0 ||
            !Number.isSafeInteger(length) ||
            length <= 0 ||
            length > YOUTUBE_UPLOAD_CHUNK_BYTES ||
            offset + length > size
          )
            throw new SocialPlatformError("rejected");
          const handle = await open(path, "r");
          try {
            if (identity(await handle.stat()) !== fileIdentity)
              throw new SocialPlatformError("unknown");
            const bytes = Buffer.allocUnsafe(length);
            let read = 0;
            while (read < length) {
              const { bytesRead } = await handle.read(bytes, read, length - read, offset + read);
              if (!bytesRead) throw new SocialPlatformError("unknown");
              read += bytesRead;
            }
            if (identity(await handle.stat()) !== fileIdentity)
              throw new SocialPlatformError("unknown");
            return bytes;
          } finally {
            await handle.close();
          }
        },
      };
    },
    async loadSession() {
      const record = await credentials.get(key);
      if (!record) return undefined;
      if (!fileIdentity || record.refreshToken !== fileIdentity)
        throw new SocialPlatformError("unknown");
      return record.accessToken;
    },
    async saveSession(uri) {
      if (!fileIdentity) throw new SocialPlatformError("unknown");
      await credentials.set(key, { accessToken: uri, refreshToken: fileIdentity });
    },
    async clearSession() {
      await credentials.delete(key);
    },
  };
}
