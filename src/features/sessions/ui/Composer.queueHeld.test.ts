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

it("shows the reason the host paused the queue as text in the banner, next to Resume", async () => {
  setQueueHoldReason("s1", "Provider crashed: exit 1");
  try {
    await renderQueue({ queueStatus: "paused", onResumeQueue: vi.fn() });
    const banner = container.querySelector("[data-message-queue-card]")!.textContent;
    expect(banner).toContain("Queue paused: the last message was not accepted");
    expect(banner).toContain("Provider crashed: exit 1");
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
  expect(container.textContent).toContain("Queue held: delivery is not confirmed");
  expect(container.textContent).not.toContain("because you interrupted");
});
