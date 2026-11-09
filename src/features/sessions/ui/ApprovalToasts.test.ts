// @vitest-environment happy-dom
import { act, createElement, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { updateNotificationPreferences } from "../../notifications/model/notificationPreferences";
import { ApprovalToasts } from "./ApprovalToasts";
import { NOTIFICATION_HISTORY_KEY } from "../../notifications/model/notificationHistory";
import * as groupLock from "../../group-lock/hooks/useGroupLock";
import { pathKey } from "../../../shared/lib/paths";
import { rememberNotificationProjects } from "../../notifications/model/notificationProjects";
import { saveTabGroupLabel } from "../../workspace/model/tabGroups";

type Notice = ComponentProps<typeof ApprovalToasts>["notices"][number];
function notice(id: string, kind: Notice["kind"] = "approval", requestId = 1): Notice {
  return {
    sessionId: id,
    requestId,
    label: `Request ${id}`,
    kind,
    session: {
      id,
      cwd: `/projects/${id}`,
      title: id,
      harness: "codex",
      model: "",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks:
        kind === "approval"
          ? [
              {
                id: `approval-${id}-${requestId}`,
                role: "approval",
                text: `Request ${id}`,
                approval: { requestId },
              },
            ]
          : [],
    },
  };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  onApproval.mockClear();
  onFocusSession.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const onApproval = vi.fn();
const onFocusSession = vi.fn();
function render(notices: Notice[]) {
  root.render(createElement(ApprovalToasts, { notices, onApproval, onFocusSession }));
}

it("retains arrivals from two mounted histories before sibling storage events are delivered", () => {
  const siblingNode = document.createElement("div");
  document.body.append(siblingNode);
  const sibling = createRoot(siblingNode);
  try {
    act(() => render([]));
    act(() =>
      sibling.render(createElement(ApprovalToasts, { notices: [], onApproval, onFocusSession })),
    );
    act(() => render([notice("first")]));
    act(() =>
      sibling.render(
        createElement(ApprovalToasts, { notices: [notice("second")], onApproval, onFocusSession }),
      ),
    );
    const saved = JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY)!);
    expect(saved.map((entry: { sessionId: string }) => entry.sessionId).sort()).toEqual([
      "first",
      "second",
    ]);
    expect(document.querySelectorAll(".approval-toast")).toHaveLength(2);
    expect(onApproval).not.toHaveBeenCalled();
  } finally {
    act(() => sibling.unmount());
    siblingNode.remove();
  }
});

it("records one StrictMode arrival, retains reused request occurrences and falls back locally when storage fails", async () => {
  const strictRender = (notices: Notice[]) =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(ApprovalToasts, { notices, onApproval, onFocusSession }),
      ),
    );
  await act(async () => strictRender([notice("work", "question")]));
  expect(JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY)!)).toHaveLength(1);
  await act(async () => strictRender([]));
  await act(async () => strictRender([notice("work", "question")]));
  expect(JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY)!)).toHaveLength(2);
  const original = localStorage.setItem.bind(localStorage);
  const write = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (key === NOTIFICATION_HISTORY_KEY) throw new Error("Storage unavailable");
    original(key, value);
  });
  try {
    await act(async () => strictRender([notice("work", "question"), notice("second")]));
    await act(async () => strictRender([]));
    act(() => button("Notifications").click());
    act(() => document.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!.click());
    expect(document.querySelectorAll('[role="tabpanel"] article')).toHaveLength(3);
    expect(JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY)!)).toHaveLength(2);
    expect(onApproval).not.toHaveBeenCalled();
  } finally {
    write.mockRestore();
  }
});

it("updates project names in open popups and history when the rail label changes", () => {
  act(() => render([notice("work", "question")]));
  act(() => saveTabGroupLabel(pathKey("/projects/work"), "bycoda"));
  expect(document.querySelector(".notification-project-name")?.textContent).toBe("bycoda");
  act(() => button("Notifications").click());
  act(() => render([]));
  act(() => document.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!.click());
  expect(document.querySelector('[role="tabpanel"] .notification-project-name')?.textContent).toBe(
    "bycoda",
  );
  act(() => saveTabGroupLabel(pathKey("/projects/work"), "New name"));
  expect(document.querySelector('[role="tabpanel"] .notification-project-name')?.textContent).toBe(
    "New name",
  );
});
function visibleRequests() {
  return [...document.querySelectorAll(".approval-toast")].map((item) => item.textContent);
}

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.getAttribute("aria-label") === label || item.textContent === label,
  )!;
}

