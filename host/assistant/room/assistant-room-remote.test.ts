import { expect, it, vi } from "vitest";
import { AssistantRoomRemote } from "./assistant-room-remote";

it("never replays a delegated mutation or cached remote data from its original receipt", async () => {
  const rows = new Map<string, any>();
  const native = vi.fn(async () => ({
    value: { taskId: "task", status: "queued" },
    targetEnvironmentId: "target",
    remoteContext: "unverified",
  }));
  const remote = new AssistantRoomRemote({
    read: async (key) => rows.get(key),
    write: async (key, value) => {
      rows.set(key, value);
    },
    native,
  });
  const source = { environmentId: "origin", threadId: "room" };
  const input = {
    grantId: "reviewed-grant",
    requestId: "original",
    action: "tasks.create",
    input: { title: "Reviewed" },
  };
  expect(
    await remote.call("remote.call", input, source, "original", async () => true),
  ).toMatchObject({ state: "returned", result: { value: { taskId: "task" } } });
  const duplicate = await remote.call("remote.call", input, source, "original", async () => true);
  expect(duplicate).toMatchObject({ state: "returned", resultRetained: false });
  expect(duplicate).not.toHaveProperty("result");
  await expect(
    remote.call(
      "remote.call",
      { ...input, input: { title: "Changed" } },
      source,
      "original",
      async () => true,
    ),
  ).rejects.toThrow("changed input");
  expect(native).toHaveBeenCalledOnce();
});

it("keeps unknown remote writes held across original-ID retries", async () => {
  const rows = new Map<string, any>();
  const native = vi.fn(async () => {
    throw new Error("Target reply lost");
  });
  const ports = {
    read: async (key: string) => rows.get(key),
    write: async (key: string, value: any) => {
      rows.set(key, value);
    },
    native,
  };
  const source = { environmentId: "origin", threadId: "room" };
  const input = { grantId: "grant", requestId: "original", action: "tasks.update", input: {} };
  expect(
    await new AssistantRoomRemote(ports).call(
      "remote.call",
      input,
      source,
      "original",
      async () => true,
    ),
  ).toMatchObject({ state: "uncertain" });
  expect(
    await new AssistantRoomRemote(ports).call(
      "remote.call",
      input,
      source,
      "original",
      async () => true,
    ),
  ).toMatchObject({ state: "uncertain" });
  expect(native).toHaveBeenCalledOnce();
});
