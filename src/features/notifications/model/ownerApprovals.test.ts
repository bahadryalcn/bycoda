import { afterEach, expect, it, vi } from "vitest";
import {
  ownerApprovalsSnapshot,
  requestOwnerApproval,
  settleOwnerApproval,
  registerOwnerApprovalChat,
  hasOwnerApprovalChat,
} from "./ownerApprovals";

afterEach(() => {
  for (const request of ownerApprovalsSnapshot()) settleOwnerApproval(request.id, false);
  vi.useRealTimers();
});
const payload = (id: string, sessionId?: string) => ({
  id,
  sessionId,
  input: {
    title: "SSH command approval",
    message: "Server: saved\nCommand: pwd",
    confirmLabel: "Run this exact command",
    cancelLabel: "Cancel",
    deadline: Date.now() + 10_000,
  },
});

it("deduplicates identical native offers, rejects changed payloads and never reopens a settled request", async () => {
  const request = payload("dedupe", "original");
  const answer = requestOwnerApproval(request);
  expect(requestOwnerApproval(request)).toBe(answer);
  expect(() =>
    requestOwnerApproval({ ...request, input: { ...request.input, message: "changed" } }),
  ).toThrow("identity changed");
  expect(ownerApprovalsSnapshot()).toHaveLength(1);
  settleOwnerApproval("dedupe", true);
  expect(await answer).toBe(true);
  expect(await requestOwnerApproval(request)).toBe(true);
  expect(ownerApprovalsSnapshot()).toHaveLength(0);
});

it("denies expired, cancelled and revoked requests even when a yes arrives late", async () => {
  vi.useFakeTimers();
  const expired = expect(requestOwnerApproval(payload("expired"))).rejects.toThrow("expired");
  await vi.advanceTimersByTimeAsync(10_000);
  settleOwnerApproval("expired", true);
  await expired;
  let allowed = true;
  const revoked = expect(requestOwnerApproval(payload("revoked"), () => allowed)).rejects.toThrow(
    "revoked",
  );
  allowed = false;
  settleOwnerApproval("revoked", true);
  await revoked;
  const cancelled = requestOwnerApproval(payload("cancelled"));
  settleOwnerApproval("cancelled", false);
  settleOwnerApproval("cancelled", true);
  expect(await cancelled).toBe(false);
});

it("routes only matching visible chat surfaces and preserves concurrent requests", async () => {
  const first = registerOwnerApprovalChat("one");
  const second = registerOwnerApprovalChat("one");
  expect(hasOwnerApprovalChat("two")).toBe(false);
  first();
  expect(hasOwnerApprovalChat("one")).toBe(true);
  const a = requestOwnerApproval(payload("a", "one"));
  const b = requestOwnerApproval(payload("b", "two"));
  settleOwnerApproval("a", true);
  expect(await a).toBe(true);
  expect(ownerApprovalsSnapshot().map((request) => request.id)).toEqual(["b"]);
  second();
  expect(hasOwnerApprovalChat("one")).toBe(false);
  settleOwnerApproval("b", false);
  expect(await b).toBe(false);
});

it("rejects invalid request bounds and field types", () => {
  for (const input of [
    { deadline: Date.now() - 1 },
    { deadline: Date.now() + 300_000 },
    { title: true },
  ])
    expect(() =>
      requestOwnerApproval({
        ...payload("invalid"),
        input: { ...payload("invalid").input, ...input },
      }),
    ).toThrow("Invalid application approval");
});