it("opens the session from the request body or the Answer action", () => {
  act(() => render([notice("work", "question")]));
  act(() => (document.querySelector(".notification-request-preview") as HTMLElement).click());
  expect(onFocusSession).toHaveBeenCalledWith("work");
  expect(visibleRequests()).toHaveLength(0);
  act(() => button("Notifications").click());
  act(() => button("Answer").click());
  expect(onFocusSession).toHaveBeenCalledTimes(2);
  expect(onApproval).not.toHaveBeenCalled();
});

it("dismisses a popup without resolving it and retrieves it from the center", () => {
  act(() => render([notice("work", "question")]));
  act(() => button("Dismiss notice").click());
  expect(visibleRequests()).toHaveLength(0);
  expect(onApproval).not.toHaveBeenCalled();
  expect(onFocusSession).not.toHaveBeenCalled();
  expect(button("Notifications").textContent).toBe("1");
  act(() => button("Notifications").click());
  expect(visibleRequests()[0]).toContain("Request work");
  act(() => render([]));
  expect(visibleRequests()).toHaveLength(0);
  expect(document.body.textContent).toContain("No pending requests");
});

it("limits a backlog of twenty requests to three popups and lists all in the center", () => {
  act(() => render(Array.from({ length: 20 }, (_, i) => notice(`work-${i}`, "question"))));
  expect(visibleRequests()).toHaveLength(3);
  expect(button("Notifications").textContent).toBe("20");
  act(() => button("View all pending requests (20)").click());
  expect(visibleRequests()).toHaveLength(20);
  act(() => button("Notification options").click());
  act(() => button("Hide all popups").click());
  act(() => button("Close").click());
  expect(visibleRequests()).toHaveLength(0);
  act(() => button("Notifications").click());
  expect(visibleRequests()).toHaveLength(20);
});

it("persists the popup switch while keeping requests accessible", () => {
  act(() => render([notice("work", "question")]));
  act(() => button("Notifications").click());
  act(() => button("Notification options").click());
  act(() => button("Show request popups").click());
  expect(localStorage.getItem("bycoda.notifications.agentInput.popups.v1")).toBe("false");
  act(() => button("Close").click());
  act(() => render([notice("work", "question", 2)]));
  expect(visibleRequests()).toHaveLength(0);
  act(() => button("Notifications").click());
  expect(visibleRequests()).toHaveLength(1);
  act(() => button("Notification options").click());
  act(() => button("Show request popups").click());
  act(() => button("Close").click());
  expect(visibleRequests()).toHaveLength(1);
});

it("auto-hides an unanswered popup but keeps it in the notification center", () => {
  vi.useFakeTimers();
  act(() => render([notice("work", "question")]));
  act(() => vi.advanceTimersByTime(12_000));
  expect(visibleRequests()).toHaveLength(0);
  act(() => button("Notifications").click());
  expect(visibleRequests()).toHaveLength(1);
  expect(onApproval).not.toHaveBeenCalled();
});

it("does not hide a popup while its controls have keyboard focus", () => {
  vi.useFakeTimers();
  act(() => render([notice("work")]));
  act(() => button("Allow").focus());
  act(() => vi.advanceTimersByTime(15_000));
  expect(visibleRequests()).toHaveLength(1);
  act(() => button("Allow").blur());
  act(() => vi.advanceTimersByTime(12_000));
  expect(visibleRequests()).toHaveLength(0);
  expect(onApproval).not.toHaveBeenCalled();
});

it("allows a later request to reuse a resolved request ID", () => {
  act(() => render([notice("work", "question")]));
  act(() => button("Dismiss notice").click());
  act(() => render([]));
  act(() => render([notice("work", "question")]));
  expect(visibleRequests()).toHaveLength(1);
});

