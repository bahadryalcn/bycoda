// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { gateUsageBudget, isUsageBudgetChecking } from "./submitUsageBudget";
import type { SubmitDeps, SubmitInput, SubmitPreflight } from "./submitTypes";
import type { Session } from "../../../../features/sessions/model/session";
import { getSessions, resetSessionsStore } from "../../../../features/sessions/model/sessionsStore";

const mocks = vi.hoisted(() => ({ assert: vi.fn(), rules: vi.fn() }));
vi.mock("../../../../features/usage/model/usageBudgetReadings", () => ({
  assertUsageBudgets: mocks.assert,
  blockingUsageBudgets: mocks.rules,
}));
const session = {
  id: "s",
  cwd: "C:/app",
  harness: "codex",
  model: "gpt",
  modelSettings: {},
  runtimeMode: "supervised",
  title: "Test",
  blocks: [],
} as Session;
const input: SubmitInput = {
  sessionId: "s",
  text: "Keep this request",
  attachments: [],
  options: undefined,
};
const pre = { current: session, storedCurrent: session, intent: "default" } as SubmitPreflight;
let ctx: SubmitDeps;
beforeEach(() => {
  vi.resetAllMocks();
  resetSessionsStore([session]);
  ctx = {
    refs: { turnGen: { current: new Map() } },
    enqueueHarnessEvent: vi.fn(),
    flushHarnessEvents: vi.fn(),
  } as unknown as SubmitDeps;
});
it("keeps the existing synchronous path when no blocking rule applies", () => {
  mocks.rules.mockReturnValue([]);
  const dispatch = vi.fn();
  expect(gateUsageBudget(ctx, input, pre, dispatch)).toBeUndefined();
  expect(dispatch).not.toHaveBeenCalled();
  expect(mocks.assert).not.toHaveBeenCalled();
});
it("rejects before dispatch and retains the exact message as a paused follow-up", async () => {
  mocks.rules.mockReturnValue([{}]);
  mocks.assert.mockRejectedValue(new Error("Budget reached"));
  const dispatch = vi.fn(() => true);
  await expect(gateUsageBudget(ctx, input, pre, dispatch)).resolves.toBe(false);
  expect(dispatch).not.toHaveBeenCalled();
  expect(getSessions()[0]).toMatchObject({
    busy: false,
    blocks: [],
    queueStatus: "paused",
    queuedMessages: [{ text: input.text, attachments: [] }],
  });
});
it("waits for validation, releases the preparation and dispatches once", async () => {
  mocks.rules.mockReturnValue([{}]);
  let release!: () => void;
  mocks.assert.mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const dispatch = vi.fn(() => {
    expect(getSessions()[0].busy).toBe(false);
    return true;
  });
  const result = gateUsageBudget(ctx, input, pre, dispatch);
  expect(getSessions()[0].busy).toBe(true);
  expect(isUsageBudgetChecking("s", ctx.refs.turnGen.current.get("s"))).toBe(true);
  expect(dispatch).not.toHaveBeenCalled();
  release();
  await expect(result).resolves.toBe(true);
  expect(dispatch).toHaveBeenCalledOnce();
  expect(isUsageBudgetChecking("s", ctx.refs.turnGen.current.get("s"))).toBe(false);
});
it("honors Stop while validation is pending and preserves the request", async () => {
  mocks.rules.mockReturnValue([{}]);
  let release!: () => void;
  mocks.assert.mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const dispatch = vi.fn(() => true);
  const result = gateUsageBudget(ctx, input, pre, dispatch);
  ctx.refs.turnGen.current.set("s", 999);
  release();
  await expect(result).resolves.toBe(false);
  expect(dispatch).not.toHaveBeenCalled();
  expect(getSessions()[0].queuedMessages?.[0].text).toBe(input.text);
});
it("does not duplicate a queued message or a draft on rejection", async () => {
  mocks.rules.mockReturnValue([{}]);
  mocks.assert.mockRejectedValue(new Error("offline"));
  await gateUsageBudget(ctx, { ...input, options: { queuedMessageId: "q" } }, pre, () => true);
  expect(getSessions()[0].queuedMessages).toBeUndefined();
});
