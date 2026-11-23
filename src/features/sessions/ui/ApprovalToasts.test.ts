// @vitest-environment happy-dom
import { act, createElement, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { updateNotificationPreferences } from "../../notifications/model/notificationPreferences";
import { focusToastCard } from "../../../shared/ui/overlay";
import { ApprovalToasts } from "./ApprovalToasts";
import { NOTIFICATION_SEEN_KEY } from "../../notifications/model/notificationSeen";
import {
  NOTIFICATION_HISTORY_KEY,
  type NotificationHistoryEntry,
} from "../../notifications/model/notificationHistory";
import * as groupLock from "../../group-lock/hooks/useGroupLock";
import { pathKey } from "../../../shared/lib/paths";
import { rememberNotificationProjects } from "../../notifications/model/notificationProjects";
import { saveTabGroupLabel } from "../../workspace/model/tabGroups";
import {
  ownerApprovalsSnapshot,
  requestOwnerApproval,
  settleOwnerApproval,
} from "../../notifications/model/ownerApprovals";
import {
  cancelOwnerSecretInput,
  ownerSecretInputsSnapshot,
  requestOwnerSecretInput,
  submitOwnerSecretInput,
} from "../../notifications/model/ownerSecretInputs";

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
    expect(document.querySelectorAll(".notification-sheet-list article")).toHaveLength(3);
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
  expect(
    document.querySelector(".notification-sheet-list .notification-history-meta")?.textContent,
  ).toBe("bycoda · work");
  act(() => saveTabGroupLabel(pathKey("/projects/work"), "New name"));
  expect(
    document.querySelector(".notification-sheet-list .notification-history-meta")?.textContent,
  ).toBe("New name · work");
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

it("offers every approval popup to the keyboard shortcut and never decides one by focusing it", () => {
  act(() => render([notice("one"), notice("two")]));
  expect(focusToastCard(".notification-request")).toBe(true);
  const focused = document.activeElement as HTMLElement;
  expect(focused.closest("[data-toast-region]")).not.toBeNull();
  expect(focused.closest(".notification-request")?.textContent).toContain("Request");
  expect(focused.textContent).not.toBe("Allow");
  expect(focused.textContent).not.toBe("Deny");
  expect(focusToastCard(".notification-request")).toBe(true);
  expect(document.activeElement?.closest(".notification-request")).not.toBe(
    focused.closest(".notification-request"),
  );
  expect(onApproval).not.toHaveBeenCalled();
  act(() => render([]));
  expect(focusToastCard(".notification-request")).toBe(false);
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
  expect(document.querySelector(".notification-pending-card")).toBeNull();
  expect(document.body.textContent).not.toContain("Waiting for you");
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
  expect(document.querySelector(".notification-sheet-list")?.textContent).toContain("Request work");
  expect(button("Allow")).toBeUndefined();
  expect(button("Deny")).toBeUndefined();
  expect(document.body.textContent).not.toContain("What this app announced");
  expect(JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY)!)).toHaveLength(1);
  // Clear all lives in the options menu, not in the header.
  expect(button("Clear all")).toBeUndefined();
  act(() => button("Notification options").click());
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const morph = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => !item.closest("[inert]") && item.textContent?.includes(label),
    )!;
  act(() => morph("Clear all").click());
  now += 300;
  await act(async () => morph("Clear").click());
  expect(document.body.textContent).toContain("All clear");
  expect(JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY)!)).toEqual([]);
});

const logEntry = (patch: Partial<NotificationHistoryEntry>): NotificationHistoryEntry => ({
  key: "log",
  sessionId: "",
  cwd: "",
  title: "Nightly",
  label: "Background automation",
  kind: "background",
  occurredAt: Date.now(),
  ...patch,
});

it("marks errors and warnings with an icon and leaves calm rows unmarked", () => {
  const kinds = [
    "failed",
    "finished",
    "question",
    "approval",
    "reminder",
    "assistant",
    "background",
    "account",
  ] as const;
  localStorage.setItem(
    NOTIFICATION_HISTORY_KEY,
    JSON.stringify(
      kinds.map((kind, index) => logEntry({ key: kind, kind, occurredAt: kinds.length - index })),
    ),
  );
  act(() => renderWith([]));
  openHistory();
  expect(
    historyRows().map((row) =>
      row.querySelector(".notification-history-icon")?.getAttribute("data-tone"),
    ),
  ).toEqual(["danger", "none", "none", "none", "none", "none", "none", "none"]);
  // No kind or source label such as "Background" is shown.
  expect(document.querySelector(".notification-history-kind")).toBeNull();
});

