// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DiagnosticsGroup } from "./DiagnosticsSettings";
const copy = vi.hoisted(() => vi.fn());
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: copy }));
it("keeps copy feedback local, prevents duplicates, and preserves retry after failure", async () => {
  let reject!: (reason: Error) => void;
  copy
    .mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(DiagnosticsGroup)));
    const button = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Copy trace",
    )!;
    button.focus();
    await act(async () => {
      button.click();
      button.click();
    });
    expect(copy).toHaveBeenCalledOnce();
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(button);
    await act(async () => reject(new Error("Clipboard unavailable")));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Clipboard unavailable");
    expect(button.getAttribute("aria-busy")).not.toBe("true");
    await act(async () => button.click());
    expect(copy).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Copied");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("shows only the latest operation: Clear replaces a still-visible Copied", async () => {
  copy.mockReset().mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(DiagnosticsGroup)));
    const named = (label: string) =>
      [...container.querySelectorAll("button")].find((node) => node.textContent === label)!;
    await act(async () => named("Copy trace").click());
    expect(container.textContent).toContain("Copied");
    await act(async () => named("Clear").click());
    expect(container.textContent).toContain("Cleared");
    expect(container.textContent).not.toContain("Copied");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("says so, with a retry, when the trace preference cannot be stored", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  try {
    await act(async () => root.render(createElement(DiagnosticsGroup)));
    const toggle = container.querySelector<HTMLElement>('[role="switch"]')!;
    await act(async () => toggle.click());
    expect(container.textContent).toContain("could not be saved");
    setItem.mockRestore();
    const retry = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Retry saving",
    )!;
    await act(async () => retry.click());
    expect(container.textContent).not.toContain("could not be saved");
    // Leave the default (off) behind for other tests.
    await act(async () => container.querySelector<HTMLElement>('[role="switch"]')!.click());
  } finally {
    setItem.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  }
});
