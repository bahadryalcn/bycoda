import { mkdir, mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SocialImageAdapters } from "../../social/social-images";
import { generateAssistantAvatar, readAssistantAvatar } from "./avatar";

// Minimal valid PNG: signature + IHDR(1x1) so validateGeneratedImage accepts it.
function png(): Uint8Array {
  const bytes = new Uint8Array(2048);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0, 0, 0, 2, 0], 8);
  return bytes;
}
function adapters(prompts: string[] = []): SocialImageAdapters {
  return {
    codex: {
      capability: async () => ({ provider: "codex", available: true, reason: "", models: [] }),
      generate: async (input) => {
        prompts.push(`${input.aspectRatio}|${input.prompt}`);
        return { bytes: png(), model: "test" };
      },
    },
  } as SocialImageAdapters;
}
const idOf = (avatar: string) => avatar.slice("image:".length);

describe("assistant builder avatar", () => {
  it("stores a framed square image and reads it back as a data URL", async () => {
    const directory = join(await mkdtemp(join(tmpdir(), "avatar-")), "avatars");
    const prompts: string[] = [];
    const { avatar } = await generateAssistantAvatar(
      { prompt: 'a "fox"', provider: "codex" },
      { directory, savedAvatar: async () => undefined, adapters: adapters(prompts) },
    );
    expect(avatar).toMatch(/^image:[0-9a-f-]{36}$/);
    expect(prompts[0]).toContain("1:1|");
    expect(prompts[0]).toContain('"a \\"fox\\""');
    const { dataUrl } = await readAssistantAvatar(idOf(avatar), directory);
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("rejects bad ids and reports a missing image", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-"));
    await expect(readAssistantAvatar("../../etc/passwd", directory)).rejects.toThrow();
    // Right length, wrong characters: must still be refused before any file access.
    await expect(
      readAssistantAvatar("../../../../../../../../../etc/passw", directory),
    ).rejects.toThrow("Invalid avatar id.");
    await expect(
      readAssistantAvatar("00000000-0000-0000-0000-000000000000", directory),
    ).rejects.toThrow("Avatar image not found.");
  });

  it("keeps the newest twelve and the avatar the saved profile references", async () => {
    const directory = await mkdtemp(join(tmpdir(), "avatar-"));
    await mkdir(directory, { recursive: true });
    const ids = Array.from(
      { length: 15 },
      (_, index) => `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
    );
    for (const [index, id] of ids.entries()) {
      const path = join(directory, `${id}.png`);
      await writeFile(path, png());
      const time = new Date(Date.now() - (100 - index) * 60_000);
      await utimes(path, time, time);
    }
    const saved = ids[0]!;
    const { avatar } = await generateAssistantAvatar(
      { prompt: "owl", provider: "codex" },
      { directory, savedAvatar: async () => `image:${saved}`, adapters: adapters() },
    );
    const left = await readdir(directory);
    expect(left).toContain(`${saved}.png`);
    expect(left).toContain(`${idOf(avatar)}.png`);
    expect(left).toHaveLength(13);
    expect(left).not.toContain(`${ids[1]}.png`);
  });
});
