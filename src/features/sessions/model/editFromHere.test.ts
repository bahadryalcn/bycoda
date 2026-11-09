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

it("binds a migrated file preview and confirmation to the same captured generation", async () => {
  const displayed = { ...session, cwd: "remote://env/repo", adoptedAuthorityGeneration: 2 };
  const reviewed = { ...plan, authorityGeneration: 2, planToken: "a".repeat(64) };
  remote.mockImplementation(async (_machine, method) =>
    method === "sessions.files.revertPlan" ? reviewed : result,
  );
  const retained = await planSessionFilesRevert(displayed, "message");
  expect(Object.isFrozen(retained)).toBe(true);
  await revertSessionFiles(displayed, "message", retained.planToken, retained);
  expect(remote).toHaveBeenLastCalledWith(
    "host",
    "sessions.files.revert",
    {
      sessionId: "shell",
      userBlockId: "message",
      planToken: reviewed.planToken,
      authorityGeneration: 2,
    },
    false,
    true,
  );
  expect(native).not.toHaveBeenCalled();
});

it("rejects an older selected preview when the displayed floor advances without rebinding its token", async () => {
  const selected = { ...session, cwd: "remote://env/repo", adoptedAuthorityGeneration: 2 };
  const reviewed = { ...plan, authorityGeneration: 2, planToken: "a".repeat(64) };
  remote.mockResolvedValue(reviewed);
  const retained = await planSessionFilesRevert(selected, "message");
  remote.mockClear();
  await expect(
    revertSessionFiles(
      { ...selected, adoptedAuthorityGeneration: 3 },
      "message",
      retained.planToken,
      retained,
    ),
  ).rejects.toThrow("authority changed");
  expect(retained.authorityGeneration).toBe(2);
  expect(remote).not.toHaveBeenCalled();
  expect(native).not.toHaveBeenCalled();
});

it.each([undefined, 2])(
  "does not fill a plan's captured generation %s from a newer Host response",
  async (generation) => {
    const selected = { ...session, cwd: "remote://env/repo" };
    remote.mockResolvedValue({ ...plan, authorityGeneration: 3, planToken: "b".repeat(64) });
    await expect(
      planSessionFilesRevert(selected, "message", { authorityGeneration: generation }),
    ).rejects.toThrow("authority changed");
    expect(remote).toHaveBeenLastCalledWith(
      "host",
      "sessions.files.revertPlan",
      {
        sessionId: "shell",
        userBlockId: "message",
        ...(generation === undefined ? {} : { authorityGeneration: generation }),
      },
      false,
      true,
    );
  },
);

it("requires a retained review rather than deriving a migrated mutation generation from current Session metadata", async () => {
  await expect(
    revertSessionFiles(
      { ...session, cwd: "remote://env/repo", adoptedAuthorityGeneration: 3 },
      "message",
      "a".repeat(64),
    ),
  ).rejects.toThrow("authority changed");
  expect(remote).not.toHaveBeenCalled();
  expect(native).not.toHaveBeenCalled();
});

it("uses the paired home Host for a generation-bound local mirror and never falls back after uncertain apply", async () => {
  const mirrored = { ...session, adoptedAuthorityGeneration: 2 };
  const reviewed = { ...plan, authorityGeneration: 2, planToken: "a".repeat(64) };
  native.mockResolvedValue({ id: "local-host", localHost: true });
  remote.mockResolvedValueOnce(reviewed).mockRejectedValueOnce(new Error("uncertain write"));
  const retained = await planSessionFilesRevert(mirrored, "message");
  await expect(
    revertSessionFiles(mirrored, "message", retained.planToken, retained),
  ).rejects.toThrow("uncertain write");
  expect(remote.mock.calls.filter(([, method]) => method === "sessions.files.revert")).toHaveLength(
    1,
  );
  expect(native.mock.calls.every(([command]) => command === "local_host_connect")).toBe(true);
});

it("retains old target identity when a tab binding changes during confirmation", async () => {
  const displayed = { ...session, cwd: "remote://env/repo", adoptedAuthorityGeneration: 2 };
  remote.mockResolvedValue({ ...plan, authorityGeneration: 2, planToken: "a".repeat(64) });
  const retained = await planSessionFilesRevert(displayed, "message");
  binding.mockReturnValue("different-host-session");
  remote.mockClear();
  await expect(
    revertSessionFiles(displayed, "message", retained.planToken, retained),
  ).rejects.toThrow("authority changed");
  expect(remote).not.toHaveBeenCalled();
});

it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "rejects malformed captured file authority %s before route discovery",
  async (generation) => {
    await expect(
      planSessionFilesRevert(session, "message", { authorityGeneration: generation }),
    ).rejects.toThrow("authority changed");
    expect(native).not.toHaveBeenCalled();
    expect(machine).not.toHaveBeenCalled();
  },
);
