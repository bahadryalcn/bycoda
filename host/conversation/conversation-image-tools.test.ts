import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  IMAGE_MODELS_KEY,
  encodeImageModels,
} from "../../src/shared/model/host-contracts/image-models";
import { randomUUID } from "node:crypto";
import type { SocialImageAdapters } from "../social/social-images";
import { MAX_IMAGES_PER_SESSION, callImageConversationTool } from "./conversation-image-tools";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function png(width = 32, height = 16) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
function jpeg(width = 20, height = 10) {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    ...Array(14).fill(0),
    0xff,
    0xd9,
  ]);
}
function setup(
  bytes: Buffer = png(),
  available = true,
  options: { selected?: string[]; antigravity?: string } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "image-tools-"));
  roots.push(root);
  const generate = vi.fn(async () => ({ bytes, model: "native-default" }));
  const adapters: SocialImageAdapters = {
    codex: {
      capability: async () => ({
        provider: "codex",
        available,
        reason: available ? "" : "Not signed in.",
        models: ["native-default"],
      }),
      generate,
    },
  };
  const runAntigravity = vi.fn(async (input: { target: string; model: string }) => {
    mkdirSync(dirname(input.target), { recursive: true });
    writeFileSync(input.target, png(64, 64));
    return { bytes: png(64, 64), model: input.model, sessionId: "child" };
  });
  const session = {
    id: randomUUID(),
    modelSettings: options.selected
      ? { [IMAGE_MODELS_KEY]: encodeImageModels(options.selected)! }
      : {},
    runtimeMode: "supervised" as const,
  };
  const call = (action: string, input: Record<string, unknown> = {}) =>
    callImageConversationTool(root, action, input, {
      session,
      projectId: "project",
      engine: { store: { attachmentDir: join(root, "attachments") } } as never,
      adapters,
      antigravity: async () => options.antigravity,
      runAntigravity: runAntigravity as never,
      authorized: async () => true,
    });
  return { root, call, generate, runAntigravity };
}

it("lists image models with access, formats and limits plus the remaining budget", async () => {
  const { call } = setup(png(), true, { antigravity: "agy-model" });
  const status = (await call("images.status")) as {
    remaining: number;
    models: {
      id: string;
      access: string;
      available: boolean;
      outputs: string[];
      limits: string[];
    }[];
  };
  expect(status.remaining).toBe(MAX_IMAGES_PER_SESSION);
  const byId = Object.fromEntries(status.models.map((model) => [model.id, model]));
  expect(byId.codex).toMatchObject({
    access: "images.generate",
    available: true,
    outputs: ["png"],
  });
  expect(byId.antigravity).toMatchObject({
    access: "antigravity-member",
    available: true,
  });
  expect(byId.antigravity!.limits.join(" ")).toContain("no SVG, GIF");
  expect(byId.gemini).toMatchObject({
    available: false,
    reason: "Not configured on this Host.",
  });
});

it("saves a generated image as a new workspace file", async () => {
  const { root, call, generate } = setup();
  const result = await call("images.generate", {
    prompt: "A green snake sprite",
    path: "games/snake/assets/snake.png",
    aspectRatio: "1:1",
  });
  expect(result).toMatchObject({
    path: "games/snake/assets/snake.png",
    provider: "codex",
    width: 32,
    height: 16,
  });
  expect(readFileSync(join(root, "games/snake/assets/snake.png"))).toEqual(png());
  expect(generate).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: "A green snake sprite",
      aspectRatio: "1:1",
    }),
  );
});

it("keeps JPEG output by correcting the saved extension", async () => {
  const { root, call } = setup(jpeg());
  const result = await call("images.generate", {
    prompt: "Menu",
    path: "art/menu.png",
  });
  expect(result).toMatchObject({ path: "art/menu.jpg", width: 20, height: 10 });
  expect(existsSync(join(root, "art/menu.png"))).toBe(false);
});

