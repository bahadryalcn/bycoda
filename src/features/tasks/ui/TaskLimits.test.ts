// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LimitsPanel } from "./TaskLimits";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("announces a machine work-limit read failure assertively", async () => {
  await act(async () =>
    root.render(
      createElement(LimitsPanel, {
        limits: [],
        onChange: vi.fn(),
        errors: [{ machineId: "m1", machineName: "Studio", error: "Work limits unavailable" }],
      }),
    ),
  );
  const alert = container.querySelector('[role="alert"]');
  expect(alert).not.toBeNull();
  expect(alert?.textContent).toContain("Studio: Work limits unavailable");
  expect(container.querySelector('[role="status"][data-tone="danger"]')).toBeNull();
});