it("lists every kind of the common log with its label and opens a background target", async () => {
  localStorage.setItem(
    NOTIFICATION_HISTORY_KEY,
    JSON.stringify([
      logEntry({ target: "background:automations", occurredAt: 3 }),
      logEntry({
        key: "done",
        kind: "finished",
        sessionId: "work",
        cwd: "/projects/work",
        title: "Fix tests",
        occurredAt: 2,
      }),
      logEntry({ key: "acct", kind: "account", target: "background:account", occurredAt: 1 }),
    ]),
  );
  const onOpenBackground = vi.fn();
  const onOpenHistorySession = vi.fn(async () => true);
  act(() => renderWith([], { onOpenBackground, onOpenHistorySession }));
  openHistory();
  const rows = historyRows();
  // The context line is the feature, or "project · session"; never a kind label.
  expect(rows.map((row) => row.querySelector(".notification-history-meta")?.textContent)).toEqual([
    "Automations",
    "work · Fix tests",
    "Account",
  ]);
  expandRow(rows[0]);
  await act(async () => rowButton(rows[0], "Open").click());
  expect(onOpenBackground).toHaveBeenCalledWith("background:automations");
  expect(onOpenHistorySession).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("shows a background row without an open action when nothing can open it", () => {
  localStorage.setItem(
    NOTIFICATION_HISTORY_KEY,
    JSON.stringify([logEntry({ target: "background:tasks" })]),
  );
  act(() => renderWith([]));
  openHistory();
  expandRow(historyRows()[0]);
  expect(rowButton(historyRows()[0], "Open")).toBeUndefined();
  expect(rowButton(historyRows()[0], "Dismiss")).toBeDefined();
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
  act(() => render([]));
  act(() => root.unmount());
  root = createRoot(container);
  act(() => render([]));
  act(() => button("Notifications").click());
  const row = document.querySelector<HTMLElement>(".notification-history-item")!;
  expect(row.querySelector(".notification-history-title")?.textContent).toContain("Request work");
  expect(row.querySelector(".notification-history-meta")?.textContent).toBe("Acme / Work · work");
  expect(onApproval).not.toHaveBeenCalled();
});

it("uses the folder name for old history without a registered project, including Windows and remote paths", async () => {
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
  expect(
    [...document.querySelectorAll(".notification-history-meta")].map((node) => node.textContent),
  ).toEqual(["demo · Old", "demo · Remote"]);
  // The full path is one expansion away, with the exact value on hover.
  const expectedPaths = ["G:\\Projects\\demo", "remote://mac/home/dev/demo"];
  for (const [index, row] of historyRows().entries()) {
    expandRow(row);
    const path = row.querySelector(".notification-history-path")!;
    await act(async () => {
      path.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    const descriptions = (path.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent);
    expect(descriptions).toContain(expectedPaths[index]);
    act(() =>
      path.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" })),
    );
  }
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
  expect(document.querySelectorAll(".notification-sheet-list article")).toHaveLength(2);
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
  expect(document.querySelector(".notification-sheet-list")?.textContent).not.toContain(
    "Request work",
  );
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
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  act(() => button("Notification options").click());
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
  expect(document.querySelector(".notification-sheet-list")?.textContent).toContain("Request work");
  expect(document.body.textContent).toContain("Notification history could not be cleared");
  setItem.mockRestore();
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>(".notification-sheet-list button")]
      .find((item) => item.textContent === "Retry")!
      .click();
  });
  expect(document.body.textContent).toContain("All clear");
  expect(JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY)!)).toEqual([]);
});

