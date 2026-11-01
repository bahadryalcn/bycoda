// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { gateRunLease } from "./submitRunLease";
import type { SubmitDeps, SubmitInput, SubmitPreflight } from "./submitTypes";
import { getSessions, resetSessionsStore } from "../../../../features/sessions/model/sessionsStore";
import { newSession } from "../../../../features/sessions/model/session";

const client = vi.hoisted(() => ({
  machine: "local" as string | undefined,
  firstLook: undefined as Promise<void> | undefined,
  discoveryPending: false,
  acquire: vi.fn(),
  release: vi.fn(async () => undefined),
}));
vi.mock("../../../../features/connections/model/runLeaseClient", () => ({
  runLeaseMachine: () => client.machine,
  firstRunLeaseLook: () => client.firstLook,
  isRunLeaseDiscoveryPending: () => client.discoveryPending,
  acquireRunLease: client.acquire,
  releaseRunLease: client.release,
  isRunLeasePending: () => false,
}));

const session = { ...newSession("codex", "/fake"), id: "chat" };
const ctx = {
  dismissNoticesForContinuedSession: vi.fn(),
  enqueueHarnessEvent: vi.fn(),
  flushHarnessEvents: vi.fn(),
  refs: { turnGen: { current: new Map() } },
} as unknown as SubmitDeps;
const input = (options?: SubmitInput["options"]) =>
  ({
    sessionId: session.id,
    text: "typed on the desktop",
    attachments: [],
    options,
  }) as SubmitInput;
const pre = {
  storedCurrent: session,
  current: session,
  intent: "default",
  submittedText: "typed on the desktop",
  harnessText: "typed on the desktop",
  operatorCommand: { matched: false },
  initialWorkCwd: session.cwd,
} as unknown as SubmitPreflight;

beforeEach(() => {
  client.machine = "local";
  client.firstLook = undefined;
  client.discoveryPending = false;
  client.acquire.mockReset();
  client.release.mockClear();
  resetSessionsStore([session]);
});

it("starts the turn exactly as before when there is no host that grants leases", () => {
  client.machine = undefined;
  const start = vi.fn(() => true);
  expect(gateRunLease(ctx, input(), pre, start)).toBeUndefined();
  expect(start).not.toHaveBeenCalled();
  expect(client.acquire).not.toHaveBeenCalled();
});

it("does not treat a still-pending initial ownership probe as permission to start", async () => {
  client.machine = undefined;
  client.firstLook = Promise.resolve();
  client.discoveryPending = true;
  const start = vi.fn(() => true);
  expect(await gateRunLease(ctx, input(), pre, start)).toBe(false);
  expect(start).not.toHaveBeenCalled();
  expect(client.acquire).not.toHaveBeenCalled();
  expect(getSessions()[0].queueStatus).toBe("paused");
  expect(getSessions()[0].blocks.at(-1)).toMatchObject({ notice: "error", text: expect.stringContaining("discovery is still pending") });
});

it("starts the turn once the lease is granted, and keeps it for the turn", async () => {
  client.acquire.mockResolvedValue({
    kind: "granted",
    lease: { holder: "h", epoch: 1, expiresAt: 1 },
  });
  const start = vi.fn(() => true);
  expect(await gateRunLease(ctx, input(), pre, start)).toBe(true);
  expect(start).toHaveBeenCalledOnce();
  expect(client.release).not.toHaveBeenCalled();
});

it("gives the lease back when the turn is refused locally", async () => {
  client.acquire.mockResolvedValue({
    kind: "granted",
    lease: { holder: "h", epoch: 1, expiresAt: 1 },
  });
  expect(await gateRunLease(ctx, input(), pre, async () => false)).toBe(false);
  expect(client.release).toHaveBeenCalledWith("chat");
});

it("starts the turn when the host cannot be asked", async () => {
  client.acquire.mockResolvedValue({ kind: "unavailable" });
  const start = vi.fn(() => true);
  expect(await gateRunLease(ctx, input(), pre, start)).toBe(true);
  expect(start).toHaveBeenCalledOnce();
});

