import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import type { AppearanceBackgroundImageParamsSchema } from "../../src/shared/model/host-contracts/appearance";
import {
  createSocialImageAdapters,
  validateGeneratedImage,
  type SocialImageAdapters,
} from "../social/social-images";
import { writeFileAtomic } from "../storage/atomic-write";

type Params = z.infer<typeof AppearanceBackgroundImageParamsSchema>;

const IMAGE_DIRECTORY = join(tmpdir(), "bycoda-appearance-images");
/** The adapter stops its own HTTP work at 180 s; this also bounds the Codex turn. */
const TIMEOUT_MS = 200_000;
const IMAGE_RETENTION_MS = 60 * 60 * 1_000;

/** The owner's words stay quoted data; the frame keeps the image usable behind chat text. */
export function backgroundImagePrompt(request: string): string {
  return [
    "A wide desktop wallpaper used behind the panes of a developer app.",
    "Calm, low detail at the centre, no text, no letters, no logos, no user interface.",
    `Scene, quoted as plain description: ${JSON.stringify(request)}`,
  ].join(" ");
}

/** Give concurrent replies time to copy their separate files into the desktop library. */
async function pruneOldImages() {
  const entries = await readdir(IMAGE_DIRECTORY).catch(() => [] as string[]);
  const cutoff = Date.now() - IMAGE_RETENTION_MS;
  await Promise.all(
    entries
      .filter((name) => name.startsWith("background-"))
      .map(async (name) => {
        const path = join(IMAGE_DIRECTORY, name);
        const file = await stat(path).catch(() => undefined);
        if (file?.isFile() && file.mtimeMs < cutoff)
          await rm(path, { force: true }).catch(() => undefined);
      }),
  );
}

/**
 * Draws one background image with the chosen provider's native image generation and writes it to
 * a private temporary file. Only that provider is tried; an unavailable one fails with its reason.
 */
export async function generateAppearanceBackgroundImage(
  params: Params,
  adapters: SocialImageAdapters = createSocialImageAdapters(IMAGE_DIRECTORY),
  requestSignal?: AbortSignal,
): Promise<{ path: string }> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
  signal.throwIfAborted();
  const adapter = adapters[params.provider];
  if (!adapter)
    throw new Error(
      params.provider === "gemini"
        ? "Gemini images need GEMINI_API_KEY and BYCODA_SOCIAL_GEMINI_IMAGE_MODEL on this Host."
        : "Codex image generation is not available on this Host.",
    );
  const capability = await adapter.capability();
  if (!capability.available)
    throw new Error(capability.reason || "The selected image provider is unavailable.");
  await mkdir(IMAGE_DIRECTORY, { recursive: true, mode: 0o700 });
  signal.throwIfAborted();
  const id = randomUUID();
  const result = await adapter.generate({
    prompt: backgroundImagePrompt(params.prompt),
    aspectRatio: "16:9",
    signal,
    checkpoint: () => undefined,
    id,
  });
  signal.throwIfAborted();
  validateGeneratedImage(result.bytes);
  const bytes = Buffer.from(result.bytes);
  const extension = bytes[0] === 0xff && bytes[1] === 0xd8 ? "jpg" : "png";
  const name = `background-${id}.${extension}`;
  const path = join(IMAGE_DIRECTORY, name);
  await writeFileAtomic(path, bytes, { mode: 0o600 });
  await pruneOldImages();
  if (signal.aborted) {
    await rm(path, { force: true }).catch(() => undefined);
    signal.throwIfAborted();
  }
  return { path };
}
