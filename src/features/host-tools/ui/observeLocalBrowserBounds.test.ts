// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { observeLocalBrowserBounds } from "./observeLocalBrowserBounds";

it("follows a subpixel style move on an ancestor without observing an unrelated streaming subtree", async () => {
  vi.useFakeTimers();
  const container = document.createElement("div");
  const slot = document.createElement("div");
  const other = document.createElement("div");
  container.append(slot);
  document.body.append(container, other);
  let x = 13.4;
  const measure = vi
    .spyOn(slot, "getBoundingClientRect")
    .mockImplementation(() => new DOMRect(x, 12, 80, 60));
  const report = vi.fn();
  const stop = observeLocalBrowserBounds(slot, report);
  try {
    await vi.advanceTimersByTimeAsync(100);
    measure.mockClear();
    other.textContent = "New token";
    other.style.width = "32px";
    await vi.advanceTimersByTimeAsync(100);
    expect(measure).not.toHaveBeenCalled();
    x = 13.8;
    container.style.transform = "translateX(13.8px)";
    await vi.advanceTimersByTimeAsync(100);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ left: x }));
  } finally {
    stop();
    container.remove();
    other.remove();
    vi.useRealTimers();
  }
});
