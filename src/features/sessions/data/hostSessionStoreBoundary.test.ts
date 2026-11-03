// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { newSession } from "../model/session";
import { saveHostSessionBinding } from "../../connections/model/sessionExecutionBinding";
import {
  deleteSession,
  getSession,
  listSessionsByProject,
  listRecentSessions,
  setSessionArchived,
  setSessionPinned,
  shouldPersistSession,
  updateOwnedSessionMetadata,
  upsertSession,
} from "./sessionStore";

const owner = vi.hoisted(() => ({ update: vi.fn(), delete: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../connections/model/connections", async (original) => ({
  ...(await original<typeof import("../../connections/model/connections")>()),
  sessionAccessForMachine: () => owner,
}));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset().mockResolvedValue([]);
  owner.update.mockReset().mockResolvedValue({});
  owner.delete.mockReset().mockResolvedValue({});
});

function bound() {
  const session = {
    ...newSession("codex", "G:/repo"),
    worktreeCwd: "G:/worktree",
    blocks: [{ id: "u", role: "user" as const, text: "Host transcript" }],
  };
  return saveHostSessionBinding(session, {
    kind: "local-host",
    machineId: "local",
    environmentId: "home",
    projectId: "project",
    sessionId: session.id,
    authorityGeneration: null,
    created: true,
  });
}

it("restores and lists a local Host shell without writing an authoritative Native transcript", async () => {
  const session = bound();
  expect(shouldPersistSession(session)).toBe(false);
  expect(await upsertSession(session)).toBeNull();
  expect(await getSession(session.id)).toMatchObject({
    id: session.id,
    cwd: "G:/repo",
    worktreeCwd: "G:/worktree",
    blocks: [],
    hostBinding: session.hostBinding,
  });
  expect(await listSessionsByProject("G:/repo")).toEqual([
    expect.objectContaining({ id: session.id, worktreeCwd: "G:/worktree" }),
  ]);
  expect(vi.mocked(invoke).mock.calls.map(([method]) => method)).toEqual([
    "session_list_by_project",
  ]);
});

it("routes metadata and deletion to the exact unfenced Host owner without inventing a generation", async () => {
  const session = bound();
  await setSessionArchived(session.id, true);
  await setSessionPinned(session.id, true);
  await updateOwnedSessionMetadata(session.id, { title: "Renamed on Host" });
  expect(owner.update.mock.calls).toEqual([
    [session.id, { projectId: "project", archived: true }],
    [session.id, { projectId: "project", pinned: true }],
    [session.id, { projectId: "project", title: "Renamed on Host" }],
  ]);
  expect(await getSession(session.id)).toMatchObject({ title: "Renamed on Host" });
  await deleteSession(session.id);
  expect(owner.delete).toHaveBeenCalledWith(session.id, "project", undefined);
  expect(await getSession(session.id)).toMatchObject({ hostBinding: session.hostBinding });
  expect(await listSessionsByProject("G:/repo")).toEqual([]);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([method]) =>
        ["session_upsert", "session_delete", "session_set_archived", "session_set_pinned"].includes(
          method,
        ),
      ),
  ).toBe(false);
});

it("retains all pinned Native rows when combining recent Host shells with a bounded recent window", async () => {
  bound();
  const base = {
    cwd: "G:/repo",
    title: "Pinned",
    harness: "codex",
    model: "model",
    runtimeMode: "supervised",
    createdAt: 1,
    updatedAt: 1,
    pinned: true,
  };
  vi.mocked(invoke).mockResolvedValueOnce([
    { ...base, id: "native-one" },
    { ...base, id: "native-two" },
  ]);
  const rows = await listRecentSessions(1);
  expect(rows.map((row) => row.id)).toEqual(["native-one", "native-two", expect.any(String)]);
});

it("keeps failed Host metadata delivery local and never falls back to Native", async () => {
  const session = bound();
  owner.update.mockRejectedValue(new Error("Host offline"));
  await expect(setSessionPinned(session.id, true)).rejects.toThrow("Host offline");
  expect(await getSession(session.id)).toMatchObject({ hostBinding: session.hostBinding });
  expect(vi.mocked(invoke).mock.calls).toEqual([]);
});
