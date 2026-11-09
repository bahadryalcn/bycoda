import { expect, it } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { groupTurnItems } from "../../../features/sessions/model/transcriptActivity";
import {
  inlineVisualFromResult,
  sandboxedInlineVisual,
} from "../../../features/sessions/model/inlineVisual";
import { sanitizeSessionForPersist } from "../../../features/sessions/data/sessionStore";
import { applyHarnessEvent } from "./apply";

const snapshot = {
  version: 1,
  title: "Chart",
  height: 360,
  html: "<button onclick='this.textContent++'>0</button>",
};
const detail = JSON.stringify({ bycodaInlineVisual: snapshot });

it("retains completed visuals as typed portable snapshots outside folded work and in persistence", () => {
  const session = applyHarnessEvent(newSession("codex", "/tmp"), {
    type: "tool.updated",
    callId: "visual",
    title: "conversation_visuals_render",
    status: "completed",
    detail,
  });
  expect(session.blocks[0].inlineVisual).toEqual(snapshot);
  expect(groupTurnItems(session.blocks, { settled: true })[0].type).toBe("block");
  const persisted = sanitizeSessionForPersist(session);
  expect(JSON.parse(JSON.stringify(persisted)).blocks[0].inlineVisual).toEqual(snapshot);
  const malformed = sanitizeSessionForPersist({
    ...session,
    blocks: [{ ...session.blocks[0], inlineVisual: { ...snapshot, version: 2 } as never }],
  });
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
    const session = applyHarnessEvent(newSession("codex", "/tmp"), {
      type: "tool.updated",
      callId: "visual",
      title: "conversation_visuals_render",
      detail,
      ...patch,
    });
    expect(session.blocks[0].inlineVisual).toBeUndefined();
  }
});

it("does not execute a snapshot-shaped JSON file returned by an ordinary read tool", () => {
  const session = applyHarnessEvent(newSession("codex", "/tmp"), {
    type: "tool.updated",
    callId: "read",
    title: "Read snapshot.json",
    status: "completed",
    detail,
  });
  expect(session.blocks[0].inlineVisual).toBeUndefined();
});

it("accepts provider MCP envelopes but rejects error wrappers and invalid metadata", () => {
  expect(
    inlineVisualFromResult(JSON.stringify({ content: [{ type: "text", text: detail }] })),
  ).toEqual(snapshot);
  expect(
    inlineVisualFromResult(JSON.stringify({ isError: true, bycodaInlineVisual: snapshot })),
  ).toBeUndefined();
  expect(
    inlineVisualFromResult(JSON.stringify({ bycodaInlineVisual: { ...snapshot, height: 100000 } })),
  ).toBeUndefined();
});

it("retains a stored visual reference and rejects references that could name a path", () => {
  const ref = {
    version: 2,
    id: "a".repeat(64),
    title: "Matrix crew",
    height: 1200,
  };
  const session = applyHarnessEvent(newSession("claude", "/tmp"), {
    type: "tool.updated",
    callId: "visual",
    title: "mcp__bycoda__conversation_visuals_render",
    status: "completed",
    detail: JSON.stringify({
      content: [{ type: "text", text: JSON.stringify({ bycodaInlineVisual: ref }) }],
    }),
  });
  expect(session.blocks[0].inlineVisual).toEqual(ref);
  expect(
    JSON.parse(JSON.stringify(sanitizeSessionForPersist(session))).blocks[0].inlineVisual,
  ).toEqual(ref);
  for (const id of ["../secret", "A".repeat(64), "a".repeat(63)])
    expect(
      inlineVisualFromResult(JSON.stringify({ bycodaInlineVisual: { ...ref, id } })),
    ).toBeUndefined();
  expect(
    inlineVisualFromResult(JSON.stringify({ bycodaInlineVisual: { ...ref, height: 2001 } })),
  ).toBeUndefined();
});

it("keeps standards mode and lets theme values never escape the base sheet", () => {
  const page = sandboxedInlineVisual("<!DOCTYPE html><html><body>x</body></html>", true, {
    "--background": "red;}</style><script>alert(1)</script>",
    "--foreground": "rgb(1 2 3)",
  });
  expect(page.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(true);
  expect(page).not.toContain("<!DOCTYPE html>");
  expect(page).not.toContain("alert(1)");
  expect(page).toContain("--foreground:rgb(1 2 3)");
});
