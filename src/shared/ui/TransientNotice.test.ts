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

it("keeps a sticky danger notice with an action and announces it assertively", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onDismiss = vi.fn();
  const onClick = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(TransientNotice, {
          tone: "danger",
          title: "Update failed",
          message: "Try again",
          durationMs: null,
          action: { label: "Retry", onClick },
          onDismiss,
        }),
      ),
    );
    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Update failed");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    const retry = [...alert.querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
    act(() => retry.click());
    expect(onClick).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("keeps an Undo notice while focused or hovered and resumes only its remaining time", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  const outside = document.createElement("button");
  document.body.append(container, outside);
  const root = createRoot(container);
  const onDismiss = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(TransientNotice, {
          message: "Archived",
          action: { label: "Undo", onClick: vi.fn() },
          onDismiss,
        }),
      ),
    );
    const notice = document.querySelector<HTMLElement>('[role="status"]')!;
    const undo = [...notice.querySelectorAll("button")].find(
      (button) => button.textContent === "Undo",
    )!;
    const close = notice.querySelector<HTMLButtonElement>('button[aria-label="Dismiss notice"]')!;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    act(() => undo.focus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(undo);
    act(() => {
      notice.dispatchEvent(new PointerEvent("pointerenter"));
      close.focus();
      outside.focus();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => notice.dispatchEvent(new PointerEvent("pointerleave")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
    outside.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("pauses expiry in a hidden document and still permits explicit dismissal while focused", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onDismiss = vi.fn();
  try {
    act(() => root.render(createElement(TransientNotice, { message: "Saved", onDismiss })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    hidden = true;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="Dismiss notice"]')!;
    act(() => close.focus());
    hidden = false;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => close.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("does not expire while dismissal is disabled by an operation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onDismiss = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(TransientNotice, { message: "Updating", dismissDisabled: true, onDismiss }),
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => root.render(createElement(TransientNotice, { message: "Updated", onDismiss })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
