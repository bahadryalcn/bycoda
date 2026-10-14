import { describe, expect, it, vi } from "vitest";
import {
  coalesceNotifications,
  createNotificationBatcher,
  decideNotification,
  enteredBackgroundFinish,
  flashFor,
  lastLine,
  LOCKED_NOTIFICATION_TEXT,
  maskLockedNotification,
  pruneUnseen,
  sessionPhase,
  taskbarAttention,
  turnOutcome,
  type NotificationContext,
  type NotificationPayload,
} from "./attention";
import { newSession, type Block, type Session } from "../../sessions/model/session";

function chat(blocks: Block[] = [], patch: Partial<Session> = {}): Session {
  const session = newSession("claude", "/work/app");
  return {
    ...session,
    id: patch.id ?? "s1",
    title: "claude · Fix the sidebar",
    blocks: [{ id: "u1", role: "user", text: "go" }, ...blocks],
    ...patch,
  };
}

const reply = (text: string): Block => ({ id: "a1", role: "assistant", text });
const tool = (background: boolean): Block => ({
  id: "t1",
  role: "tool",
  text: "npm run dev",
  tool: { title: "npm run dev", background },
});

const away: NotificationContext = {
  enabled: true,
  permission: "granted",
  eventEnabled: true,
  projectAllowed: true,
  windowFocused: false,
  sessionVisible: true,
};
const detail = { projectName: "app" };

describe("decideNotification", () => {
  const session = chat([reply("Fixed it.\nAll tests pass.")]);

  it("notifies with project, session title and the last reply line", () => {
    expect(decideNotification(session, "finished", detail, away)).toMatchObject({
      sessionId: "s1",
      kind: "finished",
      title: "Finished · app",
      subtitle: "Fix the sidebar",
      body: "All tests pass.",
    });
  });

  it("stays quiet only for the visible session in a focused window", () => {
    const focused = { ...away, windowFocused: true };
    expect(
      decideNotification(session, "finished", detail, {
        ...focused,
        sessionVisible: true,
      }),
    ).toBeNull();
    expect(
      decideNotification(session, "finished", detail, {
        ...focused,
        sessionVisible: false,
      }),
    ).not.toBeNull();
    expect(decideNotification(session, "finished", detail, away)).not.toBeNull();
  });

  it("respects the master switch, the event toggle, a muted project and a denied OS", () => {
    for (const patch of [
      { enabled: false },
      { eventEnabled: false },
      { projectAllowed: false },
      { permission: "denied" as const },
    ]) {
      expect(decideNotification(session, "finished", detail, { ...away, ...patch })).toBeNull();
    }
  });

  it("words approvals, questions and failures", () => {
    const approval = chat([
      {
        id: "p",
        role: "approval",
        text: "Run rm",
        tool: { title: "Run rm" },
        approval: { requestId: 4 },
      },
    ]);
    expect(decideNotification(approval, "input", { ...detail, requestId: 4 }, away)?.body).toBe(
      "Approve: Run rm",
    );
    const asking = chat([], {
      pendingQuestion: {
        requestId: 5,
        questions: [
          {
            id: "q",
            prompt: "Which database?",
            multiSelect: false,
            allowCustom: false,
            options: [],
          },
        ],
      },
    });
    expect(decideNotification(asking, "input", { ...detail, requestId: 5 }, away)).toMatchObject({
      title: "Has a question · app",
      body: "Which database?",
    });
    const limited = chat([reply("working")], {
      usageLimit: { message: "limit" } as Session["usageLimit"],
    });
    expect(decideNotification(limited, "failed", detail, away)?.title).toBe(
      "Usage limit reached · app",
    );
    const errored = chat([
      {
        id: "e",
        role: "system",
        text: "Process crashed\nstack",
        notice: "error",
      },
    ]);
    expect(decideNotification(errored, "failed", detail, away)).toMatchObject({
      title: "Failed · app",
      body: "Process crashed",
    });
  });
});