it("keeps expired requests in history without approval controls and can clear them", async () => {
  act(() => render([notice("work")]));
  act(() => render([]));
  act(() => button("Notifications").click());
  const historyTab = document.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!;
  act(() => historyTab.click());
  expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain("Request work");
  expect(button("Allow")).toBeUndefined();
  expect(button("Deny")).toBeUndefined();
  expect(JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY)!)).toHaveLength(1);
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const morph = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => !item.closest("[inert]") && item.textContent?.includes(label),
    )!;
  act(() => morph("Clear all").click());
  now += 300;
  await act(async () => morph("Clear").click());
  expect(document.body.textContent).toContain("No recent requests");
  expect(JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY)!)).toEqual([]);
});

it("shows the registered project and distinguishing path in popups, pending requests and restored history", () => {
  saveTabGroupLabel(pathKey("/projects/work"), "Acme / Work");
  rememberNotificationProjects([
    {
      id: "repository:work",
      name: "Acme / Work",
      detail: "repo",
      kind: "repository",
      paths: ["/projects/work"],
    },
  ]);
  act(() => render([notice("work", "question")]));
  expect(document.querySelector(".notification-project-name")?.textContent).toBe("Acme / Work");
  expect(document.querySelector(".notification-project-path")?.textContent).toBe("/projects/work");
  act(() => button("Notifications").click());
  expect(document.querySelector('[role="tabpanel"] .notification-project-name')?.textContent).toBe(
    "Acme / Work",
  );
  act(() => render([]));
  act(() => root.unmount());
  root = createRoot(container);
  act(() => render([]));
  act(() => button("Notifications").click());
  act(() => document.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!.click());
  expect(document.querySelector('[role="tabpanel"] .notification-project-name')?.textContent).toBe(
    "Acme / Work",
  );
  const row = document.querySelector<HTMLElement>(".notification-history-item")!;
  expect(row.querySelector(".notification-history-title")?.textContent).toBe("work");
  expect(row.querySelector(".notification-history-preview")?.textContent).toBe("Request work");
  expect(onApproval).not.toHaveBeenCalled();
});

it("uses the folder name for old history without a registered project, including Windows and remote paths", () => {
  localStorage.setItem(
    NOTIFICATION_HISTORY_KEY,
    JSON.stringify([
      {
        key: "old:question:1",
        sessionId: "old",
        cwd: "G:\\Projects\\demo",
        title: "Old",
        label: "Details",
        kind: "question",
        occurredAt: 1800000000000,
      },
      {
        key: "remote:question:1",
        sessionId: "remote",
        cwd: "remote://mac/home/dev/demo",
        title: "Remote",
        label: "Details",
        kind: "question",
        occurredAt: 1800000000000,
      },
    ]),
  );
  act(() => render([]));
  act(() => button("Notifications").click());
  act(() => document.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!.click());
  expect(
    [...document.querySelectorAll(".notification-project-name")].map((node) => node.textContent),
  ).toEqual(["demo", "demo"]);
  expect(
    [...document.querySelectorAll(".notification-project")].map((node) =>
      node.getAttribute("title"),
    ),
  ).toEqual(["G:\\Projects\\demo", "remote://mac/home/dev/demo"]);
});

it("restores history after remounting and records reused request IDs separately", () => {
  act(() => render([notice("work", "question")]));
  act(() => render([]));
  act(() => render([notice("work", "question")]));
  expect(JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY)!)).toHaveLength(2);
  act(() => root.unmount());
  root = createRoot(container);
  act(() => render([]));
  act(() => button("Notifications").click());
  act(() => document.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!.click());
  expect(document.querySelectorAll('[role="tabpanel"] article')).toHaveLength(2);
  expect(document.body.textContent).toContain("Request work");
});

it("redacts historical request content when its project is locked", () => {
  const snapshot = vi.spyOn(groupLock, "useLockSnapshot").mockReturnValue({
    lockedGroupIds: new Set(),
    lockedProjectKeys: new Set(),
  });
  act(() => render([notice("work", "question")]));
  snapshot.mockReturnValue({
    lockedGroupIds: new Set(["private"]),
    lockedProjectKeys: new Set([pathKey("/projects/work")]),
  });
  act(() => render([]));
  act(() => button("Notifications").click());
  act(() => document.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!.click());
  expect(document.querySelector('[role="tabpanel"]')?.textContent).not.toContain("Request work");
});

