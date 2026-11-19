// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { peekToolsDraftPart, writeToolsDraftPart } from "../../host-tools/toolsDraftTransfer";
import { deleteSessionsByProject } from "./sessionStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

const logs = {
  buffer: [],
  source: "all" as const,
  sourceIds: [],
  level: "all",
  grouped: true,
  follow: true,
  paused: false,
  started: true,
  monitorUrl: "",
  selected: [],
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
});

it("releases tools drafts of conversations a project delete removed, and keeps the kept ones", async () => {
  const gone = { cwd: "G:/repo", sessionId: "native-gone", targetValue: "project" };
  const kept = { cwd: "G:/repo", sessionId: "native-kept", targetValue: "project" };
  writeToolsDraftPart(gone, "logs", logs);
  writeToolsDraftPart(kept, "logs", logs);
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "session_ids_by_project") return ["native-gone", "native-kept"];
    if (command === "session_delete_by_project")
      return { deleted: ["native-gone"], skipped: [], failed: null, notAttempted: ["native-kept"] };
    return undefined;
  });

  await deleteSessionsByProject("G:/repo");

  expect(peekToolsDraftPart(gone, "logs")).toBeUndefined();
  expect(peekToolsDraftPart(kept, "logs")).toEqual(logs);
});
