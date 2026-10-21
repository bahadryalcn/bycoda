// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DeliveryProgressNotice } from "./DeliveryProgressNotice";
import {
  beginDeliveryProgress,
  clearDeliveryProgress,
  readDeliveryProgress,
  updateDeliveryProgress,
} from "../model/deliveryProgress";
import { getSessions, resetSessionsStore, setSessions } from "../model/sessionsStore";
import { newSession } from "../model/session";

vi.mock("../../connections/model/useSharedLocalQueues", () => ({
  useLocalSharedQueueClient: () => undefined,
}));
afterEach(() => {
  for (
    let progress = readDeliveryProgress("progress-chat");
    progress;
    progress = readDeliveryProgress("progress-chat")
  )
    clearDeliveryProgress("progress-chat", progress);
  resetSessionsStore([]);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps the current delivery stage and elapsed time after remounting the composer surface", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  let root = createRoot(container);
  const progress = beginDeliveryProgress("progress-chat", "queued", "syncing");
  await act(async () =>
    root.render(
      createElement(DeliveryProgressNotice, { sessionId: "progress-chat", messages: [] }),
    ),
  );
  expect(container.textContent).toContain("Synchronizing");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(11_000);
  });
  expect(container.textContent).toContain("11s elapsed");
  expect(container.textContent).toContain("do not need to write it again");
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(DeliveryProgressNotice, { sessionId: "progress-chat", messages: [] }),
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(container.textContent).toContain("11s elapsed");
  await act(async () => updateDeliveryProgress("progress-chat", progress, "accepted"));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("accepted");
  await act(async () => root.unmount());
});

it("offers explicit review for an unknown row restored without an in-memory request", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const row = {
    id: "unknown",
    text: "Synthetic retained instruction",
    attachments: [],
    deliveryUnknown: true as const,
  };
  const session = {
    ...newSession("codex", "/fake"),
    id: "progress-chat",
    queuedMessages: [row],
    queueStatus: "paused" as const,
  };
  resetSessionsStore([session]);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(createElement(DeliveryProgressNotice, { sessionId: session.id, messages: [row] })),
  );
  expect(container.textContent).toContain("Automatic resend is held");
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Review delivery")!
      .click(),
  );
  await act(async () =>
    Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "Keep queued, pause")!
      .click(),
  );
  expect(getSessions()[0].queuedMessages?.[0].deliveryUnknown).toBeUndefined();
  expect(getSessions()[0].queueStatus).toBe("paused");
  expect(getSessions()[0].queuedMessages).toHaveLength(1);
  await act(async () => root.unmount());
});

it("reviews the selected unknown row without resolving another outstanding delivery", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const first = {
    id: "first",
    text: "First retained message",
    attachments: [],
    deliveryUnknown: true as const,
  };
  const second = { ...first, id: "second", text: "Second retained message" };
  const session = {
    ...newSession("codex", "/fake"),
    id: "progress-chat",
    queuedMessages: [first, second],
    queueStatus: "paused" as const,
  };
  resetSessionsStore([session]);
  beginDeliveryProgress(session.id, first.id, "unknown");
  beginDeliveryProgress(session.id, second.id, "unknown");
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(DeliveryProgressNotice, { sessionId: session.id, messages: [first, second] }),
    ),
  );
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Review delivery")!
      .click(),
  );
  await act(async () =>
    Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "Keep queued, pause")!
      .click(),
  );
  expect(readDeliveryProgress(session.id, first.id)?.stage).toBe("rejected");
  expect(readDeliveryProgress(session.id, second.id)?.stage).toBe("unknown");
  expect(getSessions()[0].queuedMessages?.[1].deliveryUnknown).toBe(true);
  await act(async () => root.unmount());
});

it("clears an obsolete rejection after the corresponding queued row is removed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const row = { id: "gone", text: "Removed retained message", attachments: [] };
  const session = {
    ...newSession("codex", "/fake"),
    id: "progress-chat",
    queuedMessages: [row],
    queueStatus: "paused" as const,
  };
  resetSessionsStore([session]);
  beginDeliveryProgress(session.id, row.id, "rejected");
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(createElement(DeliveryProgressNotice, { sessionId: session.id, messages: [row] })),
  );
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => {
    setSessions((sessions) => sessions.map((entry) => ({ ...entry, queuedMessages: [] })));
    root.render(createElement(DeliveryProgressNotice, { sessionId: session.id, messages: [] }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(readDeliveryProgress(session.id)).toBeUndefined();
  expect(container.textContent).toBe("");
  await act(async () => root.unmount());
});
