// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({
  held: false,
  takeOver: vi.fn(async (_sessionId: string): Promise<unknown> => ({
    kind: "waiting",
    message: "This window now sends the queue.",
  })),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../../source-control/hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => ({
    branches: { current: "main", detached: false, branches: [] },
    settled: true,
  }),
}));
vi.mock("../../connections/model/useSharedLocalQueues", async (original) => ({
  ...(await original<typeof import("../../connections/model/useSharedLocalQueues")>()),
  useSharedQueueLeaseHeld: () => shared.held,
  takeOverSharedLocalQueue: (sessionId: string) => shared.takeOver(sessionId),
}));

import { Composer } from "./Composer";
import { setQueueHoldReason } from "../model/deliveryReview";
import {
  beginDeliveryProgress,
  clearDeliveryProgress,
  updateDeliveryProgress,
} from "../model/deliveryProgress";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  shared.held = false;
  shared.takeOver.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderQueue(props: Partial<ComponentProps<typeof Composer>>) {
  await act(async () =>
    root.render(
      createElement(Composer, {
        focused: true,
        harness: "claude",
        model: "m",
        runtimeMode: "supervised",
        executionCwd: "/repo",
        sessionId: "s1",
        hideProjectPicker: true,
        hideBranchPicker: true,
        onFocus: () => {},
        onCwdChange: () => {},
        onModelChange: () => {},
        onRuntimeModeChange: () => {},
        onSubmit: (() => true) as never,
        queuedMessages: [{ id: "a", text: "queued task", attachments: [] }],
        queueStatus: "active",
        ...props,
      }),
    ),
  );
}
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find((entry) =>
    entry.textContent?.includes(label),
  );

it("says in plain text that another window sends the queue and takes it over on request", async () => {
  shared.held = true;
  await renderQueue({});
  const banner = container.querySelector("[data-queue-held-elsewhere]");
  expect(banner?.textContent).toContain("Queue held by another window, which sends it");
  await act(async () => {
    button("Take over")!.click();
  });
  expect(shared.takeOver).toHaveBeenCalledExactlyOnceWith("s1");
  expect(container.textContent).toContain("This window now sends the queue.");
});

it("shows a failed takeover instead of swallowing it", async () => {
  shared.held = true;
  shared.takeOver.mockRejectedValueOnce(new Error("The queue could not be taken over. Try again."));
  await renderQueue({});
  await act(async () => {
    button("Take over")!.click();
  });
  expect(container.textContent).toContain("The queue could not be taken over. Try again.");
});

it("offers nothing extra when no other window holds the queue", async () => {
  await renderQueue({});
  expect(container.querySelector("[data-queue-held-elsewhere]")).toBeNull();
  expect(button("Take over")).toBeUndefined();
});

it("leaves a paused queue to its Resume, which already takes the queue over", async () => {
  shared.held = true;
  await renderQueue({ queueStatus: "paused", onResumeQueue: vi.fn() });
  expect(container.querySelector("[data-queue-held-elsewhere]")).toBeNull();
  expect(button("Resume")).toBeDefined();
});

it("keeps Resume direct and shows the actual host failure without a repeated generic error", async () => {
  setQueueHoldReason("s1", "Provider crashed: exit 1");
  try {
    await renderQueue({ queueStatus: "paused", onResumeQueue: vi.fn() });
    const banner = container.querySelector("[data-message-queue-card]")!.textContent;
    expect(banner).not.toContain("Queue paused: the last message was not accepted");
    expect(banner).toContain("Provider crashed: exit 1");
    const detail = container.querySelector("[data-message-queue-card] details");
    expect(detail).toBeNull();
    expect(button("Resume")).toBeDefined();
  } finally {
    setQueueHoldReason("s1", undefined);
  }
});

it("keeps the interrupted wording when the host paused it for a Stop", async () => {
  setQueueHoldReason("s1", "stopped");
  try {
    await renderQueue({ queueStatus: "paused", onResumeQueue: vi.fn() });
    expect(container.textContent).toContain("Queue paused because you interrupted");
  } finally {
    setQueueHoldReason("s1", undefined);
  }
});

it("names a refused or unconfirmed head instead of blaming the person who stopped", async () => {
  await renderQueue({
    queueStatus: "paused",
    onResumeQueue: vi.fn(),
    queuedMessages: [{ id: "a", text: "queued task", attachments: [], deliveryUnknown: true }],
  });
  expect(container.textContent).toContain("Delivery is not confirmed. Automatic resend is held.");
  expect(container.textContent).not.toContain("Queue held: delivery is not confirmed");
  expect(container.textContent).not.toContain("because you interrupted");
});

it("shows a rejected delivery once inside the queue and retains named icon actions", async () => {
  const progress = beginDeliveryProgress("s1", "a", "preparing");
  updateDeliveryProgress("s1", progress, "rejected", "Provider crashed: exit 1");
  try {
    await renderQueue({
      queueStatus: "paused",
      onResumeQueue: vi.fn(),
      onSteerQueuedMessage: vi.fn(),
    });
    const card = container.querySelector("[data-message-queue-card]")!;
    expect(container.querySelectorAll("[data-delivery-progress]")).toHaveLength(1);
    expect(card.querySelector("[data-delivery-progress]")).not.toBeNull();
    expect(container.textContent?.split("Provider crashed: exit 1")).toHaveLength(2);
    expect(container.querySelector("[data-delivery-details]")).toBeNull();
    expect(container.querySelector('button[aria-label="Steer"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Edit queued message"]')).not.toBeNull();
    expect(button("Resume")).toBeDefined();
    expect(container.querySelector('button[aria-label="Remove queued message"]')).not.toBeNull();
  } finally {
    clearDeliveryProgress("s1", progress);
  }
});