it("keeps the focused conversation in the center without a popup", () => {
  act(() =>
    root.render(
      createElement(ApprovalToasts, {
        notices: [notice("work", "question")],
        popupNotices: [],
        onApproval,
        onFocusSession,
      }),
    ),
  );
  expect(visibleRequests()).toHaveLength(0);
  act(() => button("Notifications").click());
  expect(visibleRequests()).toHaveLength(1);
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(button("Notifications"));
});

it("hides muted project approval popups while another project's controls remain usable", async () => {
  updateNotificationPreferences(["local:/projects/private"], {
    mutedUntil: null,
  });
  act(() => render([notice("private"), notice("work")]));
  expect(visibleRequests()).toHaveLength(1);
  expect(visibleRequests()[0]).toContain("Request work");
  const allow = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "Allow",
  )!;
  act(() => allow.click());
  expect(onApproval).toHaveBeenCalledWith("work", 1, "allow", expect.any(Object));
});

it("immediately hides an existing question when its notification category is disabled", async () => {
  await act(async () => render([notice("work", "question")]));
  expect(visibleRequests()).toHaveLength(1);
  act(() =>
    updateNotificationPreferences(["local:/projects/work"], {
      disabled: ["agentInput"],
    }),
  );
  expect(visibleRequests()).toHaveLength(0);
});

it("does not replay a mounted approval after its path is resumed", async () => {
  let now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const ids = ["local:/projects/work"];
  updateNotificationPreferences(ids, {
    mutedUntil: null,
  });
  await act(async () => render([notice("work")]));
  expect(visibleRequests()).toHaveLength(0);
  now += 1000;
  act(() =>
    updateNotificationPreferences(ids, {
      mutedUntil: undefined,
    }),
  );
  expect(visibleRequests()).toHaveLength(0);
  now += 1;
  await act(async () => render([notice("work", "approval", 2)]));
  expect(visibleRequests()).toHaveLength(1);
});

it.each(["resume", "expiry", "category"] as const)(
  "does not replay a suppressed request after %s, but shows a new request",
  async (reason) => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const ids = ["local:/projects/private"];
    updateNotificationPreferences(
      ids,
      reason === "category"
        ? { disabled: ["agentInput"] }
        : { mutedUntil: reason === "expiry" ? now + 60_000 : null },
    );
    await act(async () => render([notice("private", "question")]));
    expect(visibleRequests()).toHaveLength(0);
    now += 120_000;
    act(() => {
      if (reason === "resume") updateNotificationPreferences(ids, { mutedUntil: undefined });
      else if (reason === "category") updateNotificationPreferences(ids, { disabled: [] });
      else window.dispatchEvent(new Event("focus"));
    });
    expect(visibleRequests()).toHaveLength(0);
    now += 1;
    await act(async () => render([notice("private", "question", 2)]));
    expect(visibleRequests()).toHaveLength(1);
  },
);

function renderWith(notices: Notice[], props: Partial<ComponentProps<typeof ApprovalToasts>> = {}) {
  root.render(createElement(ApprovalToasts, { notices, onApproval, onFocusSession, ...props }));
}

it("retains an uncertain approval and blocks repeated decisions after the callback rejects", async () => {
  let reject!: (error: Error) => void;
  const decide = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  await act(async () => renderWith([notice("work")], { onApproval: decide }));
  const allow = () => button("Allow") as HTMLButtonElement;
  act(() => allow().click());
  act(() => allow().click());
  expect(decide).toHaveBeenCalledTimes(1);
  expect(button("Deny").disabled).toBe(true);
  await act(async () => reject(new Error("offline")));
  expect(document.body.textContent).toContain("Waiting for confirmation");
  expect(allow().disabled).toBe(true);
  act(() => allow().click());
  expect(decide).toHaveBeenCalledTimes(1);
});

it("shows a pre-dispatch refusal without claiming delivery", async () => {
  const decide = vi.fn(async () => false);
  await act(async () => renderWith([notice("work")], { onApproval: decide }));
  await act(async () => button("Deny").click());
  expect(document.body.textContent).toContain(
    "Decision was not sent. Check the request and try again.",
  );
});

