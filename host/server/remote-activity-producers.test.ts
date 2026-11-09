import { describe, expect, it, vi } from "vitest";
import { RemoteActivityFeed } from "../desktop/remoteActivity";
import { handleNativeRpc } from "./rpc-native";
import { handleProjectsRpc } from "./rpc-projects";
import { handleSessionsRpc } from "./rpc-sessions";
import { handleWorkspacesRpc } from "./rpc-workspaces";
import { LOCAL_DESKTOP_DEVICE_NAME } from "./remote-activity-record";

function fixture(deviceName: string) {
  const remoteActivity = new RemoteActivityFeed();
  const store = {
    environmentId: "env",
    project: vi.fn(async () => ({ id: "p1", cwd: "/work/app" })),
    pairedDevices: vi.fn(async () => ({
      devices: [{ name: deviceName, isCurrent: true }],
    })),
    assertAuthority: vi.fn(async () => {}),
    session: vi.fn(async () => ({ projectId: "p1" })),
  };
  const workspace = { id: "w1", projectId: "p1" };
  const dependencies = {
    remoteActivity,
    engine: { store, updateSession: vi.fn(async () => ({})) },
    adopt: vi.fn(async () => {}),
    workspaceForOwnerRpc: vi.fn(async () => workspace),
    managedWorkspaces: { close: vi.fn(async () => ({})), finish: vi.fn(async () => ({})) },
    managed: { retention: { onLifecycle: vi.fn(async () => {}) } },
    workspacePolicy: { update: vi.fn(async () => ({})) },
    scopedDesktopCall: vi.fn(async () => ({})),
    nativeWorkspacesService: { call: vi.fn(async () => ({})) },
  };
  const request = (method: string, params: Record<string, unknown>) => ({
    input: { method },
    params,
    token: "token",
    tokenHash: "hash",
    result: undefined as unknown,
  });
  return { dependencies, remoteActivity, request };
}

const events = (feed: RemoteActivityFeed) => feed.since(0).events;

describe("remote activity producers", () => {
  it("records an archive, worktree close, cleanup and policy change from a remote device", async () => {
    const { dependencies, remoteActivity, request } = fixture("Phone");
    await handleSessionsRpc(
      dependencies as never,
      request("sessions.update", { sessionId: "s1", projectId: "p1", archived: true }) as never,
    );
    await handleWorkspacesRpc(
      dependencies as never,
      request("workspaces.close", { workspaceId: "w1" }) as never,
    );
    await handleNativeRpc(
      dependencies as never,
      request("workspaces.cleanup.apply", { workspaceId: "w1" }) as never,
    );
    await handleProjectsRpc(
      dependencies as never,
      request("projects.workspacePolicy.update", {
        projectId: "p1",
        environmentId: "env",
      }) as never,
    );
    await handleProjectsRpc(
      dependencies as never,
      request("projects.organization.patch", {}) as never,
    );
    expect(events(remoteActivity)).toEqual([
      { kind: "archived", cwd: "/work/app", requestedBy: "Phone" },
      { kind: "worktreeChanged", cwd: "/work/app", requestedBy: "Phone" },
      { kind: "worktreeChanged", cwd: "/work/app", requestedBy: "Phone" },
      { kind: "settingsChanged", cwd: "/work/app", requestedBy: "Phone" },
      { kind: "settingsChanged", cwd: "", requestedBy: "Phone" },
    ]);
  });

  it("does not record for this machine's own desktop, or an unarchive", async () => {
    const { dependencies, remoteActivity, request } = fixture(LOCAL_DESKTOP_DEVICE_NAME);
    await handleSessionsRpc(
      dependencies as never,
      request("sessions.update", { sessionId: "s1", projectId: "p1", archived: true }) as never,
    );
    await handleWorkspacesRpc(
      dependencies as never,
      request("workspaces.finish", { workspaceId: "w1" }) as never,
    );
    await handleProjectsRpc(
      dependencies as never,
      request("projects.workspacePolicy.update", {
        projectId: "p1",
        environmentId: "env",
      }) as never,
    );
    const remote = fixture("Phone");
    await handleSessionsRpc(
      remote.dependencies as never,
      request("sessions.update", { sessionId: "s1", projectId: "p1", archived: false }) as never,
    );
    expect(events(remoteActivity)).toEqual([]);
    expect(events(remote.remoteActivity)).toEqual([]);
  });

  it("does not record when the change failed", async () => {
    const { dependencies, remoteActivity, request } = fixture("Phone");
    dependencies.managedWorkspaces.close.mockRejectedValue(new Error("nope"));
    dependencies.workspacePolicy.update.mockRejectedValue(new Error("nope"));
    dependencies.engine.updateSession.mockRejectedValue(new Error("nope"));
    dependencies.nativeWorkspacesService.call.mockRejectedValue(new Error("nope"));
    const attempts = [
      handleWorkspacesRpc(
        dependencies as never,
        request("workspaces.close", { workspaceId: "w1" }) as never,
      ),
      handleProjectsRpc(
        dependencies as never,
        request("projects.workspacePolicy.update", {
          projectId: "p1",
          environmentId: "env",
        }) as never,
      ),
      handleSessionsRpc(
        dependencies as never,
        request("sessions.update", { sessionId: "s1", projectId: "p1", archived: true }) as never,
      ),
      handleNativeRpc(
        dependencies as never,
        request("workspaces.cleanup.apply", { workspaceId: "w1" }) as never,
      ),
    ];
    for (const attempt of attempts) await expect(attempt).rejects.toThrow("nope");
    expect(events(remoteActivity)).toEqual([]);
  });
});
