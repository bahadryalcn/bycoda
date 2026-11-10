// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import { saveNotificationEvent } from "./notificationEvents";
import { readNotificationHistory, type NotificationHistoryEntry } from "./notificationHistory";
import { updateNotificationPreferences } from "./notificationPreferences";
import {
  announceSessionFinished,
  announceSessionIssue,
  notifyAssistant,
  notifyBackground,
  notifyDailySummary,
  notifyServerItem,
  pendingInputNotifications,
  saveNotificationsEnabled,
  setNotificationBatchDelay,
  setWindowFocused,
} from "./notifications";
import { pendingApprovalNotices } from "./approvalToast";

const { invoke, locked } = vi.hoisted(() => ({
  invoke: vi.fn(),
  locked: new Set<string>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../../group-lock/model/groupLock", () => ({
  isProjectLocked: (path: string) => locked.has(path),
  subscribeGroupLock: () => () => undefined,
}));

const logged = async (count: number): Promise<NotificationHistoryEntry[]> => {
  await vi.waitFor(() => expect(readNotificationHistory().length).toBeGreaterThanOrEqual(count));
  return readNotificationHistory();
};
const banners = () => invoke.mock.calls.filter(([command]) => command === "show_notification");

function finishedSession(path = "/work/app"): Session {
  const session = newSession("claude", path);
  return {
    ...session,
    title: "Fix tests",
    blocks: [
      { id: "u", role: "user", text: "go" },
      { id: "a", role: "assistant", text: "All green" },
    ],
  };
}

beforeEach(() => {
  localStorage.clear();
  locked.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(true);
  saveNotificationsEnabled(true);
  setWindowFocused(false);
  setNotificationBatchDelay(0);
});

it("records a finished turn once, with a conversation target, even when the window is focused", async () => {
  setWindowFocused(true);
  const session = finishedSession();
  await announceSessionFinished(session, false);
  const [entry, ...rest] = await logged(1);
  expect(rest).toEqual([]);
  expect(entry).toMatchObject({
    kind: "finished",
    sessionId: session.id,
    cwd: "/work/app",
    label: "All green",
  });
  expect(banners()).toEqual([]);
});

it("records a failed turn even when banners are off", async () => {
  saveNotificationsEnabled(false);
  const session = {
    ...finishedSession(),
    blocks: [
      { id: "u", role: "user" as const, text: "go" },
      { id: "e", role: "system" as const, text: "Crashed", notice: "error" as const },
    ],
  };
  await announceSessionIssue(session, "failed", false);
  const [entry] = await logged(1);
  expect(entry).toMatchObject({ kind: "failed", sessionId: session.id, label: "Crashed" });
  expect(banners()).toEqual([]);
});

it("does not record an event whose setting is off or whose project is muted", async () => {
  saveNotificationEvent("finished", false);
  await announceSessionFinished(finishedSession(), false);
  saveNotificationEvent("finished", true);
  updateNotificationPreferences(["local:/private"], { mutedUntil: null });
  await announceSessionFinished(finishedSession("/private"), false);
  await notifyBackground({ target: "tasks", kind: "failed", message: "x" }); // recorded below
  saveNotificationEvent("failed", false);
  await notifyBackground({ target: "tasks", kind: "failed", message: "off" });
  const entries = await logged(1);
  expect(entries.map((entry) => entry.title)).toEqual(["x"]);
});

it("masks a conversation in a locked group instead of recording its text", async () => {
  locked.add("/work/app");
  const session = finishedSession();
  await announceSessionFinished(session, false);
  const [entry] = await logged(1);
  expect(entry).toMatchObject({ kind: "finished", sessionId: session.id, title: "" });
  expect(JSON.stringify(entry)).not.toContain("All green");
  expect(entry.label).toBe("A session in a locked group needs attention");
});

it("records background work, the summary, account items and assistant messages with their targets", async () => {
  await notifyBackground({ target: "automations", kind: "finished", message: "Nightly ran" });
  await notifyDailySummary("3 tasks done");
  await notifyServerItem({ title: "New sign-in", body: "A new device" });
  await notifyAssistant({
    title: "Job waiting",
    body: "Needs you",
    kind: "input",
    occurredAt: 1_800_000_000_000,
  });
  const entries = await logged(4);
  expect(entries.map((entry) => [entry.kind, entry.target, entry.sessionId])).toEqual(
    expect.arrayContaining([
      ["background", "background:automations", ""],
      ["background", "background:summary", ""],
      ["account", "background:account", ""],
      ["assistant", "background:assistant", ""],
    ]),
  );
  // The same assistant event delivered again is one entry.
  await notifyAssistant({
    title: "Job waiting",
    body: "Needs you",
    kind: "input",
    occurredAt: 1_800_000_000_000,
  });
  expect(readNotificationHistory()).toHaveLength(4);
});

it("masks an assistant message that touches a locked project", async () => {
  locked.add("/work/app");
  await notifyAssistant({
    title: "Secret job",
    body: "Private text",
    kind: "finished",
    projectPath: "/work/app",
    occurredAt: Date.now(),
  });
  const [entry] = await logged(1);
  expect(JSON.stringify(entry)).not.toContain("Private");
  expect(banners()).toEqual([]);
});

it("matches the request center on which sessions wait for input", () => {
  const ask = (id: string, patch: Partial<Session> = {}): Session => ({
    ...newSession("claude", "/work/app"),
    id,
    blocks: [{ id: `b${id}`, role: "approval", text: "Run", approval: { requestId: 1 } }],
    ...patch,
  });
  const sessions = [
    ask("plain"),
    ask("worker", { orchestrationLeadId: "lead" }),
    ask("inbox", { inboxAsk: { provider: "github" } as never }),
    ask("removed", { worktreeRemoved: true }),
  ];
  const ids = [...pendingInputNotifications(sessions).values()].map((item) => item.session.id);
  expect(new Set(ids)).toEqual(new Set(pendingApprovalNotices(sessions).map((n) => n.sessionId)));
  expect(ids).toEqual(expect.arrayContaining(["plain", "worker"]));
  expect(ids).not.toContain("removed");
});
