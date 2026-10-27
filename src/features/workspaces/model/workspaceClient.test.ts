import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { hostProjectFor } from "../../automations/model/hostAutomationClient";
import { machineCapabilities } from "../../automations/model/machineSnapshot";
import { remoteRequest } from "../../connections/model/connections";
import {
  resolveWorkspaceContext,
  workspaceRequest,
  WorkspaceCapabilityError,
} from "./workspaceClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../automations/model/hostAutomationClient", () => ({
  hostProjectFor: vi.fn(),
  backgroundMachineFor: vi.fn(),
}));
vi.mock("../../automations/model/machineSnapshot", () => ({ machineCapabilities: vi.fn() }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: vi.fn() }));
const local = { id: "local-machine", environmentId: "env-local" };
const remote = { id: "remote-machine", environmentId: "env-remote" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "local_host_connect" ? local : [local, remote],
  );
  vi.mocked(hostProjectFor).mockResolvedValue({ id: "host-project", cwd: "/repo", name: "repo" });
  vi.mocked(machineCapabilities).mockResolvedValue([
    "workspaces.managed.v1",
    "workspaces.policy.v1",
    "workspaces.delivery.v1",
  ]);
});

it("resolves real host IDs and sends owner writes over authenticated transport", async () => {
  expect(await resolveWorkspaceContext("/repo")).toEqual({
    cwd: "/repo",
    projectId: "host-project",
    environmentId: "env-local",
    machineId: "local-machine",
  });
  await workspaceRequest(
    "projects.workspacePolicy.get",
    { projectId: "/repo", environmentId: "local" },
    { cwd: "/repo" },
  );
  expect(remoteRequest).toHaveBeenCalledWith(
    "local-machine",
    "projects.workspacePolicy.get",
    { projectId: "host-project", environmentId: "env-local" },
    false,
    true,
  );
});

it("never falls back to the local host when a remote project is disconnected", async () => {
  vi.mocked(invoke).mockResolvedValue([local]);
  await expect(
    workspaceRequest(
      "workspaces.get",
      { workspaceId: "owned" },
      { cwd: "remote://env-remote/repo" },
    ),
  ).rejects.toThrow("not connected");
  expect(invoke).not.toHaveBeenCalledWith("local_host_connect");
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("checks the execution machine capability before attempting creation", async () => {
  vi.mocked(machineCapabilities).mockResolvedValue([]);
  await expect(
    workspaceRequest(
      "workspaces.resume",
      { workspaceId: "owned", expectedRevision: 4, idempotencyKey: "resume" },
      { cwd: "/repo" },
    ),
  ).rejects.toBeInstanceOf(WorkspaceCapabilityError);
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("routes local managed cleanup through native activity checks and the same Host owner plan", async () => {
  vi.mocked(machineCapabilities).mockResolvedValue(["workspaces.lifecycle.v1"]);
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "local_host_connect") return { ...local, localHost: true };
    if (command === "managed_worktree_removal_plan") return { token: "native-reviewed-plan" };
    if (command === "managed_worktree_removal_apply") throw new Error("Removal outcome unknown");
    throw new Error(`Unexpected command ${command}`);
  });
  await expect(
    workspaceRequest(
      "workspaces.cleanup.plan",
      { workspaceId: "owned", expectedRevision: 4 },
      { cwd: "/repo" },
    ),
  ).resolves.toEqual({ token: "native-reviewed-plan" });
  await expect(
    workspaceRequest(
      "workspaces.cleanup.apply",
      {
        workspaceId: "owned",
        expectedRevision: 4,
        planToken: "native-reviewed-plan",
        idempotencyKey: "remove-once",
      },
      { cwd: "/repo" },
    ),
  ).rejects.toThrow("Removal outcome unknown");
  expect(invoke).toHaveBeenCalledWith("managed_worktree_removal_apply", {
    request: {
      workspaceId: "owned",
      expectedRevision: 4,
      planToken: "native-reviewed-plan",
      idempotencyKey: "remove-once",
    },
  });
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "managed_worktree_removal_apply"),
  ).toHaveLength(1);
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("keeps remote cleanup on its owning machine without a local native removal", async () => {
  vi.mocked(machineCapabilities).mockResolvedValue(["workspaces.lifecycle.v1"]);
  await workspaceRequest(
    "workspaces.cleanup.plan",
    { workspaceId: "owned", expectedRevision: 4 },
    { cwd: "remote://env-remote/repo" },
  );
  expect(remoteRequest).toHaveBeenCalledWith(
    "remote-machine",
    "workspaces.cleanup.plan",
    { workspaceId: "owned", expectedRevision: 4 },
    false,
    true,
  );
  expect(
    vi.mocked(invoke).mock.calls.some(([command]) => command === "managed_worktree_removal_plan"),
  ).toBe(false);
});

it("requires publication support for publish reviews and never retries an uncertain write", async () => {
  await expect(
    workspaceRequest(
      "workspaces.delivery.review",
      {
        workspaceId: "owned",
        expectedRevision: 4,
        action: "publish",
        publication: {
          repository: "owner/repo",
          remote: "origin",
          baseBranchRef: "refs/heads/main",
          headBranchRef: "refs/heads/work",
          title: "Change",
          body: "",
        },
      },
      { cwd: "/repo" },
    ),
  ).rejects.toThrow("Update bycoda Host");
  expect(remoteRequest).not.toHaveBeenCalled();
  vi.mocked(remoteRequest).mockRejectedValue(new Error("connection lost"));
  await expect(
    workspaceRequest(
      "workspaces.delivery.merge",
      {
        workspaceId: "owned",
        expectedRevision: 4,
        idempotencyKey: "same-op",
        planToken: "review-shas",
      },
      { cwd: "/repo" },
    ),
  ).rejects.toThrow("connection lost");
  expect(remoteRequest).toHaveBeenCalledTimes(1);
});
