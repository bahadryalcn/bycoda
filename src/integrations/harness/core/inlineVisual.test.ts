import { expect, it } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { groupTurnItems } from "../../../features/sessions/model/transcriptActivity";
import { inlineVisualFromResult } from "../../../features/sessions/model/inlineVisual";
import { sanitizeSessionForPersist } from "../../../features/sessions/data/sessionStore";
import { applyHarnessEvent } from "./apply";

const snapshot = { version: 1, title: "Chart", height: 360, html: "<button onclick='this.textContent++'>0</button>" };
const detail = JSON.stringify({ bycodaInlineVisual: snapshot });

it("retains completed visuals as typed portable snapshots outside folded work and in persistence", () => {
  const session = applyHarnessEvent(newSession("codex", "/tmp"), {
    type: "tool.updated", callId: "visual", title: "conversation_visuals_render", status: "completed", detail,
  });
  expect(session.blocks[0].inlineVisual).toEqual(snapshot);
  expect(groupTurnItems(session.blocks, { settled: true })[0].type).toBe("block");
  const persisted = sanitizeSessionForPersist(session);
  expect(JSON.parse(JSON.stringify(persisted)).blocks[0].inlineVisual).toEqual(snapshot);
  const malformed = sanitizeSessionForPersist({ ...session, blocks: [{ ...session.blocks[0], inlineVisual: { ...snapshot, version: 2 } as never }] });
  expect(malformed.blocks[0].inlineVisual).toBeUndefined();
});

it("does not promote partial, failed, truncated or ordinary HTML output", () => {
  for (const patch of [
    { status: "running" },
    { status: "failed" },
    { status: "completed", detailTruncated: true },
    { status: "completed", detail: "<html>ordinary output</html>" },
    { status: "completed", detail: detail + "x".repeat(9000) },
  ]) {
    const session = applyHarnessEvent(newSession("codex", "/tmp"), { type: "tool.updated", callId: "visual", title: "conversation_visuals_render", detail, ...patch });
    expect(session.blocks[0].inlineVisual).toBeUndefined();
  }
});

it("does not execute a snapshot-shaped JSON file returned by an ordinary read tool", () => {
  const session = applyHarnessEvent(newSession("codex", "/tmp"), { type: "tool.updated", callId: "read", title: "Read snapshot.json", status: "completed", detail });
  expect(session.blocks[0].inlineVisual).toBeUndefined();
});

it("accepts provider MCP envelopes but rejects error wrappers and invalid metadata", () => {
  expect(inlineVisualFromResult(JSON.stringify({ content: [{ type: "text", text: detail }] }))).toEqual(snapshot);
  expect(inlineVisualFromResult(JSON.stringify({ isError: true, bycodaInlineVisual: snapshot }))).toBeUndefined();
  expect(inlineVisualFromResult(JSON.stringify({ bycodaInlineVisual: { ...snapshot, height: 100000 } }))).toBeUndefined();
});
