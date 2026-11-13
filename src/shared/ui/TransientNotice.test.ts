// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TransientNotice } from "./TransientNotice";
import { toast, ToastRegion, TOAST_VISIBLE_MS } from "./ToastRegion";

beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

it.each(["top-end", "bottom-end"] as const)(
  "keeps %s container notices inside their owner and preserves dismissal",
  (placement) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onDismiss = vi.fn();
    try {
      act(() =>
        root.render(
          createElement(TransientNotice, {
            anchor: "container",
            placement,
            durationMs: null,
            message: "New activity",
            onDismiss,
          }),
        ),
      );
      const notice = container.querySelector<HTMLElement>('[role="status"]')!;
      expect(notice).not.toBeNull();
      expect(notice.classList.contains("absolute")).toBe(true);
      expect(
        placement === "top-end" ? notice.style.insetBlockStart : notice.style.insetBlockEnd,
      ).toBe("12px");
      act(() =>
        notice.querySelector<HTMLButtonElement>('button[aria-label="Dismiss notice"]')!.click(),
      );
      expect(onDismiss).toHaveBeenCalledOnce();
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);

it("expires stacked errors only after ten seconds of window focus, preserving remaining time", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  let focused = false;
  vi.mocked(document.hasFocus).mockImplementation(() => focused);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onDismiss = vi.fn();
  try {
    act(() => {
      root.render(createElement(ToastRegion));
      for (let i = 0; i < 3; i++)
        toast.show({ tone: "danger", message: "Could not update the session.", onDismiss });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(document.querySelectorAll('[data-toast-tone="danger"]')).toHaveLength(3);
    focused = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    // A system clock correction must not extend the focused-time countdown.
    vi.setSystemTime(Date.now() - 3_600_000);
    focused = false;
    act(() => window.dispatchEvent(new Event("blur")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    focused = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(3);
    expect(document.querySelector('[data-toast-tone="danger"]')).toBeNull();
  } finally {
    act(() => {
      toast.dismissAll();
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

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
      await vi.advanceTimersByTimeAsync(4_000);
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
      await vi.advanceTimersByTimeAsync(3_999);
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
      await vi.advanceTimersByTimeAsync(TOAST_VISIBLE_MS);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("expires a danger notice after ten seconds by default", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onDismiss = vi.fn();
  try {
    act(() =>
      root.render(createElement(TransientNotice, { tone: "danger", message: "Failed", onDismiss })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Failed");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
    onDismiss.mockClear();
    // Other tones share the same default.
    act(() => root.render(createElement(TransientNotice, { message: "Saved", onDismiss })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOAST_VISIBLE_MS);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("places the action after the message and blocks a second activation while pending", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onClick = vi.fn();
  const notice = (pending: boolean) =>
    createElement(TransientNotice, {
      tone: "danger",
      title: "Update failed",
      message: "The feed returned 503",
      action: { label: "Retry", onClick, pending },
      onDismiss: vi.fn(),
    });
  try {
    act(() => root.render(notice(true)));
    const alert = document.querySelector('[role="alert"]')!;
    const text = alert.textContent ?? "";
    expect(text.indexOf("Update failed")).toBeLessThan(text.indexOf("The feed returned 503"));
    expect(text.indexOf("The feed returned 503")).toBeLessThan(text.indexOf("Retry"));
    const retry = [...alert.querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
    expect(retry.getAttribute("aria-busy")).toBe("true");
    act(() => retry.click());
    expect(onClick).not.toHaveBeenCalled();
    act(() => root.render(notice(false)));
    act(() => retry.click());
    expect(onClick).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
