import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

const MAX_VIDEO = 64 * 1024 * 1024;
type Upload = {
  actor: string;
  size: number;
  offset: number;
  expires: number;
  busy: boolean;
};
/** Owner-selected bytes only. No arbitrary local paths or remote URLs are read. */
export class SocialVideoUploads {
  private pending = new Map<string, Upload>();
  constructor(
    private directory: string,
    private now = Date.now,
    private authorize: () => Promise<void> = async () => {},
  ) {}
  async call(
    actor: string,
    input: Record<string, unknown>,
  ): Promise<{ uploadId: string; offset?: number }> {
    await this.authorize();
    const staging = join(this.directory, "media", "incoming");
    for (const [id, state] of this.pending)
      if (state.expires <= this.now() && !state.busy) {
        await this.authorize();
        this.pending.delete(id);
        await unlink(join(staging, id)).catch(() => {});
      }
    if (input.mode === "begin") {
      const size = Number(input.size);
      if (!Number.isSafeInteger(size) || size < 12 || size > MAX_VIDEO)
        throw new Error("Select an MP4/WebM video up to 64 MiB.");
      if (
        this.pending.size >= 8 ||
        [...this.pending.values()].filter((s) => s.actor === actor).length >= 2
      )
        throw new Error("Finish or cancel the existing video upload first.");
      const uploadId = randomUUID();
      this.pending.set(uploadId, {
        actor,
        size,
        offset: 0,
        expires: this.now() + 30 * 60_000,
        busy: true,
      });
      try {
        await this.authorize();
        await mkdir(staging, { recursive: true, mode: 0o700 });
        const existing = (await readdir(staging)).filter((id) => /^[a-f0-9-]{36}$/.test(id));
        let count = 0;
        for (const id of existing) {
          if (
            !this.pending.has(id) &&
            (await stat(join(staging, id))).mtimeMs + 30 * 60_000 <= this.now()
          ) {
            await this.authorize();
            await unlink(join(staging, id));
          } else count++;
        }
        if (count >= 8)
          throw new Error("Incomplete video uploads must expire before another upload.");
        await this.authorize();
        const handle = await open(join(staging, uploadId), "wx", 0o600);
        await handle.close();
        this.pending.get(uploadId)!.busy = false;
        return { uploadId, offset: 0 };
      } catch (error) {
        this.pending.delete(uploadId);
        throw error;
      }
    }
    const uploadId = String(input.uploadId ?? "");
    const state = this.pending.get(uploadId);
    if (!state || state.actor !== actor || state.busy)
      throw new Error("Video upload is invalid, expired or busy.");
    state.busy = true;
    try {
      if (input.mode === "cancel") {
        await this.authorize();
        await unlink(join(staging, uploadId));
        this.pending.delete(uploadId);
      } else if (input.mode === "chunk") {
        const base64 = typeof input.base64 === "string" ? input.base64 : "";
        if (base64.length > 1_400_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
          throw new Error("Invalid video chunk.");
        const bytes = Buffer.from(base64, "base64");
        if (
          !bytes.length ||
          bytes.length > 1024 * 1024 ||
          input.offset !== state.offset ||
          state.offset + bytes.length > state.size
        )
          throw new Error("Video chunks must be bounded and sequential.");
        const handle = await open(join(staging, uploadId), "r+");
        try {
          let written = 0;
          while (written < bytes.length) {
            await this.authorize();
            const result = await handle.write(
              bytes,
              written,
              bytes.length - written,
              state.offset + written,
            );
            if (!result.bytesWritten) throw new Error("Video chunk could not be written.");
            written += result.bytesWritten;
          }
        } finally {
          await handle.close();
        }
        state.offset += bytes.length;
      } else if (input.mode === "finish") {
        if (state.offset !== state.size) throw new Error("Video upload is incomplete.");
        const handle = await open(join(staging, uploadId), "r");
        const header = Buffer.alloc(12);
        try {
          await handle.read(header, 0, 12, 0);
        } finally {
          await handle.close();
        }
        if (
          header.toString("ascii", 4, 8) !== "ftyp" &&
          !header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
        )
          throw new Error("Upload an MP4/WebM video. File extension alone is insufficient.");
        await this.authorize();
        await rename(join(staging, uploadId), join(this.directory, "media", uploadId));
        this.pending.delete(uploadId);
      } else throw new Error("Unsupported video upload step.");
      return { uploadId, offset: state.offset };
    } finally {
      state.busy = false;
    }
  }
}
