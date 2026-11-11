// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { rememberRemotePendingWorktree, rememberRemoteSession } from "./connections";
import { useRemoteSessionBindings, type RemoteSessionBindings } from "./useRemoteSessionBinding";

afterEach(() => localStorage.clear());

it("updates through each writer and keeps its identity while nothing changed", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const seen: RemoteSessionBindings[] = [];
  function Probe() {
    seen.push(useRemoteSessionBindings());
    return null;
  }
  const render = () => act(() => root.render(createElement(Probe)));
  const latest = () => seen[seen.length - 1];
  render();
  const first = latest();
  expect(first.sessionFor("a")).toBeUndefined();
  render();
  expect(latest()).toBe(first);

  act(() => rememberRemoteSession("a", "host-1"));
  expect(latest().sessionFor("a")).toBe("host-1");
  expect(latest()).not.toBe(first);

  act(() => rememberRemotePendingWorktree("a", "/wt"));
  expect(latest().pendingWorktree("a")).toBe("/wt");
  expect(latest().sessionFor("a")).toBe("host-1");

  const settled = latest();
  render();
  expect(latest()).toBe(settled);

  act(() => rememberRemotePendingWorktree("a"));
  expect(latest().pendingWorktree("a")).toBeUndefined();
  act(() => root.unmount());
});
