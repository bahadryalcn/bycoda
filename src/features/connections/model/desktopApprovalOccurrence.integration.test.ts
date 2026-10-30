// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { DesktopLive } from "../../../../host/desktopLive";
import { newSession, type Session } from "../../sessions/model/session";
import { createApprovalIntentRegistry } from "../../sessions/model/approvalIntents";
import { ParentInputRegistry } from "../../sessions/data/parentInputClosure";
import { createApprovalOccurrenceId } from "../../../shared/model/approvalOccurrence";
import {
  buildDesktopLiveSessions,
  runDesktopLiveTick,
  type DesktopLiveHandlers,
  type DesktopLiveResult,
} from "./desktopLive";

const output = vi.hoisted(() => ({ approve: vi.fn(), adapter: { respondApproval: vi.fn() } }));
vi.mock("../../../integrations/harness", () => ({
  getHarness: () => output.adapter,
  respondHarnessApproval: (...args: unknown[]) => {
    output.approve(...args);
  },
}));
beforeEach(() => {
  output.approve.mockClear();
});

function fixture() {
  let value = newSession("codex", "G:/occurrence-integration-fixture");
  const occurrenceId = createApprovalOccurrenceId();
  value.blocks = [
    {
      id: "original-tool",
      role: "approval",
      text: "  Exact original command\r\n漢🦀  ",
      approval: { requestId: 71, occurrenceId },
    },
  ];
  const host = new DesktopLive();
  host.beat({ clientId: "owner", sessions: buildDesktopLiveSessions([value]) });
  const parent = new ParentInputRegistry();
  const registry = createApprovalIntentRegistry({
    register: (adapter) => parent.register(adapter),
  });
  const handlers: DesktopLiveHandlers = {
    stop: vi.fn(),
    answer: vi.fn(),
    captureApproval: registry.captureApprovalRequest,
    approvalDispatchStarted: registry.approvalRequestDispatchStarted,
    approve: (_id, requestId, decision, expected) =>
      registry.submitApprovalIntent(value, requestId, decision, expected, () => value),
  };
  const command = {
    type: "approve" as const,
    commandId: crypto.randomUUID(),
    sessionId: value.id,
    runId: "desktop",
    requestId: 71,
    approvalOccurrenceId: occurrenceId,
    decision: "allow" as const,
  };
  const deliveries: NonNullable<DesktopLiveResult["commands"]>[] = [];
  const deps = {
    approvalOccurrenceSupported: true,
    clientId: "owner",
    sessions: () => [value],
    handlers,
    unacked: new Set<string>(),
    handled: new Set<string>(),
    request: async (
      payload: Parameters<Parameters<typeof runDesktopLiveTick>[0]["request"]>[0],
    ) => {
      const result = host.beat(payload) as DesktopLiveResult;
      deliveries.push(result.commands ?? []);
      return result;
    },
  };
  return {
    host,
    parent,
    registry,
    command,
    deps,
    deliveries,
    get value() {
      return value;
    },
    replace(next: Session) {
      value = next;
    },
  };
}

it("rejects Host-accepted A after local same-ID B arrives before the next heartbeat, without overwriting or replaying A", async () => {
  const f = fixture();
  const original = f.value.blocks[0];
  const replacement = createApprovalOccurrenceId();
  f.replace({
    ...f.value,
    blocks: [{ ...original, approval: { requestId: 71, occurrenceId: replacement } }],
  });
  // The actual Host still has A's previously published overlay, so accepting A
  // here is legitimate; B reaches it only inside this next real client beat.
  f.host.enqueue(f.command);
  f.host.enqueue(f.command);
  expect(() =>
    f.host.enqueue({ ...f.command, approvalOccurrenceId: replacement, decision: "deny" }),
  ).toThrow();
  await runDesktopLiveTick(f.deps);
  expect(f.deliveries[0]).toMatchObject([
    {
      id: f.command.commandId,
      requestId: 71,
      approvalOccurrenceId: f.command.approvalOccurrenceId,
      decision: "allow",
    },
  ]);
  expect(f.deliveries[0]).toHaveLength(1);
  expect(output.approve).not.toHaveBeenCalled();
  expect(f.registry.readApprovalIntent(f.value, 71)).toBeUndefined();
  expect([...f.deps.unacked]).toEqual([f.command.commandId]); // Original A has an exact local stale witness.
  await runDesktopLiveTick(f.deps);
  f.host.enqueue(f.command); // A committed queue receipt cannot become B's decision after ACK.
  await runDesktopLiveTick(f.deps);
  expect(f.deliveries.slice(1).flat()).toEqual([]);
  expect(output.approve).not.toHaveBeenCalled();
  const gate = f.parent.begin("logical-root", { owner: {}, timeoutMs: 1000 });
  try {
    const lease = await gate.capture();
    expect(lease.snapshots[0].snapshot).toMatchObject({
      qualified: false,
      rosterComplete: false,
      records: [],
    });
    lease.release();
  } finally {
    gate.release();
  }
});

it("keeps the exact Host command queued while the real Parent gate refuses it, then invokes its original nonce exactly once", async () => {
  const f = fixture();
  f.host.enqueue(f.command);
  const gate = f.parent.begin("logical-root", { owner: {}, timeoutMs: 1000 });
  try {
    await runDesktopLiveTick(f.deps);
    expect(output.approve).not.toHaveBeenCalled();
    expect(f.deps.unacked.size).toBe(0);
    expect(f.deps.handled.size).toBe(0);
    f.host.enqueue(f.command);
    f.replace({ ...f.value, title: "Unrelated presentation update" });
    gate.release();
    await runDesktopLiveTick(f.deps);
    expect(f.deliveries[1]).toMatchObject([
      { id: f.command.commandId, approvalOccurrenceId: f.command.approvalOccurrenceId },
    ]);
    expect(output.approve).toHaveBeenCalledExactlyOnceWith(
      "codex",
      f.value.id,
      71,
      "allow",
      f.command.approvalOccurrenceId,
    );
    expect(f.registry.readApprovalIntent(f.value, 71)).toMatchObject({
      callback: "void",
      phase: "unconfirmed",
      providerAck: "unproved",
    });
    await runDesktopLiveTick(f.deps);
    expect(f.deliveries[2]).toEqual([]);
    expect(output.approve).toHaveBeenCalledTimes(1);
  } finally {
    gate.release();
  }
});
