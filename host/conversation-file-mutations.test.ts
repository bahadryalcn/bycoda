import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "./store";
import { WorkspaceCommands } from "./workspace-commands";
import { callFileConversationTool } from "./conversation-file-tools";
import { inspectConversationPath } from "./conversation-file-mutations";
import { writeHostFile } from "./workspace";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bycoda-file-lifecycle-"));
  const store = new HostStore(join(root, "host.db"));
  store.addProject(root, "Files");
  const workspace = new WorkspaceCommands(store, async (_id, fn) => fn());
  cleanup.push(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, workspace };
}

it("rejects deletion when an editor write wins after the caller's initial inspection", async () => {
  const { root, workspace } = fixture();
  writeFileSync(join(root, "file.txt"), "old");
  const expectedHash = (await inspectConversationPath(root, "file.txt")).hash;
  await expect(
    callFileConversationTool(
      root,
      "files.delete",
      { path: "file.txt", expectedHash },
      async (command, input) => {
        await writeHostFile(root, "file.txt", "old", "new");
        return workspace.run(command, input);
      },
    ),
  ).rejects.toThrow("changed before commit");
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("new");
});

it("rejects a source redirected through a new in-checkout junction before commit", async () => {
  const { root, workspace } = fixture();
  mkdirSync(join(root, "source"));
  mkdirSync(join(root, "victim"));
  writeFileSync(join(root, "source", "file.txt"), "same bytes");
  writeFileSync(join(root, "victim", "file.txt"), "same bytes");
  const expectedHash = (await inspectConversationPath(root, "source/file.txt")).hash;
  await expect(
    callFileConversationTool(
      root,
      "files.delete",
      { path: "source/file.txt", expectedHash },
      async (command, input) => {
        rmSync(join(root, "source"), { recursive: true });
        symlinkSync(
          join(root, "victim"),
          join(root, "source"),
          process.platform === "win32" ? "junction" : "dir",
        );
        return workspace.run(command, input);
      },
    ),
  ).rejects.toThrow("changed before commit");
  expect(readFileSync(join(root, "victim", "file.txt"), "utf8")).toBe("same bytes");
});

it("refuses a destination created between copy inspection and editor commit", async () => {
  const { root, workspace } = fixture();
  writeFileSync(join(root, "file.txt"), "source");
  mkdirSync(join(root, "destination"));
  const expectedHash = (await inspectConversationPath(root, "file.txt")).hash;
  await expect(
    callFileConversationTool(
      root,
      "files.copy",
      { path: "file.txt", destinationParent: "destination", expectedHash },
      async (command, input) => {
        writeFileSync(join(root, "destination", "file.txt"), "other writer");
        return workspace.run(command, input);
      },
    ),
  ).rejects.toThrow("already exists");
  expect(readFileSync(join(root, "destination", "file.txt"), "utf8")).toBe("other writer");
  expect(existsSync(join(root, "destination", "file copy.txt"))).toBe(false);
});
