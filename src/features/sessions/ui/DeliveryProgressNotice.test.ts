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
import {
  registerDeliveryResolver,
  trackLateSettlement,
  type DeliveryReviewOutcome,
} from "../model/deliveryReview";

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

it.each([
  ["Send again", "active", 2],
  ["Already delivered", "paused", 1],
  ["Discard", "paused", 1],
] as const)(
  "resolves an unknown local row with %s: queue %s with %i row(s) left",
  async (label, status, remaining) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const unknown = {
      id: "unknown",
      text: "Synthetic retained instruction",
      attachments: [],
      deliveryUnknown: true as const,
    };
    const next = { id: "next", text: "Synthetic follow-up", attachments: [] };
    resetSessionsStore([
      {
        ...newSession("codex", "/fake"),
        id: "progress-chat",
        queuedMessages: [unknown, next],
        queueStatus: "paused" as const,
      },
    ]);
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(DeliveryProgressNotice, {
          sessionId: "progress-chat",
          messages: [unknown, next],
        }),
      ),
    );
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === label)!
        .click(),
    );
    const queue = getSessions()[0].queuedMessages ?? [];
    expect(getSessions()[0].queueStatus).toBe(status);
    expect(queue).toHaveLength(remaining);
    expect(queue.some((row) => row.deliveryUnknown)).toBe(false);
    if (label === "Send again") expect(queue[0].id).toBe("unknown");
    await act(async () => root.unmount());
  },
);

it("writes the duplicate risk as text and holds back Send again while the provider may still answer", async () => {
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
  const sendAgain = () =>
    Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Send again",
    )!;
  // Visible text, not a tooltip: the choice carries its own warning.
  await act(async () =>
    root.render(createElement(DeliveryProgressNotice, { sessionId: session.id, messages: [row] })),
  );
  expect(container.querySelector("[data-delivery-review-warning]")?.textContent).toContain(
    "Sending again duplicates a message that was delivered",
  );
  expect(sendAgain().disabled).toBe(false);
  expect(container.querySelector("[title*='Check the conversation']")).toBeNull();
  // The provider call is still open.
  let answer!: (value: "accepted" | "rejected" | "unknown") => void;
  await act(async () =>
    trackLateSettlement(
      session.id,
      new Promise((resolve) => {
        answer = resolve;
      }),
    ),
  );
  expect(sendAgain().disabled).toBe(true);
  expect(container.querySelector("[data-delivery-review-warning]")?.textContent).toContain(
    "may still deliver this message",
  );
  await act(async () => answer("unknown"));
  expect(sendAgain().disabled).toBe(false);
  await act(async () => root.unmount());
});

it.each([
  ["Already delivered", "delivered"],
  ["Send again", "retry"],
  ["Keep queued, pause", "keep"],
  ["Discard", "discard"],
] as [string, DeliveryReviewOutcome][])(
  "decides an unconfirmed row of another computer's queue through that queue: %s",
  async (label, outcome) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const row = {
      id: "unknown",
      text: "Queued on the mac",
      attachments: [],
      deliveryUnknown: true as const,
    };
    // The desktop store knows nothing of this conversation: it must stay untouched.
    resetSessionsStore([]);
    const resolver = vi.fn(async () => {});
    const unregister = registerDeliveryResolver("progress-chat", resolver);
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(DeliveryProgressNotice, { sessionId: "progress-chat", messages: [row] }),
      ),
    );
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === label)!
        .click(),
    );
    expect(resolver).toHaveBeenCalledExactlyOnceWith("unknown", outcome);
    expect(getSessions()).toEqual([]);
    unregister();
    await act(async () => root.unmount());
  },
);

it("shows why the choice could not be saved and keeps the row", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const row = { id: "unknown", text: "Queued", attachments: [], deliveryUnknown: true as const };
  const unregister = registerDeliveryResolver("progress-chat", async () => {
    throw new Error("The queue is being sent elsewhere. Wait and try again.");
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(DeliveryProgressNotice, { sessionId: "progress-chat", messages: [row] }),
    ),
  );
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Discard")!
      .click(),
  );
  expect(container.textContent).toContain("being sent elsewhere");
  expect(container.textContent).toContain("Queued");
  unregister();
  await act(async () => root.unmount());
});
