// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { TranscriptPool } from "./TranscriptPool";
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
});
