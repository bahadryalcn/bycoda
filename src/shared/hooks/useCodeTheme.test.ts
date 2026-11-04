// @vitest-environment happy-dom
import { act, createElement, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { APPEARANCE_PREFERENCES_EVENT } from "../../features/settings/model/appearancePreferences";
import { useCodeTheme } from "./useCodeTheme";

const KEY = "bycoda.appearancePreferences.v1";
let host: HTMLDivElement;
let root: Root;
let rerender: () => void = () => {};
let themes: string[] = [];

function Probe() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  rerender = bump;
  const theme = useCodeTheme();
  themes.push(theme);
  return createElement("output", null, theme);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  themes = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("reads the preference record once and reuses it across renders until a change event", async () => {
  localStorage.setItem(KEY, JSON.stringify({ codeTheme: "dracula" }));
  const parse = vi.spyOn(JSON, "parse");
  await act(async () => root.render(createElement(Probe)));
  expect(host.textContent).toBe("dracula");
  const parsesAfterMount = parse.mock.calls.length;
  expect(parsesAfterMount).toBeGreaterThan(0);

  for (let index = 0; index < 20; index++) await act(async () => rerender());
  expect(host.textContent).toBe("dracula");
  expect(parse.mock.calls.length).toBe(parsesAfterMount);

  localStorage.setItem(KEY, JSON.stringify({ codeTheme: "github" }));
  await act(async () => rerender());
  expect(host.textContent).toBe("dracula"); // a raw storage write without an event is not a change

  await act(async () => window.dispatchEvent(new Event(APPEARANCE_PREFERENCES_EVENT)));
  expect(host.textContent).toBe("github");
  expect(parse.mock.calls.length).toBe(parsesAfterMount + 1);
});

it("refreshes on another window's storage event for the appearance key only", async () => {
  await act(async () => root.render(createElement(Probe)));
  expect(host.textContent).toBe("github");
  localStorage.setItem(KEY, JSON.stringify({ codeTheme: "dracula" }));
  await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" })));
  expect(host.textContent).toBe("github");
  await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: KEY })));
  expect(host.textContent).toBe("dracula");
});

it("keeps one window listener pair for all subscribers and removes it with the last one", async () => {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const listenerCalls = (spy: typeof add) =>
    spy.mock.calls.filter(([type]) => type === APPEARANCE_PREFERENCES_EVENT || type === "storage");
  await act(async () =>
    root.render(createElement("div", null, createElement(Probe), createElement(Probe), createElement(Probe))),
  );
  expect(listenerCalls(add)).toHaveLength(2);
  await act(async () => root.render(createElement("div")));
  expect(listenerCalls(remove)).toHaveLength(2);
});
