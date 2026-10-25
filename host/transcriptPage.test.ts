import { describe, expect, it } from "vitest";
import type { HostSession } from "../src/features/connections/model/protocol";
import type { Block } from "../src/features/sessions/model/session";
import { blockDigest, conversationHead } from "../src/features/sync/model/conversationDigest";
import {
  partialSessionSync,
  previewBlock,
  previewSession,
  TranscriptPages,
  transcriptPage,
} from "./transcriptPage";
const snapshot = (): HostSession =>
  ({
    session: {
      id: "s",
      blocks: Array.from({ length: 150 }, (_, index) => ({
        id: String(index),
        role: "assistant",
        text: "x".repeat(350_000),
      })),
    },
    revision: 1,
  }) as HostSession;
it("opens a bounded tail then reconstructs every block in order", () => {
  const value = snapshot();
  let page = transcriptPage(value);
  const initial = page;
  let blocks = page.value.session.blocks;
  expect(blocks.length).toBeLessThan(100);
  while (page.before !== undefined) {
    page = transcriptPage(value, page.before, value.revision);
    blocks = [...page.value.session.blocks, ...blocks];
  }
  expect(blocks.map((block) => block.id)).toEqual(value.session.blocks.map((block) => block.id));
  expect(
    blocks.every(
      (block) =>
        block.remoteContent?.bytes ===
        Buffer.byteLength(JSON.stringify(value.session.blocks[Number(block.id)])),
    ),
  ).toBe(true);
  expect(initial.value.history).toEqual({
    before: initial.before,
    revision: 1,
    totalBlocks: 150,
  });
  expect(Buffer.byteLength(JSON.stringify(initial.value))).toBeLessThanOrEqual(1024 * 1024);
  expect(() => transcriptPage(value, 5, 2)).toThrow("changed");
});
it("rejects page metadata that alone exceeds the bounded response budget", () => {
  const value = snapshot();
  (value.session as typeof value.session & { title: string }).title = "x".repeat(1024 * 1024);
  expect(() => transcriptPage(value)).toThrow("metadata exceeds the page transfer budget");
});
it("keeps one oversized block readable and marks the remaining history cursor", () => {
  const value = snapshot();
  value.session.blocks = [
    ...value.session.blocks,
    { id: "huge", role: "assistant", text: "x".repeat(2_000_000) },
  ];
  const page = transcriptPage(value);
  expect(page.value.session.blocks.some((block) => block.id === "huge")).toBe(true);
  expect(page.value.history).toMatchObject({
    before: page.before,
    totalBlocks: 151,
    revision: 1,
  });
  expect(Buffer.byteLength(JSON.stringify(page.value.session.blocks))).toBeLessThanOrEqual(
    1024 * 1024,
  );
  expect(Buffer.byteLength(JSON.stringify(page.value))).toBeLessThanOrEqual(1024 * 1024);
  expect(
    Buffer.byteLength(
      JSON.stringify(page.value.session.blocks.find((block) => block.id === "huge")),
    ),
  ).toBeLessThan(64 * 1024);
});

it("bounds nested block previews and marks the exact full content size", () => {
  const block = {
    id: "nested",
    role: "tool" as const,
    text: "brief",
    tool: { output: "x".repeat(400_000) },
  };
  const preview = previewBlock(block, 9);
  expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThan(64 * 1024);
  expect(preview.remoteContent).toEqual({
    revision: 9,
    bytes: Buffer.byteLength(JSON.stringify(block)),
  });
});

it("preserves required IDs and tool output state while stripping inline attachment bytes", () => {
  const block = {
    id: "🧪".repeat(128),
    role: "tool" as const,
    text: "visible",
    tool: { title: "Shell", output: "x".repeat(500_000) },
    attachments: [
      {
        id: "a",
        name: "image.png",
        mimeType: "image/png",
        kind: "image" as const,
        size: 400_000,
        data: "YQ==".repeat(100_000),
      },
    ],
  };
  const preview = previewBlock(block, 3);
  expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThan(64 * 1024);
  expect(preview).toMatchObject({
    id: block.id,
    role: "tool",
    text: "visible",
    tool: { title: "Shell", outputTruncated: true },
    remoteContent: { revision: 3 },
  });
  expect(preview.attachments?.[0]).not.toHaveProperty("data");
});

it("preserves durable stopped-turn markers in bounded block previews", () => {
  const preview = previewBlock(
    {
      id: "stopped",
      role: "user",
      text: "x".repeat(200_000),
      turnOutcome: "stopped",
      turnStoppedAt: 1234,
    },
    4,
  );
  expect(preview).toMatchObject({ turnOutcome: "stopped", turnStoppedAt: 1234 });
  expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThan(64 * 1024);
});

