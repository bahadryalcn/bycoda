import { expect, it, vi } from "vitest";
import { newSession } from "../../features/sessions/model/session";
import { captureSessionRecovery } from "../../features/workspace/model/sessionRecovery";
import { collectWorkspaceSnapshot } from "../../features/workspace/model/workspaceSnapshot";
import { collectRetiredSessionRecovery, type RetirementCandidates } from "./retiredSessionRecovery";

const empty = { sessions: [], pending: false };
it("waits for native proof and rechecks ownership after transcript hydration", async () => {
  const session = newSession("codex", "/repo");
  const candidate = { sessions: [{ sessionId: session.id, cwd: session.cwd }], pending: false };
  const read = vi
    .fn<() => Promise<RetirementCandidates>>()
    .mockResolvedValueOnce({ ...empty, pending: true })
    .mockResolvedValueOnce(candidate)
    .mockResolvedValueOnce(empty);
  const load = vi.fn().mockResolvedValue(session);
  const options = { read, load, current: () => null, isLocked: () => false };
  expect(await collectRetiredSessionRecovery(options)).toEqual({ workspace: null, pending: true });
  expect(load).not.toHaveBeenCalled();
  expect(await collectRetiredSessionRecovery(options)).toEqual({ workspace: null, pending: false });
});

it("adds confirmed late retirements without recapturing resolved or locked entries", async () => {
  const old = newSession("codex", "/repo");
  const late = newSession("codex", "/repo");
  const locked = newSession("codex", "/locked");
  const previous = captureSessionRecovery(
    null,
    collectWorkspaceSnapshot([], [old], "", old.cwd, new Map()),
  )!;
  previous.resolvedIds = [old.id];
  const read = vi.fn().mockResolvedValue({
    sessions: [old, late, locked].map((session) => ({ sessionId: session.id, cwd: session.cwd })),
    pending: false,
  });
  const load = vi.fn().mockResolvedValue(late);
  const result = await collectRetiredSessionRecovery({
    read,
    load,
    current: () => previous,
    isLocked: (cwd) => cwd === "/locked",
  });
  expect(load).toHaveBeenCalledExactlyOnceWith(late.id);
  expect(result.workspace?.sessions.map((session) => session.id)).toEqual([late.id]);
  expect(result.workspace?.tabs).toHaveLength(1);
});

it("keeps unreadable or missing rows as failures instead of clearing recovery", async () => {
  const read = vi
    .fn()
    .mockResolvedValue({ sessions: [{ sessionId: "missing", cwd: "/repo" }], pending: false });
  await expect(
    collectRetiredSessionRecovery({
      read,
      load: async () => null,
      current: () => null,
      isLocked: () => false,
    }),
  ).rejects.toThrow("could not be loaded");
});

it("retains native acknowledgement for entries already captured during boot", async () => {
  const session = newSession("codex", "/repo");
  const current = captureSessionRecovery(
    null,
    collectWorkspaceSnapshot([], [session], "", session.cwd, new Map()),
  )!;
  const load = vi.fn();
  const result = await collectRetiredSessionRecovery({
    read: async () => ({
      sessions: [{ sessionId: session.id, cwd: session.cwd }],
      pending: false,
      receipt: "exact-retirement-read",
    }),
    load,
    current: () => current,
    isLocked: () => false,
  });
  expect(result).toEqual({ workspace: null, pending: false, receipt: "exact-retirement-read" });
  expect(load).not.toHaveBeenCalled();
});
