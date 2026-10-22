import { expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { loadRemoteCapabilities, recordRemoteCapabilities, remoteMachineFor } from "./connections";
import { remoteSupports, GIT_ACTIONS } from "./remoteCapabilities";
import { remotePath } from "./remoteProjects";

it("is always supported on this computer", () => {
  expect(remoteSupports("/Users/me/repo", GIT_ACTIONS)).toBe(true);
});

it("tells an old host from a new one, and unknown from both", () => {
  const project = remotePath("env-a", "/Users/me/repo");
  expect(remoteSupports(project, GIT_ACTIONS)).toBeUndefined();
  recordRemoteCapabilities("env-a", ["workspace.run", "git.index"]);
  expect(remoteSupports(project, GIT_ACTIONS)).toBe(false);
  recordRemoteCapabilities("env-a", ["workspace.run", "git.index", GIT_ACTIONS]);
  expect(remoteSupports(project, GIT_ACTIONS)).toBe(true);
  // A host that advertises nothing at all is old, not unknown.
  recordRemoteCapabilities("env-b", undefined);
  expect(remoteSupports(remotePath("env-b", "/x"), GIT_ACTIONS)).toBe(false);
});

it("reads capabilities from the machine", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === "remote_machines")
      return [{ id: "m1", name: "Mac", endpoint: "", environmentId: "env-c" }];
    if (command === "remote_request") return { capabilities: [GIT_ACTIONS] };
    throw new Error(command);
  });
  expect(await remoteMachineFor("env-c")).toMatchObject({ id: "m1" });
  expect(await loadRemoteCapabilities("env-c")).toEqual([GIT_ACTIONS]);
  expect(remoteSupports(remotePath("env-c", "/x"), GIT_ACTIONS)).toBe(true);
});

it("reuses a young describe answer and asks again after the TTL or an invalidation", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  const { invalidateRemoteCapabilities, REMOTE_CAPABILITIES_TTL_MS } =
    await import("./connections");
  vi.useFakeTimers();
  try {
    let describes = 0;
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "remote_machines")
        return [{ id: "m1", name: "Mac", endpoint: "", environmentId: "env-c" }];
      if (command === "remote_request") {
        describes++;
        return { capabilities: ["a"] };
      }
      throw new Error(command);
    });
    // env-c is the machine the previous test already loaded into the list.
    invalidateRemoteCapabilities("env-c");
    await loadRemoteCapabilities("env-c");
    await loadRemoteCapabilities("env-c");
    expect(describes).toBe(1);
    invalidateRemoteCapabilities("env-c");
    await loadRemoteCapabilities("env-c");
    expect(describes).toBe(2);
    vi.advanceTimersByTime(REMOTE_CAPABILITIES_TTL_MS + 1);
    await loadRemoteCapabilities("env-c");
    expect(describes).toBe(3);
  } finally {
    vi.useRealTimers();
  }
});
