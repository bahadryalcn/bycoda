// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import {
  announceBackgroundFinish,
  announceSessionFinished,
  notifySession,
  saveNotificationsEnabled,
  setNotificationBatchDelay,
  setWindowFocused,
} from "./notifications";
import { updateNotificationPreferences } from "./notificationPreferences";
import { newSession, type Block } from "../../sessions/model/session";
import { saveNotificationEvent } from "./notificationEvents";

const { invoke, play } = vi.hoisted(() => ({ invoke: vi.fn(), play: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../../settings/model/bycodaSoundEngine", () => ({
  play,
  setEnabled: vi.fn(),
  setVolume: vi.fn(),
}));
beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  play.mockClear();
  invoke.mockResolvedValue(undefined);
  saveNotificationsEnabled(true);
  setWindowFocused(false);
  setNotificationBatchDelay(0);
});

it("returns false without a banner or sound for a non-project path", async () => {
  const sent = await notifySession(newSession("claude", "/"), "finished", false);

  expect(sent).toBe(false);
  expect(invoke.mock.calls.filter(([command]) => command === "show_notification")).toEqual([]);
  expect(play).not.toHaveBeenCalled();
});

it("finishes without a banner or sound for a non-project path", async () => {
  await expect(announceSessionFinished(newSession("claude", "/"), false)).resolves.toBeUndefined();

  expect(invoke.mock.calls.filter(([command]) => command === "show_notification")).toEqual([]);
  expect(play).not.toHaveBeenCalled();
});

it("blocks every project banner, including approvals and questions, while muted", async () => {
  updateNotificationPreferences(["local:/private"], {
    mutedUntil: null,
  });
  const session = newSession("claude", "/private");
  expect(await notifySession(session, "finished", false)).toBe(false);
  expect(await notifySession(session, { kind: "approval", requestId: 1 }, false)).toBe(false);
  expect(await notifySession(session, { kind: "question", requestId: 2 }, false)).toBe(false);
  expect(invoke.mock.calls.filter(([command]) => command === "show_notification")).toEqual([]);
});

it("does not deliver an input event observed during a mute after expiry", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  try {
    updateNotificationPreferences(["local:/private"], {
      mutedUntil: 2000,
    });
    const sent = notifySession(
      newSession("claude", "/private"),
      { kind: "question", requestId: 1 },
      false,
    );
    vi.setSystemTime(3000);
    expect(await sent).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

function banners() {
  return invoke.mock.calls
    .filter(([command]) => command === "show_notification")
    .map(([, args]) => args as { title: string; body: string });
}

function turn(...blocks: Block[]) {
  const session = newSession("claude", "/work/app");
  session.id = "s1";
  session.blocks = [{ id: "u1", role: "user", text: "go" }, ...blocks];
  return session;
}

it("announces a failed turn as a failure, not a finish", async () => {
  await announceSessionFinished(
    turn({ id: "e", role: "system", text: "Out of credits", notice: "error" }),
    false,
  );
  expect(banners()).toEqual([
    expect.objectContaining({ title: "Failed · app", body: "Out of credits" }),
  ]);
  expect(play).not.toHaveBeenCalled();
});

it("stays quiet when the user stopped the turn", async () => {
  await announceSessionFinished(
    turn({ id: "i", role: "system", text: "Interrupted", notice: "interrupt" }),
    false,
  );
  expect(banners()).toEqual([]);
});

it("announces a background-only finish once, not again at the turn end", async () => {
  const session = turn({ id: "a", role: "assistant", text: "Server is up." });
  await announceBackgroundFinish(session, false);
  await announceBackgroundFinish(session, false);
  await announceSessionFinished(session, false);
  expect(banners()).toEqual([
    expect.objectContaining({ title: "Finished · app", body: "Server is up." }),
  ]);
  // The next turn is announced again.
  const next = turn({ id: "a2", role: "assistant", text: "Again." });
  next.blocks[0] = { id: "u2", role: "user", text: "more" };
  await announceSessionFinished(next, false);
  expect(banners()).toHaveLength(2);
});

it("announces a failure even after an early background finish", async () => {
  const session = turn({ id: "a", role: "assistant", text: "Up." });
  // Issue announcements are deduplicated per session turn across the module.
  session.id = "s-early-failure";
  await announceBackgroundFinish(session, false);
  await announceSessionFinished(
    {
      ...session,
      blocks: [...session.blocks, { id: "e", role: "system", text: "Crashed", notice: "error" }],
    },
    false,
  );
  expect(banners().map((banner) => banner.title)).toEqual(["Finished · app", "Failed · app"]);
});

it("honours the per-event toggles", async () => {
  saveNotificationEvent("finished", false);
  await announceSessionFinished(turn({ id: "a", role: "assistant", text: "Done." }), false);
  expect(banners()).toEqual([]);
  saveNotificationEvent("failed", false);
  await announceSessionFinished(
    turn({ id: "e", role: "system", text: "x", notice: "error" }),
    false,
  );
  expect(banners()).toEqual([]);
});

it("coalesces a burst of finishing sessions into one banner", async () => {
  setNotificationBatchDelay(20);
  const a = turn({ id: "a", role: "assistant", text: "A done." });
  const b = {
    ...turn({ id: "b", role: "assistant", text: "B done." }),
    id: "s2",
  };
  await Promise.all([announceSessionFinished(a, false), announceSessionFinished(b, false)]);
  expect(banners()).toEqual([expect.objectContaining({ title: "2 sessions finished" })]);
});
