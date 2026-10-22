// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { loadPromptTemplates, savePromptTemplates } from "../../sessions/model/promptTemplates";
import { insertSshSnippet, loadSshSnippets, saveSshSnippet } from "./sshSnippets";
beforeEach(() => localStorage.clear());
const save = () => saveSshSnippet({ serverId: "server-a", name: "Status", command: "git status" });
it("reuses the existing template body store and scopes references by canonical server", () => {
  const snippet = save();
  expect(loadPromptTemplates()).toEqual([{ id: snippet.id, name: "Status", body: "git status" }]);
  expect(loadSshSnippets("server-a")).toEqual([snippet]);
  expect(loadSshSnippets("server-b")).toEqual([]);
  expect(localStorage.getItem("bycoda.sshSnippetReferences.v1")).not.toContain("git status");
});
it("preserves unrelated templates and increments revisions on explicit saves", () => {
  savePromptTemplates([{ id: "prompt", name: "Explain", body: "Explain the code" }]);
  const first = save();
  const second = saveSshSnippet({
    ...first,
    command: "git diff",
    expectedVersion: first.version,
    expectedCommand: first.command,
  });
  expect(second.version).toBe(2);
  expect(loadPromptTemplates().find((template) => template.id === "prompt")?.body).toBe(
    "Explain the code",
  );
  expect(() =>
    saveSshSnippet({ ...first, expectedVersion: 1, expectedCommand: first.command }),
  ).toThrow("changed");
});
it("invalidates insertion after Settings edits a shared template until reviewed", async () => {
  const first = save();
  savePromptTemplates([{ id: first.id, name: "Status", body: "git diff" }]);
  expect(loadSshSnippets("server-a")[0].reviewed).toBe(false);
  const insert = vi.fn();
  await expect(insertSshSnippet(first, "server-a", insert)).rejects.toThrow("Review");
  expect(insert).not.toHaveBeenCalled();
  expect(() =>
    saveSshSnippet({ ...first, expectedVersion: 1, expectedCommand: first.command }),
  ).toThrow("changed");
});
it("inserts exact command text without Enter only after explicit action", async () => {
  const snippet = save();
  const insert = vi.fn().mockResolvedValue(undefined);
  expect(insert).not.toHaveBeenCalled();
  await insertSshSnippet(snippet, "server-a", insert);
  expect(insert).toHaveBeenCalledExactlyOnceWith("git status");
});
it("rejects wrong targets and deleted templates without writing to a terminal", async () => {
  const snippet = save();
  const insert = vi.fn();
  await expect(insertSshSnippet(snippet, "server-b", insert)).rejects.toThrow("Review");
  savePromptTemplates([]);
  await expect(insertSshSnippet(snippet, "server-a", insert)).rejects.toThrow("Review");
  expect(insert).not.toHaveBeenCalled();
});
it.each([
  "echo a\necho b",
  "echo a\r",
  "\u001b[200~uname",
  "echo\tsecret",
  "echo \u009b",
  "echo\u2028a",
])("rejects multiline/control input %j", (command) => {
  expect(() => saveSshSnippet({ serverId: "a", name: "Unsafe", command })).toThrow(
    "one command line",
  );
  expect(loadPromptTemplates()).toEqual([]);
});
it("fails closed on malformed metadata without replacing it", () => {
  localStorage.setItem("bycoda.sshSnippetReferences.v1", "broken");
  expect(() => loadSshSnippets("a")).toThrow();
  expect(() => save()).toThrow();
  expect(localStorage.getItem("bycoda.sshSnippetReferences.v1")).toBe("broken");
});
