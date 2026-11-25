// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  DeliveryNoticeReopen,
  DeliveryProgressIndicator,
  DeliveryProgressNotice,
} from "./DeliveryProgressNotice";
import { resetDeliveryNoticeDismissals } from "../model/deliveryNoticeDismissal";
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
  requestDeliveryReview,
  setQueueHoldReason,
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

it("titles a rejected delivery with its stage label and keeps the raw text out of the title", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const row = { id: "queued", text: "Retained instruction", attachments: [] };
  const progress = beginDeliveryProgress("progress-chat", row.id, "preparing");
  updateDeliveryProgress(
    "progress-chat",
    progress,
    "rejected",
    "Provider crashed: exit 1\nNative provider output retained for inspection.",
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(DeliveryProgressNotice, {
        sessionId: "progress-chat",
        messages: [row],
      }),
    ),
  );
  const alert = container.querySelector('[role="alert"]')!;
  expect(alert.querySelector("strong")?.textContent).toBe(
    "Queue paused: the last message was not accepted",
  );
  expect(alert.textContent).toContain("Provider crashed: exit 1");
  expect(alert.textContent).not.toContain("Native provider output");
  expect(alert.textContent).toContain("Details");
  await act(async () => root.unmount());
});

async function renderNotice(messages: { id: string; text: string; attachments: never[] }[] = []) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (rows = messages) =>
    act(async () =>
      root.render(
        createElement(DeliveryProgressNotice, { sessionId: "progress-chat", messages: rows }),
      ),
    );
  await render();
  return { container, root, render };
}
const row = { id: "queued", text: "Retained instruction", attachments: [] as never[] };

it.each([
  ["rejected", "danger", "Queue paused: the last message was not accepted"],
  ["waiting", "warning", "Not sent yet. The message stays queued and is retried automatically."],
] as const)("shows a %s delivery as a %s card with a readable body", async (stage, tone, title) => {
  resetDeliveryNoticeDismissals();
  const progress = beginDeliveryProgress("progress-chat", row.id, "preparing");
  updateDeliveryProgress(
    "progress-chat",
    progress,
    stage,
    "QuotaExceededError: Failed to execute 'setItem' on 'Storage': quota",
  );
  const { container, root } = await renderNotice([row]);
  const card = container.querySelector(`[data-delivery-progress="${stage}"]`)!;
  expect(card.getAttribute("role")).toBe(tone === "danger" ? "alert" : "status");
  expect(card.querySelector("strong")?.textContent).toBe(title);
  expect(card.textContent).toContain("local storage is full");
  expect(card.querySelector("strong")?.textContent).not.toContain("QuotaExceededError");
  await act(async () => root.unmount());
});

it("keeps a dismissed notice closed across remounts, re-opens it from the header and re-shows a new operation", async () => {
  resetDeliveryNoticeDismissals();
  const progress = beginDeliveryProgress("progress-chat", row.id, "preparing");
  updateDeliveryProgress("progress-chat", progress, "waiting", "RPC_WS_INTERRUPTED: ended");
  let view = await renderNotice([row]);
  const dismiss = view.container.querySelector<HTMLButtonElement>('button[aria-label^="Dismiss"]')!;
  await act(async () => dismiss.click());
  expect(view.container.querySelector("[data-delivery-progress]")).toBeNull();
  await act(async () => view.root.unmount());

  view = await renderNotice([row]);
  expect(view.container.querySelector("[data-delivery-progress]")).toBeNull();
  await act(async () => view.root.unmount());

  const host = document.createElement("div");
  const hostRoot = createRoot(host);
  await act(async () =>
    hostRoot.render(
      createElement(
        "div",
        null,
        createElement(DeliveryNoticeReopen, { sessionId: "progress-chat", messages: [row] }),
        createElement(DeliveryProgressNotice, { sessionId: "progress-chat", messages: [row] }),
      ),
    ),
  );
  const reopen = host.querySelector<HTMLButtonElement>("[data-delivery-notice-reopen]")!;
  expect(reopen).not.toBeNull();
  await act(async () => reopen.click());
  expect(host.querySelector("[data-delivery-progress]")).not.toBeNull();
  expect(host.querySelector("[data-delivery-notice-reopen]")).toBeNull();

  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label^="Dismiss"]')!.click(),
  );
  expect(host.querySelector("[data-delivery-progress]")).toBeNull();
  const next = beginDeliveryProgress("progress-chat", row.id, "preparing");
  await act(async () => updateDeliveryProgress("progress-chat", next, "rejected", "again"));
  expect(host.querySelector("[data-delivery-progress]")).not.toBeNull();
  await act(async () => hostRoot.unmount());
});

it("re-opens a dismissed notice when a delivery review is requested", async () => {
  resetDeliveryNoticeDismissals();
  const unknown = { ...row, deliveryUnknown: true as const };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = () =>
    act(async () =>
      root.render(
        createElement(DeliveryProgressNotice, { sessionId: "progress-chat", messages: [unknown] }),
      ),
    );
  await render();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="Dismiss"]')!.click(),
  );
  expect(container.querySelector("[data-delivery-progress]")).toBeNull();
  await act(async () => requestDeliveryReview("progress-chat"));
  expect(container.querySelector('[data-delivery-progress="unknown"]')).not.toBeNull();
  expect(container.textContent).toContain("Mark as delivered");
  await act(async () => root.unmount());
});

