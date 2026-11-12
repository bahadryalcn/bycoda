// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FAILURE_PREVIEW_CHARS, FailureState } from "./FailureState";

let container: HTMLDivElement;
let root: Root;
let write: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: write },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((el) => el.textContent === label)!;
const render = (props: Partial<Parameters<typeof FailureState>[0]> = {}) =>
  act(async () =>
    root.render(
      createElement(FailureState, {
        title: "Failed",
        description: "Retry it",
        error: new Error("Short"),
        onRetry: vi.fn(),
        ...props,
      }),
    ),
  );

it("previews a long diagnostic, says so, and copies the complete text", async () => {
  const full = `HEAD${"x".repeat(FAILURE_PREVIEW_CHARS + 500)}TAIL`;
  await render({ error: new Error(full) });
  await act(async () => button("Show details").click());
  const pre = container.querySelector("pre")!;
  expect(pre.textContent).toHaveLength(FAILURE_PREVIEW_CHARS);
  expect(pre.textContent).not.toContain("TAIL");
  expect(container.querySelector("[data-preview-note]")?.textContent).toContain(
    `${FAILURE_PREVIEW_CHARS.toLocaleString("en-US")} of ${full.length.toLocaleString("en-US")}`,
  );
  await act(async () => button("Copy details").click());
  expect(write).toHaveBeenCalledWith(`Failed\n\n${full}`);
  expect(button("Copied")).toBeDefined();
});

it("shows no truncation note when the whole diagnostic fits", async () => {
  await render({ error: new Error("x".repeat(FAILURE_PREVIEW_CHARS)) });
  await act(async () => button("Show details").click());
  expect(container.querySelector("[data-preview-note]")).toBeNull();
  expect(container.querySelector("pre")?.textContent).toHaveLength(FAILURE_PREVIEW_CHARS);
});

it("reveals the complete text for manual copy when the clipboard write fails", async () => {
  const full = `HEAD${"x".repeat(FAILURE_PREVIEW_CHARS + 10)}TAIL`;
  write.mockRejectedValue(new Error("denied"));
  await render({ error: new Error(full) });
  await act(async () => button("Show details").click());
  await act(async () => button("Copy details").click());
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Could not copy");
  expect(container.querySelector("pre")?.textContent).toBe(full);
  expect(container.querySelector("[data-preview-note]")).toBeNull();
});

it("keeps the live status region mounted so copy results are announced", async () => {
  await render();
  await act(async () => button("Show details").click());
  const status = container.querySelector('[role="status"]');
  expect(status).not.toBeNull();
  expect(status?.textContent).toBe("");
  await act(async () => button("Copy details").click());
  expect(container.querySelector('[role="status"]')).toBe(status);
});

it("leaves retry with the caller and blocks a second activation while it is pending", async () => {
  let settle!: () => void;
  const onRetry = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
  await render({ onRetry });
  await act(async () => button("Try again").click());
  expect(button("Try again").getAttribute("aria-busy")).toBe("true");
  await act(async () => button("Try again").click());
  expect(onRetry).toHaveBeenCalledOnce();
  await act(async () => settle());
  expect(button("Try again").getAttribute("aria-busy")).toBeNull();
  await act(async () => button("Try again").click());
  expect(onRetry).toHaveBeenCalledTimes(2);
});

it("accepts a caller-owned retrying state and keeps a synchronous retry immediate", async () => {
  const onRetry = vi.fn();
  await render({ onRetry, retrying: true });
  await act(async () => button("Try again").click());
  expect(onRetry).not.toHaveBeenCalled();
  await render({ onRetry, retrying: false });
  await act(async () => button("Try again").click());
  await act(async () => button("Try again").click());
  expect(onRetry).toHaveBeenCalledTimes(2);
});

it("labels the failure with a visible title and uses a heading level that fits its place", async () => {
  await render({ title: "Panel failed" });
  expect(container.querySelector("h2")?.textContent).toBe("Panel failed");
  expect(container.querySelector("section")?.getAttribute("aria-labelledby")).toBe(
    container.querySelector("h2")?.id,
  );
  await render({ title: "App failed", fullScreen: true });
  expect(container.querySelector("h1")?.textContent).toBe("App failed");
});

it("keeps an unavailable region distinct from empty data, without invented diagnostics", async () => {
  await act(async () =>
    root.render(createElement(FailureState, { context: "panel", description: "Host unavailable" })),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Host unavailable");
  expect(container.querySelector('[data-context="panel"]')).not.toBeNull();
  expect(container.querySelector('[data-kind="unavailable"]')).not.toBeNull();
  expect(container.querySelector("button")).toBeNull();
});

it("uses InlineError for inline failure and guards an asynchronous retry", async () => {
  let finish!: () => void;
  const onRetry = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    root.render(
      createElement(FailureState, { size: "inline", description: "Host unavailable", onRetry }),
    ),
  );
  expect(container.querySelector('[data-tone="danger"]')).not.toBeNull();
  await act(async () => button("Retry").click());
  await act(async () => button("Retry").click());
  expect(onRetry).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(button("Retry").disabled).toBe(false);
});
