// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SharedQueueRecoveryNotice } from "./SharedQueueRecoveryNotice";
import { requestDeliveryReview } from "../../sessions/model/deliveryReview";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  resume: vi.fn(),
  state: { recovery: "held request", queue: { messages: [] } },
}));
vi.mock("../model/useSharedLocalQueues", () => ({
  resumeSharedLocalQueue: mocks.resume,
  useLocalSharedQueueClient: () => ({
    subscribe: () => () => {},
    snapshot: () => mocks.state,
    resolveRecovery: mocks.resolve,
  }),
}));

async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.resolve.mockReset().mockResolvedValue(undefined);
  mocks.resume.mockReset().mockResolvedValue("resumed");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(createElement(SharedQueueRecoveryNotice, { sessionId: "chat" })),
  );
  const choose = (label: string) =>
    act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === label)!
        .click(),
    );
  return {
    container,
    choose,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

it("shows the inline choice for an unconfirmed delivery and never resolves it on its own", async () => {
  const view = await mount();
  try {
    expect(view.container.textContent).toContain("held request");
    expect(view.container.querySelector("[data-delivery-review]")).not.toBeNull();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
  } finally {
    await view.cleanup();
  }
});

it.each([
  ["Keep queued, pause", false],
  ["Already delivered", true],
  ["Discard", true],
] as const)(
  "resolves the held delivery with %s without sending it again",
  async (label, accepted) => {
    const view = await mount();
    try {
      await view.choose(label);
      expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(accepted);
      expect(mocks.resume).not.toHaveBeenCalled();
    } finally {
      await view.cleanup();
    }
  },
);

it("sends the held row again only when the owner says it never arrived", async () => {
  const view = await mount();
  try {
    await view.choose("Send again");
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(false);
    expect(mocks.resume).toHaveBeenCalledExactlyOnceWith("chat");
  } finally {
    await view.cleanup();
  }
});

it("moves focus to the choice when Resume asks the owner to decide", async () => {
  const view = await mount();
  try {
    await act(async () => requestDeliveryReview("chat"));
    expect(document.activeElement?.textContent).toBe("Already delivered");
  } finally {
    await view.cleanup();
  }
});

it("shows a failed resolution inline and lets the owner choose again", async () => {
  const view = await mount();
  try {
    mocks.resolve.mockRejectedValueOnce(new Error("Host unreachable"));
    await view.choose("Already delivered");
    expect(view.container.textContent).toContain("Host unreachable");
    await view.choose("Already delivered");
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
  } finally {
    await view.cleanup();
  }
});