it("refuses paths outside the workspace, other formats and existing files", async () => {
  const { root, call, generate } = setup();
  await expect(call("images.generate", { prompt: "x", path: "../escape.png" })).rejects.toThrow(
    "outside the workspace",
  );
  await expect(call("images.generate", { prompt: "x", path: "art/icon.svg" })).rejects.toThrow(
    ".png",
  );
  mkdirSync(join(root, "art"));
  writeFileSync(join(root, "art/icon.png"), "keep");
  await expect(call("images.generate", { prompt: "x", path: "art/icon.png" })).rejects.toThrow(
    "already exists",
  );
  expect(readFileSync(join(root, "art/icon.png"), "utf8")).toBe("keep");
  expect(generate).not.toHaveBeenCalled();
});

it("fails with the provider reason when no provider is available", async () => {
  const { call } = setup(png(), false);
  await expect(call("images.generate", { prompt: "x", path: "a.png" })).rejects.toThrow(
    "No selected image provider",
  );
});

it("stops generating after the per-conversation budget", async () => {
  const { call, generate } = setup();
  for (let index = 0; index < MAX_IMAGES_PER_SESSION; index++)
    await call("images.generate", { prompt: "x", path: `a/${index}.png` });
  await expect(call("images.generate", { prompt: "x", path: "a/last.png" })).rejects.toThrow(
    "Image limit reached",
  );
  expect(generate).toHaveBeenCalledTimes(MAX_IMAGES_PER_SESSION);
});

it("does not write after authority is revoked", async () => {
  const { root } = setup();
  let allowed = true;
  const adapters: SocialImageAdapters = {
    codex: {
      capability: async () => ({
        provider: "codex",
        available: true,
        reason: "",
        models: [],
      }),
      generate: async () => {
        allowed = false;
        return { bytes: png(), model: "native-default" };
      },
    },
  };
  await expect(
    callImageConversationTool(
      root,
      "images.generate",
      { prompt: "x", path: "late.png" },
      {
        session: {
          id: randomUUID(),
          modelSettings: {},
          runtimeMode: "supervised",
        },
        projectId: "project",
        engine: {
          store: { attachmentDir: join(root, "attachments") },
        } as never,
        adapters,
        antigravity: async () => undefined,
        authorized: async () => allowed,
      },
    ),
  ).rejects.toThrow("revoked");
  expect(existsSync(join(root, "late.png"))).toBe(false);
});

it("marks the session's selected models and refuses unselected providers", async () => {
  const { call, generate } = setup(png(), true, {
    selected: ["antigravity"],
    antigravity: "agy-model",
  });
  const status = (await call("images.status")) as {
    models: { id: string; selected: boolean }[];
  };
  const selected = Object.fromEntries(status.models.map((model) => [model.id, model.selected]));
  expect(selected).toMatchObject({ codex: false, antigravity: true });
  await expect(
    call("images.generate", { prompt: "x", path: "a.png", provider: "codex" }),
  ).rejects.toThrow("not selected");
  expect(generate).not.toHaveBeenCalled();
});

it("runs Nano Banana in Antigravity when it is the selected model", async () => {
  const { root, call, generate, runAntigravity } = setup(png(), true, {
    selected: ["antigravity"],
    antigravity: "agy-model",
  });
  const result = await call("images.generate", {
    prompt: "Snake logo",
    path: "art/logo.png",
  });
  expect(result).toMatchObject({
    path: "art/logo.png",
    provider: "antigravity",
    model: "agy-model",
    width: 64,
  });
  expect(generate).not.toHaveBeenCalled();
  expect(runAntigravity).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: "Snake logo",
      target: join(root, "art/logo.png"),
    }),
  );
});

it("falls back to Nano Banana only when automatic finds no Host provider", async () => {
  const { call, runAntigravity } = setup(png(), false, {
    antigravity: "agy-model",
  });
  await expect(call("images.generate", { prompt: "x", path: "b.png" })).resolves.toMatchObject({
    provider: "antigravity",
  });
  expect(runAntigravity).toHaveBeenCalledOnce();
});
