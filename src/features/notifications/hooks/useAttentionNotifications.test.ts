// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveNotificationEvent } from "../model/notificationEvents";
import {
  probeNotificationPermission,
  replaceUnseenAttention,
  saveNotificationsEnabled,
  setNotificationBatchDelay,
  setWindowFocused,
} from "../model/notifications";
import { newSession, type Session } from "../../sessions/model/session";
import { useAttentionNotifications } from "./useAttentionNotifications";

const invoke = vi.hoisted(() =>
  vi.fn(async (command: string) => {
    if (command === "notification_permission") return "granted";
  }),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function Harness({ sessions, activeSessionId }: { sessions: Session[]; activeSessionId?: string }) {
  useAttentionNotifications(sessions, activeSessionId);
  return null;
}

const calls = (command: string) =>
  invoke.mock.calls
    .filter(([name]) => name === command)
    .map(([, args]) => args as Record<string, unknown>);

let root: Root;
let container: HTMLDivElement;

async function render(sessions: Session[], activeSessionId?: string) {
  await act(async () => root.render(createElement(Harness, { sessions, activeSessionId })));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  });
  invoke.mockClear();
  saveNotificationsEnabled(true);
  setWindowFocused(false);
  setNotificationBatchDelay(0);
  replaceUnseenAttention(new Set());
  await probeNotificationPermission();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function session(patch: Partial<Session>): Session {
  return {
    ...newSession("claude", "/work/app"),
    id: "s1",
    blocks: [
      { id: "u1", role: "user", text: "go" },
      { id: "a1", role: "assistant", text: "Server is up." },
    ],
    ...patch,
  };
}

it("announces an agent that finished while background commands keep running", async () => {
  const working = session({ busy: true });
  await render([working]);
  expect(calls("show_notification")).toEqual([]);

  // Yielding to a subagent is not a finish.
  const waiting = {
    ...working,
    backgroundTasks: ["agent"],
    backgroundAgents: 1,
  };
  await render([waiting]);
  expect(calls("show_notification")).toEqual([]);

  const background = {
    ...working,
    backgroundTasks: ["dev server"],
    backgroundAgents: 0,
  };
  await render([background]);
  expect(calls("show_notification")).toEqual([
    expect.objectContaining({
      sessionId: "s1",
      title: "Finished · app",
      body: "Server is up.",
    }),
  ]);
  // More renders while it stays in that state say nothing new.
  await render([{ ...background }]);
  expect(calls("show_notification")).toHaveLength(1);
});

it("badges the taskbar for a session that needs input and clears it once viewed", async () => {
  const asking = session({
    busy: true,
    blocks: [
      { id: "u1", role: "user", text: "go" },
      { id: "p", role: "approval", text: "Run it", approval: { requestId: 1 } },
    ],
  });
  await render([asking], "other");
  expect(calls("set_taskbar_attention").at(-1)).toEqual({
    count: 1,
    flash: "critical",
  });

  // Looking at it in a focused window clears the badge.
  await act(async () => setWindowFocused(true));
  await render([asking], "s1");
  expect(calls("set_taskbar_attention").at(-1)).toMatchObject({ count: 0 });
});

it("leaves the taskbar alone when the taskbar setting is off", async () => {
  localStorage.setItem("bycoda.notifications.events.v1", JSON.stringify({ taskbar: false }));
  await render(
    [
      session({
        busy: true,
        blocks: [
          {
            id: "p",
            role: "approval",
            text: "Run it",
            approval: { requestId: 1 },
          },
        ],
      }),
    ],
    "other",
  );
  expect(calls("set_taskbar_attention")).toEqual([]);
});

it.each([
  [true, true],
  [true, false],
  [false, true],
])("routes retry and failure by app focus (focused: %s, visible: %s)", async (focused, visible) => {
  const working = { ...session({ busy: true }), id: `retry-warning-${focused}-${visible}` };
  setWindowFocused(focused);
  const activeId = visible ? working.id : "another-chat";
  await render([working], activeId);
  const retry = { ...working, retryMessage: "Reconnecting... 1/5" };
  await render([retry], activeId);
  await render([{ ...retry, retryMessage: "Reconnecting... 2/5" }], activeId);
  expect(calls("show_notification")).toEqual(
    focused
      ? []
      : [
          expect.objectContaining({
            title: "Retrying · app",
            body: "Reconnecting... 1/5",
          }),
        ],
  );
  const failed = {
    ...working,
    busy: false,
    blocks: [
      ...working.blocks,
      {
        id: "failure",
        role: "system" as const,
        notice: "error" as const,
        text: "Connection failed",
      },
    ],
  };
  await render([failed], activeId);
  await render([{ ...failed, title: "renamed" }], activeId);
  expect(calls("show_notification")).toEqual(
    focused
      ? []
      : [
          expect.objectContaining({ title: "Retrying · app", body: "Reconnecting... 1/5" }),
          expect.objectContaining({ title: "Failed · app", body: "Connection failed" }),
        ],
  );
});

const askingSession = () =>
  session({
    busy: true,
    blocks: [
      { id: "u1", role: "user", text: "go" },
      { id: "p", role: "approval", text: "Run it", approval: { requestId: 1 } },
    ],
  });

it("clears stale taskbar attention when the taskbar preference changes without a session update", async () => {
  await render([askingSession()], "other");
  expect(calls("set_taskbar_attention").at(-1)).toEqual({ count: 1, flash: "critical" });

  await act(async () => {
    saveNotificationEvent("taskbar", false);
  });
  expect(calls("set_taskbar_attention").at(-1)).toMatchObject({ count: 0 });

  await act(async () => {
    saveNotificationsEnabled(false);
  });
  await act(async () => {
    saveNotificationEvent("taskbar", true);
  });
  // Desktop notifications are off, so re-enabling the taskbar flag shows nothing.
  expect(calls("set_taskbar_attention").at(-1)).toMatchObject({ count: 0 });
});

it("resends an unchanged taskbar count after the native call failed", async () => {
  let failNext = true;
  invoke.mockImplementation(async (command: string) => {
    if (command === "set_taskbar_attention" && failNext) {
      failNext = false;
      throw new Error("taskbar unavailable");
    }
    if (command === "notification_permission") return "granted";
  });
  try {
    const asking = askingSession();
    await render([asking], "other");
    expect(calls("set_taskbar_attention")).toHaveLength(1);

    await render([{ ...asking }], "other");
    expect(calls("set_taskbar_attention")).toHaveLength(2);
    expect(calls("set_taskbar_attention").at(-1)).toEqual({ count: 1, flash: "critical" });
  } finally {
    invoke.mockImplementation(async (command: string) => {
      if (command === "notification_permission") return "granted";
    });
  }
});
