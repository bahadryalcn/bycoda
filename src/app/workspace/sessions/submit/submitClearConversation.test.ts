// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "../../../../features/sessions/model/session";
import { getSessions, resetSessionsStore } from "../../../../features/sessions/model/sessionsStore";
import { submitClearConversation } from "./submitClearConversation";
import type { SubmitDeps } from "./submitTypes";

const mocks = vi.hoisted(() => ({ forget: vi.fn(), save: vi.fn() }));
vi.mock("../../../../integrations/harness", () => ({ forgetHarnessSession: mocks.forget }));
vi.mock("../../../../features/sessions/data/sessionStore", () => ({
  upsertClearedSession: mocks.save,
}));
let ctx: SubmitDeps;
const initial = {
  id: "same-session",
  cwd: "C:/project",
  harness: "codex",
  model: "gpt",
  title: "My chat",
  modelSettings: { effort: "medium" },
  runtimeMode: "supervised",
  providerSessionId: "old-thread",
  pendingContextReplay: "old replay",
  rewindHistory: [{ id: "archive", createdAt: 1, fromBlockId: "u", blocks: [] }],
  blocks: [{ id: "u", role: "user", text: "Remember my secret" }],
} as Session;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockResolvedValue({ id: initial.id });
  resetSessionsStore([initial, { ...initial, id: "other" }]);
  ctx = {
    flushHarnessEvents: vi.fn(),
    enqueueHarnessEvent: vi.fn(),
    refs: {
      editedResends: { start: vi.fn(() => true), finish: vi.fn() },
      retiringTurns: { current: new Map() },
      turnGen: { current: new Map() },
    },
  } as unknown as SubmitDeps;
});

it("forgets provider context and durably clears the same session before unlocking it", async () => {
  let release!: () => void;
  mocks.forget.mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  expect(submitClearConversation(ctx, initial.id)).toBe(true);
  expect(ctx.refs.retiringTurns.current.has(initial.id)).toBe(true);
  expect(getSessions()[0].blocks).toHaveLength(1);
  release();
  await vi.waitFor(() => expect(ctx.refs.editedResends.finish).toHaveBeenCalled());
  expect(mocks.forget).toHaveBeenCalledWith("codex", initial.id);
  const cleared = getSessions()[0];
  expect(cleared).toMatchObject({
    id: initial.id,
    title: initial.title,
    model: initial.model,
    blocks: [],
    modelSettings: initial.modelSettings,
  });
  expect(cleared.providerSessionId).toBeUndefined();
  expect(cleared.pendingContextReplay).toBeUndefined();
  expect(cleared.rewindHistory).toBeUndefined();
  expect(mocks.save).toHaveBeenCalledWith(cleared);
  expect(getSessions()[1].blocks).toBe(initial.blocks);
  expect(ctx.refs.retiringTurns.current.has(initial.id)).toBe(false);
});

it("keeps the transcript and reports a persistence failure", async () => {
  mocks.save.mockRejectedValue(new Error("Disk unavailable"));
  submitClearConversation(ctx, initial.id);
  await vi.waitFor(() => expect(ctx.refs.editedResends.finish).toHaveBeenCalled());
  expect(getSessions()[0].blocks).toBe(initial.blocks);
  expect(ctx.enqueueHarnessEvent).toHaveBeenCalledWith(initial.id, {
    type: "session.error",
    message: "Disk unavailable",
  });
});

it.each([
  { busy: true },
  { continuingElsewhere: true },
  { historyPartial: true },
  { queuedMessages: [{ id: "q", text: "next", attachments: [] }] },
])("rejects unsafe clearing: %j", (state) => {
  resetSessionsStore([{ ...initial, ...state }]);
  expect(submitClearConversation(ctx, initial.id)).toBe(false);
  expect(mocks.forget).not.toHaveBeenCalled();
});
