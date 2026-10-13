import { expect, it } from "vitest";
import type { HostSession } from "../src/features/connections/model/protocol";
import {
  partialSessionSync,
  previewBlock,
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
it("pins history pages while a live revision advances", () => {
  const pages = new TranscriptPages();
  const old = snapshot();
  const first = pages.page(() => old, "s");
  const read = () => ({
    ...old,
    revision: 2,
    session: { ...old.session, blocks: [] },
  });
  const previous = pages.page(read, "s", first.before, first.revision);
  expect(previous.revision).toBe(1);
  expect(previous.totalBlocks).toBe(150);
});
