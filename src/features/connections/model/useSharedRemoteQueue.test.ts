// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mergeQueueChange, type SharedQueue } from "./sharedQueue";
import { useSharedRemoteQueue } from "./useSharedRemoteQueue";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./connections", () => ({
  cachedRemoteCapabilities: () => ["sessions.queue"],
  remoteRequest: (...args: unknown[]) => mocks.request(...args),
}));
vi.mock("../../sessions/data/sessionStore", () => ({
  loadStoredQueue: async () => [],
  setSessionQueue: async () => {},
}));
let root: Root;
let current: ReturnType<typeof useSharedRemoteQueue>;
let saved: SharedQueue;
function Probe() {
  current = useSharedRemoteQueue("chat", "machine", "host", true);
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  saved = { messages: [{ id: "a", text: "task", attachments: [] }], status: "paused", revision: 1 };
  mocks.request.mockReset().mockImplementation(async (_machine, method, params) => {
    if (method.endsWith(".change"))
      saved = {
        ...mergeQueueChange(saved, {
          before: params.before,
          after: params.after,
          consumer: params.takeOwnership ? params.clientId : undefined,
        }),
        revision: saved.revision + 1,
      };
    return structuredClone(saved);
  });
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("waits for durable ownership before confirming Resume", async () => {
  await act(async () => {
    expect(await current.release()).toBe(true);
  });
  expect(saved.status).toBe("active");
  expect(current.canDrain).toBe(true);
  expect(saved.messages).toHaveLength(1);
});

it("retries a synchronization error and prepares the selected row on the same action", async () => {
  mocks.request.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    await expect(current.release()).rejects.toThrow("offline");
  });
  await act(async () => {
    expect(await current.prepareSend(true)).toBe(true);
  });
  expect(current.error).toBeUndefined();
  expect(saved.messages).toHaveLength(1);
});

it("does not release the queue when Stop happens during synchronization", async () => {
  let valid = true;
  const request = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementationOnce(async (...args) => {
    valid = false;
    return request(...args);
  });
  await act(async () => {
    await expect(current.release(() => valid)).rejects.toThrow("cancelled");
  });
  expect(saved.status).toBe("paused");
  expect(saved.messages).toHaveLength(1);
});

it("restores a pause when Stop arrives after ownership was written", async () => {
  let valid = true;
  const request = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (...args) => {
    const result = await request(...args);
    if (saved.status === "active") valid = false;
    return result;
  });
  await act(async () => {
    await expect(current.release(() => valid)).rejects.toThrow("cancelled");
  });
  expect(saved.status).toBe("paused");
  expect(saved.messages).toHaveLength(1);
});
