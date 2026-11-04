import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { WorkspaceCommands } from "../../workspace-commands";
import { inspectConversationPath } from "../../conversation/conversation-file-mutations";

vi.mock("../../git/git-worktrees", () => ({ hostWorktrees: vi.fn(async (cwd: string) => ({ defaultRoot: cwd, worktrees: [{ path: cwd }] })) }));

it("rechecks Room authority after hash inspection before deleting a path", async () => {
  const root = await mkdtemp(join(tmpdir(), "room-file-effect-"));
  try {
    const path = join(root, "retained.txt"); await writeFile(path, "keep");
    const inspected = await inspectConversationPath(root, "retained.txt");
    const commands = new WorkspaceCommands({ projects: () => [{ id: "p", cwd: root }], attachmentDir: join(root, "attachments") } as never, async (_id, action) => await action());
    await expect(commands.run("delete_path", { path, expectedHash: inspected.hash }, "room", async () => false)).rejects.toThrow("authority revoked");
    expect(await readFile(path, "utf8")).toBe("keep");
  } finally { await rm(root, { recursive: true, force: true }); }
});
