import { expect, it, vi } from "vitest";
const locks = vi.hoisted(() => ({ lock: {}, listeners: new Set<() => void>() }));
vi.mock("../../../features/group-lock/model/groupLock", () => ({
  getGroupLockView: () => ({ lock: locks.lock }),
  subscribeGroupLock: (listener: () => void) => {
    locks.listeners.add(listener);
    return () => locks.listeners.delete(listener);
  },
}));
vi.mock("../../../features/group-lock/model/lockState", () => ({ isProjectLockedIn: () => false }));
import { handleOwnerApprovalControl } from "./ownerApprovalControl";
import {
  ownerApprovalsSnapshot,
  settleOwnerApproval,
} from "../../../features/notifications/model/ownerApprovals";
const payload = (id: string, sessionId?: string) => ({
  id,
  namespace: "owner-approval",
  sessionId,
  input: {
    title: "Review",
    message: "Exact operation",
    confirmLabel: "Approve",
    cancelLabel: "Cancel",
    deadline: Date.now() + 60_000,
  },
});

it("dismisses non-session sensitive content on privacy changes without treating it as an owner choice", async () => {
  const result = expect(
    handleOwnerApprovalControl(
      payload("privacy"),
      () => [],
      () => false,
    ),
  ).rejects.toThrow("revoked");
  expect(ownerApprovalsSnapshot()).toHaveLength(1);
  locks.lock = {};
  for (const listener of locks.listeners) listener();
  await result;
  expect(ownerApprovalsSnapshot()).toHaveLength(0);
});

it("rejects approval after its source session was removed and ignores an ended request's late answer", async () => {
  let sessions = [{ id: "source", cwd: "/project" }];
  const removed = expect(
    handleOwnerApprovalControl(
      payload("removed", "source"),
      () => sessions,
      () => false,
    ),
  ).rejects.toThrow("revoked");
  sessions = [];
  settleOwnerApproval("removed", true);
  await removed;
  const ended = expect(
    handleOwnerApprovalControl(
      payload("ended"),
      () => [],
      () => false,
    ),
  ).rejects.toThrow("revoked");
  handleOwnerApprovalControl(
    { ...payload("ended"), namespace: "owner-approval-ended" },
    () => [],
    () => false,
  );
  settleOwnerApproval("ended", true);
  await ended;
});
