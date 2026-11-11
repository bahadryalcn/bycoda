// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  beginSessionPerformanceTrace,
  clearPerformanceTrace,
  configurePerformanceTracing,
  endSessionPerformanceTrace,
  sessionPerformanceTrace,
  useSessionPerformanceTrace,
} from "./performanceTrace";

it("follows each writer of the session trace", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  configurePerformanceTracing({ enabled: true });
  const root = createRoot(document.createElement("div"));
  const seen: (string | undefined)[] = [];
  function Probe() {
    seen.push(useSessionPerformanceTrace("s"));
    return null;
  }
  act(() => root.render(createElement(Probe)));
  expect(seen[seen.length - 1]).toBeUndefined();
  let id: string | undefined;
  act(() => {
    id = beginSessionPerformanceTrace("s");
  });
  expect(seen[seen.length - 1]).toBe(id);
  expect(seen[seen.length - 1]).toBe(sessionPerformanceTrace("s"));
  act(() => endSessionPerformanceTrace("s"));
  expect(seen[seen.length - 1]).toBeUndefined();
  act(() => {
    beginSessionPerformanceTrace("s");
  });
  act(() => clearPerformanceTrace());
  expect(seen[seen.length - 1]).toBeUndefined();
  act(() => {
    beginSessionPerformanceTrace("s");
  });
  act(() => configurePerformanceTracing({ enabled: false }));
  expect(seen[seen.length - 1]).toBeUndefined();
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
