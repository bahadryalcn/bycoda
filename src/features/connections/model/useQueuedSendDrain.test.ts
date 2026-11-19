// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QueuedMessage } from "../../sessions";
import type { HarnessId } from "../../../shared/model/harnessIdentity";
import {
  queuedDrainRetryDelay,
  useQueuedSendDrain,
  type QueuedConfigurationChange,
} from "./useQueuedSendDrain";

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
const queued = (harness: HarnessId, model: string): QueuedMessage => ({
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

/** Renders the drain for a settled head whose `submit` answers from `answers`, in order. */
function drainRefused(answers: boolean[]) {
  const head = queued("codex", "gpt");
  const providers = ["codex", "claude"] as const;
  const capabilities = ["sessions.harnessSwitch"];
  const submit = vi.fn(() => answers.shift() ?? false);
  const sent = vi.fn();
  let retryDrain = () => {};
  function Probe() {
    retryDrain = useQueuedSendDrain({
      next: head,
      pageCacheOnly: false,
      remoteDeleted: false,
      authorityGeneration: undefined,
      saved: { ...saved, settings: {} },
      ownerBound: true,
      providers,
      capabilities,
      queue: { pause: vi.fn(), current: () => ({ messages: [head] }), sent },
      leaseWait: { current: 0 },
      submit,
      requestChange: vi.fn(),
      reportError: vi.fn(),
    }).retryDrain;
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return { head, submit, sent, retryDrain: () => act(() => retryDrain()) };
}
/** Moves fake time in 10 ms steps, flushing React between them so each retry re-arms the next. */
const advance = (ms: number) => {
  for (let left = ms; left > 0; left -= 10) {
    act(() => void vi.advanceTimersByTime(Math.min(10, left)));
    act(() => void vi.advanceTimersByTime(0));
  }
  if (ms === 0) act(() => void vi.advanceTimersByTime(0));
};

it("paces a refused head with a 250 ms to 5 s backoff", () => {
  expect([0, 1, 2, 3, 4, 5, 50].map(queuedDrainRetryDelay)).toEqual([
    250, 500, 1_000, 2_000, 4_000, 5_000, 5_000,
  ]);
});

it("does not spin when submit keeps refusing the head", () => {
  vi.useFakeTimers();
  try {
    const { submit, sent } = drainRefused([]);
    advance(0);
    expect(submit).toHaveBeenCalledTimes(1);
    advance(240);
    expect(submit).toHaveBeenCalledTimes(1);
    advance(10);
    expect(submit).toHaveBeenCalledTimes(2);
    // Attempts land at 0, 250, 750, 1750, 3750 and 7750 ms: six in eight seconds, not thousands.
    advance(8_000 - 250);
    expect(submit).toHaveBeenCalledTimes(6);
    advance(5_000);
    expect(submit).toHaveBeenCalledTimes(7);
    expect(sent).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("sends the same head once, with its id, when the refusal clears", () => {
  vi.useFakeTimers();
  try {
    const { head, submit, sent } = drainRefused([false, false, true]);
    advance(0);
    advance(250);
    advance(500);
    expect(submit).toHaveBeenCalledTimes(3);
    expect(submit).toHaveBeenLastCalledWith(
      head.text,
      head.attachments,
      { intent: undefined },
      false,
      undefined,
      head.id,
    );
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith(head.id);
    advance(20_000);
    expect(submit).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

it("retries at the fast pace again after the owner asks for a fresh look", () => {
  vi.useFakeTimers();
  try {
    const { submit, retryDrain } = drainRefused([]);
    advance(0);
    advance(250);
    advance(500);
    advance(1_000);
    expect(submit).toHaveBeenCalledTimes(4);
    retryDrain();
    advance(0);
    expect(submit).toHaveBeenCalledTimes(5);
    advance(250);
    expect(submit).toHaveBeenCalledTimes(6);
  } finally {
    vi.useRealTimers();
  }
});

it("takes the row's own account when the row switches provider", () => {
  expect(drain(queued("claude", "opus"), saved)).toMatchObject({
    harness: "claude",
    providerAccountId: "personal",
  });
});
