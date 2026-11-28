import { expect, it } from "vitest";
import { applyHarnessEvent } from "../../../integrations/harness/core/apply";
import type { HarnessEvent } from "../../../integrations/harness/core/types";
import { mapCodexNotification } from "../../../integrations/harness/providers/codex/codexProtocol";
import { newSession, type Block, type Session } from "./session";
import { groupTurns } from "./transcriptActivity";
import { turnChangedFiles } from "./turnChangedFiles";

const prompt = (id: string): Block => ({ id, role: "user", text: id });
const edit = (callId: string, path: string, status = "completed"): HarnessEvent => ({
  type: "tool.updated",
  callId,
  kind: "edit",
  status,
  preview: { kind: "write", path, additions: 1, deletions: 2 },
});

it("groups persisted Codex and legacy edits per turn, merging repeats by resolved path", () => {
  const primary = prompt("first");
  const changes = [
    { path: "src/a.ts", kind: "update", diff: "@@ -1 +1,2 @@\n--- old\n+++ replacement\n+new\n" },
    { path: "src/b.ts", kind: "add", diff: "one\r\ntwo\r\n" },
    { path: "src/c.ts", kind: "delete", diff: "removed without final newline" },
    { path: "src/d.ts", kind: "update", diff: "Binary files differ" },
    { path: "src/e.ts", kind: "update" },
  ];
  const codex = mapCodexNotification("item/completed", {
    item: { id: "multi", type: "fileChange", status: "completed", changes },
  }).events[0];
  let session = { ...newSession("codex", "/repo"), blocks: [primary] };
  session = applyHarnessEvent(session, codex);
  session = applyHarnessEvent(session, edit("repeat", "/repo/src/a.ts"));
  session = applyHarnessEvent(session, edit("failed", "broken.ts", "failed"));
  session = applyHarnessEvent(session, edit("running", "pending.ts", "in_progress"));
  session = { ...session, blocks: [...session.blocks, prompt("second")] };
  session = applyHarnessEvent(session, edit("new-turn", "src/a.ts"));
  const saved = JSON.stringify(session);
  const reloaded: Session = JSON.parse(saved);
  expect(reloaded.blocks[1].tool?.fileChanges).toHaveLength(5);
  const turns = groupTurns(reloaded.blocks);
  const records = (turn: Block[]) =>
    turnChangedFiles(turn, session.cwd).map(({ path, counts }) => ({ path, counts }));
  expect(records(turns[0])).toEqual([
    { path: "src/a.ts", counts: { additions: 3, deletions: 3 } },
    { path: "src/b.ts", counts: { additions: 2, deletions: 0 } },
    { path: "src/c.ts", counts: { additions: 0, deletions: 1 } },
    { path: "src/d.ts", counts: undefined },
    { path: "src/e.ts", counts: undefined },
  ]);
  expect(records(turns[1])).toEqual([{ path: "src/a.ts", counts: { additions: 1, deletions: 2 } }]);
  expect(records([prompt("plain")])).toEqual([]);
});

it("classifies added, deleted and modified files and leaves unknown kinds unset", () => {
  const seed = { ...newSession("codex", "/repo"), blocks: [prompt("first")] };
  const patch = "@@ -1 +1 @@\n-a\n+b\n";
  const session = applyHarnessEvent(seed, {
    type: "tool.updated",
    callId: "multi",
    kind: "edit",
    status: "completed",
    fileChanges: [
      { path: "src/new.ts", kind: "add", contents: "x\n" },
      { path: "src/old.ts", kind: "delete", contents: "y\n" },
      { path: "src/same.ts", kind: "update", contents: patch },
      { path: "src/both.ts", kind: "add", contents: "x\n" },
    ],
  });
  const again = applyHarnessEvent(session, {
    type: "tool.updated",
    callId: "later",
    kind: "edit",
    status: "completed",
    fileChanges: [{ path: "src/both.ts", kind: "update", contents: patch }],
  });
  const legacy: Block = {
    id: "legacy",
    text: "Edit title.ts",
    role: "tool",
    tool: { status: "completed", kind: "edit" },
  };
  expect(
    turnChangedFiles([...again.blocks, legacy], "/repo").map(({ path, status }) => [path, status]),
  ).toEqual([
    ["src/new.ts", "added"],
    ["src/old.ts", "deleted"],
    ["src/same.ts", "modified"],
    ["src/both.ts", "added"],
    ["title.ts", undefined],
  ]);
});

it("waits for successful edit evidence and keeps uncertain legacy counts absent", () => {
  const seed = { ...newSession("claude", "/repo"), blocks: [prompt("first")] };
  const changed = { path: "new.ts", kind: "add" as const, contents: "hello\n" };
  const partial = applyHarnessEvent(seed, {
    type: "tool.updated",
    callId: "pending",
    kind: "edit",
    status: "in_progress",
    fileChanges: [changed],
  });
  expect(partial.blocks.at(-1)?.tool?.fileChanges).toBeUndefined();
  const completed = applyHarnessEvent(partial, {
    type: "tool.updated",
    callId: "pending",
    kind: "edit",
    status: "success",
    fileChanges: [changed],
  });
  const updated = applyHarnessEvent(completed, {
    type: "tool.updated",
    callId: "pending",
    detail: "done",
  });
  expect(turnChangedFiles(updated.blocks, "/repo")).toMatchObject([
    { path: "new.ts", counts: { additions: 1, deletions: 0 } },
  ]);
  const legacy: Block[] = [
    {
      id: "legacy",
      text: "Write new.ts",
      role: "tool",
      tool: { status: "completed", preview: { kind: "write", path: "new.ts", contentOnly: true } },
    },
    {
      id: "path",
      text: "Edit title.ts",
      role: "tool",
      tool: { status: "completed", kind: "edit" },
    },
    {
      id: "read",
      text: "Read existing.ts",
      role: "tool",
      tool: { status: "completed", kind: "read" },
    },
    {
      id: "denied",
      text: "Edit denied.ts",
      role: "tool",
      approval: { requestId: 1, decided: "deny" },
      tool: { status: "completed" },
    },
  ];
  expect(turnChangedFiles([...updated.blocks, ...legacy], "/repo")).toMatchObject([
    { path: "new.ts", counts: undefined },
    { path: "title.ts", openPath: "/repo/title.ts" },
  ]);
});

it("marks a file Claude's Write created as added and an overwritten one as modified", () => {
  const write = (id: string, path: string, detail: string): Block => ({
    id,
    text: `Write ${path}`,
    role: "tool",
    tool: { status: "completed", detail, preview: { kind: "write", path, contentOnly: true } },
  });
  expect(
    turnChangedFiles(
      [
        write("a", "new.ts", "File created successfully at: /repo/new.ts"),
        write("b", "old.ts", "The file /repo/old.ts has been updated successfully."),
        write("c", "new.ts", "The file /repo/new.ts has been updated successfully."),
      ],
      "/repo",
    ),
  ).toMatchObject([
    { path: "new.ts", status: "added" },
    { path: "old.ts", status: "modified" },
  ]);
});
