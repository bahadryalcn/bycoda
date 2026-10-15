// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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

it("announces retry and failure once each even for the visible chat", async () => {
  const working = { ...session({ busy: true }), id: "retry-warning" };
  setWindowFocused(true);
  await render([working], working.id);
  const retry = { ...working, retryMessage: "Reconnecting... 1/5" };
  await render([retry], working.id);
  await render([{ ...retry, retryMessage: "Reconnecting... 2/5" }], working.id);
  expect(calls("show_notification")).toHaveLength(1);
  expect(calls("show_notification")[0]).toMatchObject({
    title: "Retrying · app",
    body: "Reconnecting... 1/5",
  });
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
  await render([failed], working.id);
  await render([{ ...failed, title: "renamed" }], working.id);
  expect(calls("show_notification")).toHaveLength(2);
  expect(calls("show_notification")[1]).toMatchObject({
    title: "Failed · app",
    body: "Connection failed",
  });
});