it("bounds rewind archive metadata in snapshots without changing active or stored history", () => {
  const value = snapshot();
  value.session.blocks = [{ id: "retained-prefix", role: "user", text: "keep me" }];
  const archive = Array.from({ length: 220 }, (_, index) => ({
    id: `rewind-${index}`,
    createdAt: index,
    fromBlockId: `removed-${index}`,
    blocks: [
      {
        id: `removed-${index}`,
        role: "assistant" as const,
        text: `archived ${index} ${"x".repeat(12_000)}`,
        tool: { output: "large provider payload".repeat(2_000) },
        attachments: [{ name: `attachment-${index}.png`, data: "YQ==".repeat(20_000) }],
      },
    ],
  }));
  value.session.rewindHistory = archive;
  const original = JSON.stringify(archive);

  const page = transcriptPage(value);
  const preview = previewSession(value);
  expect(Buffer.byteLength(JSON.stringify(page.value))).toBeLessThan(1024 * 1024);
  expect(page.value.session.rewindHistoryTruncated).toBe(true);
  expect(page.value.session.rewindHistory?.at(-1)?.id).toBe("rewind-219");
  expect(page.value.session.rewindHistory?.length).toBeLessThan(archive.length);
  expect(page.value.session.blocks.map((block) => block.id)).toEqual(["retained-prefix"]);
  expect(page.value.session.blocks.some((block) => block.id.startsWith("removed-"))).toBe(false);
  expect(preview.session.rewindHistoryTruncated).toBe(true);
  expect(JSON.stringify(value.session.rewindHistory)).toBe(original);
});

it("keeps partial delta IDs contiguous from the earliest surviving loaded block", () => {
  const value = {
    session: {
      id: "s",
      blocks: Array.from({ length: 8 }, (_, i) => ({
        id: String(i),
        role: "assistant" as const,
        text: "x",
      })),
    },
    revision: 1,
  } as HostSession;
  const current = {
    ...value,
    revision: 2,
    session: { ...value.session, blocks: value.session.blocks.slice(2) },
  };
  const sync = {
    kind: "delta" as const,
    base: 1,
    value: {
      projectId: "p",
      revision: 2,
      updatedAt: 2,
      status: "idle" as const,
      session: { ...current.session, blocks: [] },
    },
    blockIds: current.session.blocks.map((block) => block.id),
    blocks: current.session.blocks,
  };
  const partial = partialSessionSync(sync, current, ["0", "5"]);
  expect(partial).toMatchObject({
    kind: "delta",
    partial: true,
    blockIds: current.session.blocks.slice(3).map((block) => block.id),
    value: { history: { before: 3, totalBlocks: 6, revision: 2 } },
  });
});
it("retains the middle loaded block window when its first loaded block was deleted", () => {
  const value = {
    session: {
      id: "s",
      blocks: Array.from({ length: 8 }, (_, i) => ({
        id: `b${i}`,
        role: "assistant" as const,
        text: "x",
      })),
    },
    revision: 1,
  } as HostSession;
  const blocks = value.session.blocks.filter((block) => block.id !== "b0");
  const current = {
    ...value,
    revision: 2,
    session: { ...value.session, blocks },
  };
  const sync = {
    kind: "delta" as const,
    base: 1,
    value: {
      projectId: "p",
      revision: 2,
      updatedAt: 2,
      status: "idle" as const,
      session: { ...current.session, blocks: [] },
    },
    blockIds: blocks.map((block) => block.id),
    blocks,
  };
  const partial = partialSessionSync(sync, current, ["b0", "b1", "b2", "b3"]);
  expect(partial).toMatchObject({
    kind: "delta",
    partial: true,
    blockIds: ["b1", "b2", "b3", "b4", "b5", "b6", "b7"],
    value: { history: { before: undefined, totalBlocks: 7, revision: 2 } },
  });
});
it("pins history pages while a live revision advances", async () => {
  const pages = new TranscriptPages();
  const old = snapshot();
  const first = await pages.page(() => old, "s");
  const read = () => ({
    ...old,
    revision: 2,
    session: { ...old.session, blocks: [] },
  });
  const previous = await pages.page(read, "s", first.before, first.revision);
  expect(previous.revision).toBe(1);
  expect(previous.totalBlocks).toBe(150);
});

