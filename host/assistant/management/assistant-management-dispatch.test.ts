import { expect, it, vi } from "vitest";
import {
  createRoomManagementDispatcher,
  roomManagementDiscovery,
  roomManagementInput,
  captureRoomProject,
} from "./assistant-management-dispatch";

it("discovers only executable tools and preserves prior operation references", () => {
  const search = roomManagementDiscovery("tools.search", { query: "tasks", limit: 5 }, "project");
  expect(search.tools.length).toBeGreaterThan(0);
  expect(search.tools.length).toBeLessThanOrEqual(5);
  const first = search.tools[0].id;
  expect(roomManagementDiscovery("tools.describe", { ids: [first] }, "project")).toMatchObject({
    tools: [{ id: first }],
  });
  const parts: string[] = [];
  let cursor: string | null = "0:0";
  while (cursor) {
    const page = roomManagementDiscovery(
      "tools.describe",
      { ids: [first], maxChars: 200, cursor },
      "project",
    );
    if (page.fragment) parts.push(page.fragment.text);
    else if (page.tools[0]) parts.push(JSON.stringify(page.tools[0]));
    cursor = page.nextCursor;
  }
  expect(JSON.parse(parts.join(""))).toMatchObject({ id: first });
  expect(
    roomManagementInput("conversation", "servers.ssh.status", { requestId: "prior" }, "new"),
  ).toEqual({ requestId: "prior" });
  expect(
    roomManagementInput("conversation", "remote.result", { requestId: "prior" }, "new"),
  ).toEqual({ requestId: "prior" });
  expect(
    roomManagementInput("conversation", "inbox.result", { requestId: "prior" }, "new"),
  ).toEqual({ requestId: "prior" });
  expect(
    roomManagementInput("conversation", "remote.call", { requestId: "prior" }, "new"),
  ).toMatchObject({ requestId: "new" });
  expect(
    roomManagementInput(
      "conversation",
      "crews.resolve",
      { runId: "run", requestId: "prior" },
      "new",
    ),
  ).toMatchObject({ requestId: "prior", operationId: "new" });
});

it("binds a real Room thread and visible target without inventing provenance", async () => {
  let allowed = true;
  const execute = vi.fn(async () => {
    captureRoomProject("project", "/qualified/project");
    return { items: [] };
  });
  const visibleProject = vi.fn(async () => true);
  const dispatch = createRoomManagementDispatcher({
    environmentId: "host",
    thread: async (id) => ({ id }),
    visibleProject,
    execute,
  });
  const admission = {
    environmentId: "host",
    deviceHash: "owner-device",
    authorized: async () => allowed,
  };
  const call = {
    threadId: "room",
    projectId: "project",
    family: "conversation" as const,
    action: "tasks.list",
    input: {},
    requestId: "operation",
  };
  const result = await dispatch(call, admission);
  expect(result.source).toEqual({
    environmentId: "host",
    threadId: "room",
    projectId: "project",
    projectCwd: "/qualified/project",
    family: "conversation",
    action: "tasks.list",
  });
  expect(result.contributorProjects).toEqual([{ projectId: "project", cwd: "/qualified/project" }]);
  expect(result.contributorProjectIds).toEqual(["project"]);
  expect(visibleProject).toHaveBeenCalledWith("project", "room", admission);
  allowed = false;
  await expect(dispatch(call, admission)).rejects.toThrow("authority unavailable");
  expect(execute).toHaveBeenCalledTimes(1);
});

it("fails closed on locked targets and owner revocation during an effect", async () => {
  let allowed = true;
  const execute = vi.fn(async () => {
    allowed = false;
    return { accepted: true };
  });
  const admission = {
    environmentId: "host",
    deviceHash: "owner-device",
    authorized: async () => allowed,
  };
  const call = {
    threadId: "room",
    projectId: "project",
    family: "conversation" as const,
    action: "tasks.list",
    input: {},
    requestId: "operation",
  };
  const locked = createRoomManagementDispatcher({
    environmentId: "host",
    thread: async (id) => ({ id }),
    visibleProject: async () => false,
    execute,
  });
  await expect(locked(call, admission)).rejects.toThrow("unavailable or locked");
  expect(execute).not.toHaveBeenCalled();
  const dispatch = createRoomManagementDispatcher({
    environmentId: "host",
    thread: async (id) => ({ id }),
    visibleProject: async () => true,
    execute,
  });
  await expect(dispatch(call, admission)).rejects.toThrow("authority unavailable");
});

it("reports native workspace readiness as unknown and describes its acceptance boundary", () => {
  const status = roomManagementDiscovery(
    "tools.status",
    { ids: ["conversation:workspace.sessions.submit"], limit: 10 },
    "project",
  );
  expect(status.tools).toMatchObject([
    {
      action: "workspace.sessions.submit",
      availability: "unknown",
      description: expect.stringContaining("not the final UI result"),
    },
  ]);
  const host = roomManagementDiscovery(
    "tools.describe",
    { ids: ["conversation:sessions.submit"] },
    "project",
  );
  expect(host.tools).toMatchObject([{ action: "sessions.submit" }]);
});

it("requires Host-branded Native observation provenance", async () => {
  const { roomNativeResult } = await import("../native/assistant-native-library-proof");
  const proof = {
    environmentId: "host",
    threadId: "room",
    installationId: "installation",
    issuer: "issuer",
    registryRevision: "revision",
    visibilityEpoch: 1,
    policyGeneration: "policy",
  };
  let output: unknown = { value: { events: [] }, proofs: [proof] };
  const dispatch = createRoomManagementDispatcher({
    environmentId: "host",
    thread: async (id) => ({ id }),
    visibleProject: async () => true,
    execute: async () => output,
  });
  const admission = {
    environmentId: "host",
    deviceHash: "owner-device",
    authorized: async () => true,
  };
  const call = {
    threadId: "room",
    family: "conversation" as const,
    action: "observations.read",
    input: { nativeLibrary: true },
    requestId: "request",
  };
  await expect(dispatch(call, admission)).rejects.toThrow(
    "Native library provenance is unavailable",
  );
  output = roomNativeResult({ events: [] }, [proof]);
  expect(await dispatch(call, admission)).toMatchObject({
    value: { events: [] },
    source: { nativeLibrary: true },
    contributorNativeProofs: [proof],
  });
});
