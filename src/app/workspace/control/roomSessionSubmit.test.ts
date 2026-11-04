import { expect, it, vi } from "vitest";
import { submitRoomSession } from "./roomSessionSubmit";
import type { AppControlRequestDeps } from "./useAppControlRequests";

vi.mock("../../../features/orchestration/model/orchestration", () => ({ orchestrator: { run: () => null } }));
const store = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../features/sessions/data/sessionStore", () => ({ getSession: store.get }));
it("sends once with the retained app request identity and respects existing drafts", async () => {
  const session = { id: "session", cwd: "C:/project", blocks: [], busy: false };
  const submit = vi.fn(async () => true);
  const deps = { ensureOpenSessionRef: { current: vi.fn(async () => session) }, submitSessionRef: { current: submit } } as unknown as AppControlRequestDeps;
  const target = { projectCwd: "C:/project", valid: () => true };
  const input = { sessionId: "session", requestId: "room-123", text: "work" };
  store.get.mockResolvedValue({ ...session, blocks: [{ appRequestId: "room-123", text: "work", role: "user" }] });
  expect(await submitRoomSession(input, target, async () => true, deps)).toMatchObject({ status: "accepted", requestId: "room-123" });
  expect(submit).toHaveBeenCalledWith("session", "work", [], { appRequestId: "room-123" });
  session.blocks = [{ appRequestId: "room-123", text: "work", role: "user" }] as never;
  expect(await submitRoomSession(input, target, async () => true, deps)).toMatchObject({ alreadySubmitted: true });
  await expect(submitRoomSession({ ...input, text: "other" }, target, async () => true, deps)).rejects.toThrow("different submission");
  expect(submit).toHaveBeenCalledOnce();
});
it("rejects lost source authority before invoking submit", async () => {
  const submit = vi.fn();
  const deps = { ensureOpenSessionRef: { current: vi.fn(async () => ({ id: "s", cwd: "C:/p", blocks: [] })) }, submitSessionRef: { current: submit } } as unknown as AppControlRequestDeps;
  const authorize = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(submitRoomSession({ requestId: "r", sessionId: "s", text: "work" }, { projectCwd: "C:/p", valid: () => true }, authorize, deps)).rejects.toThrow("authority is unavailable");
  expect(submit).not.toHaveBeenCalled();
});
it("rejects a mismatched session even within the same project", async () => {
  const submit = vi.fn();
  const deps = { ensureOpenSessionRef: { current: vi.fn(async () => ({ id: "other", cwd: "C:/p", blocks: [] })) }, submitSessionRef: { current: submit } } as unknown as AppControlRequestDeps;
  await expect(submitRoomSession({ requestId: "r", sessionId: "s", text: "work" }, { projectCwd: "C:/p", valid: () => true }, async () => true, deps)).rejects.toThrow("local desktop target");
  expect(submit).not.toHaveBeenCalled();
});
it("waits for the exact stored user request before reporting acceptance", async () => {
  let release!: (value: unknown) => void;
  store.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const deps = { ensureOpenSessionRef: { current: vi.fn(async () => ({ id: "s", cwd: "C:/p", blocks: [], busy: false })) }, submitSessionRef: { current: vi.fn(async () => true) } } as unknown as AppControlRequestDeps;
  const result = submitRoomSession({ requestId: "r", sessionId: "s", text: "work" }, { projectCwd: "C:/p", valid: () => true }, async () => true, deps);
  await vi.waitFor(() => expect(store.get).toHaveBeenCalledWith("s"));
  let settled = false;
  void result.then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  release({ id: "s", cwd: "C:/p", blocks: [{ role: "user", appRequestId: "r", text: "work" }] });
  await expect(result).resolves.toMatchObject({ status: "accepted" });
});
