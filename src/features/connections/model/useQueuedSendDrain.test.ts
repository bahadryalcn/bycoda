// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QueuedMessage } from "../../sessions";
import { useQueuedSendDrain, type QueuedConfigurationChange } from "./useQueuedSendDrain";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

/** Renders the drain for one queued head and returns the configuration it asked for, if any. */
function drain(next: QueuedMessage, saved: QueuedConfigurationChange) {
  const requestChange = vi.fn();
  function Probe() {
    useQueuedSendDrain({
      next,
      pageCacheOnly: false,
      remoteDeleted: false,
      authorityGeneration: undefined,
      saved,
      ownerBound: true,
      providers: ["codex", "claude"],
      capabilities: ["sessions.harnessSwitch"],
      queue: { pause: vi.fn(), current: () => ({ messages: [next] }), sent: vi.fn() },
      leaseWait: { current: 0 },
      submit: () => true,
      requestChange,
      reportError: vi.fn(),
    });
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return requestChange.mock.calls[0]?.[0] as QueuedConfigurationChange | undefined;
}

const saved: QueuedConfigurationChange = {
  harness: "codex",
  model: "gpt",
  settings: {},
  mode: "supervised",
  providerAccountId: "work",
};
const queued = (harness: string, model: string): QueuedMessage => ({
  id: `row-${harness}-${model}`,
  text: "Next",
  attachments: [],
  modelTarget: { harness, model, modelSettings: {}, providerAccountId: "personal" },
});

it("sends a same-provider row on the account the owner switched to after queueing it", () => {
  expect(drain(queued("codex", "gpt"), saved)).toBeUndefined();
  const model = drain(queued("codex", "gpt-mini"), saved);
  expect(model).toMatchObject({ harness: "codex", model: "gpt-mini" });
  expect(model).not.toHaveProperty("providerAccountId");
});

it("takes the row's own account when the row switches provider", () => {
  expect(drain(queued("claude", "opus"), saved)).toMatchObject({
    harness: "claude",
    providerAccountId: "personal",
  });
});
