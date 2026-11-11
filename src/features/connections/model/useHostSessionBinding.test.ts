// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => vi.unstubAllGlobals());

const binding = {
  kind: "local-host" as const,
  machineId: "m",
  environmentId: "e",
  projectId: "p",
  sessionId: "s",
  authorityGeneration: null,
  created: false,
};

it("re-renders when an owner is saved and keeps its identity while nothing changed", async () => {
  const model = await import("./sessionExecutionBinding");
  const hooks = await import("./useHostSessionBinding");
  const shell = { id: "shell-1" } as never;
  const root = createRoot(document.createElement("div"));
  const seen: unknown[] = [];
  const readers: unknown[] = [];
  function Probe() {
    seen.push(hooks.useHostSessionBinding(shell));
    readers.push(hooks.useHostSessionBindingReader());
    return null;
  }
  const render = () => act(() => root.render(createElement(Probe)));
  render();
  expect(seen[seen.length - 1]).toBeUndefined();
  const reader = readers[readers.length - 1];
  render();
  expect(readers[readers.length - 1]).toBe(reader);

  act(() => {
    model.saveHostSessionBinding(shell, binding);
  });
  expect(seen[seen.length - 1]).toEqual(binding);
  expect(readers[readers.length - 1]).not.toBe(reader);
  const saved = seen[seen.length - 1];
  render();
  expect(seen[seen.length - 1]).toBe(saved);
  expect(model.hostSessionBinding(shell)).toEqual(saved);
  act(() => root.unmount());
});
