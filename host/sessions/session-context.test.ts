import { afterEach, expect, it } from "vitest";
import { parseCommand } from "../engine";
import { cleanups, setup } from "../engine-support/engine.test-support";

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it("keeps explicit conversation context out of the user message while delivering it to the provider", async () => {
  const { engine, store, id, turns, waitForTurnStart } = await setup();
  const receipt = await engine.command({
    type: "send",
    commandId: "social-context",
    sessionId: id,
    text: "Plan the week",
    contextReplay: "Use existing bycoda-social tools. Scope: selected Host and project.",
  });
  await waitForTurnStart();
  expect(turns[0].input.text).toContain("bycoda-social");
  expect(turns[0].input.text).toContain("Plan the week");
  expect(
    (await store.session(id)).session.blocks.find((block) => block.role === "user")?.text,
  ).toBe("Plan the week");
  turns[0].input.onEvent({ type: "turn.started" });
  turns[0].finish();
  await engine.waitForRun(id, receipt.runId);
  expect((await store.session(id)).session.pendingContextReplay).toBeUndefined();
});

it("validates replay at the command boundary", () => {
  const input = { type: "send", commandId: "context-bounds", sessionId: "session", text: "Hello" };
  expect(parseCommand({ ...input, contextReplay: "Social context" })).toMatchObject({
    contextReplay: "Social context",
  });
  expect(() => parseCommand({ ...input, contextReplay: "x".repeat(24_001) })).toThrow();
  expect(() => parseCommand({ ...input, contextReplay: { text: "not a string" } })).toThrow();
});
