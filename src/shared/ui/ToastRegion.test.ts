// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { layoutStack } from "./arc/toast-stack/toast-stack";
import { toast, ToastRegion, ToastSlot } from "./ToastRegion";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(createElement(ToastRegion)));
  return () => {
    act(() => {
      toast.dismissAll();
      root.unmount();
    });
    container.remove();
  };
}

const items = () =>
  [...document.querySelectorAll<HTMLElement>("[data-toast-item]")].filter(
    (node) => !node.hasAttribute("data-toast-leaving"),
  );

it("tucks closed toasts behind the front one and fans them out with a gap when open", () => {
  const closed = layoutStack([60, 80, 40, 50], false);
  expect(closed.targets.map((target) => target.y)).toEqual([0, -14, -28, -42]);
  expect(closed.targets.map((target) => target.scale)).toEqual([1, 0.95, 0.9, 0.85]);
  // Tucked toasts take the front height so their edges line up; only the front shows content.
  expect(closed.targets.map((target) => target.height)).toEqual([60, 60, 60, 60]);
  expect(closed.targets.map((target) => target.content)).toEqual([1, 0, 0, 0]);
  expect(closed.targets.map((target) => target.opacity)).toEqual([1, 1, 1, 0]);
  expect(closed.listHeight).toBe(60 + 14 * 2);

  const open = layoutStack([60, 80, 40, 50], true);
  expect(open.targets.map((target) => target.y)).toEqual([0, -72, -164, -216]);
  expect(open.targets.map((target) => target.height)).toEqual([60, 80, 40, 50]);
  expect(open.targets.map((target) => target.opacity)).toEqual([1, 1, 1, 0]);
  expect(open.listHeight).toBe(60 + 12 + 80 + 12 + 40);

  // A top corner hangs the same stack from the other edge.
  expect(layoutStack([60, 80], false, "top").targets.map((target) => target.y)).toEqual([0, 14]);
  expect(layoutStack([60, 80], true, "top").targets.map((target) => target.y)).toEqual([0, 72]);
  expect(layoutStack([], true).listHeight).toBe(0);
});

it("stacks the newest toast in front and keeps the fourth out of reach", () => {
  const unmount = mount();
  try {
    act(() => {
      for (const message of ["First", "Second", "Third", "Fourth"])
        toast.show({ message, durationMs: null });
    });
    const stack = document.querySelector<HTMLElement>("[data-toast-region] [data-toast-stack]")!;
    expect(stack.hasAttribute("data-empty")).toBe(false);
    expect(items()).toHaveLength(4);
    const front = items().filter((node) => node.dataset.front === "true");
    expect(front.map((node) => node.textContent)).toEqual(["Fourth"]);
    // Newer toasts sit above older ones; the one beyond the visible three is inert.
    const first = items().find((node) => node.textContent === "First")!;
    expect(first.hasAttribute("inert")).toBe(true);
    expect(items().filter((node) => node.hasAttribute("inert"))).toHaveLength(1);
    expect(Number(front[0]!.style.zIndex)).toBeGreaterThan(Number(first.style.zIndex));
  } finally {
    unmount();
  }
});

it("leaves only an inert picture behind when a laid-out toast is dismissed", async () => {
  // happy-dom has no layout; a laid-out toast is what leaves a fading copy.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(48);
  const unmount = mount();
  try {
    let id = "";
    act(() => {
      id = toast.show({
        tone: "danger",
        message: "Could not save",
        durationMs: null,
        action: { label: "Retry", onClick: () => {} },
      });
    });
    // The toast has to be visible to leave a copy; let its entrance start.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(document.querySelector('[data-toast-region] [role="alert"]')).not.toBeNull();
    await act(async () => {
      toast.dismiss(id);
      await Promise.resolve();
    });
    expect(items()).toHaveLength(0);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector("[data-toast-tone]")).toBeNull();
    expect(document.querySelectorAll("[data-toast-leaving]")).toHaveLength(1);
    for (const copy of document.querySelectorAll("[data-toast-leaving]")) {
      expect(copy.getAttribute("aria-hidden")).toBe("true");
      expect(copy.hasAttribute("inert")).toBe(true);
      expect(copy.querySelector("button, a, [aria-label], [id]")).toBeNull();
      copy.remove();
    }
  } finally {
    unmount();
  }
});

it("holds every toast's expiry while the stack is open and resumes the remaining time", async () => {
  vi.useFakeTimers();
  const unmount = mount();
  const onDismiss = vi.fn();
  try {
    act(() => {
      toast.show({ message: "Saved", onDismiss });
      toast.show({ message: "Archived", onDismiss });
    });
    const stack = document.querySelector<HTMLElement>("[data-toast-stack]")!;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    act(() => {
      stack.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
    });
    expect(items().every((node) => node.dataset.expanded === "true")).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      stack.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

it("keeps the time of a toast that waits behind the visible three", async () => {
  vi.useFakeTimers();
  const unmount = mount();
  const dismissed: string[] = [];
  try {
    act(() => {
      for (const message of ["First", "Second", "Third", "Fourth"])
        toast.show({ message, onDismiss: () => dismissed.push(message) });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    // The oldest toast was out of sight, so its countdown had not started.
    expect(dismissed.toSorted()).toEqual(["Fourth", "Second", "Third"]);
    expect(items().map((node) => node.textContent)).toEqual(["First"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_999);
    });
    expect(dismissed).toHaveLength(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(dismissed).toContain("First");
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

it("keeps a feature card outside the stack, in the same corner", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        createElement(ToastSlot, {
          placement: "top-end",
          order: -1,
          children: createElement("section", { "data-card": "" }, "Due reminders"),
        }),
      ),
    );
    const region = document.querySelector<HTMLElement>('[data-toast-region="top-end"]')!;
    const card = region.querySelector("[data-card]")!;
    expect(card.closest("[data-toast-stack]")).toBeNull();
    expect(card.closest<HTMLElement>("[data-toast-slot]")!.style.order).toBe("-1");
    expect(region.querySelector("[data-toast-stack]")!.hasAttribute("data-empty")).toBe(true);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
