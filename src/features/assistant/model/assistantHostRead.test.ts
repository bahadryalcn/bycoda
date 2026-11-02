// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn(), environmentId: "host-original", descriptorEnvironmentId: "host-original", capabilities: ["assistant.v1"] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
import { captureAssistantHostRead } from "./assistantHostRead";
beforeEach(() => {
  native.environmentId = native.descriptorEnvironmentId = "host-original"; native.capabilities = ["assistant.v1"];
  native.invoke.mockReset().mockImplementation(async (command: string, input?: any) => {
    if (command === "local_host_connect") return { id: "native-local-machine", environmentId: native.environmentId, endpoint: "http://127.0.0.1:1", name: "Local", localHost: true };
    if (command !== "remote_request") throw new Error(`Unexpected native command: ${command}`);
    if (input.expectedEnvironmentId !== native.environmentId) throw new Error("Native rejected a different Host environment");
    if (input.method === "environment.describe") return { environmentId: native.descriptorEnvironmentId, capabilities: native.capabilities };
    if (input.method === "goals.list") return [];
    if (input.method === "automations.list") return [];
    if (input.method === "sessions.get") return { projectId: "project", session: { id: input.params.sessionId } };
    if (input.method === "assistant.request" && input.params.op === "projects.list") return { projects: [{ id: "project", path: "/project", name: "Project" }] };
    throw new Error("Native refused an unexpected metadata operation");
  });
});
it("uses the real default remoteRequest transport with one captured native identity for finite reads", async () => {
  const reader = await captureAssistantHostRead(); await reader.goals(); await reader.session("session"); await reader.projects();await reader.automations();
  expect(reader.environmentId).toBe("host-original");
  expect(native.invoke.mock.calls.filter(([command]) => command === "local_host_connect")).toHaveLength(1);
  const requests = native.invoke.mock.calls.filter(([command]) => command === "remote_request");
  expect(requests.map(([, input]) => input.method)).toEqual(["environment.describe", "goals.list", "sessions.get", "assistant.request","automations.list"]);
  expect(requests.every(([, input]) => input.machineId === "native-local-machine" && input.expectedEnvironmentId === "host-original")).toBe(true);
  expect(Object.keys(reader).sort()).toEqual(["automations","environmentId", "goals", "projects", "session", "snapshot"]);
});
it("does not recapture or retarget a later lookup after the native Host changes", async () => {
  const reader = await captureAssistantHostRead("host-original"); native.environmentId = "replacement";
  await expect(reader.session("session")).rejects.toThrow("different Host environment");
  expect(native.invoke.mock.calls.filter(([command]) => command === "local_host_connect")).toHaveLength(1);
  await expect(captureAssistantHostRead("host-original")).rejects.toThrow("original connection");
});
it("refuses descriptor mismatch or a Host without the actual assistant capability before source reads", async () => {
  native.descriptorEnvironmentId = "replacement"; await expect(captureAssistantHostRead()).rejects.toThrow("connection changed");
  native.descriptorEnvironmentId = "host-original"; native.capabilities = []; await expect(captureAssistantHostRead()).rejects.toThrow("Update bycoda Host");
  expect(native.invoke.mock.calls.filter(([, input]) => input?.method === "goals.list" || input?.method === "sessions.get")).toHaveLength(0);
});
