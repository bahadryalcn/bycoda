import { beforeEach, describe, expect, it, vi } from "vitest";

const generate = vi.hoisted(() => vi.fn());
const rename = vi.hoisted(() => vi.fn());
const binding = vi.hoisted(() => vi.fn());

vi.mock("../../../integrations/harness", () => ({ generateHarnessBranchName: generate }));
vi.mock("./workspaceClient", () => ({
  workspaceRenameBranch: rename,
  resolveWorkspaceContext: vi.fn(async () => ({ cwd: "/p" })),
}));
vi.mock("../../connections/model/sessionExecutionBinding", () => ({
  hostSessionBinding: binding,
}));

import {
  renameFirstSendBranch,
  renameSessionBranch,
  shouldRenameTemporaryBranch,
} from "./branchRename";

const session = { id: "s", cwd: "/p", harness: "claude" as const };
const workspace = (branchRef: string) => ({ id: "w", revision: 3, path: "/w", branchRef });

beforeEach(() => {
  vi.clearAllMocks();
  binding.mockReturnValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("shouldRenameTemporaryBranch", () => {
  it("renames only temporary by/<8hex> branches of local sessions", () => {
    expect(shouldRenameTemporaryBranch(session, workspace("refs/heads/by/0a1b2c3d"))).toBe(true);
    expect(
      shouldRenameTemporaryBranch(session, workspace("refs/heads/by/fix-login-0a1b2c3d")),
    ).toBe(false);
    expect(shouldRenameTemporaryBranch(session, workspace("refs/heads/feature/x"))).toBe(false);
  });

  it("leaves Host-run sessions to the Host engine", () => {
    binding.mockReturnValue({ environmentId: "e" });
    expect(shouldRenameTemporaryBranch(session, workspace("refs/heads/by/0a1b2c3d"))).toBe(false);
  });
});

describe("renameSessionBranch", () => {
  const input = {
    workspaceId: "w",
    expectedRevision: 3,
    prompt: "fix login",
    harness: "claude" as const,
    cwd: "/w",
    context: {},
  };

  it("renames to the generated fragment", async () => {
    generate.mockResolvedValue("by/fix-login");
    rename.mockResolvedValue({ branchRef: "refs/heads/by/fix-login", renamed: true, revision: 4 });
    await expect(renameSessionBranch(input)).resolves.toEqual({
      branch: "by/fix-login",
      revision: 4,
    });
    expect(rename).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "w", expectedRevision: 3, fragment: "fix-login" }),
      {},
    );
  });

  it("reads a missing revision defensively", async () => {
    generate.mockResolvedValue("fix-login");
    rename.mockResolvedValue({ branchRef: "refs/heads/by/fix-login", renamed: true });
    await expect(renameSessionBranch(input)).resolves.toEqual({ branch: "by/fix-login" });
  });

  it("keeps the temporary name on empty names, refusals and failures", async () => {
    generate.mockResolvedValue(null);
    await expect(renameSessionBranch(input)).resolves.toBeNull();
    generate.mockResolvedValue("fix-login");
    rename.mockResolvedValue({ branchRef: "refs/heads/by/0a1b2c3d", renamed: false });
    await expect(renameSessionBranch(input)).resolves.toBeNull();
    rename.mockRejectedValue(new Error("no v2"));
    await expect(renameSessionBranch(input)).resolves.toBeNull();
  });
});

describe("renameFirstSendBranch", () => {
  it("skips when the branch is not temporary or the prompt is empty", async () => {
    expect(
      await renameFirstSendBranch({
        session,
        workspace: workspace("refs/heads/main"),
        prompt: "x",
      }),
    ).toBeNull();
    expect(
      await renameFirstSendBranch({
        session,
        workspace: workspace("refs/heads/by/0a1b2c3d"),
        prompt: " ",
      }),
    ).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });
});
