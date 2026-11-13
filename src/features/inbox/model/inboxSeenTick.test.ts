// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { readInboxSeenStorage } from "./inboxSeenStorage";

vi.mock("./inboxSeenStorage", () => ({
  readInboxSeenStorage: vi.fn(),
  mergeInboxSeenStorage: vi.fn(),
  seedInboxSeenStorage: vi.fn(),
}));

it("catches history initialization that starts between render and subscription", async () => {
  vi.resetModules();
  localStorage.clear();
  vi.stubGlobal("indexedDB", {});
  vi.stubGlobal("BroadcastChannel", undefined);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let finish!: (value: { seeded: boolean; items: Map<string, number | undefined> }) => void;
  vi.mocked(readInboxSeenStorage).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const api = await import("./inboxSeen");
  function Probe() {
    api.useInboxSeenTick();
    const state = api.inboxSeenStatus().state;
    api.inboxSeenIsSeeded();
    return createElement("span", { "data-history-state": state });
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(container.querySelector("span")?.getAttribute("data-history-state")).toBe("loading");
    await act(async () => finish({ seeded: true, items: new Map() }));
    expect(container.querySelector("span")?.getAttribute("data-history-state")).toBe("ready");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    localStorage.clear();
  }
});