it("does not show unreadable history as empty", () => {
  localStorage.setItem(NOTIFICATION_HISTORY_KEY, "{broken");
  act(() => render([]));
  act(() => button("Notifications").click());
  expect(document.body.textContent).toContain("Notification history could not be read");
  expect(document.body.textContent).not.toContain("All clear");
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
};
const expandRow = (row: HTMLElement) =>
  act(() => row.querySelector<HTMLButtonElement>(".notification-row-toggle")!.click());

it("keeps an expanded history entry open when newer arrivals are added", () => {
  act(() => render([longNotice("first")]));
  act(() => render([]));
  openHistory();
  const first = historyRows()[0];
  expandRow(first);
  expect(first.querySelector(".notification-history-title")?.textContent).toContain(
    "long explanation",
  );
  expect(first.querySelector(".notification-history-path")?.textContent).toBe("/projects/first");
  act(() => render([notice("second", "question")]));
  expect(historyRows()).toContain(first);
  expect(first.querySelector(".notification-row-toggle")?.getAttribute("aria-expanded")).toBe(
    "true",
  );
  act(() => render([]));
  expect(historyRows()).toHaveLength(2);
  expect(historyRows()).toContain(first);
  expect(first.querySelector(".notification-history-path")).not.toBeNull();
  // The new arrival starts collapsed.
  const other = historyRows().find((row) => row !== first)!;
  expect(other.querySelector(".notification-history-path")).toBeNull();
});

it("removes one history entry and keeps the others", async () => {
  act(() => render([notice("first", "question")]));
  act(() => render([notice("second", "question")]));
  act(() => render([]));
  openHistory();
  expect(historyRows()).toHaveLength(2);
  const target = historyRows().find((row) => row.textContent?.includes("Request first"))!;
  await act(async () => rowButton(target, "Dismiss").click());
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
  const setItem = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (key === NOTIFICATION_HISTORY_KEY) throw new Error("quota");
    realSetItem(key, value);
  });
  await act(async () => rowButton(historyRows()[0], "Dismiss").click());
  expect(historyRows()).toHaveLength(1);
  expect(document.body.textContent).toContain("This notification could not be removed.");
  setItem.mockRestore();
});

it("shows a still-pending request once, in the pending card, not in Recent", () => {
  act(() => render([notice("open", "question")]));
  act(() => render([notice("open", "question"), notice("gone", "question")]));
  act(() => render([notice("open", "question")]));
  openHistory();
  const card = document.querySelector<HTMLElement>(".notification-pending-card")!;
  expect(card.textContent).toContain("Request open");
  expect(card.querySelectorAll(".approval-toast")).toHaveLength(1);
  expect(historyRows()).toHaveLength(1);
  expect(historyRows()[0].textContent).toContain("Request gone");
  expect(
    document.querySelector(".notification-sheet-list")!.textContent!.split("Request open"),
  ).toHaveLength(2);
});

it("shows pending requests in their own card above the recent rows", () => {
  act(() => render([notice("gone", "question")]));
  act(() => render([notice("open", "question")]));
  openHistory();
  const list = document.querySelector<HTMLElement>(".notification-sheet-list")!;
  const card = list.querySelector<HTMLElement>(".notification-pending-card")!;
  expect(list.textContent).toContain("Waiting for you");
  expect(list.textContent).toContain("Today");
  expect(
    card.compareDocumentPosition(historyRows()[0]) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(button("Answer")).toBeDefined();
  expect(document.querySelector('[role="tab"]')).toBeNull();
});

it("badges unread log entries on the trigger until they are marked read", () => {
  localStorage.setItem(NOTIFICATION_SEEN_KEY, "1000");
  localStorage.setItem(
    NOTIFICATION_HISTORY_KEY,
    JSON.stringify([
      logEntry({ key: "a", occurredAt: 2000 }),
      logEntry({ key: "b", occurredAt: 2001 }),
      logEntry({ key: "c", occurredAt: 500 }),
    ]),
  );
  act(() => render([]));
  const badge = () => button("Notifications").querySelector(".notification-trigger-count");
  expect(badge()?.textContent).toBe("2");
  expect(badge()?.getAttribute("data-tone")).toBe("accent");
  // Looking at the sheet does not mark anything read.
  act(() => button("Notifications").click());
  expect(badge()?.textContent).toBe("2");
  expect(document.body.textContent).not.toContain("2 unread");
  act(() => button("Mark all read").click());
  expect(badge()).toBeNull();
  expect(button("Mark all read")).toBeUndefined();
  expect(Number(localStorage.getItem(NOTIFICATION_SEEN_KEY))).toBeGreaterThan(2001);
});

it("marks one row read from its hover action and keeps the others unread", async () => {
  localStorage.setItem(NOTIFICATION_SEEN_KEY, "1000");
  localStorage.setItem(
    NOTIFICATION_HISTORY_KEY,
    JSON.stringify([
      logEntry({ key: "a", title: "First", occurredAt: 2001 }),
      logEntry({ key: "b", title: "Second", occurredAt: 2000 }),
    ]),
  );
  act(() => render([]));
  openHistory();
  const first = historyRows()[0];
  expect(first.getAttribute("data-unread")).toBe("true");
  await act(async () => rowButton(first, "Mark read").click());
  expect(historyRows()[0].getAttribute("data-unread")).toBeNull();
  expect(historyRows()[1].getAttribute("data-unread")).toBe("true");
  expect(button("Notifications").querySelector(".notification-trigger-count")?.textContent).toBe(
    "1",
  );
  expect(JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY)!)[0].read).toBe(true);
});

