// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEditingLastTurn } from "./useEditingLastTurn";

let root: Root;
let host: HTMLDivElement;
let setEditing!: (editing: boolean) => void;
const seen: boolean[] = [];

function Probe({ sessionId, supported }: { sessionId: string; supported: boolean }) {
  const [editing, set] = useEditingLastTurn(sessionId, supported);
  // Record committed values only, after render.
  useLayoutEffect(() => {
    setEditing = set;
    seen.push(editing);
  });
  return createElement("div", { "data-editing": editing ? "yes" : "no" });
}

beforeEach(() => {
  seen.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const state = () => host.firstElementChild?.getAttribute("data-editing");
const render = (sessionId: string, supported: boolean) =>
  act(async () => root.render(createElement(Probe, { sessionId, supported })));

it("holds the edit marker until the session or the capability changes", async () => {
  await render("a", true);
  await act(async () => setEditing(true));
  expect(state()).toBe("yes");
  await render("a", true);
  expect(state()).toBe("yes");
  await render("b", true);
  expect(state()).toBe("no");
  await act(async () => setEditing(true));
  await render("b", false);
  expect(state()).toBe("no");
});

it("never commits a stale marker for the new session", async () => {
  await render("a", true);
  await act(async () => setEditing(true));
  seen.length = 0;
  await render("b", true);
  // The reset happens in the render that sees the new session, not after it.
  expect(seen.every((value) => value === false)).toBe(true);
});