it("keeps history when the durable clear fails and offers a retry", async () => {
  act(() => render([notice("work")]));
  act(() => render([]));
  act(() => button("Notifications").click());
  act(() => document.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!.click());
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const morph = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => !item.closest("[inert]") && item.textContent?.includes(label),
    )!;
  const realSetItem = localStorage.setItem.bind(localStorage);
  const setItem = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (key === NOTIFICATION_HISTORY_KEY) throw new Error("quota");
    realSetItem(key, value);
  });
  act(() => morph("Clear all").click());
  now += 300;
  await act(async () => morph("Clear").click());
  expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain("Request work");
  expect(document.body.textContent).toContain("Request history could not be cleared");
  setItem.mockRestore();
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>('[role="tabpanel"] button')]
      .find((item) => item.textContent === "Retry")!
      .click();
  });
  expect(document.body.textContent).toContain("No recent requests");
  expect(JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY)!)).toEqual([]);
});

it("does not show unreadable history as empty", () => {
  localStorage.setItem(NOTIFICATION_HISTORY_KEY, "{broken");
  act(() => render([]));
  act(() => button("Notifications").click());
  act(() => document.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!.click());
  expect(document.body.textContent).toContain("Request history could not be read");
  expect(document.body.textContent).not.toContain("No recent requests");
});

const longNotice = (id: string): Notice => ({
  ...notice(id, "question"),
  label: `Request ${id} ${"with a long explanation ".repeat(12)}`,
});
const historyRows = () => [...document.querySelectorAll<HTMLElement>(".notification-history-item")];
const rowButton = (row: HTMLElement, label: string) =>
  [...row.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.getAttribute("aria-label") === label || item.textContent === label,
  )!;
const openHistory = () => {
  act(() => button("Notifications").click());
  act(() => document.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!.click());
};

it("keeps an expanded history entry open when newer arrivals are added", () => {
  act(() => render([longNotice("first")]));
  act(() => render([]));
  openHistory();
  const first = historyRows()[0];
  act(() => rowButton(first, "Show more").click());
  expect(first.querySelector(".notification-history-path")?.textContent).toBe("/projects/first");
  act(() => render([notice("second", "question")]));
  expect(historyRows()).toHaveLength(2);
  expect(historyRows()).toContain(first);
  expect(rowButton(first, "Show less")).toBeDefined();
  // A short request needs no toggle.
  expect(rowButton(historyRows()[0], "Show more")).toBeUndefined();
});

it("removes one history entry and keeps the others", async () => {
  act(() => render([notice("first", "question")]));
  act(() => render([notice("second", "question")]));
  act(() => render([]));
  openHistory();
  expect(historyRows()).toHaveLength(2);
  const target = historyRows().find((row) => row.textContent?.includes("Request first"))!;
  await act(async () => rowButton(target, "Remove").click());
  expect(historyRows()).toHaveLength(1);
  expect(historyRows()[0].textContent).toContain("Request second");
  const stored = JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY)!);
  expect(stored.map((entry: { sessionId: string }) => entry.sessionId)).toEqual(["second"]);
});

it("keeps a history entry and says so when its removal cannot be saved", async () => {
  act(() => render([notice("work", "question")]));
  act(() => render([]));
  openHistory();
  const realSetItem = localStorage.setItem.bind(localStorage);
  vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (key === NOTIFICATION_HISTORY_KEY) throw new Error("quota");
    realSetItem(key, value);
  });
  await act(async () => rowButton(historyRows()[0], "Remove").click());
  expect(historyRows()).toHaveLength(1);
  expect(document.body.textContent).toContain("This request could not be removed.");
});

it("marks a history entry whose request is still waiting", () => {
  act(() => render([notice("open", "question")]));
  act(() => render([notice("open", "question"), notice("gone", "question")]));
  act(() => render([notice("open", "question")]));
  openHistory();
  const waiting = historyRows().map((row) => row.textContent?.includes("Waiting for you"));
  expect(waiting).toEqual([false, true]);
});

it("opens a history conversation from its row and reports an unavailable one", async () => {
  const open = vi.fn(async () => false);
  act(() => renderWith([notice("work", "question")], { onOpenHistorySession: open }));
  act(() => renderWith([], { onOpenHistorySession: open }));
  openHistory();
  const body = () => document.querySelector<HTMLButtonElement>(".notification-request-body")!;
  await act(async () => body().click());
  expect(open).toHaveBeenCalledWith("work", "/projects/work");
  expect(document.body.textContent).toContain("This conversation is no longer available");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  open.mockResolvedValueOnce(true as never);
  await act(async () => body().click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
