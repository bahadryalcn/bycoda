// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { TranscriptPool, transcriptPoolWeight } from "./TranscriptPool";
import { registerStreamingTextUpdate } from "../model/stableBlocks";
import type { Block } from "../model/session";
function Transcript(_props: { blocks: Block[]; visible?: boolean; parked?: boolean }) {
  return null;
}
describe("weighted transcript parking", () => {
  it("evicts heavy parked transcripts while retaining active panes", () => {
    const pool = new TranscriptPool(12, 2000);
    const heavy = [{ id: "a", role: "assistant", text: "x".repeat(2000) }] as Block[];
    const host = document.createElement("div");
    pool.show("active", host, createElement(Transcript, { blocks: heavy }));
    expect(pool.getSnapshot()).toHaveLength(1);
    const second = document.createElement("div");
    pool.show("heavy", second, createElement(Transcript, { blocks: heavy }));
    pool.park("heavy", second);
    expect(pool.getSnapshot().map((entry) => entry.id)).toEqual(["active"]);
  });
  it("updates the weight of a streamed frame from the previous one, matching a full count", () => {
    let blocks = [
      { id: "u", role: "user", text: "question" },
      { id: "a", role: "assistant", text: "", streaming: true },
    ] as Block[];
    transcriptPoolWeight(blocks);
    for (let frame = 0; frame < 20; frame += 1) {
      const next = [...blocks];
      next[1] = { ...next[1], text: `${next[1].text}word ` };
      registerStreamingTextUpdate(blocks, next, 1);
      const incremental = transcriptPoolWeight(next, blocks);
      expect(incremental).toBe(transcriptPoolWeight([...next]));
      blocks = next;
    }
  });
});

describe("generated image weight", () => {
  it("counts the known image size and any inline preview data", () => {
    const plain = [{ id: "a", role: "assistant", text: "x" }] as Block[];
    const withImage = [
      {
        id: "a",
        role: "assistant",
        text: "x",
        image: { path: "/i.png", name: "i", mimeType: "image/png", size: 3_000_000, data: "abcd" },
      },
    ] as Block[];
    expect(transcriptPoolWeight(withImage) - transcriptPoolWeight(plain)).toBeGreaterThanOrEqual(
      3_000_000,
    );
  });
});
