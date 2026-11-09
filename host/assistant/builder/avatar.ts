import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import {
  ASSISTANT_AVATAR_ID_PATTERN,
  AssistantAvatarIdSchema,
  type AssistantAvatarGenerateParamsSchema,
} from "../../../src/shared/model/host-contracts/assistant-builder";
import {
  createSocialImageAdapters,
  validateGeneratedImage,
  type SocialImageAdapters,
} from "../../social/social-images";
import { writeFileAtomic } from "../../storage/atomic-write";

type Params = z.infer<typeof AssistantAvatarGenerateParamsSchema>;

/** The adapter stops its own HTTP work at 180 s; this also bounds the Codex turn. */
const TIMEOUT_MS = 200_000;
/** Generated portraits kept besides the one the saved profile uses. */
export const AVATAR_KEEP = 12;
const AVATAR_PREFIX = "image:";
const FILE_PATTERN = /^([0-9a-f-]{36})\.(png|jpg)$/;

export interface AvatarStorage {
  /** Persistent Host state folder for generated avatars. */
  directory: string;
  /** The avatar value saved in the assistant profile, e.g. `image:<id>`; never pruned. */
  savedAvatar: () => Promise<string | undefined>;
  adapters?: SocialImageAdapters;
}

/** The owner's words stay quoted data; the frame keeps the picture a usable square avatar. */
export function avatarImagePrompt(request: string): string {
  return [
    "A square avatar portrait for a friendly AI assistant, centered subject, simple background,",
    "no text, no letters, no logos, no user interface.",
    `Look, quoted as plain description: ${JSON.stringify(request)}`,
  ].join(" ");
}

/** Keeps the newest files plus the one the saved profile references. */
async function pruneAvatars(storage: AvatarStorage, keepName: string) {
  const saved = await storage.savedAvatar().catch(() => undefined);
  const savedId = saved?.startsWith(AVATAR_PREFIX) ? saved.slice(AVATAR_PREFIX.length) : undefined;
  const entries = await readdir(storage.directory).catch(() => [] as string[]);
  const files = await Promise.all(
    entries
      .filter((name) => FILE_PATTERN.test(name))
      .map(async (name) => ({
        name,
        time: (await stat(join(storage.directory, name)).catch(() => undefined))?.mtimeMs ?? 0,
      })),
  );
  const newest = files
    .sort((a, b) => b.time - a.time)
    .slice(0, AVATAR_KEEP)
    .map((file) => file.name);
  const keep = new Set([...newest, keepName]);
  await Promise.all(
    files
      .filter((file) => !keep.has(file.name) && file.name.slice(0, 36) !== savedId)
      .map((file) =>
        rm(join(storage.directory, file.name), { force: true }).catch(() => undefined),
      ),
  );
}

/** Draws one square portrait with the chosen provider and stores it as `<uuid>.png|jpg`. */
export async function generateAssistantAvatar(
  params: Params,
  storage: AvatarStorage,
): Promise<{ avatar: string }> {
  const adapters =
    storage.adapters ?? createSocialImageAdapters(join(tmpdir(), "bycoda-assistant-avatars"));
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
  const id = randomUUID();
  const result = await adapter.generate({
    prompt: avatarImagePrompt(params.prompt),
    aspectRatio: "1:1",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    checkpoint: () => undefined,
    id,
  });
  validateGeneratedImage(result.bytes);
  const bytes = Buffer.from(result.bytes);
  const extension = bytes[0] === 0xff && bytes[1] === 0xd8 ? "jpg" : "png";
  const name = `${id}.${extension}`;
  await mkdir(storage.directory, { recursive: true, mode: 0o700 });
  await writeFileAtomic(join(storage.directory, name), bytes, { mode: 0o600 });
  await pruneAvatars(storage, name);
  return { avatar: `${AVATAR_PREFIX}${id}` };
}

/** Reads a stored avatar as a data URL; the id is validated before it touches the filesystem. */
export async function readAssistantAvatar(
  rawId: string,
  directory: string,
): Promise<{ dataUrl: string }> {
  const id = AssistantAvatarIdSchema.parse(rawId);
  if (!ASSISTANT_AVATAR_ID_PATTERN.test(id)) throw new Error("Invalid avatar id.");
  for (const [extension, mime] of [
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
  ] as const) {
    const bytes = await readFile(join(directory, `${id}.${extension}`)).catch(() => undefined);
    if (bytes) return { dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
  }
  throw new Error("Avatar image not found.");
}
