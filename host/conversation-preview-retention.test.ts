import { expect, it, vi } from "vitest";
import {
  ConversationPreviewWorkflow,
  PREVIEW_RECEIPT_TTL_MS,
  type PreviewBrowserState,
} from "./conversation-preview";

const scope = { projectId: "project", sessionId: "session", principalId: "token-hash" };
const url = "http://localhost:3000";

/** A browser that always verifies, over an injected monotonic clock. */
function fixture() {
  let now = 5_000;
  let state: PreviewBrowserState = {
    open: false,
    controlling: false,
    url: null,
    viewport: { width: 1280, height: 720 },
  };
  const browser = vi.fn(async (method: string, input: Record<string, unknown>) => {
    if (method === "browser.claim") state = { ...state, controlling: true, leaseId: "lease" };
    if (method === "browser.open") state = { ...state, open: true, url: String(input.url) };
    return method === "browser.frame"
      ? { ...state, data: "frame", mimeType: "image/jpeg", width: 1280, height: 720 }
      : { ...state };
  });
  return {
    workflow: new ConversationPreviewWorkflow(() => now),
    ports: {
      browser,
      present: vi.fn(async () => ({
        open: true,
        panels: [{ id: "panel", tab: "browser", machine: "project", mounted: true }],
      })),
      authorize: vi.fn(async () => {}),
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

it("replays a settled receipt inside the TTL and retires it afterwards", async () => {
  const { workflow, ports, advance } = fixture();
  const first = await workflow.run({ requestId: "r1", url }, scope, ports);
  expect(first.execution.state).toBe("succeeded");
  const calls = ports.browser.mock.calls.length;
  advance(PREVIEW_RECEIPT_TTL_MS - 1);
  const replay = await workflow.run({ requestId: "r1", url }, scope, ports);
  expect(replay.execution.state).toBe("succeeded");
  expect(replay.evidence.frame?.data).toBeUndefined();
  expect(ports.browser.mock.calls).toHaveLength(calls);
  await expect(
    workflow.run({ requestId: "r1", url, width: 390, height: 844 }, scope, ports),
  ).rejects.toThrow("different input");
  advance(1);
  // Past the TTL the receipt is gone: the same requestId with other input is a new request.
  const fresh = await workflow.run({ requestId: "r1", url, width: 390, height: 844 }, scope, ports);
  expect(fresh.execution.state).toBe("succeeded");
  expect(ports.browser.mock.calls.length).toBeGreaterThan(calls);
});

it("never evicts a pending receipt, even past the TTL", async () => {
  const { workflow, ports, advance } = fixture();
  let release!: () => void;
  const held = new Promise<void>((ready) => {
    release = ready;
  });
  ports.browser.mockImplementationOnce(async () => {
    await held;
    return { open: false, controlling: false };
  });
  const pending = workflow.run({ requestId: "slow", url }, scope, ports);
  await vi.waitFor(() => expect(ports.browser).toHaveBeenCalledTimes(1));
  advance(PREVIEW_RECEIPT_TTL_MS * 2);
  await expect(workflow.run({ requestId: "slow", url, show: false }, scope, ports)).rejects.toThrow(
    "different input",
  );
  release();
  const result = await pending;
  expect(result.execution.state).toBe("blocked");
  expect((await workflow.run({ requestId: "slow", url }, scope, ports)).execution.state).toBe(
    "blocked",
  );
  expect(ports.browser).toHaveBeenCalledTimes(1);
});

it("retires every receipt of one authority and leaves other authorities untouched", async () => {
  const { workflow, ports } = fixture();
  const other = { ...scope, principalId: "other-hash" };
  await workflow.run({ requestId: "r1", url }, scope, ports);
  await workflow.run({ requestId: "r1", url }, other, ports);
  const calls = ports.browser.mock.calls.length;
  workflow.retire(scope.principalId);
  await workflow.run({ requestId: "r1", url, show: false }, scope, ports);
  expect(ports.browser.mock.calls.length).toBeGreaterThan(calls);
  await expect(workflow.run({ requestId: "r1", url, show: false }, other, ports)).rejects.toThrow(
    "different input",
  );
});
