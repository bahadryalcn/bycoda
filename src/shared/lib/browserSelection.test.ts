// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

it("seçim bildirimlerini erteler ve açık olay gönderimini eşzamanlı tutar", async () => {
  vi.useFakeTimers();
  const listener = vi.fn();
  const node = document.createTextNode("seçim");
  document.body.append(node);
  document.addEventListener("selectionchange", listener);
  try {
    const range = document.createRange();
    range.selectNodeContents(node);
    document.getSelection()!.addRange(range);
    expect(listener).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledOnce();
    document.dispatchEvent(new Event("selectionchange"));
    expect(listener).toHaveBeenCalledTimes(2);
  } finally {
    document.removeEventListener("selectionchange", listener);
    document.getSelection()!.removeAllRanges();
    node.remove();
    vi.useRealTimers();
  }
});
