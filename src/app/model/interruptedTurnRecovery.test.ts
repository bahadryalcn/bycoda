// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  isAutoContinueDue,
  resetAutoContinueForTests,
} from "../../features/sessions/model/autoContinue";
import { markTurnInterrupted } from "../../features/sessions/model/inFlight";
import { newSession, type Session } from "../../features/sessions/model/session";
import { isAutoContinueArmed } from "../../features/sessions/model/turnRecovery";
import { recoverInterruptedTurn } from "./interruptedTurnRecovery";

const mocks = vi.hoisted(() => ({
  probeTurnTail: vi.fn(),
  readTurnSteps: vi.fn(),
  initializeAgentDefaults: vi.fn(),
  loadAutoContinueInterrupted: vi.fn(),
}));

vi.mock("../../platform/tauri/turnProbe", () => ({
  probeTurnTail: mocks.probeTurnTail,
  readTurnSteps: mocks.readTurnSteps,
}));
vi.mock("../../features/settings/public/agentDefaultsSync", () => ({
  initializeAgentDefaults: mocks.initializeAgentDefaults,
}));
vi.mock("../../features/settings/model/settings", async (original) => ({
  ...(await original<typeof import("../../features/settings/model/settings")>()),
  loadAutoContinueInterrupted: mocks.loadAutoContinueInterrupted,
}));

function interrupted(): Session {
  return markTurnInterrupted({
    ...newSession("codex", "/project"),
    providerSessionId: "thread-1",
    blocks: [{ id: "prompt", role: "user", text: "Implement the feature" }],
    busy: true,
  });
}

/** A note written before this launch's decision, as a later launch reads it. */
function alreadyDecided(session: Session): Session {
  const note = { ...session.blocks[session.blocks.length - 1] };
  delete note.autoContinueArmed;
  return { ...session, blocks: [...session.blocks.slice(0, -1), note] };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetAutoContinueForTests();
  mocks.probeTurnTail.mockResolvedValue({ state: "open" });
  mocks.readTurnSteps.mockResolvedValue(null);
  mocks.initializeAgentDefaults.mockResolvedValue(undefined);
  mocks.loadAutoContinueInterrupted.mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  resetAutoContinueForTests();
});

it("continues a fresh interruption once and spends its one automatic attempt", async () => {
  const session = interrupted();
  expect(isAutoContinueArmed(session)).toBe(true);

  const recovered = await recoverInterruptedTurn(session);

  expect(isAutoContinueDue(session.id)).toBe(true);
  expect(isAutoContinueArmed(recovered)).toBe(false);
});

it("leaves an interruption from an earlier launch to the owner", async () => {
  const session = alreadyDecided(interrupted());

  await recoverInterruptedTurn(session);

  expect(isAutoContinueDue(session.id)).toBe(false);
});

it("spends the attempt when the setting is off, so enabling it later sends nothing old", async () => {
  mocks.loadAutoContinueInterrupted.mockReturnValue(false);
  const session = interrupted();

  const recovered = await recoverInterruptedTurn(session);

  expect(isAutoContinueDue(session.id)).toBe(false);
  expect(isAutoContinueArmed(recovered)).toBe(false);
});

it("waits for a Host that is still starting instead of dropping the continuation", async () => {
  mocks.initializeAgentDefaults
    .mockRejectedValueOnce(new Error("Host agent defaults unavailable"))
    .mockRejectedValueOnce(new Error("Host agent defaults unavailable"))
    .mockResolvedValue(undefined);
  const session = interrupted();

  await recoverInterruptedTurn(session);
  expect(isAutoContinueDue(session.id)).toBe(false);

  await vi.advanceTimersByTimeAsync(4_000);
  expect(isAutoContinueDue(session.id)).toBe(true);
});

it("keeps manual Continue when the Host never answers", async () => {
  mocks.initializeAgentDefaults.mockRejectedValue(new Error("Host agent defaults unavailable"));
  const session = interrupted();

  await recoverInterruptedTurn(session);
  await vi.advanceTimersByTimeAsync(120_000);

  expect(isAutoContinueDue(session.id)).toBe(false);
});
