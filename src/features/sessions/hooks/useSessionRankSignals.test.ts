// @vitest-environment happy-dom
import { act, createElement, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSessionRankSignals } from "./useSessionRankSignals";

const drafts = vi.hoisted(() => ({ ids: new Set<string>(), listeners: new Set<() => void>() }));
vi.mock("../model/draftCache", () => ({
  hasUnsentComposerDraft: (id: string) => drafts.ids.has(id),
  subscribeComposerDraftPresence: (listener: () => void) => {
    drafts.listeners.add(listener);
    return () => drafts.listeners.delete(listener);
  },
}));

let root: Root;
let sessions: { id: string }[];
let unseen: ReadonlySet<string>;
let activeId: string | null;
let result: ReturnType<typeof useSessionRankSignals>;
let projection: { rank: ReturnType<typeof useSessionRankSignals> };

function Probe() {
  const rank = useSessionRankSignals(sessions, unseen, activeId);
  projection = useMemo(() => ({ rank }), [rank]);
  result = projection.rank;
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  drafts.ids.clear();
  drafts.listeners.clear();
  sessions = [{ id: "first" }, { id: "second" }];
  unseen = new Set();
  activeId = null;
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("does not rebuild a dependent list projection on unrelated renders", async () => {
  await act(async () => root.render(createElement(Probe)));
  const previous = result;
  const before = projection;
  await act(async () => root.render(createElement(Probe)));
  expect(result).toBe(previous);
  expect(projection).toBe(before);
});

it("publishes draft and done changes while preserving the opened done rank", async () => {
  await act(async () => root.render(createElement(Probe)));
  const previous = result;
  await act(async () => {
    drafts.ids.add("first");
    for (const listener of drafts.listeners) listener();
  });
  expect(result).not.toBe(previous);
  expect([...result.draftIds]).toEqual(["first"]);
  unseen = new Set(["second"]);
  await act(async () => root.render(createElement(Probe)));
  activeId = "second";
  unseen = new Set();
  await act(async () => root.render(createElement(Probe)));
  expect([...result.doneIds]).toEqual(["second"]);
  activeId = null;
  await act(async () => root.render(createElement(Probe)));
  expect(result.doneIds.size).toBe(0);
});
