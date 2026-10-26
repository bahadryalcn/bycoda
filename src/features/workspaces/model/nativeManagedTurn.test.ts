// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { upsertSession } from "../../sessions/data/sessionStore";
import { newSession } from "../../sessions/model/session";
import { beginNativeManagedTurn } from "./nativeManagedTurn";

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
});

it("durably saves the accepted boundary before Host admission and ends the same run", async () => {
  let release!: (value: never) => void;
  vi.mocked(upsertSession).mockReturnValue(new Promise((resolve) => (release = resolve)));
  const pending = beginNativeManagedTurn(session, "run");
  expect(invoke).not.toHaveBeenCalled();
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
  expect(invoke).not.toHaveBeenCalled();
});

it("propagates unknown admission and end outcomes without retrying mutations", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("lost begin receipt"));
  await expect(beginNativeManagedTurn(session, "run")).rejects.toThrow("lost begin receipt");
  expect(invoke).toHaveBeenCalledTimes(1);
  const finish = await beginNativeManagedTurn(session, "next-run");
  vi.mocked(invoke).mockRejectedValueOnce(new Error("lost end receipt"));
  await expect(finish!(false)).rejects.toThrow("lost end receipt");
  expect(invoke).toHaveBeenCalledTimes(3);
});

it("keeps unknown writer retirement fenced", async () => {
  const finish = await beginNativeManagedTurn(session, "run");
  await expect(finish!(true)).rejects.toThrow("could not be retired");
  expect(invoke).toHaveBeenCalledTimes(1);
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