describe("turnOutcome", () => {
  it("separates finished, failed and interrupted turns", () => {
    expect(turnOutcome(chat([reply("done")]))).toBe("finished");
    expect(turnOutcome(chat([{ id: "e", role: "system", text: "boom", notice: "error" }]))).toBe(
      "failed",
    );
    expect(turnOutcome(chat([reply("You have reached your usage limit")]))).toBe("failed");
    expect(
      turnOutcome(chat([{ id: "i", role: "system", text: "stopped", notice: "interrupt" }])),
    ).toBe("interrupted");
  });

  it("ignores errors from earlier turns", () => {
    const session = chat([]);
    session.blocks = [
      { id: "u0", role: "user", text: "first" },
      { id: "e", role: "system", text: "boom", notice: "error" },
      { id: "u1", role: "user", text: "second" },
      reply("ok"),
    ];
    expect(turnOutcome(session)).toBe("finished");
  });
});

describe("state transitions", () => {
  const phase = (blocks: Block[], patch: Partial<Session>) => sessionPhase(chat(blocks, patch));

  it("derives the dock phase the notifications key off", () => {
    expect(phase([reply("x")], { busy: true })).toBe("working");
    expect(
      phase([tool(true)], {
        busy: true,
        backgroundTasks: ["dev"],
        backgroundAgents: 0,
      }),
    ).toBe("background");
    expect(phase([], { busy: true, backgroundTasks: ["a"], backgroundAgents: 1 })).toBe("waiting");
    expect(
      phase([], {
        busy: true,
        backgroundTasks: ["a"],
        backgroundAgents: undefined,
      }),
    ).toBe("waiting");
    expect(
      phase([{ id: "p", role: "approval", text: "x", approval: { requestId: 1 } }], { busy: true }),
    ).toBe("needs-input");
    expect(phase([reply("x")], { busy: false })).toBe("idle");
  });

  it("counts only entering background-only as a finish", () => {
    expect(enteredBackgroundFinish("working", "background")).toBe(true);
    expect(enteredBackgroundFinish("waiting", "background")).toBe(true);
    expect(enteredBackgroundFinish(undefined, "background")).toBe(true);
    expect(enteredBackgroundFinish("background", "background")).toBe(false);
    expect(enteredBackgroundFinish("working", "waiting")).toBe(false);
    expect(enteredBackgroundFinish("working", "needs-input")).toBe(false);
    expect(enteredBackgroundFinish("background", "idle")).toBe(false);
    expect(enteredBackgroundFinish("needs-input", "working")).toBe(false);
  });
});

