// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type QueuedMessage, type Session } from "../model/session";
import { resetSessionsStore, setSessions } from "../model/sessionsStore";
import { useQueuePersistence } from "./useQueuePersistence";

const write = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../data/sessionStore", () => ({ setSessionQueue: write }));

const queue: QueuedMessage[] = [{ id: "q", text: "Next", attachments: [] }];
let root: ReturnType<typeof createRoot>;
let session: Session;
function Harness() {
  useQueuePersistence();
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  write.mockReset().mockResolvedValue(undefined);
  session = { ...newSession("claude", "/project"), id: "local", queuedMessages: queue };
  resetSessionsStore([session]);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  resetSessionsStore([]);
  vi.unstubAllGlobals();
});

it("persists initially and on store changes without a component rerender, then unsubscribes", async () => {
  await act(async () => root.render(createElement(StrictMode, null, createElement(Harness))));
  expect(write).toHaveBeenCalledExactlyOnceWith("local", queue);
  const cleared: QueuedMessage[] = [];
  await act(async () => setSessions([{ ...session, queuedMessages: cleared }]));
  expect(write).toHaveBeenLastCalledWith("local", cleared);
  const count = write.mock.calls.length;
  await act(async () => root.unmount());
  setSessions([session]);
  expect(write).toHaveBeenCalledTimes(count);
});

it("prunes removed sessions and persists their queue when reopened", async () => {
  await act(async () => root.render(createElement(Harness)));
  await act(async () => setSessions([]));
  await act(async () => setSessions([session]));
  expect(write).toHaveBeenCalledTimes(2);
});

it("does not let failure of an older write invalidate a newer successful queue", async () => {
  let reject!: (error: Error) => void;
  write.mockImplementationOnce(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  await act(async () => root.render(createElement(Harness)));
  const next = [{ ...queue[0], text: "Updated" }];
  await act(async () => setSessions([{ ...session, queuedMessages: next }]));
  await act(async () => reject(new Error("Old request failed")));
  await act(async () => setSessions([{ ...session, queuedMessages: next, title: "Renamed" }]));
  expect(write).toHaveBeenCalledTimes(2);
});

it("marks the queue before writing so a reentrant store update does not duplicate it", async () => {
  write.mockImplementationOnce(async () =>
    setSessions([{ ...session, title: "Updated during write" }]),
  );
  await act(async () => root.render(createElement(Harness)));
  expect(write).toHaveBeenCalledTimes(1);
});
