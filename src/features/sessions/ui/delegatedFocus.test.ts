// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { consumeViewDelegated, requestViewDelegated, VIEW_DELEGATED_EVENT } from "./delegatedFocus";
afterEach(() => vi.useRealTimers());
it("retains one exact parent request until consumed or expired", () => {
  vi.useFakeTimers();
  const listener = vi.fn();
  window.addEventListener(VIEW_DELEGATED_EVENT, listener);
  requestViewDelegated("parent", "child");
  expect(listener).toHaveBeenCalledOnce();
  expect(consumeViewDelegated("other")).toBeUndefined();
  expect(consumeViewDelegated("parent")).toBe("child");
  expect(consumeViewDelegated("parent")).toBeUndefined();
  requestViewDelegated("parent", "later");
  vi.advanceTimersByTime(10_000);
  expect(consumeViewDelegated("parent")).toBeUndefined();
  window.removeEventListener(VIEW_DELEGATED_EVENT, listener);
});
