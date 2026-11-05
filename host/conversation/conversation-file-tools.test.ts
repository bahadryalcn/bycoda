import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callFileConversationTool } from "./conversation-file-tools";
import { conversationToolCatalog, validateConversationTool } from "./conversation-tools";

const roots: string[] = [];
const root = () => {
  const value = mkdtempSync(join(tmpdir(), "bycoda-mcp-files-"));
  roots.push(value);
  return value;
};
afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

it("registers bounded reads without project, root or write authority", () => {
  for (const [action, input] of Object.entries({
    "files.list": {},
    "files.index": {},
    "files.search": { query: "code" },
    "files.searchContent": { query: "code" },
    "files.read": { path: "code.ts" },
    "git.index": {},
    "git.fileDiff": { path: "code.ts" },
    "git.branches": {},
    "git.worktrees": {},
  })) {
    expect(
      conversationToolCatalog().find((tool) => tool.action === action)?.annotations.readOnlyHint,
    ).toBe(true);
    expect(() => validateConversationTool(action, input)).not.toThrow();
    for (const extra of [{ cwd: "/other" }, { projectId: "other" }, { approved: true }])
      expect(() => validateConversationTool(action, { ...input, ...extra })).toThrow();
  }
  expect(() => validateConversationTool("files.read", { path: "a", maxChars: 16001 })).toThrow();
  expect(() =>
    validateConversationTool("files.searchContent", { query: "a", limit: 101 }),
  ).toThrow();
});

it("pages redacted text and refuses traversal and binary reads", async () => {
  const cwd = root();
  writeFileSync(join(cwd, "a.txt"), "api_key=private-value\n" + "content".repeat(100));
  const first = (await callFileConversationTool(cwd, "files.read", {
    path: "a.txt",
    maxChars: 200,
  })) as any;
  expect(first.text).toContain("[REDACTED]");
  expect(first.text).not.toContain("private-value");
  expect(first.nextOffset).toBe(200);
  const next = (await callFileConversationTool(cwd, "files.read", {
    path: "a.txt",
    offset: 200,
  })) as any;
  expect(first.text + next.text).toHaveLength(first.totalChars);
  await expect(callFileConversationTool(cwd, "files.read", { path: "../outside" })).rejects.toThrow(
    "outside",
  );
  writeFileSync(join(cwd, "binary"), Buffer.from([0, 1, 2]));
  await expect(callFileConversationTool(cwd, "files.read", { path: "binary" })).rejects.toThrow(
    "Binary",
  );
});

it("creates without overwriting and saves only the version read by the caller", async () => {
  const cwd = root();
  expect(() =>
    validateConversationTool("files.create", { parent: ".", name: "a.txt", isDir: false }),
  ).not.toThrow();
  await callFileConversationTool(cwd, "files.create", { parent: ".", name: "a.txt", isDir: false });
  await expect(
    callFileConversationTool(cwd, "files.create", { parent: ".", name: "a.txt", isDir: false }),
  ).rejects.toThrow();
  const first = (await callFileConversationTool(cwd, "files.read", { path: "a.txt" })) as any;
  await callFileConversationTool(cwd, "files.write", {
    path: "a.txt",
    expectedHash: first.hash,
    content: "first",
  });
  await expect(
    callFileConversationTool(cwd, "files.write", {
      path: "a.txt",
      expectedHash: first.hash,
      content: "stale",
    }),
  ).rejects.toThrow("changed");
  expect(((await callFileConversationTool(cwd, "files.read", { path: "a.txt" })) as any).text).toBe(
    "first",
  );
  expect(
    conversationToolCatalog().find((tool) => tool.action === "files.write")?.annotations
      .readOnlyHint,
  ).toBe(false);
  await expect(
    callFileConversationTool(cwd, "files.create", {
      parent: ".",
      name: "../outside",
      isDir: false,
    }),
  ).rejects.toThrow();
});

it("uses real workspace search, pagination and Git diff without changing the checkout", async () => {
  const cwd = root();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, windowsHide: true, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(cwd, "a.txt"), "base\n");
  git("add", "a.txt");
  git("commit", "-qm", "base");
  writeFileSync(join(cwd, "a.txt"), "changed api_key=private-value\n");
  writeFileSync(join(cwd, "b.txt"), "changed\n");
  const before = git("status", "--porcelain");
  const listing = (await callFileConversationTool(cwd, "files.list", { limit: 1 })) as any;
  expect(listing.items).toHaveLength(1);
  expect(listing.nextOffset).toBe(1);
  const search = (await callFileConversationTool(cwd, "files.searchContent", {
    query: "changed",
    limit: 1,
  })) as any;
  expect(search.items).toHaveLength(1);
  expect(JSON.stringify(search)).not.toContain("private-value");
  const diff = (await callFileConversationTool(cwd, "git.fileDiff", { path: "a.txt" })) as any;
  expect(diff.original.text).toBe("base\n");
  expect(diff.current.text).toContain("[REDACTED]");
  const index = (await callFileConversationTool(cwd, "git.index", { limit: 1 })) as any;
  expect(index.items).toHaveLength(1);
  expect(git("status", "--porcelain")).toBe(before);
});
