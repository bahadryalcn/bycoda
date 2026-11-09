import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { parseQuickLaunch } from "./quickComposer";
import { quickLaunchAttachments, storeQuickAttachments } from "./quickAttachments";
import type { Attachment } from "../../sessions/model/session";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const image: Attachment = {
  id: "shot",
  name: "Screenshot.png",
  kind: "image",
  mimeType: "image/png",
  size: 4,
  data: "dGVzdA==",
  previewUrl: "blob:local",
};
const base = {
  prompt: "",
  cwd: "/tmp/project",
  harness: "codex",
  reveal: false,
};
beforeEach(() => vi.mocked(invoke).mockReset());

it("a failed spill waits for every accepted sibling's actual result", async () => {
  let release!: (value: string) => void;
  const held = new Promise<string>((resolve) => {
    release = resolve;
  });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "write_attachment") return undefined;
    if ((args as { name: string }).name === "first.png") throw new Error("First spill failed");
    return held;
  });
  let finished = false;
  const actual = storeQuickAttachments([
    { ...image, name: "first.png" },
    { ...image, id: "second", name: "second.png" },
  ]);
  const rejected = expect(actual).rejects.toThrow("First spill failed");
  void actual.then(
    () => {
      finished = true;
    },
    () => {
      finished = true;
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(finished).toBe(false);
  release("/tmp/second.png");
  await rejected;
});

it("stores pasted images and sends only portable metadata across windows", async () => {
  vi.mocked(invoke).mockResolvedValue("/tmp/Screenshot.png");
  const stored = await storeQuickAttachments([image]);
  expect(invoke).toHaveBeenCalledWith("write_attachment", {
    name: image.name,
    data: image.data,
  });
  const attachments = quickLaunchAttachments(stored);
  expect(attachments).toEqual([
    {
      id: "shot",
      name: image.name,
      kind: "image",
      mimeType: "image/png",
      size: 4,
      path: "/tmp/Screenshot.png",
    },
  ]);
  expect(parseQuickLaunch({ ...base, attachments })).toEqual({
    ...base,
    attachments,
  });
});

it("does not rewrite files that already live on disk", async () => {
  const file = { ...image, path: "/tmp/file.png" };
  expect(await storeQuickAttachments([file])).toEqual([file]);
  expect(invoke).not.toHaveBeenCalled();
});

it("rejects unreadable or malformed attachments instead of silently losing them", async () => {
  await expect(storeQuickAttachments([{ ...image, data: undefined }])).rejects.toThrow(
    "Could not attach",
  );
  expect(() => quickLaunchAttachments([image])).toThrow("Could not attach");
  for (const attachment of [
    image,
    { ...image, path: "" },
    { ...image, path: "/tmp/a", size: -1 },
    { ...image, path: "/tmp/a", kind: "unknown" },
  ]) {
    expect(parseQuickLaunch({ ...base, prompt: "Look", attachments: [attachment] })).toBeNull();
  }
});

it("rejects excess attachments and unsupported providers", () => {
  const file = { ...image, path: "/tmp/image.png" };
  expect(parseQuickLaunch({ ...base, attachments: Array(21).fill(file) })).toBeNull();
  expect(parseQuickLaunch({ ...base, harness: "fx", attachments: [file] })).toBeNull();
});
