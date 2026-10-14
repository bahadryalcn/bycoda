// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TransientNotice } from "./TransientNotice";

it("announces the message and does not restart expiry when a parent rerenders", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const first = vi.fn();
  const latest = vi.fn();
  try {
    act(() =>
      root.render(createElement(TransientNotice, { message: "Could not save", onDismiss: first })),
    );
    const status = document.querySelector('[role="status"]')!;
    expect(status.textContent).toContain("Could not save");
    expect(status.hasAttribute("aria-label")).toBe(false);
    expect(status.querySelector('button[aria-label="Dismiss notice"]')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    act(() =>
      root.render(createElement(TransientNotice, { message: "Could not save", onDismiss: latest })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