it("retains an unsent message and displays retirement failure without starting or automatically queueing it", async () => {
  client.acquire.mockResolvedValue({ kind: "failed", text: "Previous Host writer retirement is unconfirmed" });
  const start = vi.fn(() => true);
  const request = input();
  request.attachments = [{ id: "retained", name: "draft.txt" } as never];
  expect(await gateRunLease(ctx, request, pre, start)).toBe(false);
  expect(start).not.toHaveBeenCalled();
  expect(client.release).not.toHaveBeenCalled();
  const current = getSessions()[0];
  expect(current.queuedMessages).toMatchObject([{ text: "typed on the desktop", attachments: request.attachments }]);
  expect(current.queueStatus).toBe("paused");
  expect(current.blocks.at(-1)).toMatchObject({ role: "system", notice: "error", text: "Previous Host writer retirement is unconfirmed" });
  expect(current.busy).toBeFalsy();
});

it("reports managed retirement failure to its caller without creating an interactive queue row", async () => {
  client.acquire.mockResolvedValue({ kind: "failed", text: "Retirement failed" });
  const onSettled = vi.fn();
  const start = vi.fn(() => true);
  expect(await gateRunLease(ctx, input({ managed: true, onSettled } as never), pre, start)).toBe(false);
  expect(start).not.toHaveBeenCalled();
  expect(onSettled).toHaveBeenCalledWith({ status: "failed", text: "", error: "Retirement failed" });
  expect(getSessions()[0].queuedMessages ?? []).toEqual([]);
});

it("queues the message while another computer runs a turn: nothing started, nothing paused", async () => {
  client.acquire.mockResolvedValue({ kind: "held", text: "busy elsewhere" });
  const start = vi.fn(() => true);
  expect(await gateRunLease(ctx, input(), pre, start)).toBe(true);
  expect(start).not.toHaveBeenCalled();
  expect(getSessions()[0]).toMatchObject({
    continuingElsewhere: true,
    queuedMessages: [{ text: "typed on the desktop" }],
  });
  // The dispatcher reads a conversation running elsewhere as a wait, not a failed send.
  expect(getSessions()[0].queueStatus).not.toBe("paused");
  expect(getSessions()[0].busy).toBeUndefined();
});

it("leaves a queue row where it is and marks the conversation as running elsewhere", async () => {
  client.acquire.mockResolvedValue({ kind: "held", text: "busy elsewhere" });
  const start = vi.fn(() => true);
  expect(await gateRunLease(ctx, input({ queuedMessageId: "row" }), pre, start)).toBe(false);
  expect(start).not.toHaveBeenCalled();
  expect(getSessions()[0].queuedMessages ?? []).toEqual([]);
  expect(getSessions()[0].continuingElsewhere).toBe(true);
});

it("refuses managed and automated sends instead of queueing them", async () => {
  client.acquire.mockResolvedValue({ kind: "held", text: "busy elsewhere" });
  const onSettled = vi.fn();
  expect(
    await gateRunLease(ctx, input({ managed: true, onSettled } as never), pre, () => true),
  ).toBe(false);
  expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  expect(await gateRunLease(ctx, input({ appRequestId: "r" } as never), pre, () => true)).toBe(
    false,
  );
  expect(getSessions()[0].queuedMessages ?? []).toEqual([]);
});

it("gives the lease back when the turn throws before it runs", async () => {
  client.acquire.mockResolvedValue({
    kind: "granted",
    lease: { holder: "h", epoch: 1, expiresAt: 1 },
  });
  const start = vi.fn(() => {
    throw new Error("could not prepare the turn");
  });
  await expect(gateRunLease(ctx, input(), pre, start)).rejects.toThrow("could not prepare");
  expect(client.release).toHaveBeenCalledWith("chat");
});

it("makes the very first turn of a run wait for the first look at the host, then take its lease", async () => {
  client.machine = undefined;
  let looked!: () => void;
  client.firstLook = new Promise<void>((resolve) => (looked = resolve));
  client.acquire.mockResolvedValue({
    kind: "granted",
    lease: { holder: "h", epoch: 1, expiresAt: 1 },
  });
  const start = vi.fn(() => true);
  const gated = gateRunLease(ctx, input(), pre, start);
  expect(gated).toBeInstanceOf(Promise);
  expect(start).not.toHaveBeenCalled();
  client.machine = "local"; // the look found the host
  looked();
  expect(await gated).toBe(true);
  expect(client.acquire).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledOnce();
  // A look that found no host starts the turn as before, without a lease.
  client.machine = undefined;
  client.firstLook = Promise.resolve();
  start.mockClear();
  client.acquire.mockClear();
  expect(await gateRunLease(ctx, input(), pre, start)).toBe(true);
  expect(client.acquire).not.toHaveBeenCalled();
});
