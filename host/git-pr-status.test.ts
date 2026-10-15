import { expect, it, vi } from "vitest";
import { WorkspaceCommands } from "./workspace-commands";

function commands(output: string, error?: Error) {
  const ghCommand = error ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue(output);
  const workspace = Object.assign(Object.create(WorkspaceCommands.prototype), {
    gitCommand: vi.fn().mockResolvedValue("feature/topic\n"),
    ghCommand,
  }) as WorkspaceCommands;
  return { workspace, ghCommand };
}

it("returns no PR only after a successful empty lookup", async () => {
  const { workspace, ghCommand } = commands("[]");
  await expect(workspace.run("git_pr_status", { cwd: "/repo" })).resolves.toBeNull();
  expect(ghCommand).toHaveBeenCalledWith(
    "/repo",
    expect.arrayContaining(["list", "--head", "feature/topic", "--state", "all"]),
  );
});
it("propagates authentication failures instead of reporting no PR", async () => {
  const { workspace } = commands("", new Error("Authentication required"));
  await expect(workspace.run("git_pr_status", { cwd: "/repo" })).rejects.toThrow(
    "Authentication required",
  );
});
it("prefers an open PR and normalizes its state", async () => {
  const { workspace } = commands(
    JSON.stringify([
      {
        number: 1,
        title: "Closed",
        url: "https://example.test/pull/1",
        state: "CLOSED",
      },
      {
        number: 2,
        title: "Open",
        url: "https://example.test/pull/2",
        state: "OPEN",
      },
    ]),
  );
  await expect(workspace.run("git_pr_status", { cwd: "/repo" })).resolves.toMatchObject({
    number: 2,
    state: "open",
  });
});
it("propagates malformed CLI responses", async () => {
  const { workspace } = commands("not JSON");
  await expect(workspace.run("git_pr_status", { cwd: "/repo" })).rejects.toThrow();
});
