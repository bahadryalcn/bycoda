import { describe, expect, it } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { MAX_TOOL_DETAIL_CHARS, applyHarnessEvent } from "./apply";
import type { HarnessEvent } from "./types";

const run = (events: HarnessEvent[]) =>
  events.reduce(applyHarnessEvent, newSession("codex", "/repo")).blocks[0].tool;

const started: HarnessEvent = { type: "tool.started", callId: "c1", kind: "execute" };

describe("tool detail truncation flag (CMD-03)", () => {
  it("leaves outputTruncated unset when the detail fits", () => {
    const tool = run([started, { type: "tool.updated", callId: "c1", detail: "ok\n" }]);
    expect(tool?.detail).toBe("ok");
    expect(tool).not.toHaveProperty("outputTruncated");
  });

  it("sets outputTruncated when the core cap drops text", () => {
    const tool = run([
      started,
      { type: "tool.updated", callId: "c1", detail: "x".repeat(MAX_TOOL_DETAIL_CHARS + 50) },
    ]);
    expect(tool?.outputTruncated).toBe(true);
  });

  it("sets it on a first update that creates the block", () => {
    const tool = run([
      { type: "tool.updated", callId: "c1", detail: "x".repeat(MAX_TOOL_DETAIL_CHARS + 1) },
    ]);
    expect(tool?.outputTruncated).toBe(true);
  });

  it("honors a provider-reported drop and clears it when a complete result replaces it", () => {
    const partial = run([
      started,
      { type: "tool.updated", callId: "c1", detail: "tail", detailTruncated: true },
    ]);
    expect(partial?.outputTruncated).toBe(true);
    const done = run([
      started,
      { type: "tool.updated", callId: "c1", detail: "tail", detailTruncated: true },
      { type: "tool.updated", callId: "c1", detail: "full", status: "completed" },
    ]);
    expect(done?.detail).toBe("full");
    expect(done).not.toHaveProperty("outputTruncated");
  });

  it("keeps the flag when an update carries no detail", () => {
    const tool = run([
      started,
      { type: "tool.updated", callId: "c1", detail: "tail", detailTruncated: true },
      { type: "tool.updated", callId: "c1", status: "completed" },
    ]);
    expect(tool?.outputTruncated).toBe(true);
  });
});
