// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { parseCodeWorkspace } from "../model/codeWorkspace";
import { projectDisplayName } from "../model/projectNames";
import { loadRecents, rememberImportedProjects } from "../model/recents";
import {
  assignProjectsToNamedGroup,
  linkProjectGroup,
  loadProjectGroups,
  projectGroupMembers,
  loadProjectGroupAssignments,
} from "../model/projectGroups";
import { saveWorkspaceProjectNames, saveAutoTabGroupLabel } from "../../workspace/model/tabGroups";
import { syncLinkedGroup } from "./useLinkedWorkspaceGroups";

const { readTextFile, listDir } = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  listDir: vi.fn(async () => []),
}));
vi.mock("../../../platform/tauri/fs", () => ({
  readTextFile,
  listDir,
  basename: (path: string) => path.split("/").pop(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn(async () => {}) }));
vi.mock("../../files/model/fileWatch", () => ({ watchFile: vi.fn(() => () => {}) }));

const file = "/work/wallet.code-workspace";
const a = "/work/pf-account/srv";
const b = "/work/pf-payment/srv";
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

it("keeps aliases across import, reopen and sync without replacing project/session records", async () => {
  rememberImportedProjects([{ path: a, lastUsedAt: 123 }]);
  localStorage.setItem("existing-session-record", JSON.stringify({ id: "session-1", cwd: a }));
  saveAutoTabGroupLabel(a, "srv 3");
  const text = JSON.stringify({
    folders: [{ name: "pf-account-srv", path: "pf-account/srv" }, { path: "pf-payment/srv" }],
  });
  const workspace = parseCodeWorkspace(text, file);
  saveWorkspaceProjectNames(workspace.folders, workspace.folderNames);
  rememberImportedProjects(workspace.folders.map((path) => ({ path, lastUsedAt: 456 })));
  const group = assignProjectsToNamedGroup(workspace.name, workspace.folders)!;
  linkProjectGroup(group.id, file, workspace.folders);
  expect(projectDisplayName(a)).toBe("pf-account-srv");
  expect(projectDisplayName(b)).toBe("srv");
  expect(loadRecents().find((item) => item.path === a)?.openedAt).toBe(123);
  // Startup sync re-reads the file for already-linked members, including name-only edits.
  readTextFile.mockResolvedValue(
    JSON.stringify({
      folders: [
        { name: "account-api", path: "pf-account/srv" },
        { name: "payment-api", path: "pf-payment/srv" },
      ],
    }),
  );
  const added = vi.fn();
  await syncLinkedGroup(loadProjectGroups()[0].id, added);
  expect(projectDisplayName(a)).toBe("account-api");
  expect(projectDisplayName(b)).toBe("payment-api");
  expect(added).not.toHaveBeenCalled();
  expect(projectGroupMembers(group.id, loadProjectGroupAssignments())).toEqual(
    expect.arrayContaining([a, b]),
  );
  readTextFile.mockResolvedValue(
    JSON.stringify({
      folders: [
        { path: "pf-account/srv" },
        { path: "pf-payment/srv" },
        { name: "third-api", path: "third/srv" },
      ],
    }),
  );
  await syncLinkedGroup(group.id, added);
  expect(projectDisplayName(a)).toBe("srv");
  expect(projectDisplayName(b)).toBe("srv");
  expect(projectDisplayName("/work/third/srv")).toBe("third-api");
  expect(loadRecents()).toHaveLength(3);
  expect(localStorage.getItem("existing-session-record")).toBe(
    JSON.stringify({ id: "session-1", cwd: a }),
  );
});
