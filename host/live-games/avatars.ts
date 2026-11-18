import { createHash } from "node:crypto";
import { createJimp } from "@jimp/core";
import jpeg from "@jimp/js-jpeg";
import png from "@jimp/js-png";
import { methods as resize } from "@jimp/plugin-resize";

const Image = createJimp({ formats: [jpeg, png], plugins: [resize] });
const MAX_BYTES = 500_000;
const CDN = /(?:^|\.)(?:tiktokcdn(?:-us|-eu)?\.com|ibyteimg\.com|byteoversea\.com|tiktokv\.com)$/i;

async function avatar(url: URL): Promise<Buffer> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5_000) });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > MAX_BYTES)
    throw new Error("Avatar unavailable.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Avatar is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  const isPng = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (isPng && (bytes.readUInt32BE(16) > 1024 || bytes.readUInt32BE(20) > 1024))
    throw new Error("Avatar dimensions are too large.");
  const image = await Image.fromBuffer(bytes, { "image/jpeg": { maxMemoryUsageInMB: 8, maxResolutionInMP: 2 } });
  const scale = Math.min(1, 96 / Math.max(image.width, image.height));
  if (scale < 1) image.resize({
    w: Math.max(1, Math.round(image.width * scale)), h: Math.max(1, Math.round(image.height * scale)),
  });
  return image.getBuffer("image/png");
}

type Entry = { source: string; bytes?: Buffer; retryAt: number };

/** CDN downloads stay on the Host. Overlay clients receive only bounded, re-encoded images. */
export class AvatarCache {
  private readonly entries = new Map<string, Entry>();
  private pending = 0;

  get(id: string, source: string | undefined): string | undefined {
    if (!source) return undefined;
    const url = URL.parse(source);
    if (!url || url.protocol !== "https:" || url.port || url.username || url.password || !CDN.test(url.hostname))
      return undefined;
    const key = createHash("sha256").update(id).digest("hex");
    const entry = this.entries.get(key);
    if (entry?.source === source && entry.bytes) return key;
    if (this.pending >= 5 || (entry?.source === source && entry.retryAt > Date.now())) return undefined;
    const next: Entry = { source, retryAt: Date.now() + 60_000 };
    this.entries.delete(key);
    this.entries.set(key, next);
    const oldest = this.entries.keys().next().value;
    if (this.entries.size > 300 && oldest !== undefined) this.entries.delete(oldest);
    this.pending++;
    void avatar(url).then((bytes) => { next.bytes = bytes; }).catch(() => {}).finally(() => { this.pending--; });
    return undefined;
  }

  read(key: string) {
    return this.entries.get(key)?.bytes;
  }
}
