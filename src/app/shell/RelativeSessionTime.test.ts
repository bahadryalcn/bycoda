// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RelativeSessionTime } from "./RelativeSessionTime";

it("updates labels through a shared minute tick without rendering their cards", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const at = Date.now() - 5 * 60_000;
  const cardRenders = vi.fn();
  function Card() {
    cardRenders();
    return createElement(RelativeSessionTime, { at });
  }
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Card)));
    const before = host.textContent;
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(host.textContent).not.toBe(before);
    expect(cardRenders).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
