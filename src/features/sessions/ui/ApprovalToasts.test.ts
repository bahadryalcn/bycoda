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
      blocks: [],
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

it("opens the session when clicking the request body or provider label", () => {
  act(() => render([notice("work", "question")]));
  act(() => (document.querySelector(".notification-request-preview") as HTMLElement).click());
  expect(onFocusSession).toHaveBeenCalledWith("work");
  expect(visibleRequests()).toHaveLength(0);
  act(() => button("Notifications").click());
  act(() =>
    (document.querySelector(".notification-request-footer .truncate") as HTMLElement).click(),
  );
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
  act(() => button("Notification settings…").click());
  act(() => button("Hide all popups").click());
  act(() => button("Close").click());
  expect(visibleRequests()).toHaveLength(0);
  act(() => button("Notifications").click());
  expect(visibleRequests()).toHaveLength(20);
});

it("persists the popup switch while keeping requests accessible", () => {
  act(() => render([notice("work", "question")]));
  act(() => button("Notifications").click());
  act(() => button("Notification settings…").click());
  act(() => button("Show request popups").click());
  expect(localStorage.getItem("bycoda.notifications.agentInput.popups.v1")).toBe("false");
  act(() => button("Close").click());
  act(() => render([notice("work", "question", 2)]));
  expect(visibleRequests()).toHaveLength(0);
  act(() => button("Notifications").click());
  expect(visibleRequests()).toHaveLength(1);
  act(() => button("Notification settings…").click());
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

it("keeps expired requests in history without approval controls and can clear them", () => {
  act(() => render([notice("work")]));
  act(() => render([]));
  act(() => button("Notifications").click());
  const historyTab = document.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!;
  act(() => historyTab.click());
  expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain("Request work");
  expect(document.querySelector('[role="tabpanel"] button')).toBeNull();
  expect(JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY)!)).toHaveLength(1);
  act(() => button("Notification settings…").click());
  act(() => button("Clear notification history").click());
  expect(document.body.textContent).toContain("No notification history");
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
  const details = document.querySelector<HTMLDetailsElement>(".notification-history-details")!;
  expect(details.querySelector("summary")?.textContent).toContain("work");
  act(() => details.querySelector("summary")!.click());
  expect(details.open).toBe(true);
  expect(details.querySelector(".notification-history-label")?.textContent).toBe("Request work");
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
    [...document.querySelectorAll(".notification-project-path")].map((node) =>
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
  expect(onApproval).toHaveBeenCalledWith("work", 1, "allow");
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