it("shows a repeated notification as one counted row whose expansion lists each time", () => {
  localStorage.setItem(NOTIFICATION_SEEN_KEY, "1000");
  localStorage.setItem(
    NOTIFICATION_HISTORY_KEY,
    JSON.stringify([
      logEntry({
        key: "q5",
        kind: "failed",
        title: "Could not load queued messages",
        label: "",
        count: 5,
        occurredAt: 5000,
        earlier: [4000, 3000, 2000, 1500],
      }),
    ]),
  );
  act(() => render([]));
  openHistory();
  expect(historyRows()).toHaveLength(1);
  expect(historyRows()[0].querySelector(".notification-history-count")?.textContent).toBe("×5");
  expect(historyRows()[0].querySelector(".notification-history-arrivals")).toBeNull();
  expandRow(historyRows()[0]);
  expect(historyRows()[0].querySelectorAll(".notification-history-arrivals li")).toHaveLength(5);
});

it("groups rows under Today and Earlier and shows one calm line when empty", () => {
  const dayMs = 24 * 60 * 60 * 1000;
  localStorage.setItem(NOTIFICATION_SEEN_KEY, String(Date.now()));
  localStorage.setItem(
    NOTIFICATION_HISTORY_KEY,
    JSON.stringify([
      logEntry({ key: "now", title: "Now", occurredAt: Date.now() }),
      logEntry({ key: "old", title: "Old", occurredAt: Date.now() - 3 * dayMs }),
    ]),
  );
  act(() => render([]));
  openHistory();
  const text = document.querySelector(".notification-sheet-list")!.textContent!;
  expect(text.indexOf("Today")).toBeLessThan(text.indexOf("Now"));
  expect(text.indexOf("Now")).toBeLessThan(text.indexOf("Earlier"));
  expect(text.indexOf("Earlier")).toBeLessThan(text.indexOf("Old"));
});

it("adds waiting requests to the new count and uses the warning tone", () => {
  localStorage.setItem(NOTIFICATION_SEEN_KEY, "1000");
  localStorage.setItem(NOTIFICATION_HISTORY_KEY, JSON.stringify([logEntry({ occurredAt: 2000 })]));
  act(() => render([notice("work", "question")]));
  const badge = button("Notifications").querySelector(".notification-trigger-count");
  expect(badge?.textContent).toBe("2");
  expect(badge?.getAttribute("data-tone")).toBe("warning");
});

it("marks a row that arrived after the last look as new while the sheet is open", () => {
  localStorage.setItem(NOTIFICATION_SEEN_KEY, "1500");
  localStorage.setItem(
    NOTIFICATION_HISTORY_KEY,
    JSON.stringify([
      logEntry({ key: "fresh", title: "Fresh", occurredAt: 2000 }),
      logEntry({ key: "stale", title: "Stale", occurredAt: 1000 }),
    ]),
  );
  act(() => render([]));
  openHistory();
  const row = (title: string) => historyRows().find((item) => item.textContent?.includes(title))!;
  expect(row("Fresh").getAttribute("data-unread")).toBe("true");
  expect(row("Fresh").textContent).toContain("Unread");
  expect(row("Stale").getAttribute("data-unread")).toBeNull();
  expect(button("Notifications").querySelector(".notification-trigger-count")?.textContent).toBe(
    "1",
  );
});

