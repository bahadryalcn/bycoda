// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  isTextOnlyChange,
  resetSessionsStore,
  setSessions,
  useSessionsSelector,
} from "../../features/sessions/model/sessionsStore";
import type { Session } from "../../features/sessions/model/session";

it("does not loop when an inline selector returns a fresh object for an unchanged store", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetSessionsStore([]);
  let renders = 0;
  function Probe() {
    const value = useSessionsSelector((sessions) => ({ count: sessions.length }));
    renders++;
    return String(value.count);
  }
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(host.textContent).toBe("0");
    expect(renders).toBe(1);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("skips streamed text, adopts later metadata and batches with ordinary React state", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const initial = {
    id: "one",
    title: "First",
    cwd: "/p",
    blocks: [{ id: "a", role: "assistant", text: "a", streaming: true }],
  } as Session;
  resetSessionsStore([initial]);
  const seen: Array<[string, number]> = [];
  let changeTab!: (tab: number) => void;
  function Probe() {
    const sessions = useSessionsSelector((items) => items, isTextOnlyChange);
    const [tab, setTab] = useState(0);
    changeTab = setTab;
    seen.push([sessions[0].blocks[0].text!, tab]);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Probe)));
    seen.length = 0;
    await act(async () =>
      setSessions((items) => [
        { ...items[0], blocks: [{ ...items[0].blocks[0], text: "ab" }] } as Session,
      ]),
    );
    expect(seen).toEqual([]);
    await act(async () => {
      setSessions((items) => [{ ...items[0], title: "Finished" }]);
      changeTab(1);
    });
    expect(seen).toEqual([["ab", 1]]);
  } finally {
    await act(async () => root.unmount());
    resetSessionsStore([]);
    vi.unstubAllGlobals();
  }
});
