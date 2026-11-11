// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UnreachableMachinesNotice } from "./UnreachableMachinesNotice";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(text));

it("shows the sentence and Retry in one row and keeps the raw reasons behind Details", async () => {
  const onRetry = vi.fn();
  await act(async () =>
    root.render(
      createElement(UnreachableMachinesNotice, {
        message: "Mini isn’t reachable right now.",
        detail: "Mini: ssh: connect to host 10.0.0.2 port 22: Connection timed out",
        onRetry,
      }),
    ),
  );
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Mini isn’t reachable right now.",
  );
  expect(container.textContent).not.toContain("Connection timed out");
  await act(async () => button("Retry")!.click());
  expect(onRetry).toHaveBeenCalledTimes(1);
  await act(async () => button("Details")!.click());
  expect(document.querySelector('[aria-label="Error details"]')?.textContent).toContain(
    "Connection timed out",
  );
});

it("offers no Details link without a reason and blocks Retry while disabled", async () => {
  const onRetry = vi.fn();
  await act(async () =>
    root.render(
      createElement(UnreachableMachinesNotice, {
        message: "Mini is away.",
        onRetry,
        disabled: true,
      }),
    ),
  );
  expect(button("Details")).toBeUndefined();
  await act(async () => button("Retry")!.click());
  expect(onRetry).not.toHaveBeenCalled();
});
