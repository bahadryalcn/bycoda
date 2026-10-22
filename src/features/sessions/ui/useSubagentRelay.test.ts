// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Block, ComposerTurnOptions } from "../model/session";
import { useSubagentRelay } from "./useSubagentRelay";
import { subagentRelayPrompt } from "../model/subagentRelay";

const agent: Block = {
  id: "agent-1",
  role: "tool",
  text: "Review",
  tool: { callId: "spawn-1", kind: "agent", status: "in_progress" },
  agentRun: { name: "Reviewer", prompt: "Inspect changes", steps: [] },
};
const container = document.createElement("div");
let root = createRoot(container);
let relay: ReturnType<typeof useSubagentRelay>;
function Harness(props: Parameters<typeof useSubagentRelay>[0]) {
  const current = useSubagentRelay(props);
  useLayoutEffect(() => {
    relay = current;
  });
  return null;
}
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(container);
  vi.unstubAllGlobals();
});
function render(onSubmit = vi.fn(), block = agent, blocked = false, sessionId = "parent") {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  act(() => root.render(createElement(Harness, { sessionId, block, blocked, onSubmit })));
  return onSubmit;
}

it("targets an existing run without promising delivery or replacing an agent", () => {
  const prompt = subagentRelayPrompt(agent, "  What did you find?  ")!;
  expect(prompt).toContain('"callId":"spawn-1"');
  expect(prompt).toContain('"task":"Inspect changes"');
  expect(prompt).toContain("Do not create a replacement agent");
  expect(prompt).toMatch(/User message:\n\nWhat did you find\?$/);
  expect(subagentRelayPrompt(agent, "  ")).toBeNull();
  expect(subagentRelayPrompt({ ...agent, tool: { kind: "execute" } }, "hello")).toBeNull();
});

it("submits once through normal acceptance and clears only accepted drafts", () => {
  const submit = render();
  act(() => relay.setDraft("Progress?"));
  act(() => {
    relay.send();
    relay.send();
  });
  expect(submit).toHaveBeenCalledOnce();
  expect(relay.draft).toBe("");
  expect(relay.status).toBe("accepted");
});

it("preserves independent drafts across agent switches, closing and sessions", () => {
  const submit = render();
  act(() => relay.setDraft("First"));
  render(submit, { ...agent, id: "other" });
  act(() => relay.setDraft("Second"));
  render(submit);
  expect(relay.draft).toBe("First");
  render(submit, agent, false, "another-session");
  expect(relay.draft).toBe("");
  render(submit);
  expect(relay.draft).toBe("First");
});

it.each([false, "throw"])("keeps a rejected message for retry (%s)", (result) => {
  render(
    vi.fn(() => {
      if (result === "throw") throw new Error("offline");
      return false;
    }),
  );
  act(() => relay.setDraft("Hello"));
  act(() => relay.send());
  expect(relay.draft).toBe("Hello");
  expect(relay.status).toBe("rejected");
});

it("restores late rejections to the original agent without overwriting newer text", () => {
  let options: ComposerTurnOptions;
  const submit = render(
    vi.fn((_text, opts) => {
      options = opts;
      return true;
    }),
  );
  act(() => relay.setDraft("First message"));
  act(() => relay.send());
  act(() => relay.setDraft("New draft"));
  render(submit, { ...agent, id: "other" });
  act(() => options.onSendRejected?.());
  expect(relay.draft).toBe("");
  render(submit);
  expect(relay.draft).toBe("New draft\n\nFirst message");
  expect(relay.status).toBe("rejected");
});

it("does not submit blocked or non-agent requests", () => {
  const submit = render(vi.fn(), agent, true);
  act(() => relay.setDraft("Hello"));
  act(() => relay.send());
  expect(submit).not.toHaveBeenCalled();
  render(submit, { ...agent, tool: { kind: "execute" } });
  act(() => relay.send());
  expect(submit).not.toHaveBeenCalled();
});
