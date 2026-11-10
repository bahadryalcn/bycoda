// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import { sessionsNeedingAttention, taskbarAttention } from "./attention";
import { attentionRulesFor } from "./attentionRules";
import { pendingApprovalNotices } from "./approvalToast";
import { saveNotificationEvent } from "./notificationEvents";
import { updateNotificationPreferences } from "./notificationPreferences";
import { rememberNotificationProjects } from "./notificationProjects";
import { saveNotificationsEnabled } from "./notifications";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => "granted"),
}));

const asking: Session = {
  ...newSession("claude", "/work/app"),
  id: "ask",
  blocks: [{ id: "p", role: "approval", text: "Run", approval: { requestId: 1 } }],
};
const worker = { ...asking, id: "worker", orchestrationLeadId: "lead" };

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  rememberNotificationProjects([
    { id: "app", name: "app", detail: "", kind: "local", paths: ["/work/app"] },
  ]);
  saveNotificationsEnabled(true);
});
afterEach(() => vi.unstubAllGlobals());

const input = (surface: "taskbar" | "dock", sessions = [asking]) =>
  sessionsNeedingAttention(sessions, new Set(), attentionRulesFor(surface)).input.length;

it("counts the same sessions on the taskbar, the Dock and the request center", () => {
  const sessions = [asking, worker];
  expect(input("dock", sessions)).toBe(2);
  expect(input("taskbar", sessions)).toBe(2);
  expect(pendingApprovalNotices(sessions)).toHaveLength(2);
  expect(
    taskbarAttention(sessions, new Set(), undefined, false, attentionRulesFor("taskbar")).count,
  ).toBe(2);
});

it("zeroes the Dock badge with the master switch off", () => {
  saveNotificationsEnabled(false);
  expect(input("dock")).toBe(0);
});

it("zeroes the Dock badge when input events are off", () => {
  saveNotificationEvent("input", false);
  expect(input("dock")).toBe(0);
});

it("zeroes the Dock badge for a project that mutes agent input", () => {
  updateNotificationPreferences(["app"], { disabled: ["agentInput"] });
  expect(input("dock")).toBe(0);
  // The request center stays complete so the request remains answerable.
  expect(pendingApprovalNotices([asking])).toHaveLength(1);
});

it("keeps the Dock free of unseen finishes but the taskbar counts them", () => {
  const done = { ...newSession("claude", "/work/app"), id: "done" };
  const unseen = new Set(["done"]);
  expect(sessionsNeedingAttention([done], unseen, attentionRulesFor("dock")).unseen).toEqual([]);
  expect(sessionsNeedingAttention([done], unseen, attentionRulesFor("taskbar")).unseen).toEqual([
    done,
  ]);
});
