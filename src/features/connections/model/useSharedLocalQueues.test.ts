// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import { mergeQueueChange, type SharedQueue } from "./sharedQueue";
import {
  sharedLocalQueueReady,
  submitSharedLocalQueue,
  useSharedLocalQueues,
} from "./useSharedLocalQueues";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => [
    { id: "local", environmentId: "host", localHost: true, endpoint: "http://127.0.0.1:1" },
  ],
}));
vi.mock("./connections", () => ({
  cachedRemoteCapabilities: () => ["sessions.queue"],
  loadRemoteCapabilities: async () => ["sessions.queue"],
  remoteRequest: (...args: unknown[]) => mocks.request(...args),
}));
vi.mock("./remoteAttachments", () => ({
  uploadRemoteAttachments: async (_machine: string, attachments: unknown[]) => attachments,
}));

let root: Root;
let queue: SharedQueue;
let sessionsRef: { current: Session[] };
const reachable = { current: true };
const row = (id: string, text = id) => ({ id, text, attachments: [] });
const setSessions = (update: (sessions: Session[]) => Session[]) => {
  sessionsRef.current = update(sessionsRef.current);
};
function Probe() {
  useSharedLocalQueues(sessionsRef, setSessions, reachable);
  return null;
}
beforeEach(() => {
  mocks.request.mockReset();
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  queue = { messages: [], revision: 0 };
  sessionsRef = {
    current: [
      {
        id: "chat",
        cwd: "/repo",
        blocks: [{ id: "user", role: "user", text: "task" }],
        queuedMessages: [row("a")],
        queueStatus: "active",
      } as Session,
    ],
  };
  mocks.request.mockImplementation(async (_machine, method, params) => {
    if (method.endsWith(".change"))
      queue = {
        ...mergeQueueChange(queue, {
          before: params.before,
          after: params.after,
          consumer: params.takeOwnership ? params.clientId : undefined,
        }),
        revision: queue.revision + 1,
      };
    if (method.endsWith(".claim"))
      queue = {
        ...queue,
        revision: queue.revision + 1,
        claim: { id: params.id, clientId: params.clientId, token: "claimed" },
      };
    if (method.endsWith(".finish"))
      queue = {
        ...queue,
        revision: queue.revision + 1,
        messages: params.accepted
          ? queue.messages.filter((message) => message.id !== queue.claim?.id)
          : queue.messages,
        claim: undefined,
      };
    return structuredClone(queue);
  });
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    root.render(createElement(Probe));
  });
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}
async function tick() {
  await act(async () => {
    vi.advanceTimersByTime(1500);
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

it("publishes a local queue and applies edits from the other computer without replacing the transcript", async () => {
  const blocks = sessionsRef.current[0].blocks;
  await mount();
  expect(queue.messages).toEqual([row("a")]);
  expect(sharedLocalQueueReady("chat")).toBe(true);
  queue = {
    ...queue,
    messages: [row("a", "edited remotely"), row("b")],
    revision: queue.revision + 1,
  };
  await tick();
  expect(sessionsRef.current[0].queuedMessages?.map((message) => message.text)).toEqual([
    "edited remotely",
    "b",
  ]);
  expect(sessionsRef.current[0].blocks).toBe(blocks);
});

it("preserves a new local row created while the host poll is pending", async () => {
  await mount();
  const original = mocks.request.getMockImplementation()!;
  let resolve!: (value: SharedQueue) => void;
  mocks.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const polling = tick();
  await act(async () => {
    await Promise.resolve();
  });
  sessionsRef.current = [{ ...sessionsRef.current[0], queuedMessages: [row("a"), row("new")] }];
  await act(async () => resolve(structuredClone(queue)));
  await polling;
  mocks.request.mockImplementation(original);
  await tick();
  expect(queue.messages.map((message) => message.id)).toEqual(["a", "new"]);
  expect(sessionsRef.current[0].queuedMessages?.map((message) => message.id)).toEqual(["a", "new"]);
});

it("reserves a local queued send until acceptance and prevents a second sender", async () => {
  await mount();
  let accept!: (value: boolean) => void;
  const send = vi.fn(
    () =>
      new Promise<boolean>((done) => {
        accept = done;
      }),
  );
  const first = submitSharedLocalQueue("chat", "a", false, send);
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
  expect(send).toHaveBeenCalledOnce();
  expect(await submitSharedLocalQueue("chat", "a", false, send)).toBe(false);
  expect(sharedLocalQueueReady("chat")).toBe(false);
  accept(true);
  expect(await first).toBe(true);
  expect(queue.messages).toEqual([]);
});

it("holds the queue when Stop invalidates preparation instead of launching another turn", async () => {
  await mount();
  const send = vi.fn(() => true);
  sessionsRef.current = [{ ...sessionsRef.current[0], queueStatus: "paused" }];
  expect(await submitSharedLocalQueue("chat", "a", true, send, () => false)).toBe(false);
  expect(send).not.toHaveBeenCalled();
  await tick();
  expect(queue.messages).toEqual([row("a")]);
  expect(queue.status).toBe("paused");
});
