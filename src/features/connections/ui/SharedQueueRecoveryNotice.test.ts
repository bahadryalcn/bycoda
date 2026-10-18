// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SharedQueueRecoveryNotice } from "./SharedQueueRecoveryNotice";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), state: { recovery: "held request" } }));
vi.mock("../model/useSharedLocalQueues", () => ({
  useLocalSharedQueueClient: () => ({
    subscribe: () => () => {},
    snapshot: () => mocks.state,
    resolveRecovery: mocks.resolve,
  }),
}));
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ children }: { children: unknown }) => children,
}));

it.each([
  ["Keep queued, pause", false],
  ["Already delivered", true],
] as const)("requires reviewing delivery before choosing %s", async (label, accepted) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.resolve.mockReset().mockResolvedValue(undefined);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(SharedQueueRecoveryNotice, { sessionId: "chat" })),
    );
    expect(container.textContent).not.toContain("held request");
    expect(mocks.resolve).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.textContent).toContain("held request");
    expect(container.textContent).toContain("does not resend it");
    const choice = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === label,
    )!;
    await act(async () => choice.click());
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(accepted);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
