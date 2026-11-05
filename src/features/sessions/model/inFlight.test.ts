import { describe, expect, it } from "vitest";
import { newTab } from "../../workspace/model/layout";
import {
  CONTINUE_PROMPT,
  INTERRUPT_MESSAGE,
  canAutoContinue,
  hasInFlightSessions,
  inFlightRefs,
  isInFlightSession,
  markTurnInterrupted,
  quitWhileBusyMessage,
  shouldWriteInFlightSnapshot,
  wasTurnInterrupted,
  workspaceFromResumed,
} from "./inFlight";
import { newSession, type Session } from "./session";

function chat(cwd: string, patch: Partial<Session> = {}): Session {
  const session = newSession("cursor", cwd);
  session.blocks = [{ id: "u1", role: "user", text: "hello" }];
  return { ...session, ...patch, blocks: patch.blocks ?? session.blocks };
}

describe("isInFlightSession", () => {
  it("leaves explicit local Host work running when its client detaches", () => {
    const session = chat("/tmp/local", { busy: true });
    session.hostBinding = {
      kind: "local-host",
      machineId: "local",
      environmentId: "home",
      projectId: "project",
      sessionId: session.id,
      authorityGeneration: null,
      created: true,
    };
    expect(isInFlightSession(session)).toBe(false);
    expect(inFlightRefs([session], [newTab(session.id)])).toEqual([]);
  });
  it("is true for a busy turn, a live approval, or a parked question", () => {
    expect(isInFlightSession(chat("/tmp/a"))).toBe(false);
    expect(isInFlightSession(chat("/tmp/a", { busy: true }))).toBe(true);
    expect(
      isInFlightSession(
        chat("/tmp/a", {
          blocks: [
            { id: "u1", role: "user", text: "hello" },
            {
              id: "a1",
              role: "approval",
              text: "run rm",
              approval: { requestId: 1 },
            },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      isInFlightSession(
        chat("/tmp/a", {
          pendingQuestion: {
            requestId: 4,
            questions: [
              {
                id: "q1",
                prompt: "Which file?",
                multiSelect: false,
                allowCustom: true,
                options: [{ id: "a.ts", label: "a.ts" }],
              },
            ],
          },
        }),
      ),
    ).toBe(true);
  });
});

describe("a chat on another machine", () => {
  const remote = chat("remote://env-1/home/me/app", { busy: true });

  it("is not in flight: its turn keeps running on the host when the app quits", () => {
    expect(isInFlightSession(remote)).toBe(false);
    expect(hasInFlightSessions([remote])).toBe(false);
    expect(inFlightRefs([remote], [newTab(remote.id)])).toEqual([]);
  });

  it("does not hide a local turn running beside it", () => {
    const local = chat("/tmp/a", { busy: true });
    expect(hasInFlightSessions([remote, local])).toBe(true);
    expect(
      inFlightRefs([remote, local], [newTab(remote.id), newTab(local.id)]).map(
        (ref) => ref.sessionId,
      ),
    ).toEqual([local.id]);
  });
});

describe("inFlightRefs", () => {
  it("walks open tabs first, then parked busy sessions", () => {
    const parked = chat("/tmp/parked", { busy: true });
    const openBusy = chat("/tmp/open", { busy: true });
    const idle = chat("/tmp/idle");
    const blank = newSession("cursor", "/tmp/blank");
    blank.busy = true;

    const tabs = [newTab(idle.id), newTab(openBusy.id)];
    expect(inFlightRefs([parked, openBusy, idle, blank], tabs)).toEqual([
      { sessionId: openBusy.id, cwd: "/tmp/open" },
      { sessionId: parked.id, cwd: "/tmp/parked" },
    ]);
  });

  it("skips chats that were never persisted", () => {
    const blank = newSession("cursor", "/tmp/a");
    blank.busy = true;
    expect(inFlightRefs([blank], [newTab(blank.id)])).toEqual([]);
    expect(hasInFlightSessions([blank])).toBe(true);
  });

  it("does not resume a session whose worktree was removed", () => {
    const removed = chat("/tmp/a", {
      busy: true,
      worktreeCwd: "/tmp/a-worktrees/feature",
      worktreeRemoved: true,
    });
    expect(isInFlightSession(removed)).toBe(false);
    expect(inFlightRefs([removed], [newTab(removed.id)])).toEqual([]);
  });
});

describe("markTurnInterrupted", () => {
  it("keeps legacy Stop plus quit-marker bytes without advertising interruption", () => {
    const session = chat("/tmp/a", {
      providerSessionId: "p1",
      blocks: [
        { id: "u1", role: "user", text: "hello" },
        { id: "stop", role: "system", notice: "interrupt", text: "Stopped by you." },
        { id: "quit", role: "system", notice: "interrupt", text: INTERRUPT_MESSAGE },
      ],
    });
    expect(wasTurnInterrupted(session)).toBe(false);
    expect(canAutoContinue(session)).toBe(false);
    expect(markTurnInterrupted(session).blocks).toEqual(session.blocks);
  });

  it("retains real Host interruption and a new interrupted turn after owner Stop", () => {
    const stopped = {
      id: "stop",
      role: "system" as const,
      notice: "interrupt" as const,
      text: "Stopped by you.",
    };
    const host = chat("/tmp/a", {
      blocks: [
        stopped,
        {
          id: "host",
          role: "system",
          notice: "interrupt",
          text: "Host restarted while this turn was running.",
        },
      ],
    });
    expect(wasTurnInterrupted(host)).toBe(true);
    const laterTurn = chat("/tmp/a", {
      blocks: [
        stopped,
        { id: "new", role: "user", text: "Continue" },
        { id: "quit", role: "system", notice: "interrupt", text: INTERRUPT_MESSAGE },
      ],
    });
    expect(wasTurnInterrupted(laterTurn)).toBe(true);
  });
  it.each(["Stopped by you.", "  Stopped by you.\n"])(
    "does not replace an explicit owner Stop from stale in-flight recovery: %s",
    (text) => {
      const session = chat("/tmp/a", {
        providerSessionId: "p1",
        blocks: [
          { id: "u1", role: "user", text: "hello" },
          { id: "stop", role: "system", notice: "interrupt", text },
        ],
      });
      const recovered = markTurnInterrupted(session);
      expect(recovered.blocks).toEqual(session.blocks);
      expect(wasTurnInterrupted(recovered)).toBe(false);
      expect(canAutoContinue(recovered)).toBe(false);
    },
  );
  it("seals the stream, cancels open tools, and appends a system note", () => {
    const interrupted = markTurnInterrupted(
      chat("/tmp/a", {
        busy: true,
        blocks: [
          { id: "u1", role: "user", text: "hello", startedAt: 1_000 },
          { id: "a1", role: "assistant", text: "Working", streaming: true },
          {
            id: "t1",
            role: "tool",
            text: "edit",
            streaming: true,
            tool: { status: "running", title: "edit" },
          },
          {
            id: "p1",
            role: "approval",
            text: "allow?",
            approval: { requestId: 7 },
          },
        ],
      }),
    );

    expect(interrupted.busy).toBe(false);
    expect(interrupted.blocks).toEqual([
      expect.objectContaining({
        id: "u1",
        startedAt: 1_000,
      }),
      expect.objectContaining({
        id: "a1",
        streaming: false,
        text: "Working",
      }),
      expect.objectContaining({
        id: "t1",
        streaming: false,
        tool: expect.objectContaining({ status: "cancelled" }),
      }),
      expect.objectContaining({
        role: "system",
        text: INTERRUPT_MESSAGE,
      }),
    ]);
    expect(interrupted.blocks[0].durationMs).toBeUndefined();
  });

  it("does not append the interrupt note twice for the same turn", () => {
    const once = markTurnInterrupted(chat("/tmp/a", { busy: true }));
    const twice = markTurnInterrupted(once);
    expect(twice.blocks.filter((block) => block.text === INTERRUPT_MESSAGE)).toHaveLength(1);
  });

  it("keeps recorded turn duration when recovery seals an already timed turn", () => {
    const session = chat("/tmp/a", {
      busy: true,
      blocks: [{ id: "u1", role: "user", text: "hello", startedAt: 1_000, durationMs: 250 }],
    });
    expect(markTurnInterrupted(session).blocks[0].durationMs).toBe(250);
  });

  it("appends a new note when a later turn is quit after Continue", () => {
    const first = markTurnInterrupted(chat("/tmp/a", { busy: true, providerSessionId: "p1" }));
    const continued: Session = {
      ...first,
      blocks: [
        ...first.blocks,
        { id: "c1", role: "user", text: CONTINUE_PROMPT },
        { id: "a2", role: "assistant", text: "resumed" },
        { id: "u2", role: "user", text: "edit the readme" },
        {
          id: "t2",
          role: "tool",
          text: "read",
          tool: { status: "completed", title: "read" },
        },
      ],
      busy: true,
    };
    const second = markTurnInterrupted(continued);
    expect(second.blocks.filter((block) => block.text === INTERRUPT_MESSAGE)).toHaveLength(2);
    expect(second.blocks[second.blocks.length - 1]?.text).toBe(INTERRUPT_MESSAGE);
    expect(canAutoContinue(second)).toBe(true);
  });

  it("leaves finished tools alone", () => {
    const interrupted = markTurnInterrupted(
      chat("/tmp/a", {
        busy: true,
        blocks: [
          { id: "u1", role: "user", text: "hello" },
          {
            id: "t1",
            role: "tool",
            text: "read",
            tool: { status: "completed", title: "read" },
          },
        ],
      }),
    );
    expect(interrupted.blocks[1]?.tool?.status).toBe("completed");
  });
});

describe("quitWhileBusyMessage", () => {
  it("mentions resume on reopen", () => {
    expect(quitWhileBusyMessage(1)).toContain("1 chat is still running");
    expect(quitWhileBusyMessage(3)).toContain("3 chats are still running");
  });
});

describe("workspaceFromResumed", () => {
  it("opens one tab per restored chat", () => {
    const first = chat("/tmp/a");
    const second = chat("/tmp/b");
    const workspace = workspaceFromResumed([first, second]);
    expect(workspace?.projectCwd).toBe("/tmp/a");
    expect(workspace?.sessions.map((session) => session.id)).toEqual([first.id, second.id]);
    expect(workspace?.tabs).toHaveLength(2);
    expect(workspace?.tabs[0]?.focusedId).toBe(first.id);
    expect(workspace?.activeTabId).toBe(workspace?.tabs[0]?.id);
  });

  it("returns null when there is nothing to restore", () => {
    expect(workspaceFromResumed([])).toBeNull();
  });
});

describe("canAutoContinue", () => {
  it.each(["Stopped by you.", "  Stopped by you.\n"])(
    "does not warn or auto-continue an owner stop saved with the old interrupt kind: %s",
    (text) => {
      const session = chat("/tmp/a", {
        providerSessionId: "p1",
        blocks: [
          { id: "u1", role: "user", text: "hello" },
          { id: "stop", role: "system", notice: "interrupt", text },
        ],
      });
      expect(wasTurnInterrupted(session)).toBe(false);
      expect(canAutoContinue(session)).toBe(false);
      expect(session.blocks.at(-1)?.notice).toBe("interrupt");
    },
  );
  it("keeps unexpected Host interruption eligible for recovery", () => {
    const session = chat("/tmp/a", {
      providerSessionId: "p1",
      blocks: [
        { id: "u1", role: "user", text: "hello" },
        {
          id: "restart",
          role: "system",
          notice: "interrupt",
          text: "Host restarted. This turn was interrupted; inspect its work before continuing.",
        },
      ],
    });
    expect(wasTurnInterrupted(session)).toBe(true);
    expect(canAutoContinue(session)).toBe(true);
  });
  it("resumes legacy interrupted sessions without adding a duplicate notice", () => {
    const legacy = chat("/tmp/a", {
      providerSessionId: "p1",
      blocks: [
        { id: "u1", role: "user", text: "hello" },
        { id: "old", role: "system", text: "Turn interrupted when Bycoda quit." },
      ],
    });
    expect(canAutoContinue(legacy)).toBe(true);
    expect(markTurnInterrupted(legacy).blocks).toEqual(legacy.blocks);
  });
  it("needs a provider thread and an interrupt note as the last block", () => {
    const interrupted = markTurnInterrupted(
      chat("/tmp/a", { busy: true, providerSessionId: "p1" }),
    );
    expect(canAutoContinue(interrupted)).toBe(true);
    expect(canAutoContinue(chat("/tmp/a", { providerSessionId: "p1" }))).toBe(false);
    expect(canAutoContinue(markTurnInterrupted(chat("/tmp/a", { busy: true })))).toBe(false);
    expect(
      canAutoContinue({
        ...interrupted,
        blocks: [
          ...interrupted.blocks,
          { id: "c1", role: "user", text: "Continue from where you left off." },
        ],
      }),
    ).toBe(false);
    expect(canAutoContinue({ ...interrupted, busy: true })).toBe(false);
    expect(canAutoContinue({ ...interrupted, worktreeRemoved: true })).toBe(false);
  });
});

describe("shouldWriteInFlightSnapshot", () => {
  it("does not wipe a disk snapshot on the first idle paint", () => {
    expect(shouldWriteInFlightSnapshot("", [], null, false)).toBe(false);
  });

  it("writes when a chat becomes in-flight", () => {
    expect(shouldWriteInFlightSnapshot("a", [{ sessionId: "a", cwd: "/tmp" }], null, false)).toBe(
      true,
    );
  });

  it("clears after this process has seen an in-flight chat", () => {
    expect(shouldWriteInFlightSnapshot("", [], "a", true)).toBe(true);
  });

  it("skips unchanged keys", () => {
    expect(shouldWriteInFlightSnapshot("a", [{ sessionId: "a", cwd: "/tmp" }], "a", true)).toBe(
      false,
    );
  });
});