it("keeps routine waiting compact across time and remount", async () => {
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
  expect(container.querySelector("[data-delivery-progress]")).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(11_000);
  });
  expect(container.querySelector("[data-delivery-progress]")).toBeNull();
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
  expect(container.querySelector("[data-delivery-progress]")).toBeNull();
  await act(async () => updateDeliveryProgress("progress-chat", progress, "accepted"));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector("[data-delivery-progress]")).toBeNull();
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
  ["Mark as delivered", "paused", 1],
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
          inlineRowId: label === "Send again" ? unknown.id : undefined,
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
    "Sending again duplicates a delivered message",
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
  ["Mark as delivered", "delivered"],
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
  expect(container.textContent).toContain("Could not record your choice");
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.startsWith("Details"))!
      .click(),
  );
  expect(document.body.textContent).toContain("being sent elsewhere");
  expect(container.textContent).toContain("Queued");
  unregister();
  await act(async () => root.unmount());
});

it("shows only authoritative acceptance and clears the compact indicator", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.createElement("div");
  const root = createRoot(container);
  const progress = beginDeliveryProgress("progress-chat", "queued", "preparing");
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(DeliveryProgressIndicator, { sessionId: "progress-chat" }),
        createElement(DeliveryProgressNotice, { sessionId: "progress-chat", messages: [] }),
      ),
    ),
  );
  expect(container.querySelector("[data-delivery-pending]")).not.toBeNull();
  expect(container.querySelector("[data-delivery-accepted]")).toBeNull();
  await act(async () =>
    updateDeliveryProgress("progress-chat", progress, "accepted", "Provider confirmed"),
  );
  expect(container.querySelector("[data-delivery-accepted]")).not.toBeNull();
  expect(container.querySelector("[data-delivery-progress]")).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1800);
  });
  expect(container.querySelector("[data-delivery-accepted]")).toBeNull();
  await act(async () => root.unmount());
});

it("keeps one waiting notice across automatic retries and honours its dismissal", async () => {
  resetDeliveryNoticeDismissals();
  const first = beginDeliveryProgress("progress-chat", row.id, "preparing");
  updateDeliveryProgress("progress-chat", first, "waiting", "RPC_WS_INTERRUPTED: ended");
  const { container, root } = await renderNotice([row]);
  const waitingCard = () => container.querySelector('[data-delivery-progress="waiting"]');
  expect(waitingCard()).not.toBeNull();
  // A retry is a new pending operation: the card must stay, not hide and re-show.
  const retry = beginDeliveryProgress("progress-chat", row.id, "claiming");
  await act(async () => {});
  expect(waitingCard()).not.toBeNull();
  await act(async () =>
    updateDeliveryProgress("progress-chat", retry, "waiting", "RPC_WS_INTERRUPTED: ended"),
  );
  expect(waitingCard()).not.toBeNull();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="Dismiss"]')!.click(),
  );
  expect(waitingCard()).toBeNull();
  const again = beginDeliveryProgress("progress-chat", row.id, "claiming");
  await act(async () => {});
  await act(async () =>
    updateDeliveryProgress("progress-chat", again, "waiting", "RPC_WS_INTERRUPTED: ended"),
  );
  expect(waitingCard()).toBeNull();
  await act(async () => root.unmount());
});

it("leaves ownership feedback beside the queue during waiting, retry and hold", async () => {
  const first = beginDeliveryProgress("progress-chat", row.id, "preparing");
  updateDeliveryProgress(
    "progress-chat",
    first,
    "waiting",
    "Waiting for the previous run to finish.",
    false,
    true,
  );
  const { container, root } = await renderNotice([row]);
  expect(container.querySelector("[data-delivery-progress]")).toBeNull();
  let retry: ReturnType<typeof beginDeliveryProgress>;
  await act(async () => {
    retry = beginDeliveryProgress("progress-chat", row.id, "claiming");
  });
  expect(container.querySelector("[data-delivery-progress]")).toBeNull();
  await act(async () =>
    updateDeliveryProgress(
      "progress-chat",
      retry,
      "rejected",
      "Check the conversation on its Host before resuming.",
      false,
      true,
    ),
  );
  expect(container.querySelector("[data-delivery-progress]")).toBeNull();
  await act(async () => root.unmount());
});

it("clears a waiting notice whose row left the queue", async () => {
  resetDeliveryNoticeDismissals();
  const progress = beginDeliveryProgress("progress-chat", row.id, "preparing");
  updateDeliveryProgress("progress-chat", progress, "waiting", "RPC_WS_INTERRUPTED: ended");
  const { container, root, render } = await renderNotice([row]);
  expect(container.querySelector("[data-delivery-progress]")).not.toBeNull();
  await render([]);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  expect(readDeliveryProgress("progress-chat")).toBeUndefined();
  expect(container.querySelector("[data-delivery-progress]")).toBeNull();
  await act(async () => root.unmount());
});

it("shows a pause reason as its own warning notice and re-shows it for a different reason", async () => {
  resetDeliveryNoticeDismissals();
  setQueueHoldReason("progress-chat", "Another computer changed the queue. Review it first.");
  const { container, root } = await renderNotice([row]);
  const card = container.querySelector('[data-delivery-progress="paused"]')!;
  expect(card.getAttribute("role")).toBe("status");
  expect(card.querySelector("strong")?.textContent).toBe("Queue paused");
  expect(card.textContent).toContain("Another computer changed the queue.");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="Dismiss"]')!.click(),
  );
  expect(container.querySelector("[data-delivery-progress]")).toBeNull();
  await act(async () => setQueueHoldReason("progress-chat", "Provider paused the queue."));
  expect(container.querySelector('[data-delivery-progress="paused"]')).not.toBeNull();
  await act(async () => setQueueHoldReason("progress-chat", undefined));
  await act(async () => root.unmount());
});