describe("digests", () => {
  const fullBlocks = (): Block[] => [
    { id: "plain", role: "user", text: "hello", startedAt: 5, durationMs: 90 },
    {
      id: "files",
      role: "user",
      text: "[file1] [image1]",
      attachments: [
        {
          id: "f1",
          name: "clip.mkv",
          mimeType: "video/x-matroska",
          kind: "file",
          size: 9,
          path: "C:/files/clip.mkv",
          data: "AAAA",
        },
        {
          id: "f2",
          name: "shot.png",
          mimeType: "image/png",
          kind: "image",
          size: 4,
          previewUrl: "blob:x",
        },
      ],
    },
    { id: "long", role: "assistant", text: "word ".repeat(30_000) },
    {
      id: "tool",
      role: "tool",
      text: "",
      tool: { id: "t1", name: "Bash", status: "done", output: "line\n".repeat(40_000) },
    } as unknown as Block,
    {
      id: "image",
      role: "assistant",
      text: "made",
      image: { path: "C:/out.png", name: "out.png", mimeType: "image/png", size: 3, data: "AAA" },
    },
    { id: "unicode", role: "assistant", text: "naïve 日本語 \u{1f600} \ud800 end" },
  ];

  it("gives a shrunk block the digest of the full block, and an unshrunk block the same one", () => {
    for (const block of fullBlocks()) {
      const wire = previewBlock(block, 7, true);
      expect(blockDigest(wire)).toBe(blockDigest(block));
      // The same after the wire: JSON round trip, as the other side receives it.
      expect(blockDigest(JSON.parse(JSON.stringify(wire)))).toBe(blockDigest(block));
      if (wire.remoteContent) expect(wire.remoteContent.digest).toBe(blockDigest(block));
    }
    const marked = fullBlocks().filter((block) => previewBlock(block, 1).remoteContent);
    expect(marked.map((block) => block.id)).toEqual(["files", "long", "tool", "image"]);
  });

  it("does not depend on what a machine keeps locally", () => {
    const [plain, files] = fullBlocks();
    expect(blockDigest({ ...plain!, durationMs: 1, startedAt: 9, turnMetrics: {} as never })).toBe(
      blockDigest(plain!),
    );
    const moved = {
      ...files!,
      attachments: files!.attachments!.map(({ path: _path, data: _data, ...rest }) => rest),
    };
    expect(blockDigest(moved)).toBe(blockDigest(files!));
    expect(blockDigest({ ...plain!, text: "hello!" })).not.toBe(blockDigest(plain!));
    expect(
      blockDigest({
        ...files!,
        attachments: [{ ...files!.attachments![0]!, name: "other.mkv" }, files!.attachments![1]!],
      }),
    ).not.toBe(blockDigest(files!));
  });

  it("is absent unless asked for", () => {
    const wire = previewBlock(fullBlocks()[1]!, 3);
    expect(wire.remoteContent).toEqual({ revision: 3, bytes: expect.any(Number) });
    const value = { ...snapshot(), session: { ...snapshot().session, blocks: fullBlocks() } };
    expect(previewSession(value as HostSession)).not.toHaveProperty("head");
    expect(transcriptPage(value as HostSession).value).not.toHaveProperty("head");
  });

  it("carries the head of the whole transcript on a snapshot, a page and a window", () => {
    const value = {
      ...snapshot(),
      session: { ...snapshot().session, blocks: fullBlocks() },
    } as HostSession;
    const head = conversationHead(value.session.blocks)!;
    expect(previewSession(value, true).head).toEqual(head);
    const page = transcriptPage(value, undefined, undefined, true, true);
    expect(page.value.head).toEqual(head);
    // A page holds only part of the blocks, never the head of just those.
    expect(transcriptPage(value, 3, undefined, true, true).value.head).toEqual(head);
    expect(previewSession(page.value as HostSession, true).head).toEqual(head);
    const sync = {
      kind: "delta" as const,
      base: 1,
      value: { ...value, session: { ...value.session, blocks: undefined as never } },
      blockIds: value.session.blocks.map((block) => block.id),
      blocks: value.session.blocks,
    };
    const partial = partialSessionSync(sync as never, value, ["tool", "image"], true);
    expect(partial).toMatchObject({ kind: "delta", partial: true, value: { head } });
    expect(
      (partial as { blocks: Block[] }).blocks.find((block) => block.id === "tool")?.remoteContent
        ?.digest,
    ).toBe(blockDigest(value.session.blocks[3]!));
  });

  it("makes the digests of a transcript reconstructed from pages agree with its head", () => {
    const value = snapshot();
    let page = transcriptPage(value, undefined, undefined, true, true);
    let blocks = page.value.session.blocks;
    while (page.before !== undefined) {
      page = transcriptPage(value, page.before, value.revision, true, true);
      blocks = [...page.value.session.blocks, ...blocks];
    }
    expect(conversationHead(blocks)).toEqual(page.value.head);
    expect(conversationHead(blocks)).toEqual(conversationHead(value.session.blocks));
  });
});
