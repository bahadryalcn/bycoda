import { afterEach, expect, it, vi } from "vitest";
import {
  abandonOwnerApproval,
  ownerApprovalsSnapshot,
  requestOwnerApproval,
  settleOwnerApproval,
} from "../../../features/notifications/model/ownerApprovals";
import { newSession, sessionNeedsInput } from "../../../features/sessions/model/session";
import { liveAgentsFromSessions } from "../../../features/sessions/model/liveAgents";
import { liveSessionInfos } from "../../../features/sessions/model/recentSessions";
import { sessionPhase } from "../../../features/notifications/model/attention";
import {
  getSessions,
  resetSessionsStore,
  setSessions,
} from "../../../features/sessions/model/sessionsStore";
import { startOwnerApprovalSessions } from "./ownerApprovalSessions";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  for (const request of ownerApprovalsSnapshot()) settleOwnerApproval(request.id, false);
  resetSessionsStore([]);
  vi.useRealTimers();
});

const payload = (id: string, sessionId?: string) => ({
  id,
  sessionId,
  input: {
    title: "bycoda — Application operation approval",
    message: "Publish these exact commits",
    confirmLabel: "Approve this exact operation",
    cancelLabel: "Cancel",
    deadline: Date.now() + 10_000,
  },
});

function setup() {
  const session = {
    ...newSession("claude", "/project"),
    busy: true,
    blocks: [{ id: "u", role: "user" as const, text: "publish" }],
  };
  const other = newSession("codex", "/other");
  resetSessionsStore([session, other]);
  stop = startOwnerApprovalSessions();
  return session;
}

it("updates list, live agent and dock status without a provider question or transcript mutation", async () => {
  const session = setup();
  const answer = requestOwnerApproval(payload("status", session.id));
  const waiting = getSessions()[0];
  expect(sessionNeedsInput(waiting)).toBe(true);
  expect(waiting.blocks).toBe(session.blocks);
  expect(waiting.pendingQuestion).toBeUndefined();
  expect(sessionNeedsInput(getSessions()[1])).toBe(false);
  expect(liveSessionInfos(getSessions())[0].status).toBe("input");
  expect(liveAgentsFromSessions(getSessions())[0]).toMatchObject({
    needsApproval: true,
    inputKind: "approval",
    activity: "Need approval",
  });
  expect(sessionPhase(waiting)).toBe("needs-input");
  setSessions((sessions) => [{ ...sessions[0], busy: false }, sessions[1]]);
  expect(sessionPhase(getSessions()[0])).toBe("needs-input");
  // A fresh Host snapshot cannot erase a still-pending local decision.
  setSessions((sessions) => [session, sessions[1]]);
  expect(sessionNeedsInput(getSessions()[0])).toBe(true);
  settleOwnerApproval("status", true);
  expect(await answer).toBe(true);
  expect(sessionNeedsInput(getSessions()[0])).toBe(false);
  expect(sessionPhase(getSessions()[0])).toBe("working");
});

it("waits for the last concurrent approval and ignores approvals without a session", async () => {
  const session = setup();
  const first = requestOwnerApproval(payload("first", session.id));
  const second = requestOwnerApproval(payload("second", session.id));
  const global = requestOwnerApproval(payload("global"));
  settleOwnerApproval("first", false);
  expect(await first).toBe(false);
  expect(sessionNeedsInput(getSessions()[0])).toBe(true);
  settleOwnerApproval("second", false);
  expect(await second).toBe(false);
  expect(sessionNeedsInput(getSessions()[0])).toBe(false);
  settleOwnerApproval("global", false);
  await global;
});

it("clears waiting on timeout and source retirement, and recovers requests already pending on mount", async () => {
  vi.useFakeTimers();
  const session = setup();
  stop?.();
  const expired = expect(requestOwnerApproval(payload("timeout", session.id))).rejects.toThrow(
    "expired",
  );
  stop = startOwnerApprovalSessions();
  expect(sessionNeedsInput(getSessions()[0])).toBe(true);
  await vi.advanceTimersByTimeAsync(10_000);
  await expired;
  expect(sessionNeedsInput(getSessions()[0])).toBe(false);
  const retired = expect(requestOwnerApproval(payload("retired", session.id))).rejects.toThrow(
    "revoked",
  );
  abandonOwnerApproval("retired");
  await retired;
  expect(sessionNeedsInput(getSessions()[0])).toBe(false);
});
