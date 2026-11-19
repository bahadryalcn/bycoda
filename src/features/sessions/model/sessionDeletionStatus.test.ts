import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dismissSessionDeletionStatus,
  getSessionDeletionStatus,
  setSessionDeletionStatus,
  subscribeSessionDeletionStatus,
  type SessionDeletionStatus,
} from "./sessionDeletionStatus";

const pending: SessionDeletionStatus = {
  sessionId: "deletion-test",
  cwd: "/project",
  title: "Conversation",
  stage: "deleting",
  startedAt: 0,
};

afterEach(() => {
  for (const status of getSessionDeletionStatus()) dismissSessionDeletionStatus(status.sessionId);
});

describe("conversation deletion feedback", () => {
  it("clears completed progress, notifies mounted consumers and preserves other pending deletions", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSessionDeletionStatus(listener);
    try {
      setSessionDeletionStatus(pending);
      const other = { ...pending, sessionId: "other" };
      setSessionDeletionStatus(other);
      listener.mockClear();
      setSessionDeletionStatus({ ...pending, outcome: "deleted" });
      expect(getSessionDeletionStatus()).toEqual([other]);
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
  });

  it("keeps other conversations' failure notices when a deletion starts or finishes", () => {
    const failed = { ...pending, sessionId: "failed", outcome: "failed" as const, error: "Busy" };
    const warned = {
      ...pending,
      sessionId: "warned",
      outcome: "deleted" as const,
      error: "Worktree kept",
    };
    setSessionDeletionStatus(failed);
    setSessionDeletionStatus(warned);
    setSessionDeletionStatus(pending);
    expect(getSessionDeletionStatus()).toEqual([failed, warned, pending]);
    setSessionDeletionStatus({ ...pending, outcome: "deleted" });
    expect(getSessionDeletionStatus()).toEqual([failed, warned]);
  });

  it("replaces only the retried conversation's failure and keeps explicit dismissal exact", () => {
    const failed = { ...pending, sessionId: "failed", outcome: "failed" as const, error: "Busy" };
    const sibling = { ...failed, sessionId: "sibling" };
    setSessionDeletionStatus(failed);
    setSessionDeletionStatus(sibling);
    setSessionDeletionStatus({ ...pending, sessionId: "failed" });
    expect(getSessionDeletionStatus()).toEqual([sibling, { ...pending, sessionId: "failed" }]);
    dismissSessionDeletionStatus("sibling");
    expect(getSessionDeletionStatus()).toEqual([{ ...pending, sessionId: "failed" }]);
    dismissSessionDeletionStatus("missing");
    expect(getSessionDeletionStatus()).toHaveLength(1);
  });

  it.each(["failed", "deleted"] as const)(
    "retains %s outcomes that need attention until dismissed",
    (outcome) => {
      const status = { ...pending, outcome, error: "Cleanup unavailable" };
      setSessionDeletionStatus(status);
      expect(getSessionDeletionStatus()).toEqual([status]);
      dismissSessionDeletionStatus(status.sessionId);
      expect(getSessionDeletionStatus()).toEqual([]);
    },
  );
});
