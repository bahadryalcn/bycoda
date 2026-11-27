// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialWaitingItem } from "../model/socialWaiting";

const mocks = vi.hoisted(() => ({
  lead: vi.fn(async () => true),
  read: vi.fn(),
  machine: vi.fn<() => Promise<{ id: string } | undefined>>(async () => ({ id: "m1" })),
  notify: vi.fn(async () => true),
}));
vi.mock("./useBackgroundNotifications", () => ({ isLeadWindow: mocks.lead }));
vi.mock("../model/socialWaitingFeed", () => ({
  socialMachine: mocks.machine,
  readSocialWaiting: mocks.read,
}));
vi.mock("../model/notifications", () => ({ notifySocialWaiting: mocks.notify }));
import {
  loadAnnouncedSocial,
  setSocialWaitingCount,
  socialWaitingCount,
} from "../model/socialWaiting";
import { useSocialNotifications } from "./useSocialNotifications";

const waiting = (id: string): SocialWaitingItem => ({
  id,
  kind: "accountRequest",
  platform: "x",
  paths: [],
  at: 1,
});
let root: Root | undefined;
function Watcher() {
  useSocialNotifications();
  return null;
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.lead.mockResolvedValue(true);
  mocks.machine.mockResolvedValue({ id: "m1" });
  setSocialWaitingCount(0);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("announces an item once across polls and remounts, and counts what waits", async () => {
  mocks.read.mockResolvedValue([waiting("request:1")]);
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Watcher)));
  await act(async () => vi.advanceTimersByTimeAsync(130_000));
  expect(mocks.notify).toHaveBeenCalledOnce();
  expect(socialWaitingCount()).toBe(1);
  expect(loadAnnouncedSocial().has("request:1")).toBe(true);
  // A remount reads the persisted ids instead of announcing again.
  await act(async () => root!.unmount());
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Watcher)));
  expect(mocks.notify).toHaveBeenCalledOnce();
  // A new item is announced alone.
  mocks.read.mockResolvedValue([waiting("request:1"), waiting("human:2")]);
  await act(async () => vi.advanceTimersByTimeAsync(61_000));
  expect(mocks.notify).toHaveBeenCalledTimes(2);
  expect((mocks.notify.mock.calls[1] as unknown[][])[0]).toEqual([waiting("human:2")]);
});

it("does not announce from a window that is not the workspace lead or when the Host is unreadable", async () => {
  mocks.lead.mockResolvedValue(false);
  mocks.read.mockResolvedValue([waiting("request:1")]);
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Watcher)));
  expect(mocks.read).not.toHaveBeenCalled();
  mocks.lead.mockResolvedValue(true);
  mocks.read.mockResolvedValue(undefined);
  await act(async () => vi.advanceTimersByTimeAsync(61_000));
  expect(mocks.notify).not.toHaveBeenCalled();
  expect(loadAnnouncedSocial().size).toBe(0);
});

it("clears the retained count when the Social Host is unpaired", async () => {
  mocks.read.mockResolvedValue([waiting("request:1")]);
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Watcher)));
  expect(socialWaitingCount()).toBe(1);
  mocks.machine.mockResolvedValue(undefined);
  await act(async () => vi.advanceTimersByTimeAsync(61_000));
  expect(socialWaitingCount()).toBe(0);
});

it("keeps the count through a brief outage, then drops it once the Host stays unreadable", async () => {
  mocks.read.mockResolvedValue([waiting("request:1")]);
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Watcher)));
  expect(socialWaitingCount()).toBe(1);
  mocks.read.mockResolvedValue(undefined);
  await act(async () => vi.advanceTimersByTimeAsync(61_000));
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(socialWaitingCount()).toBe(1);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(socialWaitingCount()).toBe(0);
  // A successful read restores the count and resets the failure streak.
  mocks.read.mockResolvedValue([waiting("request:1")]);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(socialWaitingCount()).toBe(1);
  mocks.read.mockRejectedValue(new Error("offline"));
  await act(async () => vi.advanceTimersByTimeAsync(120_000));
  expect(socialWaitingCount()).toBe(1);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(socialWaitingCount()).toBe(0);
});