it("opens a history conversation from its row and reports an unavailable one", async () => {
  const open = vi.fn(async () => false);
  act(() => renderWith([notice("work", "question")], { onOpenHistorySession: open }));
  act(() => renderWith([], { onOpenHistorySession: open }));
  openHistory();
  expandRow(historyRows()[0]);
  const body = () => rowButton(historyRows()[0], "Open session");
  await act(async () => body().click());
  expect(open).toHaveBeenCalledWith("work", "/projects/work");
  expect(document.body.textContent).toContain("This conversation is no longer available");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  open.mockResolvedValueOnce(true as never);
  await act(async () => body().click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

const OWNER_SECRET = "synthetic-owner-typed-secret";
function ownerApproval(id: string, sessionId?: string) {
  const promise = requestOwnerApproval({
    id,
    sessionId,
    input: {
      title: `Approve ${id}`,
      message: "Private details of the operation",
      confirmLabel: "Run",
      cancelLabel: "Cancel",
      deadline: Date.now() + 90_000,
    },
  });
  promise.catch(() => undefined);
  return promise;
}
function ownerSecret(id: string, sessionId?: string) {
  const promise = requestOwnerSecretInput({
    id,
    sessionId,
    input: {
      title: `Secret ${id}`,
      message: "Which token",
      fieldLabel: "TOKEN",
      confirmLabel: "Save",
      cancelLabel: "Cancel",
      deadline: Date.now() + 90_000,
    },
  });
  return promise;
}
const ownerOutcomes = () =>
  (JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY) ?? "[]") as NotificationHistoryEntry[])
    .filter((entry) => entry.kind === "owner")
    .map((entry) => `${entry.title}:${entry.label}`);
afterEach(() => {
  act(() => {
    for (const request of ownerApprovalsSnapshot()) settleOwnerApproval(request.id, false);
    for (const request of ownerSecretInputsSnapshot()) cancelOwnerSecretInput(request.id);
  });
});

it("lists a live owner approval in the pending card with its time left and counts it", () => {
  act(() => render([]));
  act(() => void ownerApproval("p1"));
  expect(button("Notifications").querySelector(".notification-trigger-count")?.textContent).toBe(
    "1",
  );
  openHistory();
  const card = document.querySelector<HTMLElement>(".notification-pending-card")!;
  expect(card.textContent).toContain("Approve p1");
  expect(card.textContent).toContain("1:30 left");
  expect(card.textContent).not.toContain("Private details");
  // The count lives once, on the trigger badge; the section label only names the group.
  expect(document.querySelector(".notification-section-label")?.textContent).toBe("Waiting for you");
});

it("opens the owner request's conversation, or only closes the sheet without one", () => {
  act(() => render([]));
  act(() => void ownerApproval("with-session", "s-owner"));
  act(() => void ownerApproval("no-session"));
  openHistory();
  act(() => button("Approve with-session")?.click());
  expect(onFocusSession).toHaveBeenCalledWith("s-owner");
  expect(document.querySelector('[data-sheet-side="end"]')).toBeNull();
  onFocusSession.mockClear();
  openHistory();
  act(() => button("Approve no-session").click());
  expect(onFocusSession).not.toHaveBeenCalled();
  expect(document.querySelector('[data-sheet-side="end"]')).toBeNull();
});

it("never shows or stores a secret value, only its title and outcome", async () => {
  act(() => render([]));
  const answer = ownerSecret("sec-1");
  act(() => void answer);
  openHistory();
  expect(document.querySelector(".notification-pending-card")!.textContent).toContain(
    "Secret sec-1",
  );
  await act(async () => void submitOwnerSecretInput("sec-1", OWNER_SECRET));
  expect(await answer).toBe(OWNER_SECRET);
  expect(document.body.innerHTML).not.toContain(OWNER_SECRET);
  expect(JSON.stringify({ ...localStorage })).not.toContain(OWNER_SECRET);
  expect(ownerOutcomes()).toEqual(["Secret sec-1:Submitted"]);
});

it("records each owner outcome once: approved, denied, expired and an expired secret", async () => {
  act(() => render([]));
  const approved = ownerApproval("o-yes");
  const denied = ownerApproval("o-no");
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const late = ownerApproval("o-late");
  const secret = ownerSecret("o-secret");
  act(() => {
    settleOwnerApproval("o-yes", true);
    settleOwnerApproval("o-yes", false);
    settleOwnerApproval("o-no", false);
  });
  await Promise.all([approved, denied]);
  await act(async () => void vi.advanceTimersByTime(91_000));
  await late.catch(() => undefined);
  expect(await secret).toBeNull();
  expect(ownerOutcomes().sort()).toEqual([
    "Approve o-late:Expired",
    "Approve o-no:Denied",
    "Approve o-yes:Approved",
    "Secret o-secret:Expired",
  ]);
  expect(ownerApprovalsSnapshot()).toHaveLength(0);
});
