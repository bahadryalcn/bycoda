import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "./session";
import {
  EDIT_FROM_HERE_CAPABILITY,
  planSessionFilesRevert,
  revertSessionFiles,
} from "./editFromHere";

const native = vi.hoisted(() => vi.fn());
const remote = vi.hoisted(() => vi.fn());
const binding = vi.hoisted(() => vi.fn());
const machine = vi.hoisted(() => vi.fn());
const capabilities = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: native }));
vi.mock("../../connections/model/connections", () => ({
  remoteRequest: remote,
  remoteSessionFor: binding,
  remoteMachineFor: machine,
}));
vi.mock("../../automations/model/machineSnapshot", () => ({ machineCapabilities: capabilities }));
vi.mock("../../../shared/i18n", () => ({ t: (value: string) => value }));

const session = { id: "shell", cwd: "G:/repo", blocks: [] } as unknown as Session;
const plan = {
  files: [
    { path: "src/app.ts", action: "restore" as const },
    { path: "new.ts", action: "delete" as const, conflict: "Changed by another session" },
  ],
  planToken: "reviewed-history",
};
const result = { reverted: ["src/app.ts"], skipped: [{ path: "new.ts", reason: "Changed" }] };

beforeEach(() => {
  vi.clearAllMocks();
  binding.mockReturnValue(undefined);
  machine.mockResolvedValue({ id: "host", environmentId: "env" });
  capabilities.mockResolvedValue([EDIT_FROM_HERE_CAPABILITY]);
  native.mockImplementation(async (command: string) =>
    command === "session_files_revert_plan" ? plan : result,
  );
  remote.mockImplementation(async (_machine: string, method: string) =>
    method === "sessions.files.revertPlan" ? plan : result,
  );
});

it("previews native session-owned file edits without requiring a Host", async () => {
  await expect(planSessionFilesRevert(session, "message")).resolves.toEqual(plan);
  expect(native).toHaveBeenCalledWith("session_files_revert_plan", {
    sessionId: "shell",
    userBlockId: "message",
  });
  expect(capabilities).not.toHaveBeenCalled();
  expect(remote).not.toHaveBeenCalled();
});

it("applies native history once and preserves skipped-file reasons", async () => {
  await expect(revertSessionFiles(session, "message", plan.planToken)).resolves.toEqual(result);
  expect(native).toHaveBeenCalledExactlyOnceWith("session_files_revert", {
    sessionId: "shell",
    userBlockId: "message",
    planToken: "reviewed-history",
  });
});

it("routes a remote shell to the authoritative Host session", async () => {
  binding.mockReturnValue("host-session");
  const remoteSession = { ...session, cwd: "remote://env/G:/repo" };
  await expect(planSessionFilesRevert(remoteSession, "message")).resolves.toEqual(plan);
  await expect(revertSessionFiles(remoteSession, "message")).resolves.toEqual(result);
  expect(machine).toHaveBeenCalledWith("env");
  expect(remote).toHaveBeenNthCalledWith(
    1,
    "host",
    "sessions.files.revertPlan",
    { sessionId: "host-session", userBlockId: "message" },
    false,
    true,
  );
  expect(remote).toHaveBeenNthCalledWith(
    2,
    "host",
    "sessions.files.revert",
    { sessionId: "host-session", userBlockId: "message" },
    false,
    true,
  );
  expect(native).not.toHaveBeenCalled();
});

it("uses the local Host for an adopted local session", async () => {
  binding.mockReturnValue("host-session");
  native.mockResolvedValue({ id: "local-host", localHost: true });
  await expect(planSessionFilesRevert(session, "message")).resolves.toEqual(plan);
  expect(native).toHaveBeenCalledExactlyOnceWith("local_host_connect");
  expect(remote).toHaveBeenCalledWith(
    "local-host",
    "sessions.files.revertPlan",
    { sessionId: "host-session", userBlockId: "message" },
    false,
    true,
  );
});

it("keeps conversation-only editing available when the Host lacks file history", async () => {
  capabilities.mockResolvedValue([]);
  const remoteSession = { ...session, cwd: "remote://env/repo" };
  const preview = await planSessionFilesRevert(remoteSession, "message");
  expect(preview.files).toEqual([]);
  expect(preview.unavailable).toMatch(/Update bycoda Host/);
  await expect(revertSessionFiles(remoteSession, "message")).rejects.toThrow("Update bycoda Host");
  expect(remote).not.toHaveBeenCalled();
  expect(native).not.toHaveBeenCalled();
});

it("does not fall back to native or retry a failed Host mutation", async () => {
  remote.mockRejectedValue(new Error("Lost connection"));
  await expect(
    revertSessionFiles({ ...session, cwd: "remote://env/repo" }, "message"),
  ).rejects.toThrow("Lost connection");
  expect(remote).toHaveBeenCalledTimes(1);
  expect(native).not.toHaveBeenCalled();
});

it("does not use a local folder when the remote machine is disconnected", async () => {
  machine.mockResolvedValue(undefined);
  await expect(
    planSessionFilesRevert({ ...session, cwd: "remote://env/repo" }, "message"),
  ).rejects.toThrow("not connected");
  expect(native).not.toHaveBeenCalled();
  expect(remote).not.toHaveBeenCalled();
});
