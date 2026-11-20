// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { newSession } from "../model/session";
import { getComposerDraft, setComposerDraft } from "../model/draftCache";
import { saveHostSessionBinding } from "../../connections/model/sessionExecutionBinding";
import { countSessionsByProject, deleteSessionsByProject } from "./sessionStore";

const owner = vi.hoisted(() => ({ delete: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock("../../connections/model/sessionExecutionBinding", async (original) => ({
  ...(await original<typeof import("../../connections/model/sessionExecutionBinding")>()),
  flushHostSessionBindings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../connections/model/connections", async (original) => ({
  ...(await original<typeof import("../../connections/model/connections")>()),
  sessionAccessForMachine: () => owner,
}));

type Outcome = {
  deleted: string[];
  skipped: string[];
  failed: { sessionId: string; error: string } | null;
  notAttempted: string[];
};
const done = (deleted: string[]): Outcome => ({
  deleted,
  skipped: [],
  failed: null,
  notAttempted: [],
});

const ids = (count: number, prefix = "native") =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

function calls(command: string) {
  return vi.mocked(invoke).mock.calls.filter(([name]) => name === command);
}

/** Lists `rows` for the project and answers every bulk batch with `answer`. */
function nativeProject(rows: string[], answer: (batch: string[]) => Outcome) {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "session_ids_by_project") return rows;
    if (command === "session_delete_by_project")
      return answer((args as { sessionIds: string[] }).sessionIds);
    return undefined;
  });
}

function hostOwnedShell(cwd: string) {
  const shell = {
    ...newSession("codex", cwd),
    blocks: [{ id: "u", role: "user" as const, text: "Host transcript" }],
  };
  return saveHostSessionBinding(shell, {
    kind: "local-host",
    machineId: "local",
    environmentId: "home",
    projectId: "project",
    sessionId: shell.id,
    authorityGeneration: null,
    created: true,
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  owner.delete.mockReset().mockResolvedValue({});
});

it("counts a project's conversations from ids, not from the summary list", async () => {
  const hosted = hostOwnedShell("G:/repo");
  // A corrupt owner record still fences its Native row: it is not an unowned conversation.
  localStorage.setItem("bycoda.host-session-binding.v1:fenced", "{broken");
  nativeProject(["native-a", "native-b", "fenced", hosted.id], () => done([]));

  // Two unowned Native rows plus the one Host-owned shell.
  await expect(countSessionsByProject("G:/repo")).resolves.toBe(3);
  expect(calls("session_ids_by_project")).toEqual([["session_ids_by_project", { cwd: "G:/repo" }]]);
  expect(calls("session_list_by_project")).toEqual([]);
  await expect(countSessionsByProject("~")).resolves.toBe(0);
});

it("does not report a failed read as an empty project", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("database unavailable"));
  await expect(countSessionsByProject("G:/repo")).rejects.toThrow("database unavailable");
  await expect(deleteSessionsByProject("G:/repo")).rejects.toThrow("database unavailable");
  expect(calls("session_delete_by_project")).toEqual([]);
});

it("deletes thousands of conversations in a few bounded batches, not one call each", async () => {
  const rows = ids(450);
  nativeProject(rows, done);
  await expect(deleteSessionsByProject("G:/repo")).resolves.toBe(450);
  expect(calls("session_delete")).toEqual([]);
  expect(calls("session_delete_by_project").map(([, args]) => args)).toEqual([
    { cwd: "G:/repo", sessionIds: rows.slice(0, 200) },
    { cwd: "G:/repo", sessionIds: rows.slice(200, 400) },
    { cwd: "G:/repo", sessionIds: rows.slice(400) },
  ]);
});

it("leaves Host-owned and fenced conversations to their owners", async () => {
  const hosted = hostOwnedShell("G:/repo");
  localStorage.setItem("bycoda.host-session-binding.v1:fenced", "{broken");
  nativeProject(["native-a", "fenced", hosted.id], done);

  await expect(deleteSessionsByProject("G:/repo")).resolves.toBe(2);
  expect(calls("session_delete_by_project").map(([, args]) => args)).toEqual([
    { cwd: "G:/repo", sessionIds: ["native-a"] },
  ]);
  // The Host shell goes through its owning Host with its project id.
  expect(owner.delete).toHaveBeenCalledTimes(1);
  expect(owner.delete).toHaveBeenCalledWith(hosted.id, "project", undefined);
});

it("stops at the first failed batch, reports the progress and keeps the failed drafts", async () => {
  const rows = ids(450);
  for (const id of ["native-0", "native-205"]) setComposerDraft(id, `unsent text for ${id}`);
  nativeProject(rows, (batch) =>
    batch[0] === "native-200"
      ? {
          deleted: batch.slice(0, 5),
          skipped: [],
          failed: { sessionId: batch[5]!, error: "write failed" },
          notAttempted: batch.slice(6),
        }
      : done(batch),
  );

  await expect(deleteSessionsByProject("G:/repo")).rejects.toThrow(
    "Deleted 205 of 450 conversations; 245 could not be removed and the project was kept. write failed",
  );
  // The third batch was never sent.
  expect(calls("session_delete_by_project")).toHaveLength(2);
  // A deleted conversation loses its draft; one that was kept keeps it.
  expect(getComposerDraft("native-0")).toBeUndefined();
  expect(getComposerDraft("native-205")).toBe("unsent text for native-205");
});

it("does not count a conversation that left the project as deleted", async () => {
  nativeProject(["native-a", "native-b"], (batch) => ({
    deleted: [batch[0]!],
    skipped: [batch[1]!],
    failed: null,
    notAttempted: [],
  }));
  await expect(deleteSessionsByProject("G:/repo")).resolves.toBe(1);
});

it("reports a Host owner failure after the Native batches were deleted", async () => {
  hostOwnedShell("G:/repo");
  nativeProject(["native-a"], done);
  owner.delete.mockRejectedValue(new Error("owner offline"));
  await expect(deleteSessionsByProject("G:/repo")).rejects.toThrow(
    "Deleted 1 of 2 conversations; 1 could not be removed and the project was kept. owner offline",
  );
});