describe("burst coalescing", () => {
  const item = (
    sessionId: string,
    kind: NotificationPayload["kind"],
    projectName = "app",
  ): NotificationPayload => ({
    sessionId,
    kind,
    title: `${kind} · ${projectName}`,
    subtitle: sessionId,
    body: "body",
    projectName,
    sessionTitle: `Session ${sessionId}`,
  });

  it("passes a single notification through", () => {
    const only = item("a", "finished");
    expect(coalesceNotifications([only])).toEqual(only);
  });

  it("counts sessions and opens the most urgent one", () => {
    const merged = coalesceNotifications([
      item("a", "finished", "app"),
      item("b", "finished", "site"),
      item("c", "finished", "app"),
      item("d", "finished", "api"),
    ]);
    expect(merged).toMatchObject({
      sessionId: "a",
      title: "4 sessions finished",
      subtitle: "app, site, api",
      body: "Session a · Session b · Session c · +1 more",
    });
    const mixed = coalesceNotifications([
      item("a", "finished"),
      item("b", "input"),
      item("c", "failed"),
    ]);
    expect(mixed.title).toBe("3 sessions need attention");
    expect(mixed.sessionId).toBe("b");
  });

  it("counts a session once, at its most urgent state", () => {
    const merged = coalesceNotifications([
      item("a", "finished"),
      item("a", "input"),
      item("b", "failed"),
    ]);
    expect(merged.title).toBe("2 sessions need attention");
  });

  it("delivers one notification for a burst and resolves every caller", async () => {
    vi.useFakeTimers();
    try {
      const deliver = vi.fn(async (_payload: NotificationPayload) => true);
      const batcher = createNotificationBatcher(deliver, () => 500);
      const first = batcher.enqueue(item("a", "finished"));
      const second = batcher.enqueue(item("b", "finished"));
      await vi.advanceTimersByTimeAsync(499);
      expect(deliver).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(deliver).toHaveBeenCalledTimes(1);
      expect(deliver.mock.calls[0][0].title).toBe("2 sessions finished");
      await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
      // A later event starts a new burst.
      void batcher.enqueue(item("c", "failed"));
      await vi.advanceTimersByTimeAsync(500);
      expect(deliver).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a failed delivery to every caller", async () => {
    vi.useFakeTimers();
    try {
      const batcher = createNotificationBatcher(
        async () => {
          throw new Error("no");
        },
        () => 0,
      );
      const sent = batcher.enqueue(item("a", "finished"));
      await vi.advanceTimersByTimeAsync(0);
      await expect(sent).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("taskbar attention", () => {
  const waiting = chat([{ id: "p", role: "approval", text: "x", approval: { requestId: 1 } }], {
    id: "wait",
  });
  const quiet = chat([reply("done")], { id: "quiet" });
  const allow = () => true;

  it("counts pending input and unseen finishes, excluding the viewed session", () => {
    const sessions = [waiting, quiet];
    expect(taskbarAttention(sessions, new Set(["quiet"]), undefined, false, allow)).toEqual({
      count: 2,
      hasInput: true,
    });
    expect(taskbarAttention(sessions, new Set(["quiet"]), "wait", true, allow)).toEqual({
      count: 1,
      hasInput: false,
    });
    // An unfocused window still has something to show for the active session.
    expect(taskbarAttention(sessions, new Set(), "wait", false, allow).count).toBe(1);
  });

  it("skips input from projects that do not allow it", () => {
    expect(taskbarAttention([waiting], new Set(), undefined, false, () => false)).toEqual({
      count: 0,
      hasInput: false,
    });
  });

  it("clears unseen entries once viewed or closed", () => {
    const unseen = new Set(["quiet", "gone"]);
    expect([...pruneUnseen(unseen, [quiet], "other", true)]).toEqual(["quiet"]);
    expect([...pruneUnseen(unseen, [quiet], "quiet", true)]).toEqual([]);
    expect([...pruneUnseen(unseen, [quiet], "quiet", false)]).toEqual(["quiet"]);
  });

  it("flashes only when the count grows while unfocused", () => {
    const next = { count: 2, hasInput: true };
    expect(flashFor(1, next, false)).toBe("critical");
    expect(flashFor(1, { count: 2, hasInput: false }, false)).toBe("info");
    expect(flashFor(2, next, false)).toBe("none");
    expect(flashFor(1, next, true)).toBe("none");
  });
});

describe("lastLine", () => {
  it("takes the last prose line without markers and truncates", () => {
    expect(lastLine("## Done\n- first\n- all good\n\n")).toBe("all good");
    expect(lastLine("```\ncode\n```")).toBe("code");
    expect(lastLine("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
    expect(lastLine("")).toBe("");
  });
});

describe("notifications for a locked group", () => {
  const secret: NotificationPayload = {
    sessionId: "s1",
    kind: "finished",
    title: "Finished · secret-project",
    subtitle: "Fix the secret thing",
    body: "Shipped the secret thing",
    projectName: "secret-project",
    sessionTitle: "Fix the secret thing",
  };

  it("names neither the project nor the session", () => {
    const masked = maskLockedNotification(secret);
    expect(masked.title).toBe(LOCKED_NOTIFICATION_TEXT);
    expect(JSON.stringify(masked)).not.toMatch(/secret/i);
    expect(masked.sessionId).toBe("s1");
  });

  it("stays neutral when a burst is coalesced with an open session", () => {
    const open: NotificationPayload = {
      ...secret,
      sessionId: "s2",
      title: "Finished · public",
      projectName: "public",
      sessionTitle: "Public work",
    };
    const merged = coalesceNotifications([maskLockedNotification(secret), open]);
    expect(JSON.stringify(merged)).not.toMatch(/secret/i);
  });
});
