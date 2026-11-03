// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { captureRemoteVoiceHistory, captureVoiceHistorySession } from "./voiceHistoryTransport";
import type { AssistantRequest } from "../../../shared/model/host-contracts/assistant";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  known: vi.fn(),
  machine: vi.fn(),
  project: vi.fn(),
  capabilities: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mocks.invoke(...args) }));
vi.mock("../../connections/model/connections", () => ({
  knownRemoteMachine: (...args: unknown[]) => mocks.known(...args),
  remoteMachineFor: (...args: unknown[]) => mocks.machine(...args),
  remoteRequest: (...args: unknown[]) => mocks.rpc(...args),
  remoteSessionFor: (id: string) =>
    JSON.parse(localStorage.getItem("bycoda.remote-tabs.v2") ?? "{}")[id],
}));
vi.mock("../../connections/model/remoteHealth", () => ({
  subscribeRemoteRecovered: () => () => undefined,
}));
vi.mock("../../automations/model/machineSnapshot", () => ({
  machineCapabilities: (...args: unknown[]) => mocks.capabilities(...args),
}));
vi.mock("../../connections/model/remoteProjects", async (original) => ({
  ...(await original<typeof import("../../connections/model/remoteProjects")>()),
  remoteProjectFor: (...args: unknown[]) => mocks.project(...args),
}));
const machine = {
  id: "mac",
  environmentId: "remote-env",
  name: "Same name",
  endpoint: "https://remote.invalid",
};
const project = {
  key: "remote://remote-env/repo",
  environmentId: "remote-env",
  projectId: "canonical-remote",
  cwd: "/repo",
};
const thread = {
  id: "remote-thread",
  projectId: project.projectId,
  summary: "Prior discussion",
  version: 1,
  createdAt: 1,
  updatedAt: 1,
};
let projects = [{ id: project.projectId, path: "/repo", name: "Same name" }],
  available = true;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  available = true;
  projects = [{ id: project.projectId, path: "/repo", name: "Same name" }];
  mocks.invoke.mockImplementation(async (command) =>
    command === "remote_machines" ? [machine] : null,
  );
  mocks.known.mockReturnValue(machine);
  mocks.machine.mockResolvedValue(machine);
  mocks.project.mockReturnValue(project);
  mocks.capabilities.mockResolvedValue(["assistant.v1"]);
  mocks.rpc.mockImplementation(async (_id: string, method: string, input: AssistantRequest) => {
    if (!available) throw new Error("offline");
    if (method === "environment.describe")
      return { environmentId: machine.environmentId, capabilities: ["assistant.v1"] };
    if (input.op === "projects.list") return { projects };
    if (input.op === "threads.open") return { thread };
    if (input.op === "threads.messages") return { messages: [] };
    if (input.op === "threads.append")
      return {
        message: {
          id: "message-1",
          version: 1,
          createdAt: 1,
          updatedAt: 1,
          threadId: input.threadId,
          role: input.role,
          via: input.via,
          text: input.text,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          jobIds: [],
        },
      };
    throw new Error("unexpected route");
  });
});
async function open() {
  const route = captureRemoteVoiceHistory(project.key);
  const listed = await route.request({ op: "projects.list" });
  expect(listed.projects?.[0].path).toBe(project.key);
  await route.request({ op: "threads.open", projectId: project.projectId });
  return route;
}
it("uses the production finite owner client and canonical captured remote IDs without opening a local project", async () => {
  const route = await open();
  await route.request({ op: "threads.messages", threadId: thread.id, limit: 6 });
  const request = {
    op: "threads.append" as const,
    threadId: thread.id,
    role: "assistant" as const,
    via: "voice" as const,
    text: "Accepted reply",
    sessionId: "actual-remote-session",
    jobIds: [],
    idempotencyKey: "original-key",
  };
  await route.request(request);
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    "mac",
    "assistant.request",
    request,
    false,
    false,
    "remote-env",
  );
  expect(
    mocks.rpc.mock.calls.every(
      ([id, , , fresh, user, environment]) =>
        id === "mac" && fresh === false && user === false && environment === "remote-env",
    ),
  ).toBe(true);
  expect(mocks.invoke.mock.calls.every(([command]) => command === "remote_machines")).toBe(true);
});
it("retains its original machine/project through failed lookup and changed directory objects", async () => {
  const mutableMachine = { ...machine },
    mutableProject = { ...project };
  mocks.known.mockReturnValue(mutableMachine);
  mocks.project.mockReturnValue(mutableProject);
  const route = captureRemoteVoiceHistory(project.key);
  mutableMachine.id = "other";
  mutableProject.projectId = "other-project";
  available = false;
  await expect(route.request({ op: "projects.list" })).rejects.toThrow("offline");
  available = true;
  expect((await route.request({ op: "projects.list" })).projects?.[0].id).toBe(project.projectId);
  expect(mocks.rpc.mock.calls.every(([id]) => id === "mac")).toBe(true);
  projects = [{ id: "replacement", path: "/repo", name: "Same name" }];
  await expect(route.request({ op: "threads.open", projectId: "replacement" })).rejects.toThrow(
    "verified",
  );
  expect(
    mocks.rpc.mock.calls.some(
      ([, method, input]) => method === "projects.open" || input?.op === "threads.open",
    ),
  ).toBe(false);
});
it("refuses wrong environments, unsupported Hosts and arbitrary owner operations", async () => {
  const route = captureRemoteVoiceHistory(project.key);
  await expect(route.request({ op: "pauseAll", paused: true })).rejects.toThrow("only stores");
  expect(mocks.rpc).not.toHaveBeenCalled();
  await expect(
    route.request({ op: "memory.search", query: "private", scope: "all" }),
  ).rejects.toThrow("only stores");
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValueOnce({ environmentId: "foreign", capabilities: ["assistant.v1"] });
  await expect(route.request({ op: "projects.list" })).rejects.toThrow("compatible");
  mocks.rpc.mockResolvedValueOnce({ environmentId: machine.environmentId, capabilities: [] });
  await expect(route.request({ op: "projects.list" })).rejects.toThrow("compatible");
});
it("refuses thread replacement or foreign-message replies without retargeting", async () => {
  const route = await open();
  mocks.rpc
    .mockImplementationOnce(async () => ({
      environmentId: machine.environmentId,
      capabilities: ["assistant.v1"],
    }))
    .mockImplementationOnce(async () => ({ projects }))
    .mockImplementationOnce(async () => ({ thread: { ...thread, id: "replacement-thread" } }));
  await expect(route.request({ op: "threads.open", projectId: project.projectId })).rejects.toThrow(
    "identity changed",
  );
  await expect(
    route.request({ op: "threads.messages", threadId: "foreign-thread", limit: 6 }),
  ).rejects.toThrow("another conversation");
});
it("associates only proven Host session IDs and never a remote session with the local global thread", () => {
  localStorage.setItem("bycoda.remote-tabs.v2", JSON.stringify({ shell: "actual-host-session" }));
  expect(captureVoiceHistorySession({ id: "shell" }, project.key)).toBe("actual-host-session");
  expect(captureVoiceHistorySession({ id: "shell" }, project.key, true)).toBeUndefined();
  expect(captureVoiceHistorySession({ id: "native-only" }, "/repo")).toBeUndefined();
  expect(
    captureVoiceHistorySession(
      {
        id: "local-shell",
        hostBinding: {
          kind: "local-host",
          machineId: "local",
          environmentId: "local-env",
          projectId: "p",
          sessionId: "actual-local",
          created: true,
          authorityGeneration: null,
        },
      },
      "/repo",
    ),
  ).toBe("actual-local");
});
