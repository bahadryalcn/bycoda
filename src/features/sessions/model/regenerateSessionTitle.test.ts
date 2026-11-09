import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "./session";
const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  get: vi.fn(),
  stamp: vi.fn(),
  save: vi.fn(),
  binding: vi.fn(),
  remote: vi.fn(),
  machine: vi.fn(),
  remoteSession: vi.fn(),
  access: vi.fn(),
  status: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("../../../integrations/harness", () => ({ generateHarnessTitle: mocks.generate }));
vi.mock("../data/sessionStore", () => ({
  getSession: mocks.get,
  storedSessionUpdatedAt: mocks.stamp,
  upsertSessionIfUnchanged: mocks.save,
}));
vi.mock("../../connections/model/sessionExecutionBinding", () => ({
  hostSessionBinding: mocks.binding,
}));
vi.mock("../../connections/model/connections", () => ({
  loadRemoteSession: mocks.remote,
  remoteMachineFor: mocks.machine,
  remoteSessionFor: mocks.remoteSession,
  sessionAccessForMachine: mocks.access,
}));
import { regenerateSessionTitle, TitleRegenerationConflictError } from "./regenerateSessionTitle";

const session = () =>
  ({
    id: "s",
    cwd: "/project",
    harness: "codex",
    model: "codex:work",
    title: "Old title",
    blocks: [{ id: "m", role: "user", text: "Fix title generation" }],
  }) as Session;
const target = {
  harness: "codex" as const,
  model: "codex:terra",
  modelSettings: { effort: "low" },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockImplementation(async () => session());
  mocks.stamp.mockResolvedValue(100);
  mocks.save.mockResolvedValue(true);
  mocks.generate.mockResolvedValue({ title: "Better title", workItem: null });
  mocks.access.mockReturnValue({ status: mocks.status, dispatch: mocks.dispatch });
});

it("persists only against the read native revision and keeps active transcript in returned state", async () => {
  const active = {
    ...session(),
    blocks: [
      ...session().blocks,
      { id: "reply", role: "assistant" as const, text: "New live output" },
    ],
  };
  const result = await regenerateSessionTitle(session(), target, {
    commandId: "one",
    assertWritable: vi.fn(),
    currentSession: () => active,
  });
  expect(mocks.generate).toHaveBeenCalledWith(
    "codex",
    expect.objectContaining({ model: target.model, modelSettings: target.modelSettings }),
  );
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({ title: expect.stringContaining("Better title") }),
    100,
  );
  expect(result.blocks).toBe(active.blocks);
});

it("does not overwrite a manual rename during native generation", async () => {
  await expect(
    regenerateSessionTitle(session(), target, {
      commandId: "one",
      assertWritable: vi.fn(),
      currentSession: () => ({ ...session(), title: "Manual" }),
    }),
  ).rejects.toThrow("Conversation title changed");
  expect(mocks.save).not.toHaveBeenCalled();
});

it("rejects a native revision change before persistence", async () => {
  mocks.stamp.mockResolvedValueOnce(100).mockResolvedValueOnce(101);
  await expect(
    regenerateSessionTitle(session(), target, { commandId: "one", assertWritable: vi.fn() }),
  ).rejects.toThrow("Conversation changed");
  expect(mocks.save).not.toHaveBeenCalled();
});

it("reconciles an accepted Host command without regenerating and retains owner route", async () => {
  mocks.binding.mockReturnValue({
    created: true,
    machineId: "owner",
    environmentId: "environment",
    sessionId: "host-s",
    authorityGeneration: 7,
  });
  mocks.status.mockResolvedValue({ commandId: "same", sessionId: "host-s", revision: 8 });
  mocks.remote.mockResolvedValue({
    authorityGeneration: 7,
    session: { id: "host-s", title: "Host title" },
  });
  const result = await regenerateSessionTitle(session(), target, {
    commandId: "same",
    assertWritable: vi.fn(),
  });
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(mocks.access).toHaveBeenCalledWith("owner", false, true, "environment");
  expect(result.title).toBe("Host title");
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("does not fall back to native generation after Host dispatch failure", async () => {
  mocks.binding.mockReturnValue({
    created: true,
    machineId: "owner",
    environmentId: "environment",
    sessionId: "host-s",
    authorityGeneration: 7,
  });
  mocks.status.mockResolvedValue(null);
  mocks.remote.mockResolvedValue({
    authorityGeneration: 7,
    session: { id: "host-s", title: "Old title" },
  });
  mocks.dispatch.mockRejectedValue(new Error("Disconnected"));
  await expect(
    regenerateSessionTitle(session(), target, { commandId: "same", assertWritable: vi.fn() }),
  ).rejects.toThrow("Disconnected");
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("targets the adopted remote session and fresh authority generation", async () => {
  mocks.machine.mockResolvedValue({ id: "remote-owner" });
  mocks.remoteSession.mockReturnValue("actual-host-session");
  mocks.remote.mockResolvedValue({
    projectId: "p",
    authorityGeneration: 9,
    session: { id: "actual-host-session", title: "Old title" },
  });
  mocks.status.mockResolvedValue(null);
  mocks.dispatch.mockResolvedValue({
    commandId: "remote-request",
    sessionId: "actual-host-session",
    revision: 3,
  });
  await regenerateSessionTitle({ ...session(), cwd: "remote://environment/project" }, target, {
    commandId: "remote-request",
    assertWritable: vi.fn(),
  });
  expect(mocks.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: "actual-host-session",
      authorityGeneration: 9,
      expectedTitle: "Old title",
    }),
  );
  expect(mocks.access).toHaveBeenCalledWith("remote-owner", false, true, "environment");
});

it("marks a proven Host title conflict as a fresh-attempt rejection without dispatch", async () => {
  mocks.binding.mockReturnValue({
    created: true,
    machineId: "owner",
    environmentId: "environment",
    sessionId: "host-s",
    authorityGeneration: 7,
  });
  mocks.remote.mockResolvedValue({
    authorityGeneration: 7,
    session: { id: "host-s", title: "Manual rename" },
  });
  mocks.status.mockResolvedValue(null);
  await expect(
    regenerateSessionTitle(session(), target, { commandId: "same", assertWritable: vi.fn() }),
  ).rejects.toBeInstanceOf(TitleRegenerationConflictError);
  expect(mocks.dispatch).not.toHaveBeenCalled();
});
