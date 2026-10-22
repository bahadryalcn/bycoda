// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecoveryBoundary } from "./RecoveryBoundary";
import { FailureState, isModuleLoadError } from "./FailureState";
import { lazySurface } from "./lazySurface";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((el) => el.textContent === label)!;

it("contains a render failure and remounts only the failed view on retry", async () => {
  let fail = true;
  function View() {
    if (fail) throw new Error("View exploded");
    return createElement("p", null, "Recovered view");
  }
  const onBack = vi.fn();
  await act(async () =>
    root.render(createElement(RecoveryBoundary, { onBack }, createElement(View))),
  );
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).not.toContain("View exploded");
  await act(async () => button("Show details").click());
  expect(container.querySelector("pre")?.textContent).toBe("View exploded");
  await act(async () => button("Back to workspace").click());
  expect(onBack).toHaveBeenCalledOnce();
  fail = false;
  await act(async () => button("Try again").click());
  expect(container.textContent).toBe("Recovered view");
});

it("contains a rejected optional import and offers reload instead of a cached lazy retry", async () => {
  const View = lazySurface(() =>
    Promise.reject(new Error("Failed to fetch dynamically imported module: /view.js")),
  );
  await act(async () => root.render(createElement(View)));
  expect(container.textContent).toContain("Reload app");
  expect(container.textContent).not.toContain("Try again");
});

it("keeps error details selectable and reports a denied clipboard write", async () => {
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
  await act(async () =>
    root.render(
      createElement(FailureState, {
        title: "Failed",
        description: "Retry",
        error: new Error("Diagnostic"),
        onRetry: vi.fn(),
      }),
    ),
  );
  await act(async () => button("Show details").click());
  await act(async () => button("Copy details").click());
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Could not copy");
  expect(container.querySelector("pre")?.tabIndex).toBe(0);
  vi.mocked(navigator.clipboard.writeText).mockResolvedValue();
  await act(async () => button("Copy details").click());
  expect(button("Copied")).toBeDefined();
});

it.each([
  "Failed to fetch dynamically imported module: /app.js",
  "Importing a module script failed.",
  "error loading dynamically imported module",
  "Loading chunk 42 failed.",
  "Outdated Optimize Dep",
])("recognizes module recovery for %s", (message) => {
  expect(isModuleLoadError(new Error(message))).toBe(true);
  expect(isModuleLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
});
