// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { newLocalHostSession } from "./newLocalHostSession";
import { remoteRequest } from "./connections";
import {
  acknowledgeHostSessionBinding,
  hostSessionBinding,
  restoreHostSessionShell,
} from "./sessionExecutionBinding";
import { setWorktreeFocus } from "../../source-control/model/worktreeFocus";
import { newDefaultSession } from "../../sessions/model/session";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./sessionExecutionBinding", async (original) => ({
  ...(await original<typeof import("./sessionExecutionBinding")>()),
  flushHostSessionBindings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./connections", () => ({ remoteRequest: vi.fn(), refreshRemoteMachines: vi.fn() }));
const machine = {
  id: "local",
  localHost: true,
  name: "This computer",
  endpoint: "http://127.0.0.1:3776",
  environmentId: "home",
};

beforeEach(() => {
  localStorage.clear();
  setWorktreeFocus("G:/repo", undefined);
  vi.mocked(invoke).mockReset().mockResolvedValue(machine);
  vi.mocked(remoteRequest)
    .mockReset()
    .mockImplementation(async (_id, method) => {
      if (method === "environment.describe")
        return {
          environmentId: "home",
          capabilities: ["sessions.createFirstTurn", "sessions.managedCreation.v1"],
        } as never;
      if (method === "projects.open") return { id: "project", cwd: "G:/repo" } as never;
      throw new Error("Unexpected method " + method);
    });
});

it("ordinary local creation stays Native while explicit creation durably binds local project identity", async () => {
  expect(hostSessionBinding(newDefaultSession("G:/repo"))).toBeUndefined();
  const session = await newLocalHostSession("G:/repo", "auto-accept-edits");
  expect(session.cwd).toBe("G:/repo");
  expect(session.runtimeMode).toBe("auto-accept-edits");
  expect(hostSessionBinding(session)).toEqual({
    kind: "local-host",
    machineId: "local",
    environmentId: "home",
    projectId: "project",
    sessionId: session.id,
    authorityGeneration: null,
    created: false,
  });
  expect(restoreHostSessionShell(session.id)?.hostBinding).toEqual(session.hostBinding);
  acknowledgeHostSessionBinding(session, session.id, 1);
  expect(hostSessionBinding(session)?.authorityGeneration).toBe(1);
  expect(restoreHostSessionShell(session.id)?.blocks).toEqual([]);
});

it("retains selected worktree separately from the local project and owner", async () => {
  setWorktreeFocus("G:/repo", { path: "G:/worktree", branch: "topic" });
  const session = await newLocalHostSession("G:/repo");
  expect(session).toMatchObject({ cwd: "G:/repo", worktreeCwd: "G:/worktree", branch: "topic" });
  expect(hostSessionBinding(session)?.environmentId).toBe("home");
});

it("refuses an unavailable, replaced or old Host before allocating a writable shell", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(null);
  await expect(newLocalHostSession("G:/repo")).rejects.toThrow("unavailable");
  vi.mocked(remoteRequest).mockResolvedValueOnce({
    environmentId: "replacement",
    capabilities: [],
  } as never);
  await expect(newLocalHostSession("G:/repo")).rejects.toThrow("Update");
  expect(
    [...Array(localStorage.length)]
      .map((_, index) => localStorage.key(index))
      .some((key) => key?.startsWith("bycoda.host-session-binding")),
  ).toBe(false);
});

it("keeps canonical fresh generation absent and rejects late acknowledgements after a newer generation", async () => {
  const session = await newLocalHostSession("G:/repo");
  acknowledgeHostSessionBinding(session, session.id, undefined);
  expect(hostSessionBinding(session)).toMatchObject({ authorityGeneration: null, created: true });
  acknowledgeHostSessionBinding(session, session.id, 7);
  expect(() => acknowledgeHostSessionBinding(session, session.id, 5)).toThrow(
    "different session owner",
  );
  expect(() => acknowledgeHostSessionBinding(session, session.id, undefined)).toThrow(
    "different session owner",
  );
  expect(hostSessionBinding(session)?.authorityGeneration).toBe(7);
});

it("rejects a delayed acknowledgement if its durable owner route was replaced", async () => {
  const session = await newLocalHostSession("G:/repo");
  const key = "bycoda.host-session-binding.v1:" + session.id;
  const stored = JSON.parse(localStorage.getItem(key)!);
  stored.binding.environmentId = "replacement";
  localStorage.setItem(key, JSON.stringify(stored));
  expect(() => acknowledgeHostSessionBinding(session, session.id, undefined)).toThrow(
    "owner changed",
  );
  expect(hostSessionBinding(session)?.environmentId).toBe("replacement");
});
