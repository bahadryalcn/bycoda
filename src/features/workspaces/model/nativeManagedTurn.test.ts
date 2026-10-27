// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { upsertSession } from "../../sessions/data/sessionStore";
import { newSession } from "../../sessions/model/session";
import { beginNativeManagedTurn, recoverNativeManagedTurn } from "./nativeManagedTurn";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../sessions/data/sessionStore", () => ({ upsertSession: vi.fn() }));
const session = {
  ...newSession("codex", "/repo"),
  workspaceId: "workspace",
  workspaceRevision: 4,
  worktreeCwd: "/worktrees/owned",
  blocks: [
    { id: "user", role: "user" as const, text: "Implement" },
    { id: "draft", role: "user" as const, text: "Later", draft: true },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(upsertSession).mockResolvedValue({ id: session.id } as never);
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "managed_turn_recover" ? ({ released: true } as never) : undefined,
  );
});

it("recovers a retained starting row before saving the accepted boundary and admitting execution", async () => {
  let recover!: (value: unknown) => void;
  let release!: (value: never) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => (recover = resolve)));
  vi.mocked(upsertSession).mockReturnValue(new Promise((resolve) => (release = resolve)));
  const pending = beginNativeManagedTurn(session, "run");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("managed_turn_recover", { sessionId: session.id });
  expect(upsertSession).not.toHaveBeenCalled();
  recover({ released: true });
  await vi.waitFor(() => expect(upsertSession).toHaveBeenCalledOnce());
  expect(invoke).toHaveBeenCalledTimes(1);
  release({ id: session.id } as never);
  const finish = await pending;
  expect(invoke).toHaveBeenCalledWith("managed_turn_begin", {
    sessionId: session.id,
    userBlockId: "user",
    runId: "run",
  });
  await finish!(false);
  expect(invoke).toHaveBeenLastCalledWith("managed_turn_end", {
    sessionId: session.id,
    userBlockId: "user",
    runId: "run",
  });
});

it("does not admit execution after a rejected or unacknowledged session save", async () => {
  vi.mocked(upsertSession).mockResolvedValue(null);
  await expect(beginNativeManagedTurn(session, "run")).rejects.toThrow("could not be saved");
  vi.mocked(upsertSession).mockRejectedValue(new Error("revision changed"));
  await expect(beginNativeManagedTurn(session, "run")).rejects.toThrow("revision changed");
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "managed_turn_recover",
    "managed_turn_recover",
  ]);
});

it("does not save or start a new turn when the Host cannot release the existing fence", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    released: false,
    reason: "Complete before capture exists",
  });
  await expect(beginNativeManagedTurn(session, "next-run")).rejects.toThrow(
    "Managed turn recovery blocked: Complete before capture exists",
  );
  expect(upsertSession).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("managed_turn_recover", { sessionId: session.id });
});

it("does not save or start execution after an unknown recovery transport outcome", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Host unavailable"));
  await expect(beginNativeManagedTurn(session, "next-run")).rejects.toThrow(
    "Managed turn recovery could not be confirmed: Error: Host unavailable",
  );
  expect(upsertSession).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("managed_turn_recover", { sessionId: session.id });
});

it("propagates unknown admission and end outcomes without retrying mutations", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ released: true });
  vi.mocked(invoke).mockRejectedValueOnce(new Error("lost begin receipt"));
  await expect(beginNativeManagedTurn(session, "run")).rejects.toThrow("lost begin receipt");
  expect(invoke).toHaveBeenCalledTimes(2);
  const finish = await beginNativeManagedTurn(session, "next-run");
  vi.mocked(invoke).mockRejectedValueOnce(new Error("lost end receipt"));
  await expect(finish!(false)).rejects.toThrow("lost end receipt");
  expect(invoke).toHaveBeenCalledTimes(5);
});

it("keeps unknown writer retirement fenced", async () => {
  const finish = await beginNativeManagedTurn(session, "run");
  await expect(finish!(true)).rejects.toThrow("could not be retired");
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("recovers only through the stored native session identity and validates acknowledgement", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    released: false,
    reason: "Native process remains active",
  });
  await expect(recoverNativeManagedTurn(session.id)).resolves.toEqual({
    released: false,
    reason: "Native process remains active",
  });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("managed_turn_recover", { sessionId: session.id });
  for (const value of [null, {}, { released: "yes" }, { released: true, reason: 1 }]) {
    vi.mocked(invoke).mockResolvedValueOnce(value);
    await expect(recoverNativeManagedTurn(session.id)).rejects.toThrow("did not confirm");
  }
});

it("retains legacy and Host-owned remote lifecycle and refuses removed native workspaces", async () => {
  expect(
    await beginNativeManagedTurn({ ...session, workspaceId: undefined }, "run"),
  ).toBeUndefined();
  expect(
    await beginNativeManagedTurn({ ...session, cwd: "remote://env/repo" }, "run"),
  ).toBeUndefined();
  await expect(
    beginNativeManagedTurn({ ...session, worktreeRemoved: true }, "run"),
  ).rejects.toThrow("Resume");
  expect(upsertSession).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});
