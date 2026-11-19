// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDraftPresenceReporter } from "./useDraftPresenceReporter";

const env = vi.hoisted(() => ({
  invoke: vi.fn(),
  remoteRequest: vi.fn(),
  hasUnsentComposerDraft: vi.fn(),
  draftListener: undefined as undefined | ((id: string) => void),
  drafts: new Set<string>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: env.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: env.remoteRequest }));
vi.mock("../../connections/public/useReloadOnReconnect", () => ({
  useReloadOnMachineReconnect: vi.fn(),
}));
vi.mock("../data/composerDraftStore", () => ({
  composerDraftsLoaded: () => true,
  flushComposerDrafts: vi.fn(async () => {}),
  subscribeComposerDraftLoadState: vi.fn(() => () => {}),
}));
vi.mock("../model/draftCache", () => ({
  hasUnsentComposerDraft: env.hasUnsentComposerDraft,
  subscribeComposerDrafts: vi.fn((listener: (id: string) => void) => {
    env.draftListener = listener;
    return () => {};
  }),
}));

const hidden = { value: false };
let hiddenSpy: { mockRestore(): void };
function Probe() {
  useDraftPresenceReporter();
  return null;
}
const reports = () =>
  env.remoteRequest.mock.calls.map((call) => (call[2] as { sessionIds: string[] }).sessionIds);
let root: Root;
let container: HTMLElement;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.clearAllMocks();
  hidden.value = false;
  env.drafts.clear();
  env.draftListener = undefined;
  env.invoke.mockImplementation(async (command: string) => {
    if (command === "session_list_drafts") return [];
    if (command === "local_host_connect") return { id: "host", environmentId: "env" };
    return undefined;
  });
  env.remoteRequest.mockReset().mockResolvedValue({});
  env.hasUnsentComposerDraft.mockImplementation((id: string) => env.drafts.has(id));
  hiddenSpy = vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden.value);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe));
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(reports()).toEqual([[]]);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  hiddenSpy.mockRestore();
  vi.useRealTimers();
});

const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

it("does not evaluate drafts every second; the heartbeat is 30 s", async () => {
  act(() => env.draftListener?.("s1"));
  await advance(400);
  env.hasUnsentComposerDraft.mockClear();
  await advance(29_000);
  expect(env.hasUnsentComposerDraft).not.toHaveBeenCalled();
});

it("skips heartbeat ticks while hidden once the snapshot is confirmed", async () => {
  env.drafts.add("s1");
  act(() => env.draftListener?.("s1"));
  await advance(1000);
  expect(reports()).toEqual([[], ["s1"]]);
  hidden.value = true;
  env.hasUnsentComposerDraft.mockClear();
  await advance(90_000);
  expect(env.hasUnsentComposerDraft).not.toHaveBeenCalled();
  expect(reports()).toEqual([[], ["s1"]]);
});

it("reports a draft edit made while hidden", async () => {
  hidden.value = true;
  env.drafts.add("s2");
  act(() => env.draftListener?.("s2"));
  await advance(1000);
  expect(reports()).toEqual([[], ["s2"]]);
});

it("recovers the snapshot when the window becomes visible again", async () => {
  env.drafts.add("s1");
  act(() => env.draftListener?.("s1"));
  await advance(1000);
  hidden.value = true;
  await advance(90_000);
  expect(reports()).toEqual([[], ["s1"]]);
  hidden.value = false;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await advance(1000);
  expect(reports()).toEqual([[], ["s1"], ["s1"]]);
});

it("retries an unconfirmed report on a tick even while hidden", async () => {
  hidden.value = true;
  env.drafts.add("s3");
  env.remoteRequest.mockRejectedValueOnce(new Error("offline"));
  act(() => env.draftListener?.("s3"));
  await advance(1000);
  expect(reports()).toEqual([[], ["s3"]]);
  await advance(30_000);
  expect(reports()).toEqual([[], ["s3"], ["s3"]]);
});

it("reruns a draft change that arrives while a report is in flight", async () => {
  let release: () => void = () => {};
  env.remoteRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({});
      }),
  );
  env.drafts.add("s4");
  act(() => env.draftListener?.("s4"));
  await advance(1000);
  env.drafts.add("s5");
  act(() => env.draftListener?.("s5"));
  await advance(1000);
  expect(reports()).toEqual([[], ["s4"]]);
  await act(async () => release());
  await advance(1000);
  expect(reports()).toEqual([[], ["s4"], ["s4", "s5"]]);
});
