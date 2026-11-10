import { expect, it, vi } from "vitest";
import { callRoomAppRead, isRoomAppRead, listHostDevices } from "./assistant-room-app-reads";
import type { AssistantThreadPrincipal } from "../../sessions/session-authority";

const principal = {
  kind: "assistant-thread",
  threadId: "thread",
  projectId: "p",
  provider: "assistant",
} as AssistantThreadPrincipal;
const ports = () => {
  const projects = { call: vi.fn(async () => ({ items: [] })) };
  const devices = {
    list: vi.fn(async () => ({
      devices: Array.from({ length: 120 }, (_, id) => ({ id })),
      errors: [],
    })),
  };
  const monitors = { list: vi.fn(() => [{ id: "m", projectId: "p" }]) };
  return { projects, devices, monitors } as never as Parameters<typeof callRoomAppRead>[0] & {
    projects: { call: ReturnType<typeof vi.fn> };
    devices: { list: ReturnType<typeof vi.fn> };
    monitors: { list: ReturnType<typeof vi.fn> };
  };
};

it("routes project model and usage reads through the thread's own project identity", async () => {
  const p = ports();
  await callRoomAppRead(p, "models.list", {}, principal, "/repo", async () => true);
  await callRoomAppRead(
    p,
    "usage.sessions.read",
    { from: 1 },
    principal,
    "/repo",
    async () => true,
  );
  expect(p.projects.call).toHaveBeenNthCalledWith(
    1,
    "models.list",
    {},
    principal,
    expect.any(Function),
  );
  expect(p.projects.call).toHaveBeenCalledTimes(2);
});

it("lists monitors for the thread's project only and pages devices to the requested limit", async () => {
  const p = ports();
  expect(
    await callRoomAppRead(p, "logs.monitors.list", {}, principal, "/repo", async () => true),
  ).toMatchObject({ items: [{ id: "m" }], total: 1 });
  expect(p.monitors.list).toHaveBeenCalledWith("p");
  const page = (await listHostDevices(p.devices, { limit: 5 }, async () => true)) as {
    devices: unknown[];
    pagination: { devices: { nextOffset: number | null } };
  };
  expect(page.devices).toHaveLength(5);
  expect(page.pagination.devices.nextOffset).toBe(5);
});

it("refuses connected machines, unknown actions, non-thread principals and revoked authority", async () => {
  const p = ports();
  await expect(listHostDevices(p.devices, { machineId: "mac" }, async () => true)).rejects.toThrow(
    /focused session/,
  );
  await expect(
    callRoomAppRead(p, "git.push", {}, principal, "/repo", async () => true),
  ).rejects.toThrow(/Unsupported/);
  await expect(
    callRoomAppRead(
      p,
      "models.list",
      {},
      { kind: "session", projectId: "p", sessionId: "s", provider: "x" } as never,
      "/repo",
      async () => true,
    ),
  ).rejects.toThrow(/Unsupported/);
  await expect(
    callRoomAppRead(p, "models.list", {}, principal, "/repo", async () => false),
  ).rejects.toThrow(/revoked/);
  expect(isRoomAppRead("skills.read")).toBe(true);
  expect(isRoomAppRead("tasks.delete")).toBe(false);
});
